import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { createArchiveHost } from "../src/index.js";

const prevHome = process.env.HOME;
const prevDshHome = process.env.DSH_HOME;
const prevCwd = process.cwd();

let fakeHome: string;
let saRoot: string;

beforeEach(() => {
  fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "fh-"));
  process.env.HOME = fakeHome;
  process.env.DSH_HOME = fakeHome;
});

afterEach(() => {
  process.env.HOME = prevHome;
  process.env.DSH_HOME = prevDshHome;
  fs.rmSync(fakeHome, { recursive: true, force: true });
  if (saRoot !== undefined) {
    try { fs.rmSync(saRoot, { recursive: true, force: true }); } catch {}
  }
});

describe("session-archive host (list/detail/delete/unarchive)", () => {
  const archiveCfg = { detailMaxMessages: 50, messagePreviewChars: 500, titleReadConcurrency: 2 };

  function writeSession(id, cwd, events) {
    const dir = path.join(saRoot, "--proj--", id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "session.jsonl"), JSON.stringify(events));
    return dir;
  }

  it("list/detail/delete/unarchive + ghost/busy/live semantics", async () => {
    saRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sa-"));
    const sessions = new Map();
    const registryState = { initialized: true, workspaceIds: ["w1"], archivedSessionIds: ["s1", "s2", "s-ghost"] };
    const archiveRegistry = {
      archivedSessionIds: registryState.archivedSessionIds,
      enqueueOperation: async (operation) => { await operation(); },
      requireState: () => registryState,
      setState: (next) => { Object.assign(registryState, next); },
    };
    const headers = [];
    const persistenceMock = {
      list: async () => headers.filter((h) =>
        fs.existsSync(path.join(saRoot, "--proj--", h.id, "session.jsonl"))),
      locate: (meta) => ({ kind: "jsonl", path: path.join(saRoot, "--proj--", meta.id, "session.jsonl") }),
      readFrom: async (id) => {
        const header = headers.find((h) => h.id === id);
        if (header === void 0) throw new Error("no such session " + id);
        const events = JSON.parse(fs.readFileSync(path.join(saRoot, "--proj--", id, "session.jsonl"), "utf8"));
        return { meta: header, events };
      },
    };
    const saCtx = {
      workspaceRegistry: archiveRegistry,
      sessionPersistence: persistenceMock,
      sessions: { get: (id) => sessions.get(id) },
    };
    writeSession("s1", "/proj/a", [
      { type: "session/title", seq: 1, time: 1000, data: { title: "第一个归档会话", messageSeqs: [2] } },
      { type: "user/message", seq: 2, time: 1000, data: { id: "m1", role: "user", content: [{ type: "text", text: "你好" }] } },
      { type: "assistant/message", seq: 3, time: 2000, data: { id: "m2", role: "assistant", content: [{ type: "text", text: "你好！有什么可以帮你？" }] } },
    ]);
    writeSession("s2", "/proj/b", [
      { type: "user/message", seq: 1, time: 3000, data: { id: "m3", role: "user", content: [{ type: "text", text: "没有标题的会话" }] } },
    ]);
    headers.push({ id: "s1", cwd: "/proj/a", createdAt: 1000, version: 0 });
    headers.push({ id: "s2", cwd: "/proj/b", createdAt: 3000, version: 0 });
    headers.push({ id: "s3", cwd: "/proj/c", createdAt: 4000, version: 0 });
    const archiveHost = createArchiveHost(saCtx, archiveCfg);

    const listResult = await archiveHost.list();
    expect(listResult.items.length === 2 && !listResult.items.some((i) => i.sessionId === "s-ghost")).toBe(true);
    expect(!listResult.items.some((i) => i.sessionId === "s3")).toBe(true);
    expect(listResult.items.find((i) => i.sessionId === "s1").title === "第一个归档会话"
      && listResult.items.find((i) => i.sessionId === "s2").title === null).toBe(true);
    expect(listResult.items.every((i) => i.size > 0 && i.updatedAt > 0 && i.live === false)).toBe(true);

    // 宿主归档不停止内存会话、web 重连还会恢复旧 tab，但归档会话已从会话
    // 列表移除、无法继续对话——内存存在不构成删除风险，不再标记"运行中"。
    sessions.set("s1", {});
    const listLive = await archiveHost.list();
    expect(listLive.items.find((i) => i.sessionId === "s1").live === false).toBe(true);

    const detailResult = await archiveHost.detail("s1");
    expect(detailResult.title === "第一个归档会话"
      && detailResult.messages.length === 2
      && detailResult.messages[0].role === "user"
      && detailResult.messages[1].text.includes("可以帮你")).toBe(true);
    expect(detailResult.live === false).toBe(true);

    // busy 兜底：归档 + 仍在内存 + 文件 60s 内有写入（归档瞬间还在生成）→ 拒绝。
    const delBusy = await archiveHost.deleteArchived(["s1"]);
    expect(delBusy.deleted.length === 0 && delBusy.failed[0].reason === "busy").toBe(true);
    sessions.delete("s1");

    const delResult = await archiveHost.deleteArchived(["s1", "s-ghost"]);
    expect(delResult.deleted.includes("s1") && delResult.deleted.includes("s-ghost")
      && !fs.existsSync(path.join(saRoot, "--proj--", "s1"))).toBe(true);
    expect(registryState.archivedSessionIds.includes("s1")
      && registryState.archivedSessionIds.includes("s-ghost")
      && delResult.removedFromArchive === 0).toBe(true);
    expect(!(await archiveHost.list()).items.some((i) => i.sessionId === "s1")).toBe(true);

    const unResult = await archiveHost.unarchive(["s2"]);
    expect(unResult.restored.includes("s2")
      && fs.existsSync(path.join(saRoot, "--proj--", "s2", "session.jsonl"))
      && !registryState.archivedSessionIds.includes("s2")).toBe(true);

    const ghostUnResult = await archiveHost.unarchive(["s-ghost"]);
    expect(ghostUnResult.restored.length === 0 && registryState.archivedSessionIds.includes("s-ghost")).toBe(true);

    // 降级路径：registry 无写入通道时删除仅清文件，列表按存在性过滤
    const degraded = createArchiveHost({ ...saCtx, workspaceRegistry: { archivedSessionIds: ["s2"] } }, archiveCfg);
    const degList = await degraded.list();
    expect(degList.items.length === 1 && degList.items[0].sessionId === "s2").toBe(true);
  });

  it("count 端点 / 删除与详情的归档成员校验 / 标题 mtime 缓存", async () => {
    saRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sa2-"));
    const sessions = new Map();
    const registryState = { initialized: true, workspaceIds: ["w1"], archivedSessionIds: ["a1", "a-ghost"] };
    const archiveRegistry = {
      archivedSessionIds: registryState.archivedSessionIds,
      enqueueOperation: async (operation) => { await operation(); },
      requireState: () => registryState,
      setState: (next) => { Object.assign(registryState, next); },
    };
    const headers = [
      { id: "a1", cwd: "/proj/a", createdAt: 1000, version: 0 },
      { id: "live-unarchived", cwd: "/proj/b", createdAt: 2000, version: 0 },
    ];
    let readFromCalls = 0;
    const persistenceMock = {
      list: async () => headers.filter((h) => fs.existsSync(path.join(saRoot, "--proj--", h.id, "session.jsonl"))),
      locate: (meta) => ({ kind: "jsonl", path: path.join(saRoot, "--proj--", meta.id, "session.jsonl") }),
      readFrom: async (id) => {
        readFromCalls++;
        const header = headers.find((h) => h.id === id);
        if (header === void 0) throw new Error("no such session " + id);
        return { meta: header, events: [{ type: "session/title", seq: 1, time: 1, data: { title: "T-" + id } }] };
      },
    };
    const archiveHost = createArchiveHost({
      workspaceRegistry: archiveRegistry,
      sessionPersistence: persistenceMock,
      sessions: { get: () => undefined },
    }, archiveCfg);

    writeSession("a1", "/proj/a", []);
    writeSession("live-unarchived", "/proj/b", []);

    // count():存在性过滤后的真实数量(a-ghost 文件已删),且不触发任何事件流读取。
    const before = readFromCalls;
    expect((await archiveHost.count()).count === 1).toBe(true);
    expect(readFromCalls === before).toBe(true);

    // list() 第二次调用命中标题缓存(mtime 未变),不再重读事件流。
    await archiveHost.list();
    const afterFirstList = readFromCalls;
    expect(afterFirstList > before).toBe(true);
    await archiveHost.list();
    expect(readFromCalls === afterFirstList).toBe(true);

    // deleteArchived:未归档的会话(即使文件存在、不在内存)必须拒绝且不动文件。
    const delForeign = await archiveHost.deleteArchived(["live-unarchived"]);
    expect(delForeign.deleted.length === 0
      && delForeign.failed[0].reason === "not-archived"
      && fs.existsSync(path.join(saRoot, "--proj--", "live-unarchived", "session.jsonl"))).toBe(true);

    // detail:同样只对归档成员开放。
    let threw: any = null;
    try { await archiveHost.detail("live-unarchived"); } catch (error) { threw = error; }
    expect(threw !== null && threw.code === "NOT_ARCHIVED").toBe(true);
    expect((await archiveHost.detail("a1")).title === "T-a1").toBe(true);
  });
});
