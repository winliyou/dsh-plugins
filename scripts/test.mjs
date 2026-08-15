// 两个 host 插件 + config-store + remote 的全量回归测试
// 运行：node scripts/test.mjs（先 bash scripts/link-deps.sh）
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "fh-"));
process.env.HOME = fakeHome;

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log("PASS", name); }
  else { fail++; console.log("FAIL", name, detail ?? ""); }
}

// ── config-store + remote ──────────────────────────────────────────────
const { createConfigStore } = await import(path.join(ROOT, "packages/vision-router/lib/config-store.mjs"));
const { PluginConfigGateway } = await import(path.join(ROOT, "packages/vision-router/lib/remote.mjs"));
const { remoteMethods } = await import("@deepseek-ai/dsh-typert-protocol");

const updates = [];
const store = createConfigStore({
  name: "vision-router",
  defaults: { a: 1, b: 2 },
  patchConfig: { b: 20 },
  onUpdate: (merged) => updates.push(merged),
});
check("store: 合并默认+patch", store.effective().a === 1 && store.effective().b === 20);
const next = store.set({ b: 200 });
check("store: set 持久化+热更新回调", next.b === 200 && updates.length === 1);
const fake = Object.create(PluginConfigGateway.prototype);
fake.store = store;
check("remote: 标记生效", remoteMethods(fake).some((m) => m.method === "get") && remoteMethods(fake).some((m) => m.method === "set"));
check("remote: get/set 调用", fake.get().config.b === 200 && fake.set({ b: 300 }).saved === true);

// ── vision-router ──────────────────────────────────────────────────────
const { apply: applyVision } = await import(path.join(ROOT, "packages/vision-router/lib/index.mjs"));
const calls = { transcription: 0, downstream: [] };
const CATALOG = {
  "zai-open": [
    { id: "glm-4v-flash", name: "GLM-4V-Flash", inputModalities: ["text", "image"] },
    { id: "glm-5.2", name: "GLM-5.2", inputModalities: ["text"] },
  ],
  "deepseek": [{ id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", inputModalities: ["text"] }],
};
const llmMock = {
  async listModels(provider) { return CATALOG[provider] ?? []; },
  async listProviders() { return [{ id: "zai-open" }, { id: "deepseek" }]; },
  async resolveModelInfo(provider, model) {
    const entry = (CATALOG[provider] ?? []).find((m) => m.id === model);
    return entry ? { provider, id: model, name: entry.name, ...(entry.inputModalities ? { inputModalities: entry.inputModalities } : {}) } : { provider, id: model, name: model };
  },
  streamWithRegistration(options) {
    if (options.messages && options.messages.length === 1 && options.messages[0].role === "user" && options.messages[0].content.some((b) => b.type === "image")) {
      calls.transcription += 1;
      return (async function* () { yield { type: "text-delta", text: "图片转述结果" }; yield { type: "finish", reason: { kind: "success" } }; })();
    }
    calls.downstream.push(options);
    return (async function* () { yield { type: "text-delta", text: "主模型回复" }; yield { type: "finish", reason: { kind: "success" } }; })();
  },
  stream(options) { return this.streamWithRegistration(options); },
};
const appended = [];
const ctx = {
  llm: llmMock,
  sessions: { get: (id) => id === "s9" ? { log: [{ type: "step/start", data: { turn: 3, step: 0 } }], append: (t, d) => appended.push({ t, d }) } : undefined },
  attachments: undefined,
  logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  get(name) { return this[name]; },
  effect(fn) { fn(); },
  plugin(Cls, cfg) {
    const saved = this.reflect;
    this.reflect = { provide: () => {}, props: {} };
    try { this.gateway = new Cls(this, cfg); } finally { this.reflect = saved; }
  },
};
applyVision(ctx, { visionProvider: "zai-open", visionModel: "glm-4v-flash" });
const mi = await llmMock.resolveModelInfo("deepseek", "deepseek-v4-flash");
check("VR: resolveModelInfo 补 image", mi.inputModalities.includes("image"));
const imageBlock = { type: "image", attachment: { attachmentId: "a1", mediaType: "image/png", bytes: 10, width: 10, height: 10 } };
const withImage = { provider: "deepseek", model: "deepseek-v4-flash", sessionId: "s9", messages: [{ role: "user", content: [imageBlock] }] };
for await (const c of llmMock.streamWithRegistration(withImage)) {}
check("VR: 含图转述+替换", calls.transcription === 1 && calls.downstream[0].messages[0].content[0].type === "text");
const progressCount = appended.filter((a) => a.t === "assistant/chunk" && a.d.chunk.text.includes("已收到图片")).length;
check("VR: 提示 1 次", progressCount === 1);
const before = appended.length;
const textAfter = { provider: "deepseek", model: "deepseek-v4-flash", sessionId: "s9", messages: [
  { role: "user", content: [imageBlock] },
  { role: "user", content: [{ type: "text", text: "继续" }] },
] };
for await (const c of llmMock.streamWithRegistration(textAfter)) {}
check("VR: 普通文本+历史图不再提示", appended.length === before);
check("VR: remote 网关注册", ctx.gateway !== undefined && ctx.gateway.get().config.visionProvider === "zai-open");

// ── sandbox-extra-roots ────────────────────────────────────────────────
const { apply: applySandbox } = await import(path.join(ROOT, "packages/sandbox-extra-roots/lib/index.mjs"));
const { writableRoots } = await import(path.join(ROOT, "packages/sandbox-extra-roots/lib/common.mjs"));
const WS = "/ws";
const EXTRA = "/tmp/extra";
function sbpl(roots) {
  const forms = ["(version 1)", "(allow default)", "(deny file-write*)", '(allow file-write* (literal "/dev/null"))'];
  forms.push("(allow file-write* " + roots.map((r) => '(subpath "' + r + '")').join(" ") + ")");
  return forms.join(" ");
}
const sandboxMock = {
  confine(argv, policy) {
    const roots = writableRoots(policy);
    return { argv: ["sandbox-exec", "-p", sbpl(roots), "--", ...argv], enforcement: "full", denialSignatures: [], runnerFailureRules: [] };
  },
};
const fsMock = {
  async resolve(displayPath) { return { targetKey: displayPath }; },
  async checkedTarget(target) {
    if (target.displayPath.startsWith("/tmp")) return await this.resolve(target.displayPath);
    throw new Error("FS_SANDBOX_DENIED");
  },
};
const ctx2 = {
  sandbox: sandboxMock,
  fs: fsMock,
  sandboxPolicy: { resolve: () => ({ mode: "workspace-write", workspaceRoot: WS }) },
  logger: { warn: () => {} },
  effect(fn) { fn(); },
  plugin(Cls, cfg) {
    const saved = this.reflect;
    this.reflect = { provide: () => {}, props: {} };
    try { this.gateway = new Cls(this, cfg); } finally { this.reflect = saved; }
  },
};
applySandbox(ctx2, { extraWritableRoots: [EXTRA] });
const out = sandboxMock.confine(["bash", "-c", "x"], { mode: "workspace-write", workspaceRoot: WS });
check("SER: seatbelt 额外目录+官方根", out.argv[2].includes('(subpath "/tmp/extra")') && out.argv[2].includes('(subpath "/ws")'));
const granted = await fsMock.checkedTarget({ displayPath: EXTRA + "/foo" });
check("SER: fs fence 放行", granted.targetKey === EXTRA + "/foo");
ctx2.gateway.set({ extraWritableRoots: ["/tmp/hot"] });
const out2 = sandboxMock.confine(["x"], { mode: "workspace-write", workspaceRoot: WS });
check("SER: remote set 热更新", out2.argv[2].includes('(subpath "/tmp/hot")'));

fs.rmSync(fakeHome, { recursive: true, force: true });
console.log("RESULT pass=" + pass + " fail=" + fail);
process.exit(fail === 0 ? 0 : 1);
