// 全部 host 插件 + config-store + remote 的全量回归测试
// 运行：bun scripts/test.mjs（依赖由根部 devDependencies 提供）
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "fh-"));
process.env.HOME = fakeHome;
// bun 的 os.homedir() 不读 $HOME（与 node 兼容性差异），这里把 DSH_HOME
// 显式指给 config-store 回归测试，避免写入真实 ~/.dsh/plugins。
process.env.DSH_HOME = fakeHome;

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log("PASS", name); }
  else { fail++; console.log("FAIL", name, detail ?? ""); }
}

// ── config-store + remote ──────────────────────────────────────────────
// vision-router 的 config-store/remote 回归已迁移至
// packages/vision-router/test/vision.test.ts。
// sandbox 的 config-store 曾把换行写成字面 "\\n"，导致下次 effective() 读到非法 JSON 而丢配置。
const { createConfigStore: createSandboxConfigStore } = await import(path.join(ROOT, "packages/sandbox-extra-roots/lib/config-store.js"));
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
// 三个包共享实现文件，历史上曾发生 config-store 漂移导致配置丢失。vision-router
// 与 sandbox-extra-roots 均已迁移至 TS（lib/*.js），其与 adaptive-perf 的实现
// 一致性由根 test/ 的 src 对照检查覆盖（重构收尾任务）；adaptive-perf 的对照
// 在自适应引擎迁移任务中处理。

// ── npm bundle metadata（dsh plugin 自动激活依赖 dsh.bundle.patch）──────
for (const name of ["vision-router", "sandbox-extra-roots", "adaptive-perf", "session-archive"]) {
  const pkgPath = path.join(ROOT, "packages", name, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const patchFile = path.join(ROOT, "packages", name, "cordis.patch.yml");
  const patch = fs.existsSync(patchFile) ? fs.readFileSync(patchFile, "utf8") : "";
  check(`bundle(${name}): 声明 dsh.bundle.patch`, pkg.dsh?.bundle?.patch === "./cordis.patch.yml");
  check(`bundle(${name}): files 包含 cordis.patch.yml`, Array.isArray(pkg.files) && pkg.files.includes("cordis.patch.yml"));
  check(`bundle(${name}): exports 暴露 cordis.patch.yml`, pkg.exports?.["./cordis.patch.yml"] === "./cordis.patch.yml");
  check(`bundle(${name}): exports 暴露 package.json（client 发现机制依赖）`, pkg.exports?.["./package.json"] === "./package.json");
  const scopedName = `@chaoset/${name}`;
  check(`bundle(${name}): package name 与 patch 一致`, pkg.name === scopedName);
  check(`bundle(${name}): patch 文件存在并插入自身`, patch.includes("- insert:") && patch.includes(scopedName));
}

// ── client bundle 冒烟：settings.plugin.item 注册必须带 key ──────────────
// 宿主 dsh-client-ui-slots（0.1.0-rc.7+）把 settings.plugin.item 声明为
// keyed slot，注册缺 key 会让整个 client bundle apply 失败（Failed to load
// plugins）。key 为卡片编辑的设置 namespace（与 host 侧 serviceKey 一致）。
// 这里 mock react/slots/remote/locale 真实执行三个配置类包的 client apply。
{
  const requireCjs = createRequire(import.meta.url);
  const reactStub = {
    createElement: (...args) => ({ args }),
    Fragment: "fragment",
    useMemo: (fn) => fn(),
    useState: (init) => [typeof init === "function" ? init() : init, () => {}],
    useCallback: (fn) => fn,
    useEffect: () => {},
    useRef: () => ({ current: null }),
  };
  const configServiceStub = {
    get: async () => ({ ok: true, value: { config: {} } }),
    set: async (partial) => ({ ok: true, value: partial }),
  };
  for (const [name, key] of [["vision-router", "visionRouterConfig"], ["sandbox-extra-roots", "sandboxExtraRootsConfig"], ["adaptive-perf", "adaptivePerfConfig"]]) {
    const entries = [];
    const prevWindow = globalThis.window;
    globalThis.window = { __ModuleLoader__: { load: (entry) => entries.push(entry) } };
    let bundleExports;
    try {
      requireCjs(path.join(ROOT, "packages", name, "client", "client.cjs"));
      bundleExports = entries[0].factory((id) => {
        if (id === "react") return reactStub;
        throw new Error("unexpected require: " + id);
      });
    } finally {
      if (prevWindow === void 0) delete globalThis.window;
      else globalThis.window = prevWindow;
    }
    const registrations = [];
    const clientCtx = {
      slots: {
        inject: (slotName, fn) => { fn(); },
        register: (options, component) => registrations.push({ options, component }),
      },
      locale: Object.assign(() => () => "", { bind: () => () => "", register: () => {} }),
      effect: (fn) => {},
      remote: { $mount: async () => {} },
      get: (svc) => (typeof svc === "string" && svc.startsWith("remote.") ? configServiceStub : {}),
    };
    await bundleExports.apply(clientCtx);
    const item = registrations.find((r) => r.options.name === "settings.plugin.item");
    check(`client(${name}): settings.plugin.item 注册带 key=${key}`,
      item !== undefined && item.options.key === key);
  }

// session-archive client 冒烟：侧边栏归档入口 + remote 贡献挂载。
{
  const requireCjs = createRequire(import.meta.url);
  const reactStub = {
    createElement: (...args) => ({ args }),
    Fragment: "fragment",
    useMemo: (fn) => fn(),
    useState: (init) => [typeof init === "function" ? init() : init, () => {}],
    useCallback: (fn) => fn,
    useEffect: () => {},
    useRef: () => ({ current: null }),
  };
  const entries = [];
  const prevWindow = globalThis.window;
  globalThis.window = { __ModuleLoader__: { load: (entry) => entries.push(entry) } };
  let bundleExports;
  try {
    requireCjs(path.join(ROOT, "packages/session-archive/client/client.cjs"));
    bundleExports = entries[0].factory((id) => {
      if (id === "react") return reactStub;
      throw new Error("unexpected require: " + id);
    });
  } finally {
    if (prevWindow === void 0) delete globalThis.window;
    else globalThis.window = prevWindow;
  }
  const registrations = [];
  const mounted = [];
  const archiveServiceStub = {
    list: async () => ({ ok: true, value: { items: [] } }),
    detail: async () => ({ ok: true, value: {} }),
    delete: async () => ({ ok: true, value: { deleted: [], failed: [], removedFromArchive: 0 } }),
    unarchive: async () => ({ ok: true, value: { restored: [], removedFromArchive: 0 } }),
  };
  const clientCtx = {
    slots: {
      inject: (slotName, fn) => { fn(); },
      register: (options, component) => registrations.push({ options, component }),
    },
    locale: Object.assign(() => () => "", { bind: () => () => "", register: () => {} }),
    effect: (fn) => {},
    remote: { $mount: async (contribution) => mounted.push(contribution) },
    get: (svc) => (svc === "remote.sessionArchive" ? archiveServiceStub : {}),
  };
  await bundleExports.apply(clientCtx);
  const action = registrations.find((r) => r.options.name === "sidebar.footer.action");
  check("client(session-archive): 侧边栏归档入口注册", action !== undefined && action.options.id === "session-archive");
  check("client(session-archive): remote 贡献挂载", mounted.length === 1 && mounted[0].package === "@chaoset/session-archive");
}
}

// ── settings namespace 注册（宿主 rc.7+ 设置页可见性）──────────────────
// 设置页 describe() 只枚举 ctx.settings.register 注册过的 namespace；未注册
// 时卡片即使带正确 key 也不渲染。仓库测试环境无 @deepseek-ai/schemastery，
// 用 stub schema 库直接驱动两个配置类包导出的注册函数（vision-router 的
// 注册回归已随其迁移至 vitest）。
{
  const sbNS = await import(path.join(ROOT, "packages/sandbox-extra-roots/lib/index.js"));
  const apNS = await import(path.join(ROOT, "packages/adaptive-perf/lib/index.mjs"));
  check("settings: 两包均导出注册函数",
    typeof sbNS.registerSettingsNamespace === "function"
    && typeof apNS.registerSettingsNamespace === "function");
}

// ── adaptive-perf 自适应引擎（mock ctx 模拟 agent 生命周期）─────────────
const ap = await import(path.join(ROOT, "packages/adaptive-perf/lib/index.mjs"));
check("AP: 提取用户文本", ap.extractUserText({ content: [{ type: "text", text: "a" }, { type: "image", attachment: {} }, { type: "text", text: "b" }] }) === "ab");
check("AP: 关键词命中（大小写不敏感）", ap.matchKeywords("帮我 SUBAGENT 处理", ["subagent"]) === true && ap.matchKeywords("普通消息", ["子代理"]) === false);
check("AP: 失败文本收集", ap.collectFailureText({ isError: true, error: { code: "UNKNOWN_TOOL", message: 'unknown tool "workflow"' }, content: [] }).includes("workflow"));
const norm = ap.normalizeConfig({ presets: "standard,code", families: { delegation: { tools: "subagent,subagent_fork", keywords: ["子代理"] } } });
check("AP: 配置归一化", norm.presets.length === 2 && norm.families.delegation.tools.length === 2 && norm.enabled === true);

// ── adaptive-perf 首轮锚定（bootstrap）纯函数 ──────────────────────────
const PROMOTE = ap.PROMOTE_EVENTS.either;
check("AP: 阶段扫描-无事件未晋升", ap.scanPhase([], PROMOTE).promoted === false);
check("AP: 阶段扫描-首个 assistant/message 晋升", ap.scanPhase([{ type: "assistant/message", seq: 1 }], PROMOTE).promoted === true);
check("AP: 阶段扫描-只认 tool-call 时不认 assistant", ap.scanPhase([{ type: "assistant/message", seq: 1 }], ap.PROMOTE_EVENTS["tool-call"]).promoted === false);
check("AP: 阶段扫描-晋升持久（compaction 不重置）", ap.scanPhase([{ type: "assistant/message", seq: 1 }, { type: "compaction/end", seq: 5 }], PROMOTE).promoted === true);
check("AP: 阶段扫描-压缩前晋升保持", ap.scanPhase([{ type: "assistant/message", seq: 3 }, { type: "compaction/end", seq: 5 }], PROMOTE).promoted === true);
const phaseState = new Map([["s1", { ...ap.scanPhase([], PROMOTE), promoteOn: "either" }]]);
ap.observePhase(phaseState, "s1", { type: "tool/call", seq: 2 });
check("AP: 阶段观察-增量晋升", phaseState.get("s1").promoted === true);
ap.observePhase(phaseState, "s1", { type: "compaction/end", seq: 9 });
check("AP: 阶段观察-晋升持久（压缩不重置）", phaseState.get("s1").promoted === true);
ap.observePhase(phaseState, "s1", { type: "assistant/message", seq: 10 });
check("AP: 阶段观察-已晋升保持", phaseState.get("s1").promoted === true);
const fullAsm = { tools: ["bash", "read", "write", "edit", "glob", "grep", "str_replace_editor", "subagent", "workflow"].map((name) => ({ name })) };
check("AP: 工具过滤-收窄到 bootstrap 对", (() => {
  const r = ap.filterBootstrapTools(fullAsm, ["bash", "str_replace_editor"]);
  return r.missing.length === 0 && r.tools.length === 2 && r.tools.every((t) => ["bash", "str_replace_editor"].includes(t.name));
})());
check("AP: 工具过滤-缺失工具报 missing 且保留可用集", (() => {
  const r = ap.filterBootstrapTools(fullAsm, ["bash", "not-a-tool"]);
  return r.missing.length === 1 && r.missing[0] === "not-a-tool" && r.tools.length === 1;
})());
check("AP: 工具过滤-多工具保留集", (() => {
  const r = ap.filterBootstrapTools(fullAsm, ["bash", "str_replace_editor", "read", "write"]);
  return r.missing.length === 0 && r.tools.length === 4;
})());
check("AP: 消息过滤-剥离 skill-catalog 保留用户消息", (() => {
  const msgs = [
    { role: "user", source: { kind: "skill-catalog" }, content: [{ type: "text", text: "skills" }] },
    { role: "user", source: { kind: "agent-instructions" }, content: [{ type: "text", text: "agents" }] },
    { role: "user", source: { kind: "user" }, content: [{ type: "text", text: "real" }] },
    { role: "user", content: [{ type: "text", text: "plain" }] },
  ];
  const kept = ap.filterBootstrapMessages(msgs, new Set(["skill-catalog", "agent-instructions"]));
  return kept.length === 2 && kept[0].content[0].text === "real";
})());
check("AP: 消息过滤-空抑制集原样返回", ap.filterBootstrapMessages([{ content: [] }], new Set()).length === 1);
check("AP: 预算-未晋升封顶", JSON.stringify(ap.applyBootstrapBudget({ maxTokens: 256000, a: 1 }, false, 1024)) === '{"maxTokens":1024,"a":1}');
check("AP: 预算-晋升后剥离封顶", JSON.stringify(ap.applyBootstrapBudget({ maxTokens: 1024, a: 1 }, true, 1024)) === '{"a":1}');
check("AP: 预算-晋升后非封顶值保留", ap.applyBootstrapBudget({ maxTokens: 256000, a: 1 }, true, 1024).maxTokens === 256000);
const bnorm = ap.normalizeConfig({ bootstrap: { enabled: false, maxTokens: 2048, promoteOn: "tool-call", suppressedContextSources: [] } });
check("AP: bootstrap 配置归一化", bnorm.bootstrap.enabled === false && bnorm.bootstrap.maxTokens === 2048
  && bnorm.bootstrap.promoteOn === "tool-call" && bnorm.bootstrap.suppressedContextSources.length === 0
  && bnorm.bootstrap.tools.includes("bash"));
let rejected = false;
try { ap.validateConfig({ bootstrap: { promoteOn: "bogus" } }); } catch { rejected = true; }
check("AP: bootstrap 配置校验-非法 promoteOn 拒绝", rejected === true);

// minimalPrompt（极简提示词层）配置归一化与校验
const mpnorm = ap.normalizeConfig({ minimalPrompt: { persona: "  You are terse.  ", suppressSections: false } });
check("AP: minimalPrompt 配置归一化", mpnorm.minimalPrompt.enabled === true
  && mpnorm.minimalPrompt.persona === "You are terse."
  && mpnorm.minimalPrompt.suppressSections === false);
const mpdef = ap.normalizeConfig({});
check("AP: minimalPrompt 默认开启（0.7.0 开箱即用）且 persona 模板保留",
  mpdef.minimalPrompt.enabled === true
  && mpdef.minimalPrompt.persona === "You are a helpful software engineer assistant."
  && mpdef.minimalPrompt.suppressSections === true);
let mpRejected = false;
try { ap.validateConfig({ minimalPrompt: { persona: 123 } }); } catch { mpRejected = true; }
check("AP: minimalPrompt 配置校验-非法 persona 拒绝", mpRejected === true);
check("AP: 阴影段清单完整", ap.SECTION_SHADOWS.length === 3
  && ap.SECTION_SHADOWS.some(([n]) => n === "harness:identity")
  && ap.SECTION_SHADOWS.some(([n]) => n === "harness:source")
  && ap.SECTION_SHADOWS.some(([n]) => n === "app:web-surface")
  && ap.PERSONA_SECTION_NAME === "deployment:persona");

// ── 0.7.0：默认配置（首轮锚定、晋升后全恢复：只提高性能不减少功能）────
const v5def = ap.normalizeConfig({});
check("AP: 0.7.0 默认配置（提示词层开、工具零裁剪、常驻剥离、bootstrap 锚定，含创造模式）",
  v5def.suppressInjectedContext === true && v5def.leanByDefault === false
  && v5def.suppressRuntimeContext === true
  && v5def.bootstrap.enabled === true && v5def.bootstrap.realPair === true
  && v5def.presets.includes("standard") && v5def.presets.includes("code") && v5def.presets.includes("cordis"));
const v5norm = ap.normalizeConfig({ suppressInjectedContext: true, bootstrap: { realPair: false } });
check("AP: 0.7.0 配置归一化-opt-in 生效", v5norm.suppressInjectedContext === true && v5norm.bootstrap.realPair === false);
let v5Rejected = false;
try { ap.validateConfig({ suppressInjectedContext: "yes" }); } catch { v5Rejected = true; }
let v5Rejected2 = false;
try { ap.validateConfig({ bootstrap: { realPair: 1 } }); } catch { v5Rejected2 = true; }
check("AP: 0.7.0 配置校验-非法值拒绝", v5Rejected === true && v5Rejected2 === true);

// ── 0.5.0：真实 Minimal 工具对 / 上下文剥离纯函数 ─────────────────────
check("AP: Minimal bash 描述与官方逐字一致", ap.MINIMAL_BASH_DESCRIPTION.startsWith("Run commands in a bash shell")
  && ap.MINIMAL_BASH_DESCRIPTION.includes("* State is persistent across command calls and discussions with the user.")
  && ap.MINIMAL_BASH_DESCRIPTION.includes("sed -n 10,25p"));
const stubModules = {
  terminal: { name: "dsh-terminal" },
  terminalBash: { name: "dsh-terminal-bash" },
  bashPersistent: { name: "dsh-tool-bash-persistent" },
  fsLocal: { name: "dsh-fs-local" },
  strReplaceEditor: { name: "dsh-tool-str-replace-editor" },
};
const loaded = await ap.loadRealPairModules((spec) => Promise.resolve(stubModules[Object.keys(ap.REAL_PAIR_SPECS).find((k) => ap.REAL_PAIR_SPECS[k] === spec)]));
check("AP: loadRealPairModules-成功路径", loaded !== null && loaded.bashPersistent.name === "dsh-tool-bash-persistent");
const failed = await ap.loadRealPairModules(() => Promise.reject(new Error("no such package")));
check("AP: loadRealPairModules-缺失包整体降级", failed === null);
const mounts = ap.realPairMounts(stubModules, "/work");
check("AP: realPairMounts-顺序与配置", mounts.length === 5
  && mounts[0].module.name === "dsh-terminal"
  && mounts[2].module.name === "dsh-tool-bash-persistent"
  && mounts[2].config.description === ap.MINIMAL_BASH_DESCRIPTION
  && mounts[3].config.cwd === "/work"
  && mounts[4].config.maxOutputChars === 16000);
const mountedPlugins = [];
const mountAgent = { ctx: { plugin(mod, cfg) { mountedPlugins.push({ name: mod.name, cfg }); return { dispose() {} }; } } };
const disposers = ap.mountRealPair(mountAgent, mounts, () => {});
check("AP: mountRealPair-逐模块挂载", mountedPlugins.length === 5 && disposers.length === 5);
check("AP: mountRealPair-无 plugin 的 agent 安全跳过", ap.mountRealPair({ ctx: {} }, mounts, () => {}).length === 0);

const strippedMsgs = ap.stripSuppressedMessages(
  [{ source: { kind: "skill-catalog" }, content: [] }, { source: { kind: "user" }, content: [] }],
  new Set(["skill-catalog"]));
check("AP: stripSuppressedMessages-按 kind 剥离", strippedMsgs.length === 1 && strippedMsgs[0].source.kind === "user");
check("AP: stripSuppressedMessages-空集原样", ap.stripSuppressedMessages([{ content: [] }], new Set()).length === 1);

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
const apToolRegistrations = []; // { agent, name } 注册的 agent 作用域工具
const apToolDisposals = []; // { agent, name } 释放的 agent 作用域工具
const apToolDefs = new Map(); // "agent:name" -> tool definition
const apSuppressCalls = new Set(); // 调用过 suppressRuntimeContext 的 agent
const apSectionCalls = []; // { agent, name, order, text }
const apSectionDisposed = []; // 被调用的 section disposer（name 记录）
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
    register(definition) {
      apToolRegistrations.push({ agent: id, name: definition.name });
      apToolDefs.set(`${id}:${definition.name}`, definition);
      return () => { apToolDisposals.push({ agent: id, name: definition.name }); };
    },
  };
}
const apAgentPresetsMock = {
  composedPreset(agentCtx) { return agentCtx.presetId; },
};
const apAgentsMock = { list: () => [...apLiveAgents.values()] };
// 0.5.0：instruction-hint 探测与 skill 发现工具的宿主服务桩
const apSkillsMock = {
  list: async () => [{ name: "pdf-tools", description: "PDF 处理" }],
  get: async (name) => ({ name, content: "full instructions" }),
};
const apFsMock = {
  resolve: async (target) => target,
  stat: async (target) => (target.includes("AGENTS.md") || target.includes("CLAUDE.md") ? { type: "file" } : { type: "dir" }),
};
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
    if (name === "skills") return apSkillsMock;
    if (name === "fs") return apFsMock;
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
function apAgent(id, presetId, session) {
  apToolSets.set(id, new Set(STANDARD_CATALOG));
  const agent = {
    id,
    ctx: {
      presetId,
      tools: makeAgentTools(id),
      systemPrompt: {
        suppressRuntimeContext() { apSuppressCalls.add(id); return () => {}; },
        section(section) {
          apSectionCalls.push({ agent: id, ...section });
          return () => { apSectionDisposed.push({ agent: id, name: section.name }); };
        },
      },
    },
  };
  if (session !== void 0) agent.session = session;
  apLiveAgents.set(id, agent);
  return agent;
}
function apEmit(event, ...args) {
  for (const listener of apEvents[event] ?? []) listener(...args);
}

// 引擎启动：显式传激进配置（lean/suppressInjectedContext 显式开启，隔离机制断言）。
// realPairModules: null 注入 = 官方包缺失的降级路径（测试环境无 @deepseek-ai 包）。
await ap.apply(apCtx, {
  presets: ["standard", "code"],
  leanByDefault: true,
  suppressRuntimeContext: true,
  suppressInjectedContext: true,
  minimalPrompt: { enabled: true },
  bootstrap: { enabled: true, realPair: false },
}, { realPairModules: null });
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
// 极简提示词层：3 个全局引导段屏蔽 + persona 替换（默认与极简逐字相同）
const stdSections = apSectionCalls.filter((c) => c.agent === "s-std");
check("AP: 极简提示词层-3 引导段屏蔽 + persona 替换", stdSections.length === 4
  && stdSections.filter((c) => c.text === "").length === 3
  && stdSections.some((c) => c.name === "harness:identity" && c.order === -100)
  && stdSections.some((c) => c.name === "harness:source" && c.order === -99)
  && stdSections.some((c) => c.name === "app:web-surface" && c.order === -98)
  && stdSections.some((c) => c.name === "deployment:persona" && c.text === "You are a helpful software engineer assistant."));

// 非目标 preset 不受影响
apEmit("agent/created", { agent: apAgent("s-min", "minimal") });
check("AP: 非目标 preset 零副作用", apRestrictCalls.filter((c) => c.agent === "s-min").length === 0
  && !apSuppressCalls.has("s-min") && apSectionCalls.filter((c) => c.agent === "s-min").length === 0);

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

// 极简提示词层热更新（每次配置更新都会对已接管会话重算，用增量断言）
const mpCallsBefore = apSectionCalls.filter((c) => c.agent === "s-std").length;
const mpDisposedBefore = apSectionDisposed.filter((c) => c.agent === "s-std").length;
apCtx.gateway.set({ minimalPrompt: { enabled: true, suppressSections: false } });
const mpNewCalls = apSectionCalls.filter((c) => c.agent === "s-std").slice(mpCallsBefore);
const mpNewDisposed = apSectionDisposed.filter((c) => c.agent === "s-std").slice(mpDisposedBefore);
check("AP: minimalPrompt 热更新-旧阴影释放且仅 persona 保留", mpNewDisposed.length === 4
  && mpNewCalls.length === 1 && mpNewCalls[0].name === "deployment:persona");
const mpDisposedBefore2 = apSectionDisposed.filter((c) => c.agent === "s-std").length;
apCtx.gateway.set({ minimalPrompt: { enabled: false } });
const mpNewDisposed2 = apSectionDisposed.filter((c) => c.agent === "s-std").slice(mpDisposedBefore2);
check("AP: minimalPrompt 关闭-全部释放", mpNewDisposed2.length === 1 && mpNewDisposed2[0].name === "deployment:persona");
const mpCallsBefore3 = apSectionCalls.filter((c) => c.agent === "s-std").length;
apCtx.gateway.set({ minimalPrompt: { enabled: true, suppressSections: true } });
const mpNewCalls3 = apSectionCalls.filter((c) => c.agent === "s-std").slice(mpCallsBefore3);
check("AP: minimalPrompt 重开-4 段恢复", mpNewCalls3.length === 4
  && mpNewCalls3.filter((c) => c.text === "").length === 3
  && mpNewCalls3.some((c) => c.name === "deployment:persona"));

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
  && apSuppressCalls.has("s-late2")
  && apSectionCalls.filter((c) => c.agent === "s-late2").length === 4);
const late2DisposedBefore = apSectionDisposed.filter((c) => c.agent === "s-late2").length;
apEmit("agent/disposed", { agent: sLate });
apEmit("agent/disposed", { agent: sLate2 });
check("AP: agent 销毁释放提示词层", apSectionDisposed.filter((c) => c.agent === "s-late2").length === late2DisposedBefore + 4);

// agent 销毁清理（无异常）
apEmit("agent/disposed", { agent: agentStd });
check("AP: 引擎全程运行无异常", apSuppressCalls.has("s-std"));

// ── 0.7.0：首轮锚定、晋升后 resident 目录（dsh-anchored-standard 语义）─
const residentSession = {
  id: "s-res",
  header: { cwd: "/tmp/res", delegationDepth: 0 },
  events: [{ type: "assistant/message", seq: 1 }],
};
const agentResident = apAgent("s-res", "standard", residentSession);
apEmit("agent/created", { agent: agentResident });
const resRegs = apToolRegistrations.filter((r) => r.agent === "s-res");
check("AP: 晋升后注册常驻发现工具三件套", ["dev_tool_search", "skill_search", "skill_load"].every((n) =>
  resRegs.some((r) => r.name === n)));
const resRestrictCalls = apRestrictCalls.filter((c) => c.agent === "s-res");
const resBootstrap = resRestrictCalls.find((c) => c.deny.includes("read") && c.deny.includes("web_search"));
check("AP: 晋升后保留 resident 目录而非完整目录", resBootstrap !== void 0
  && !resBootstrap.deny.includes("bash")
  && !resBootstrap.deny.includes("str_replace_editor")
  && !resBootstrap.deny.includes("dev_tool_search")
  && !resBootstrap.deny.includes("skill_search")
  && !resBootstrap.deny.includes("skill_load")
  && resBootstrap.deny.includes("read")
  && resBootstrap.deny.includes("subagent"));
const devTool = apToolDefs.get("s-res:dev_tool_search");
const beforeUnlockRestrict = apRestrictCalls.filter((c) => c.agent === "s-res").length;
if (devTool !== void 0) {
  const out = await devTool.execute({ query: "", toolNames: ["read"] }, { agent: agentResident });
  check("AP: dev_tool_search 解锁返回文本", typeof out.text === "string" && out.text.includes("Unlocked"));
} else {
  check("AP: dev_tool_search 解锁返回文本", false);
}
const unlockRestrictCalls = apRestrictCalls.filter((c) => c.agent === "s-res").slice(beforeUnlockRestrict);
check("AP: dev_tool_search 解锁后 read 进入 resident 保留集", unlockRestrictCalls.length > 0
  && unlockRestrictCalls.some((c) => !c.deny.includes("read") && c.deny.includes("web_search")));
apEmit("agent/disposed", { agent: agentResident });
check("AP: agent 销毁释放 dev_tool_search", apToolDisposals.some((d) => d.agent === "s-res" && d.name === "dev_tool_search"));
const agentBoot = apAgent("s-boot", "standard", { id: "s-boot", header: {}, events: [] });
apEmit("agent/created", { agent: agentBoot });
const bootRestrictCalls = apRestrictCalls.filter((c) => c.agent === "s-boot");
check("AP: 首轮锚定-收窄到真实工具对（4 编排族 + bootstrap restrict）", bootRestrictCalls.length === 5
  && bootRestrictCalls.some((c) => c.deny.includes("read") && c.deny.includes("web_search")
    && !c.deny.includes("bash") && !c.deny.includes("str_replace_editor")));
check("AP: bootstrap 阶段不注册发现工具", !apToolRegistrations.some((r) => r.agent === "s-boot" && r.name === "dev_tool_search"));
apEmit("agent/disposed", { agent: agentBoot });

// ── 0.7.0：上下文剥离引擎路径（默认只剥首轮；常驻抑制是 opt-in）──────
const ctxSession = { id: "s-ctx", header: { cwd: "/ctx" }, events: [{ type: "assistant/message", seq: 1 }] };
const ctxAgent = apAgent("s-ctx", "standard", ctxSession);
apEmit("agent/created", { agent: ctxAgent });
check("AP: 晋升后注册发现工具三件套（resident）", ["dev_tool_search", "skill_search", "skill_load"].every((n) =>
  apToolRegistrations.some((r) => r.agent === "s-ctx" && r.name === n)));
const preStep = apEvents["agent/pre-step"][0];
const injectedMsgs = [
  { role: "user", source: { kind: "skill-catalog" }, content: [{ type: "text", text: "skills" }] },
  { role: "user", source: { kind: "agent-instructions" }, content: [{ type: "text", text: "agents" }] },
  { role: "user", source: { kind: "user" }, content: [{ type: "text", text: "real" }] },
];
// 引擎以 suppressInjectedContext=true 启动：常驻抑制开启时晋升后仍剥离（opt-in 语义）。
const stepRes = await preStep({ agent: ctxAgent, signal: undefined }, async () => ({ kind: "continue", messages: injectedMsgs }));
const stepKinds = stepRes.messages.map((m) => m.source && m.source.kind);
check("AP: 常驻抑制开启-晋升后仍剥离注入（opt-in）", stepKinds.includes("user") && !stepKinds.includes("skill-catalog") && !stepKinds.includes("agent-instructions"));
// 常驻抑制关闭 → 晋升后恢复注入（功能不减少）。
apCtx.gateway.set({ suppressInjectedContext: false });
const stepRes3 = await preStep({ agent: ctxAgent, signal: undefined }, async () => ({ kind: "continue", messages: injectedMsgs }));
const stepKinds3 = stepRes3.messages.map((m) => m.source && m.source.kind);
check("AP: 常驻抑制关闭-晋升后恢复注入（功能不减少）", stepKinds3.includes("skill-catalog") && stepKinds3.includes("agent-instructions") && stepKinds3.includes("user"));
apCtx.gateway.set({ suppressInjectedContext: true });
// bootstrap 阶段（未晋升）：首轮剥离生效。
const boot2 = apAgent("s-boot2", "standard", { id: "s-boot2", header: {}, events: [] });
apEmit("agent/created", { agent: boot2 });
const bootRes = await preStep({ agent: boot2, signal: undefined }, async () => ({ kind: "continue", messages: injectedMsgs }));
const bootKinds = bootRes.messages.map((m) => m.source && m.source.kind);
check("AP: 首轮剥离注入", bootKinds.length === 1 && bootKinds[0] === "user");
// 增量晋升：空 events 新会话挂 bootstrap restrict，收到首个 tool/call 后释放。
const freshAgent = apAgent("s-fresh", "standard", { id: "s-fresh", header: {}, events: [] });
apEmit("agent/created", { agent: freshAgent });
const freshDenies = apRestrictCalls.filter((c) => c.agent === "s-fresh");
check("AP: 增量晋升前-新会话处于首轮锚定", freshDenies.some((c) => c.deny.includes("read") && c.deny.includes("web_search")));
const freshDisposedBefore = apDisposedCalls.filter((c) => c.agent === "s-fresh").length;
apEmit("session/event", freshAgent.session, { type: "tool/call", seq: 1 });
const freshDisposedAfter = apDisposedCalls.filter((c) => c.agent === "s-fresh");
check("AP: 增量晋升-首个 tool/call 释放 bootstrap restrict（进入 resident 目录）", freshDisposedAfter.length === freshDisposedBefore + 1
  && freshDisposedAfter.some((c) => c.deny.includes("read") && c.deny.includes("web_search")));
check("AP: 增量晋升后注册常驻发现工具", ["dev_tool_search", "skill_search", "skill_load"].every((n) =>
  apToolRegistrations.some((r) => r.agent === "s-fresh" && r.name === n)));
apEmit("agent/disposed", { agent: freshAgent });
apEmit("agent/disposed", { agent: boot2 });
apEmit("agent/disposed", { agent: ctxAgent });

// ── 0.5.0：真实工具对挂载（stub 模块注入，独立 ctx）───────────────────
const rpEvents = {};
const apMounted = []; // { agent, module, config }
const apFiberDisposed = [];
const apCtx2 = {
  logger: apCtx.logger,
  get(name) {
    if (name === "tools") return { schemas: (a) => [...(apToolSets.get(a.id) ?? [])].map((n) => ({ name: n })), restrict: () => () => {} };
    if (name === "systemPrompt") return { suppressRuntimeContext() { return () => {}; } };
    if (name === "agentPresets") return apAgentPresetsMock;
    if (name === "agents") return apAgentsMock;
    if (name === "skills") return apSkillsMock;
    if (name === "fs") return apFsMock;
    return undefined;
  },
  on(event, listener) { (rpEvents[event] ??= []).push(listener); },
  effect(fn) { fn(); },
  plugin(Cls, cfg) {
    const saved = this.reflect;
    this.reflect = { provide: () => {}, props: {} };
    try { this.gateway = new Cls(this, cfg); } finally { this.reflect = saved; }
  },
};
await ap.apply(apCtx2, { presets: ["standard"], bootstrap: { enabled: true, realPair: true } }, { realPairModules: stubModules });
const agentRp = apAgent("s-rp", "standard", { id: "s-rp", header: { cwd: "/rp" }, events: [] });
agentRp.ctx.plugin = (mod, cfg) => {
  apMounted.push({ agent: agentRp.id, module: mod.name, config: cfg });
  return { dispose: () => apFiberDisposed.push(agentRp.id) };
};
for (const listener of rpEvents["agent/created"] ?? []) listener({ agent: agentRp });
check("AP: realPair 挂载 5 个官方插件", apMounted.length === 5
  && apMounted.some((m) => m.module === "dsh-tool-bash-persistent" && m.config.description === ap.MINIMAL_BASH_DESCRIPTION)
  && apMounted.some((m) => m.module === "dsh-tool-str-replace-editor")
  && apMounted.some((m) => m.module === "dsh-terminal"));
check("AP: realPair 阴影 tool:bash 引导段", apSectionCalls.some((c) => c.agent === "s-rp" && c.name === "tool:bash" && c.text === ""));
const mountedBefore = apFiberDisposed.length;
apCtx2.gateway.set({ bootstrap: { realPair: false } });
check("AP: realPair 热更新关闭后卸载", apFiberDisposed.length === mountedBefore + apMounted.length);
for (const listener of rpEvents["agent/disposed"] ?? []) listener({ agent: agentRp });

// ── 0.7.0：默认零裁剪（只提高性能不减少功能；lean 为 opt-in）──────────
// 默认配置下 standard 会话：工具目录零裁剪（无编排族限制），只启用
// 提示词层（运行时快照抑制 + 3 个全局引导段屏蔽 + 极简 persona 替换）。
// 开启 leanByDefault 后编排族限制按需生效（opt-in 路径完好）。
{
  const zeroEvents = {};
  const zeroCtx = {
    logger: apCtx.logger,
    get(name) {
      if (name === "tools") return { schemas: (a) => [...(apToolSets.get(a.id) ?? [])].map((n) => ({ name: n })), restrict: () => () => {} };
      if (name === "systemPrompt") return { suppressRuntimeContext() { return () => {}; } };
      if (name === "agentPresets") return apAgentPresetsMock;
      if (name === "agents") return apAgentsMock;
      if (name === "skills") return apSkillsMock;
      if (name === "fs") return apFsMock;
      return undefined;
    },
    on(event, listener) { (zeroEvents[event] ??= []).push(listener); },
    effect(fn) { fn(); },
    plugin(Cls, cfg) {
      const saved = this.reflect;
      this.reflect = { provide: () => {}, props: {} };
      try { this.gateway = new Cls(this, cfg); } finally { this.reflect = saved; }
    },
  };
  // 热更新用例已把激进配置持久化进 config.json（fakeHome），先清掉再
  // apply，模拟全新安装下的默认行为（0.7.0：全部机制默认开启）。
  fs.rmSync(path.join(fakeHome, "plugins", "adaptive-perf", "config.json"), { force: true });
  await ap.apply(zeroCtx, {});
  const zeroAgent = apAgent("s-zero", "standard");
  for (const listener of zeroEvents["agent/created"] ?? []) listener({ agent: zeroAgent });
  await new Promise((resolve) => setTimeout(resolve, 10));
  check("AP: 默认配置工具零裁剪（无编排族限制）", apRestrictCalls.filter((c) => c.agent === "s-zero").length === 0,
    JSON.stringify(apRestrictCalls.filter((c) => c.agent === "s-zero").map((c) => c.deny)));
  check("AP: 默认配置运行时上下文抑制", apSuppressCalls.has("s-zero"));
  check("AP: 默认配置提示段阴影（3 引导段 + 极简 persona）", (() => {
    const calls = apSectionCalls.filter((c) => c.agent === "s-zero");
    return calls.length === 4
      && calls.filter((c) => c.text === "").length === 3
      && calls.some((c) => c.name === "deployment:persona" && c.text === "You are a helpful software engineer assistant.");
  })(), JSON.stringify(apSectionCalls.filter((c) => c.agent === "s-zero")));
  // opt-in：热开启 lean → 新会话有 4 个编排族限制。
  zeroCtx.gateway.set({ leanByDefault: true });
  const zeroAgent2 = apAgent("s-zero2", "standard");
  for (const listener of zeroEvents["agent/created"] ?? []) listener({ agent: zeroAgent2 });
  check("AP: opt-in 开启 lean 后新会话有 4 编排族限制", apRestrictCalls.filter((c) => c.agent === "s-zero2").length === 4,
    JSON.stringify(apRestrictCalls.filter((c) => c.agent === "s-zero2").map((c) => c.deny)));
  // 热关闭 lean → 新会话回到零裁剪。
  zeroCtx.gateway.set({ leanByDefault: false });
  const zeroAgent3 = apAgent("s-zero3", "standard");
  for (const listener of zeroEvents["agent/created"] ?? []) listener({ agent: zeroAgent3 });
  check("AP: 热关闭 lean 后新会话无编排族限制", apRestrictCalls.filter((c) => c.agent === "s-zero3").length === 0);
}


// ── session-archive（归档管理：列表/查看/批量删除/恢复）─────────────────
const { createArchiveHost } = await import(path.join(ROOT, "packages/session-archive/lib/index.mjs"));
const archiveCfg = { detailMaxMessages: 50, messagePreviewChars: 500, titleReadConcurrency: 2 };
const saRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sa-"));
const writeSession = (id, cwd, events) => {
  const dir = path.join(saRoot, "--proj--", id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "session.jsonl"), JSON.stringify(events));
  return dir;
};
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
  // 与真实 JSONL 后端一致：list() 扫描文件系统，文件已删的会话不再出现。
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
check("SA: list 过滤幽灵归档 id", listResult.items.length === 2 && !listResult.items.some((i) => i.sessionId === "s-ghost"));
check("SA: list 不显示未归档会话", !listResult.items.some((i) => i.sessionId === "s3"));
check("SA: list 折叠标题", listResult.items.find((i) => i.sessionId === "s1").title === "第一个归档会话"
  && listResult.items.find((i) => i.sessionId === "s2").title === null);
check("SA: list 带文件元信息", listResult.items.every((i) => i.size > 0 && i.updatedAt > 0 && i.live === false));

// 宿主归档不停止内存会话、web 重连还会恢复旧 tab，但归档会话已从会话
// 列表移除、无法继续对话——内存存在不构成删除风险，不再标记"运行中"。
sessions.set("s1", {});
const listLive = await archiveHost.list();
check("SA: list 归档会话不标运行中（内存存在也不）", listLive.items.find((i) => i.sessionId === "s1").live === false);

const detailResult = await archiveHost.detail("s1");
check("SA: detail 提取标题与消息", detailResult.title === "第一个归档会话"
  && detailResult.messages.length === 2
  && detailResult.messages[0].role === "user"
  && detailResult.messages[1].text.includes("可以帮你"));
check("SA: detail 归档会话不标运行中", detailResult.live === false);

// busy 兜底：归档 + 仍在内存 + 文件 60s 内有写入（归档瞬间还在生成）→ 拒绝。
const delBusy = await archiveHost.deleteArchived(["s1"]);
check("SA: busy 兜底拒绝删除（内存+新 mtime）", delBusy.deleted.length === 0 && delBusy.failed[0].reason === "busy");
sessions.delete("s1");

const delResult = await archiveHost.deleteArchived(["s1", "s-ghost"]);
check("SA: 批量删除归档会话（删除文件）", delResult.deleted.includes("s1") && delResult.deleted.includes("s-ghost")
  && !fs.existsSync(path.join(saRoot, "--proj--", "s1")));
check("SA: 删除后保留归档 ghost id（侧边栏不再显示内存会话）",
  registryState.archivedSessionIds.includes("s1")
  && registryState.archivedSessionIds.includes("s-ghost")
  && delResult.removedFromArchive === 0);
check("SA: 删除后 list 不再显示（存在性过滤）",
  !(await archiveHost.list()).items.some((i) => i.sessionId === "s1"));

const unResult = await archiveHost.unarchive(["s2"]);
check("SA: 恢复归档不动文件", unResult.restored.includes("s2")
  && fs.existsSync(path.join(saRoot, "--proj--", "s2", "session.jsonl"))
  && !registryState.archivedSessionIds.includes("s2"));

const ghostUnResult = await archiveHost.unarchive(["s-ghost"]);
check("SA: ghost 归档 id 拒绝恢复（不复活已删除会话）",
  ghostUnResult.restored.length === 0 && registryState.archivedSessionIds.includes("s-ghost"));

// 降级路径：registry 无写入通道时删除仅清文件，列表按存在性过滤
const degraded = createArchiveHost({ ...saCtx, workspaceRegistry: { archivedSessionIds: ["s2"] } }, archiveCfg);
const degList = await degraded.list();
check("SA: 降级 registry 仍能列出（存在性过滤）", degList.items.length === 1 && degList.items[0].sessionId === "s2");

fs.rmSync(saRoot, { recursive: true, force: true });

fs.rmSync(fakeHome, { recursive: true, force: true });
console.log("RESULT pass=" + pass + " fail=" + fail);
process.exit(fail === 0 ? 0 : 1);
