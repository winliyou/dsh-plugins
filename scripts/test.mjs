// 两个 host 插件 + config-store + remote 的全量回归测试
// 运行：node scripts/test.mjs（先 bash scripts/link-deps.sh）
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "fh-"));
process.env.HOME = fakeHome;
delete process.env.DSH_HOME; // 让 config-store 回归测试使用临时 HOME，避免污染真实 DSH_HOME

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

// sandbox 的 config-store 曾把换行写成字面 "\\n"，导致下次 effective() 读到非法 JSON 而丢配置。
const { createConfigStore: createSandboxConfigStore } = await import(path.join(ROOT, "packages/sandbox-extra-roots/lib/config-store.mjs"));
const sandboxStore = createSandboxConfigStore({ name: "sandbox-extra-roots-store-test", defaults: { extraWritableRoots: [] }, patchConfig: {} });
sandboxStore.set({ extraWritableRoots: ["/tmp/regression"] });
check("store(sandbox): set 后可重新读取配置", sandboxStore.effective().extraWritableRoots[0] === "/tmp/regression");
// adaptive-perf 的 config-store：嵌套默认配置（families）的持久化与合并。
const { createConfigStore: createAdaptiveStore } = await import(path.join(ROOT, "packages/adaptive-perf/lib/config-store.mjs"));
const adaptiveDefaults = {
  enabled: true,
  presets: ["standard", "code"],
  families: { delegation: { enabled: true, tools: ["subagent"], keywords: ["子代理"] } },
};
const adaptiveStore = createAdaptiveStore({ name: "adaptive-perf-store-test", defaults: adaptiveDefaults, patchConfig: { presets: ["code"] }, onUpdate: () => {} });
adaptiveStore.set({ enabled: false });
check("store(adaptive): 嵌套默认+patch+json 合并", adaptiveStore.effective().enabled === false
  && adaptiveStore.effective().presets[0] === "code"
  && adaptiveStore.effective().families.delegation.tools[0] === "subagent");
// 三个包共享实现文件，历史上曾发生 config-store 漂移导致配置丢失；强制保持一致。
const visionStoreSrc = fs.readFileSync(path.join(ROOT, "packages/vision-router/lib/config-store.mjs"), "utf8");
const sandboxStoreSrc = fs.readFileSync(path.join(ROOT, "packages/sandbox-extra-roots/lib/config-store.mjs"), "utf8");
const adaptiveStoreSrc = fs.readFileSync(path.join(ROOT, "packages/adaptive-perf/lib/config-store.mjs"), "utf8");
const visionRemoteSrc = fs.readFileSync(path.join(ROOT, "packages/vision-router/lib/remote.mjs"), "utf8");
const sandboxRemoteSrc = fs.readFileSync(path.join(ROOT, "packages/sandbox-extra-roots/lib/remote.mjs"), "utf8");
const adaptiveRemoteSrc = fs.readFileSync(path.join(ROOT, "packages/adaptive-perf/lib/remote.mjs"), "utf8");
check("shared: config-store/remote 三包保持一致",
  visionStoreSrc === sandboxStoreSrc && sandboxStoreSrc === adaptiveStoreSrc
  && visionRemoteSrc === sandboxRemoteSrc && sandboxRemoteSrc === adaptiveRemoteSrc);

// ── npm bundle metadata（dsh plugin 自动激活依赖 dsh.bundle.patch）──────
for (const name of ["vision-router", "sandbox-extra-roots", "adaptive-perf"]) {
  const pkgPath = path.join(ROOT, "packages", name, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const patchFile = path.join(ROOT, "packages", name, "cordis.patch.yml");
  const patch = fs.existsSync(patchFile) ? fs.readFileSync(patchFile, "utf8") : "";
  check(`bundle(${name}): 声明 dsh.bundle.patch`, pkg.dsh?.bundle?.patch === "./cordis.patch.yml");
  check(`bundle(${name}): files 包含 cordis.patch.yml`, Array.isArray(pkg.files) && pkg.files.includes("cordis.patch.yml"));
  check(`bundle(${name}): exports 暴露 cordis.patch.yml`, pkg.exports?.["./cordis.patch.yml"] === "./cordis.patch.yml");
  check(`bundle(${name}): exports 暴露 package.json（client 发现机制依赖）`, pkg.exports?.["./package.json"] === "./package.json");
  check(`bundle(${name}): patch 文件存在并插入自身`, patch.includes("- insert:") && patch.includes(`@dsh-plugins/${name}`));
}

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
const reAsk = { provider: "deepseek", model: "deepseek-v4-flash", sessionId: "s9", messages: [
  { role: "user", content: [{ type: "text", text: "图片里的文字是什么？" }, imageBlock] },
] };
for await (const c of llmMock.streamWithRegistration(reAsk)) {}
check("VR: 同一图片+不同问题不误用缓存", calls.transcription === 2);
check("VR: remote 网关注册", ctx.gateway !== undefined && ctx.gateway.get().config.visionProvider === "zai-open");
let invalidRejected = false;
try { ctx.gateway.set({ maxVisionTokens: -1 }); } catch { invalidRejected = true; }
check("VR: remote 拒绝非法配置", invalidRejected);

// ── sandbox-extra-roots ────────────────────────────────────────────────
const { apply: applySandbox } = await import(path.join(ROOT, "packages/sandbox-extra-roots/lib/index.mjs"));
const { canonicalPath, writableRoots } = await import(path.join(ROOT, "packages/sandbox-extra-roots/lib/common.mjs"));
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
    throw Object.assign(new Error("FS_SANDBOX_DENIED"), { code: "FS_SANDBOX_DENIED" });
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
await applySandbox(ctx2, { extraWritableRoots: [EXTRA] });
const out = sandboxMock.confine(["bash", "-c", "x"], { mode: "workspace-write", workspaceRoot: WS });
check("SER: seatbelt 额外目录+官方根", out.argv[2].includes('(subpath "/tmp/extra")') && out.argv[2].includes('(subpath "/ws")'));
const granted = await fsMock.checkedTarget({ displayPath: EXTRA + "/foo" });
check("SER: fs fence 放行", granted.targetKey === EXTRA + "/foo");
ctx2.gateway.set({ extraWritableRoots: ["/tmp/hot"] });
const out2 = sandboxMock.confine(["x"], { mode: "workspace-write", workspaceRoot: WS });
check("SER: remote set 热更新", out2.argv[2].includes('(subpath "/tmp/hot")'));
let invalidRootRejected = false;
try { ctx2.gateway.set({ extraWritableRoots: ["relative/path"] }); } catch { invalidRootRejected = true; }
check("SER: remote 拒绝相对路径", invalidRootRejected);

// bwrap/Landlock 不能绑定不存在的目录，运行时过滤缺失 root。
const fakeHome2 = fs.mkdtempSync(path.join(os.tmpdir(), "fh2-"));
const existingExtra = fs.mkdtempSync(path.join(os.tmpdir(), "ser-existing-"));
const missingExtra = path.join(fakeHome2, "missing-root");
process.env.HOME = fakeHome2;
const bwrapMock = {
  confine(argv, policy) {
    return { argv: ["bwrap", "--ro-bind", "/", "/", "--", ...argv], enforcement: "full", denialSignatures: [], runnerFailureRules: [] };
  },
};
const ctx3 = {
  sandbox: bwrapMock,
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
await applySandbox(ctx3, { extraWritableRoots: [missingExtra, existingExtra] });
const bwrapOut = bwrapMock.confine(["bash", "-c", "x"], { mode: "workspace-write", workspaceRoot: WS });
const bindArgs = bwrapOut.argv.slice(0, bwrapOut.argv.indexOf("--"));
const canonicalExistingExtra = canonicalPath(existingExtra);
const canonicalMissingExtra = canonicalPath(missingExtra);
check("SER: bwrap 只授予存在的额外目录", bindArgs.includes("--bind") && bindArgs.includes(canonicalExistingExtra) && !bindArgs.includes(canonicalMissingExtra));
process.env.HOME = fakeHome;
fs.rmSync(fakeHome2, { recursive: true, force: true });
fs.rmSync(existingExtra, { recursive: true, force: true });

// ── adaptive-perf 自适应引擎（mock ctx 模拟 agent 生命周期）─────────────
const ap = await import(path.join(ROOT, "packages/adaptive-perf/lib/index.mjs"));
check("AP: 提取用户文本", ap.extractUserText({ content: [{ type: "text", text: "a" }, { type: "image", attachment: {} }, { type: "text", text: "b" }] }) === "ab");
check("AP: 关键词命中（大小写不敏感）", ap.matchKeywords("帮我 SUBAGENT 处理", ["subagent"]) === true && ap.matchKeywords("普通消息", ["子代理"]) === false);
check("AP: 失败文本收集", ap.collectFailureText({ isError: true, error: { code: "UNKNOWN_TOOL", message: 'unknown tool "workflow"' }, content: [] }).includes("workflow"));
const norm = ap.normalizeConfig({ presets: "standard,code", families: { delegation: { tools: "subagent,subagent_fork", keywords: ["子代理"] } } });
check("AP: 配置归一化", norm.presets.length === 2 && norm.families.delegation.tools.length === 2 && norm.enabled === true);

// 标准模式工具目录（真实 standard preset 的行注册集）
const STANDARD_CATALOG = [
  "bash", "read", "write", "edit", "glob", "grep", "read_image",
  "job_output", "job_list", "job_kill", "todo_write", "ask_user_question",
  "web_search", "skill", "exit_plan_mode",
  "subagent", "subagent_fork", "send_message", "list_agents", "interrupt_agent",
  "workflow", "ralph", "create_goal", "get_goal", "update_goal",
];
const apEvents = {}; // event -> [listeners]
const apRestrictCalls = []; // { agent, deny }
const apDisposedCalls = []; // 被调用的 restrict disposer 对应 deny
const apSuppressCalls = new Set(); // 调用过 suppressRuntimeContext 的 agent
const apToolSets = new Map(); // agentId -> Set(tool names)
const apLiveAgents = new Map(); // agentId -> agent（供 agents.list() sweep 使用）
function makeAgentTools(id) {
  return {
    schemas(agent) {
      return [...(apToolSets.get(id) ?? [])].map((n) => ({ name: n }));
    },
    restrict({ deny }) {
      apRestrictCalls.push({ agent: id, deny: [...deny] });
      return () => { apDisposedCalls.push({ agent: id, deny: [...deny] }); };
    },
  };
}
const apAgentPresetsMock = {
  composedPreset(agentCtx) { return agentCtx.presetId; },
};
const apAgentsMock = { list: () => [...apLiveAgents.values()] };
const apCtx = {
  logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  get(name) {
    if (name === "tools") return {
      schemas: (agent) => [...(apToolSets.get(agent.id) ?? [])].map((n) => ({ name: n })),
      restrict: () => () => {},
    };
    if (name === "systemPrompt") return {
      suppressRuntimeContext() { apSuppressCalls.add("sp"); return () => {}; },
    };
    if (name === "agentPresets") return apAgentPresetsMock;
    if (name === "agents") return apAgentsMock;
    return undefined;
  },
  on(event, listener) { (apEvents[event] ??= []).push(listener); },
  effect(fn) { fn(); },
  plugin(Cls, cfg) {
    const saved = this.reflect;
    this.reflect = { provide: () => {}, props: {} };
    try { this.gateway = new Cls(this, cfg); } finally { this.reflect = saved; }
  },
};
function apAgent(id, presetId) {
  apToolSets.set(id, new Set(STANDARD_CATALOG));
  const agent = {
    id,
    ctx: {
      presetId,
      tools: makeAgentTools(id),
      systemPrompt: {
        suppressRuntimeContext() { apSuppressCalls.add(id); return () => {}; },
      },
    },
  };
  apLiveAgents.set(id, agent);
  return agent;
}
function apEmit(event, ...args) {
  for (const listener of apEvents[event] ?? []) listener(...args);
}

// 引擎启动（默认配置，config.json 不存在 → 默认值）
ap.apply(apCtx, { presets: ["standard", "code"] });
const agentStd = apAgent("s-std", "standard");
apEmit("agent/created", { agent: agentStd });
const stdDenies = apRestrictCalls.filter((c) => c.agent === "s-std");
check("AP: 启动即限制 4 个编排族", stdDenies.length === 4
  && stdDenies.some((c) => c.deny.includes("subagent") && c.deny.includes("send_message") && c.deny.includes("interrupt_agent"))
  && stdDenies.some((c) => c.deny[0] === "workflow")
  && stdDenies.some((c) => c.deny[0] === "ralph")
  && stdDenies.some((c) => c.deny.includes("create_goal") && c.deny.includes("update_goal")));
check("AP: 核心工具不在任何 deny 里", stdDenies.every((c) => !c.deny.includes("bash") && !c.deny.includes("read") && !c.deny.includes("web_search")));
check("AP: 运行时上下文已抑制", apSuppressCalls.has("s-std"));

// 非目标 preset 不受影响
apEmit("agent/created", { agent: apAgent("s-min", "minimal") });
check("AP: 非目标 preset 零副作用", apRestrictCalls.filter((c) => c.agent === "s-min").length === 0 && !apSuppressCalls.has("s-min"));

// 关键词信号：用户说"子代理" → 放行 delegation 族（其 restrict disposer 被调用）
apEmit("agent/inbox/inserted", { agent: agentStd, message: { content: [{ type: "text", text: "请用子代理并行处理这两个任务" }] } });
check("AP: 关键词放行 delegation 族", apDisposedCalls.some((c) => c.agent === "s-std" && c.deny.includes("subagent")));
const disposedCount = apDisposedCalls.length;
apEmit("agent/inbox/inserted", { agent: agentStd, message: { content: [{ type: "text", text: "再委托一次" }] } });
check("AP: 升级单调（重复触发不重复放行）", apDisposedCalls.length === disposedCount && apRestrictCalls.filter((c) => c.agent === "s-std").length === 4);

// 失败信号：PTC 程序调用隐藏工具 workflow 报 UNKNOWN_TOOL → 放行 workflow 族
apEmit("tools/result",
  { agent: agentStd },
  { isError: true, error: { code: "UNKNOWN_TOOL", message: 'unknown tool "workflow": reach it via the SDK' }, content: [] });
check("AP: 失败信号放行 workflow 族", apDisposedCalls.some((c) => c.agent === "s-std" && c.deny[0] === "workflow"));
const afterFailure = apDisposedCalls.length;

// 热更新：leanByDefault=false 释放全部剩余限制（ralph/goal 的 disposer 被调用）
apCtx.gateway.set({ leanByDefault: false });
check("AP: lean 关闭释放全部剩余限制", apDisposedCalls.length === afterFailure + 2);
// 热更新：重新开启 lean → 未升级的族（ralph/goal）重新限制，已升级族不重复
const restrictBeforeReopen = apRestrictCalls.filter((c) => c.agent === "s-std").length;
apCtx.gateway.set({ leanByDefault: true });
const reopened = apRestrictCalls.filter((c) => c.agent === "s-std").slice(restrictBeforeReopen);
check("AP: 重开 lean 只补限制未升级族", reopened.length === 2
  && reopened.some((c) => c.deny[0] === "ralph")
  && reopened.some((c) => c.deny.includes("create_goal")));
// 升级后的族重开 lean 后依然放行（单调性跨配置刷新保持）
apEmit("agent/inbox/inserted", { agent: agentStd, message: { content: [{ type: "text", text: "用子代理" }] } });
check("AP: 已升级族跨配置刷新保持放行", apRestrictCalls.filter((c) => c.agent === "s-std").length === restrictBeforeReopen + 2);

// 总开关：关闭释放已接管会话的全部限制；开启后补挂此前创建的会话（sweep 路径）
const sLate = apAgent("s-late", "standard");
apEmit("agent/created", { agent: sLate });
check("AP: 新会话接入 4 族限制", apRestrictCalls.filter((c) => c.agent === "s-late").length === 4);
const disposedBeforeOff = apDisposedCalls.length;
apCtx.gateway.set({ enabled: false });
const offDisposals = apDisposedCalls.slice(disposedBeforeOff);
check("AP: 总开关关闭释放全部限制", offDisposals.filter((c) => c.agent === "s-late").length === 4
  && offDisposals.some((c) => c.agent === "s-std" && c.deny.includes("create_goal")));
const sLate2 = apAgent("s-late2", "code"); // 不触发 agent/created：模拟插件关闭期间创建的会话
apCtx.gateway.set({ enabled: true });
check("AP: 重新启用补挂插件关闭期间创建的会话", apRestrictCalls.filter((c) => c.agent === "s-late2").length === 4
  && apSuppressCalls.has("s-late2"));
apEmit("agent/disposed", { agent: sLate });
apEmit("agent/disposed", { agent: sLate2 });

// agent 销毁清理（无异常）
apEmit("agent/disposed", { agent: agentStd });
check("AP: 引擎全程运行无异常", apSuppressCalls.has("s-std"));

fs.rmSync(fakeHome, { recursive: true, force: true });
console.log("RESULT pass=" + pass + " fail=" + fail);
process.exit(fail === 0 ? 0 : 1);
