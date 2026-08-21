import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as ap from "../src/index.js";
import { createConfigStore } from "../src/config-store.js";

const prevHome = process.env.HOME;
const prevDshHome = process.env.DSH_HOME;
let fakeHome: string;

beforeEach(() => {
  fakeHome = mkdtempSync(join(tmpdir(), "ap-fh-"));
  process.env.HOME = fakeHome;
  process.env.DSH_HOME = fakeHome;
});
afterEach(() => {
  process.env.HOME = prevHome;
  process.env.DSH_HOME = prevDshHome;
  rmSync(fakeHome, { recursive: true, force: true });
});

const STANDARD_CATALOG = [
  "bash", "read", "write", "edit", "glob", "grep", "read_image",
  "job_output", "job_list", "job_kill", "todo_write", "ask_user_question",
  "web_search", "skill", "exit_plan_mode",
  "subagent", "subagent_fork", "send_message", "list_agents", "interrupt_agent",
  "workflow", "ralph", "create_goal", "get_goal", "update_goal",
];

/** 构造一组全新的 mock（每个 it 隔离，避免全局计数器串扰）。 */
function buildMocks() {
  const events: any = {};
  const restrictCalls: any[] = [];
  const disposedCalls: any[] = [];
  const toolRegistrations: any[] = [];
  const toolDisposals: any[] = [];
  const toolDefs = new Map<string, any>();
  const suppressCalls = new Set<string>();
  const sectionCalls: any[] = [];
  const sectionDisposed: any[] = [];
  const toolSets = new Map<string, Set<string>>();
  const liveAgents = new Map<string, any>();

  function makeAgentTools(id: string) {
    return {
      schemas(agent: any) {
        return [...(toolSets.get(id) ?? [])].map((n) => ({ name: n }));
      },
      restrict({ deny }: any) {
        restrictCalls.push({ agent: id, deny: [...deny] });
        return () => { disposedCalls.push({ agent: id, deny: [...deny] }); };
      },
      register(definition: any) {
        toolRegistrations.push({ agent: id, name: definition.name });
        toolDefs.set(`${id}:${definition.name}`, definition);
        return () => { toolDisposals.push({ agent: id, name: definition.name }); };
      },
    };
  }
  const agentPresetsMock = { composedPreset(agentCtx: any) { return agentCtx.presetId; } };
  const agentsMock = { list: () => [...liveAgents.values()] };
  const skillsMock = {
    list: async () => [{ name: "pdf-tools", description: "PDF 处理" }],
    get: async (name: string) => ({ name, content: "full instructions" }),
  };
  const fsMock = {
    resolve: async (target: string) => target,
    stat: async (target: string) => (target.includes("AGENTS.md") || target.includes("CLAUDE.md") ? { type: "file" } : { type: "dir" }),
  };
  let gateway: any;
  const ctx: any = {
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    get(name: string) {
      if (name === "tools") return {
        schemas: (agent: any) => [...(toolSets.get(agent.id) ?? [])].map((n) => ({ name: n })),
        restrict: () => () => {},
      };
      if (name === "systemPrompt") return {
        suppressRuntimeContext() { suppressCalls.add("sp"); return () => {}; },
      };
      if (name === "agentPresets") return agentPresetsMock;
      if (name === "agents") return agentsMock;
      if (name === "skills") return skillsMock;
      if (name === "fs") return fsMock;
      return undefined;
    },
    on(event: string, listener: any) { (events[event] ??= []).push(listener); },
    effect(fn: any) { fn(); },
    plugin(Cls: any, cfg: any) {
      const saved = this.reflect;
      this.reflect = { provide: () => {}, props: {} };
      try { this.gateway = new Cls(this, cfg); } finally { this.reflect = saved; }
    },
  };
  function agent(id: string, presetId: string, session?: any) {
    toolSets.set(id, new Set(STANDARD_CATALOG));
    const a = {
      id,
      ctx: {
        presetId,
        tools: makeAgentTools(id),
        systemPrompt: {
          suppressRuntimeContext() { suppressCalls.add(id); return () => {}; },
          section(section: any) {
            sectionCalls.push({ agent: id, ...section });
            return () => { sectionDisposed.push({ agent: id, name: section.name }); };
          },
        },
      },
    };
    if (session !== void 0) (a as any).session = session;
    liveAgents.set(id, a);
    return a;
  }
  function emit(event: string, ...args: any[]) {
    for (const listener of events[event] ?? []) listener(...args);
  }
  return {
    ctx, events, emit, agent,
    restrictCalls, disposedCalls, toolRegistrations, toolDefs, toolDisposals,
    suppressCalls, sectionCalls, sectionDisposed,
  };
}

describe("adaptive-perf pure functions + config-store", () => {
  it("config-store 嵌套默认+patch+json 合并", () => {
    const store = createConfigStore({ name: "adaptive-perf-store-test", defaults: { enabled: true, presets: ["standard", "code"], families: { delegation: { enabled: true, tools: ["subagent"], keywords: ["子代理"] } } }, patchConfig: { presets: ["code"] }, onUpdate: () => {} });
    store.set({ enabled: false });
    expect(store.effective().enabled === false && store.effective().presets[0] === "code" && store.effective().families.delegation.tools[0] === "subagent", "store(adaptive): 嵌套默认+patch+json 合并").toBe(true);
  });

  it("settings namespace 注册函数导出", () => {
    expect(typeof ap.registerSettingsNamespace === "function", "AP: 导出 registerSettingsNamespace").toBe(true);
  });

  it("纯函数：提取/匹配/失败文本", () => {
    expect(ap.extractUserText({ content: [{ type: "text", text: "a" }, { type: "image", attachment: {} }, { type: "text", text: "b" }] }) === "ab", "AP: 提取用户文本").toBe(true);
    expect(ap.matchKeywords("帮我 SUBAGENT 处理", ["subagent"]) === true && ap.matchKeywords("普通消息", ["子代理"]) === false, "AP: 关键词命中（大小写不敏感）").toBe(true);
    expect(ap.collectFailureText({ isError: true, error: { code: "UNKNOWN_TOOL", message: 'unknown tool "workflow"' }, content: [] }).includes("workflow"), "AP: 失败文本收集").toBe(true);
  });

  it("配置归一化", () => {
    const norm = ap.normalizeConfig({ presets: "standard,code", families: { delegation: { tools: "subagent,subagent_fork", keywords: ["子代理"] } } });
    expect(norm.presets.length === 2 && norm.families.delegation.tools.length === 2 && norm.enabled === true, "AP: 配置归一化").toBe(true);
  });

  it("bootstrap 首轮锚定纯函数", () => {
    const PROMOTE = ap.PROMOTE_EVENTS.either;
    expect(ap.scanPhase([], PROMOTE).promoted === false, "AP: 阶段扫描-无事件未晋升").toBe(true);
    expect(ap.scanPhase([{ type: "assistant/message", seq: 1 }], PROMOTE).promoted === true, "AP: 阶段扫描-首个 assistant/message 晋升").toBe(true);
    expect(ap.scanPhase([{ type: "assistant/message", seq: 1 }], ap.PROMOTE_EVENTS["tool-call"]).promoted === false, "AP: 阶段扫描-只认 tool-call 时不认 assistant").toBe(true);
    expect(ap.scanPhase([{ type: "assistant/message", seq: 1 }, { type: "compaction/end", seq: 5 }], PROMOTE).promoted === true, "AP: 阶段扫描-晋升持久（compaction 不重置）").toBe(true);
    expect(ap.scanPhase([{ type: "assistant/message", seq: 3 }, { type: "compaction/end", seq: 5 }], PROMOTE).promoted === true, "AP: 阶段扫描-压缩前晋升保持").toBe(true);
    const phaseState = new Map([["s1", { ...ap.scanPhase([], PROMOTE), promoteOn: "either" }]]);
    ap.observePhase(phaseState, "s1", { type: "tool/call", seq: 2 });
    expect(phaseState.get("s1").promoted === true, "AP: 阶段观察-增量晋升").toBe(true);
    ap.observePhase(phaseState, "s1", { type: "compaction/end", seq: 9 });
    expect(phaseState.get("s1").promoted === true, "AP: 阶段观察-晋升持久（压缩不重置）").toBe(true);
    ap.observePhase(phaseState, "s1", { type: "assistant/message", seq: 10 });
    expect(phaseState.get("s1").promoted === true, "AP: 阶段观察-已晋升保持").toBe(true);
  });

  it("工具/消息过滤 + 预算", () => {
    const fullAsm = { tools: ["bash", "read", "write", "edit", "glob", "grep", "str_replace_editor", "subagent", "workflow"].map((name) => ({ name })) };
    expect((() => {
      const r = ap.filterBootstrapTools(fullAsm, ["bash", "str_replace_editor"]);
      return r.missing.length === 0 && r.tools.length === 2 && r.tools.every((t: any) => ["bash", "str_replace_editor"].includes(t.name));
    })(), "AP: 工具过滤-收窄到 bootstrap 对").toBe(true);
    expect((() => {
      const r = ap.filterBootstrapTools(fullAsm, ["bash", "not-a-tool"]);
      return r.missing.length === 1 && r.missing[0] === "not-a-tool" && r.tools.length === 1;
    })(), "AP: 工具过滤-缺失工具报 missing 且保留可用集").toBe(true);
    expect((() => {
      const r = ap.filterBootstrapTools(fullAsm, ["bash", "str_replace_editor", "read", "write"]);
      return r.missing.length === 0 && r.tools.length === 4;
    })(), "AP: 工具过滤-多工具保留集").toBe(true);
    expect((() => {
      const msgs = [
        { role: "user", source: { kind: "skill-catalog" }, content: [{ type: "text", text: "skills" }] },
        { role: "user", source: { kind: "agent-instructions" }, content: [{ type: "text", text: "agents" }] },
        { role: "user", source: { kind: "user" }, content: [{ type: "text", text: "real" }] },
        { role: "user", content: [{ type: "text", text: "plain" }] },
      ];
      const kept = ap.filterBootstrapMessages(msgs, new Set(["skill-catalog", "agent-instructions"]));
      return kept.length === 2 && kept[0].content[0].text === "real";
    })(), "AP: 消息过滤-剥离 skill-catalog 保留用户消息").toBe(true);
    expect(ap.filterBootstrapMessages([{ content: [] }], new Set()).length === 1, "AP: 消息过滤-空抑制集原样返回").toBe(true);
    expect(JSON.stringify(ap.applyBootstrapBudget({ maxTokens: 256000, a: 1 }, false, 1024)) === '{"maxTokens":1024,"a":1}', "AP: 预算-未晋升封顶").toBe(true);
    expect(JSON.stringify(ap.applyBootstrapBudget({ maxTokens: 1024, a: 1 }, true, 1024)) === '{"a":1}', "AP: 预算-晋升后剥离封顶").toBe(true);
    expect(ap.applyBootstrapBudget({ maxTokens: 256000, a: 1 }, true, 1024).maxTokens === 256000, "AP: 预算-晋升后非封顶值保留").toBe(true);
  });

  it("bootstrap/minimalPrompt 配置校验与归一化", () => {
    let rejected = false;
    try { ap.validateConfig({ bootstrap: { promoteOn: "bogus" } }); } catch { rejected = true; }
    expect(rejected === true, "AP: bootstrap 配置校验-非法 promoteOn 拒绝").toBe(true);

    const bnorm = ap.normalizeConfig({ bootstrap: { enabled: false, maxTokens: 2048, promoteOn: "tool-call", suppressedContextSources: [] } });
    expect(bnorm.bootstrap.enabled === false && bnorm.bootstrap.maxTokens === 2048 && bnorm.bootstrap.promoteOn === "tool-call" && bnorm.bootstrap.suppressedContextSources.length === 0 && bnorm.bootstrap.tools.includes("bash"), "AP: bootstrap 配置归一化").toBe(true);

    const mpnorm = ap.normalizeConfig({ minimalPrompt: { persona: "  You are terse.  ", suppressSections: false } });
    expect(mpnorm.minimalPrompt.enabled === true && mpnorm.minimalPrompt.persona === "You are terse." && mpnorm.minimalPrompt.suppressSections === false, "AP: minimalPrompt 配置归一化").toBe(true);
    const mpdef = ap.normalizeConfig({});
    expect(mpdef.minimalPrompt.enabled === true && mpdef.minimalPrompt.persona === "You are a helpful software engineer assistant." && mpdef.minimalPrompt.suppressSections === true, "AP: minimalPrompt 默认开启且 persona 模板保留").toBe(true);
    let mpRejected = false;
    try { ap.validateConfig({ minimalPrompt: { persona: 123 } }); } catch { mpRejected = true; }
    expect(mpRejected === true, "AP: minimalPrompt 配置校验-非法 persona 拒绝").toBe(true);

    expect(ap.SECTION_SHADOWS.length === 3 && ap.SECTION_SHADOWS.some(([n]: any) => n === "harness:identity") && ap.SECTION_SHADOWS.some(([n]: any) => n === "harness:source") && ap.SECTION_SHADOWS.some(([n]: any) => n === "app:web-surface") && ap.PERSONA_SECTION_NAME === "deployment:persona", "AP: 阴影段清单完整").toBe(true);
  });

  it("0.7.0 默认配置与 opt-in", () => {
    const v5def = ap.normalizeConfig({});
    expect(v5def.suppressInjectedContext === true && v5def.leanByDefault === false && v5def.suppressRuntimeContext === true && v5def.bootstrap.enabled === true && v5def.bootstrap.realPair === true && v5def.presets.includes("standard") && v5def.presets.includes("code") && v5def.presets.includes("cordis"), "AP: 0.7.0 默认配置").toBe(true);
    const v5norm = ap.normalizeConfig({ suppressInjectedContext: true, bootstrap: { realPair: false } });
    expect(v5norm.suppressInjectedContext === true && v5norm.bootstrap.realPair === false, "AP: 0.7.0 配置归一化-opt-in 生效").toBe(true);
    let v5Rejected = false;
    try { ap.validateConfig({ suppressInjectedContext: "yes" }); } catch { v5Rejected = true; }
    let v5Rejected2 = false;
    try { ap.validateConfig({ bootstrap: { realPair: 1 } }); } catch { v5Rejected2 = true; }
    expect(v5Rejected === true && v5Rejected2 === true, "AP: 0.7.0 配置校验-非法值拒绝").toBe(true);
  });

  it("真实 Minimal 工具对纯函数", async () => {
    expect(ap.MINIMAL_BASH_DESCRIPTION.startsWith("Run commands in a bash shell") && ap.MINIMAL_BASH_DESCRIPTION.includes("* State is persistent across command calls and discussions with the user.") && ap.MINIMAL_BASH_DESCRIPTION.includes("sed -n 10,25p"), "AP: Minimal bash 描述与官方逐字一致").toBe(true);
    const stubModules = {
      terminal: { name: "dsh-terminal" },
      terminalBash: { name: "dsh-terminal-bash" },
      bashPersistent: { name: "dsh-tool-bash-persistent" },
      fsLocal: { name: "dsh-fs-local" },
      strReplaceEditor: { name: "dsh-tool-str-replace-editor" },
    };
    const loaded = await ap.loadRealPairModules((spec: string) => Promise.resolve(stubModules[Object.keys(ap.REAL_PAIR_SPECS).find((k: string) => ap.REAL_PAIR_SPECS[k] === spec) as keyof typeof stubModules]));
    expect(loaded !== null && loaded.bashPersistent.name === "dsh-tool-bash-persistent", "AP: loadRealPairModules-成功路径").toBe(true);
    const failed = await ap.loadRealPairModules(() => Promise.reject(new Error("no such package")));
    expect(failed === null, "AP: loadRealPairModules-缺失包整体降级").toBe(true);
    const mounts = ap.realPairMounts(stubModules, "/work");
    expect(mounts.length === 5 && mounts[0].module.name === "dsh-terminal" && mounts[2].module.name === "dsh-tool-bash-persistent" && mounts[2].config.description === ap.MINIMAL_BASH_DESCRIPTION && mounts[3].config.cwd === "/work" && mounts[4].config.maxOutputChars === 16000, "AP: realPairMounts-顺序与配置").toBe(true);
    const mountedPlugins: any[] = [];
    const mountAgent = { ctx: { plugin(mod: any, cfg: any) { mountedPlugins.push({ name: mod.name, cfg }); return { dispose() {} }; } } };
    const disposers = ap.mountRealPair(mountAgent, mounts, () => {});
    expect(mountedPlugins.length === 5 && disposers.length === 5, "AP: mountRealPair-逐模块挂载").toBe(true);
    expect(ap.mountRealPair({ ctx: {} }, mounts, () => {}).length === 0, "AP: mountRealPair-无 plugin 的 agent 安全跳过").toBe(true);

    const strippedMsgs = ap.stripSuppressedMessages(
      [{ source: { kind: "skill-catalog" }, content: [] }, { source: { kind: "user" }, content: [] }],
      new Set(["skill-catalog"]));
    expect(strippedMsgs.length === 1 && strippedMsgs[0].source.kind === "user", "AP: stripSuppressedMessages-按 kind 剥离").toBe(true);
    expect(ap.stripSuppressedMessages([{ content: [] }], new Set()).length === 1, "AP: stripSuppressedMessages-空集原样").toBe(true);
  });
});

describe("adaptive-perf 自适应引擎", () => {
  function setup() {
    const m = buildMocks();
    return m;
  }

  it("引擎：限制族 / 提示词层 / 升级 / 热更新", async () => {
    const m = setup();
    const { ctx, emit, agent, restrictCalls, disposedCalls, suppressCalls, sectionCalls, sectionDisposed } = m;
    await ap.apply(ctx, {
      presets: ["standard", "code"],
      leanByDefault: true,
      suppressRuntimeContext: true,
      suppressInjectedContext: true,
      minimalPrompt: { enabled: true },
      bootstrap: { enabled: true, realPair: false },
    }, { realPairModules: null });

    const agentStd = agent("s-std", "standard");
    emit("agent/created", { agent: agentStd });
    const stdDenies = restrictCalls.filter((c) => c.agent === "s-std");
    expect(stdDenies.length === 4
      && stdDenies.some((c) => c.deny.includes("subagent") && c.deny.includes("send_message") && c.deny.includes("interrupt_agent"))
      && stdDenies.some((c) => c.deny[0] === "workflow")
      && stdDenies.some((c) => c.deny[0] === "ralph")
      && stdDenies.some((c) => c.deny.includes("create_goal") && c.deny.includes("update_goal")), "AP: 启动即限制 4 个编排族").toBe(true);
    expect(stdDenies.every((c) => !c.deny.includes("bash") && !c.deny.includes("read") && !c.deny.includes("web_search")), "AP: 核心工具不在任何 deny 里").toBe(true);
    expect(suppressCalls.has("s-std"), "AP: 运行时上下文已抑制").toBe(true);
    const stdSections = sectionCalls.filter((c) => c.agent === "s-std");
    expect(stdSections.length === 4
      && stdSections.filter((c) => c.text === "").length === 3
      && stdSections.some((c) => c.name === "harness:identity" && c.order === -100)
      && stdSections.some((c) => c.name === "harness:source" && c.order === -99)
      && stdSections.some((c) => c.name === "app:web-surface" && c.order === -98)
      && stdSections.some((c) => c.name === "deployment:persona" && c.text === "You are a helpful software engineer assistant."), "AP: 极简提示词层-3 引导段屏蔽 + persona 替换").toBe(true);

    emit("agent/created", { agent: agent("s-min", "minimal") });
    expect(restrictCalls.filter((c) => c.agent === "s-min").length === 0 && !suppressCalls.has("s-min") && sectionCalls.filter((c) => c.agent === "s-min").length === 0, "AP: 非目标 preset 零副作用").toBe(true);

    emit("agent/inbox/inserted", { agent: agentStd, message: { content: [{ type: "text", text: "请用子代理并行处理这两个任务" }] } });
    expect(disposedCalls.some((c) => c.agent === "s-std" && c.deny.includes("subagent")), "AP: 关键词放行 delegation 族").toBe(true);
    const disposedCount = disposedCalls.length;
    emit("agent/inbox/inserted", { agent: agentStd, message: { content: [{ type: "text", text: "再委托一次" }] } });
    expect(disposedCalls.length === disposedCount && restrictCalls.filter((c) => c.agent === "s-std").length === 4, "AP: 升级单调（重复触发不重复放行）").toBe(true);

    emit("tools/result",
      { agent: agentStd },
      { isError: true, error: { code: "UNKNOWN_TOOL", message: 'unknown tool "workflow": reach it via the SDK' }, content: [] });
    expect(disposedCalls.some((c) => c.agent === "s-std" && c.deny[0] === "workflow"), "AP: 失败信号放行 workflow 族").toBe(true);
    const afterFailure = disposedCalls.length;

    ctx.gateway.set({ leanByDefault: false });
    expect(disposedCalls.length === afterFailure + 2, "AP: lean 关闭释放全部剩余限制").toBe(true);
    const restrictBeforeReopen = restrictCalls.filter((c) => c.agent === "s-std").length;
    ctx.gateway.set({ leanByDefault: true });
    const reopened = restrictCalls.filter((c) => c.agent === "s-std").slice(restrictBeforeReopen);
    expect(reopened.length === 2 && reopened.some((c) => c.deny[0] === "ralph") && reopened.some((c) => c.deny.includes("create_goal")), "AP: 重开 lean 只补限制未升级族").toBe(true);
    emit("agent/inbox/inserted", { agent: agentStd, message: { content: [{ type: "text", text: "用子代理" }] } });
    expect(restrictCalls.filter((c) => c.agent === "s-std").length === restrictBeforeReopen + 2, "AP: 已升级族跨配置刷新保持放行").toBe(true);

    const mpCallsBefore = sectionCalls.filter((c) => c.agent === "s-std").length;
    const mpDisposedBefore = sectionDisposed.filter((c) => c.agent === "s-std").length;
    ctx.gateway.set({ minimalPrompt: { enabled: true, suppressSections: false } });
    const mpNewCalls = sectionCalls.filter((c) => c.agent === "s-std").slice(mpCallsBefore);
    const mpNewDisposed = sectionDisposed.filter((c) => c.agent === "s-std").slice(mpDisposedBefore);
    expect(mpNewDisposed.length === 4 && mpNewCalls.length === 1 && mpNewCalls[0].name === "deployment:persona", "AP: minimalPrompt 热更新-旧阴影释放且仅 persona 保留").toBe(true);
    const mpDisposedBefore2 = sectionDisposed.filter((c) => c.agent === "s-std").length;
    ctx.gateway.set({ minimalPrompt: { enabled: false } });
    const mpNewDisposed2 = sectionDisposed.filter((c) => c.agent === "s-std").slice(mpDisposedBefore2);
    expect(mpNewDisposed2.length === 1 && mpNewDisposed2[0].name === "deployment:persona", "AP: minimalPrompt 关闭-全部释放").toBe(true);
    const mpCallsBefore3 = sectionCalls.filter((c) => c.agent === "s-std").length;
    ctx.gateway.set({ minimalPrompt: { enabled: true, suppressSections: true } });
    const mpNewCalls3 = sectionCalls.filter((c) => c.agent === "s-std").slice(mpCallsBefore3);
    expect(mpNewCalls3.length === 4 && mpNewCalls3.filter((c) => c.text === "").length === 3 && mpNewCalls3.some((c) => c.name === "deployment:persona"), "AP: minimalPrompt 重开-4 段恢复").toBe(true);

    const sLate = agent("s-late", "standard");
    emit("agent/created", { agent: sLate });
    expect(restrictCalls.filter((c) => c.agent === "s-late").length === 4, "AP: 新会话接入 4 族限制").toBe(true);
    const disposedBeforeOff = disposedCalls.length;
    ctx.gateway.set({ enabled: false });
    const offDisposals = disposedCalls.slice(disposedBeforeOff);
    expect(offDisposals.filter((c) => c.agent === "s-late").length === 4 && offDisposals.some((c) => c.agent === "s-std" && c.deny.includes("create_goal")), "AP: 总开关关闭释放全部限制").toBe(true);
    const sLate2 = agent("s-late2", "code");
    ctx.gateway.set({ enabled: true });
    expect(restrictCalls.filter((c) => c.agent === "s-late2").length === 4 && suppressCalls.has("s-late2") && sectionCalls.filter((c) => c.agent === "s-late2").length === 4, "AP: 重新启用补挂插件关闭期间创建的会话").toBe(true);
    const late2DisposedBefore = sectionDisposed.filter((c) => c.agent === "s-late2").length;
    emit("agent/disposed", { agent: sLate });
    emit("agent/disposed", { agent: sLate2 });
    expect(sectionDisposed.filter((c) => c.agent === "s-late2").length === late2DisposedBefore + 4, "AP: agent 销毁释放提示词层").toBe(true);

    emit("agent/disposed", { agent: agentStd });
    expect(suppressCalls.has("s-std"), "AP: 引擎全程运行无异常").toBe(true);
  });

  it("首轮锚定 / 晋升后 resident / 上下文剥离", async () => {
    const m = setup();
    const { ctx, emit, agent, restrictCalls, disposedCalls, toolRegistrations, toolDefs, toolDisposals, sectionCalls, sectionDisposed } = m;
    await ap.apply(ctx, {
      presets: ["standard", "code"],
      leanByDefault: true,
      suppressRuntimeContext: true,
      suppressInjectedContext: true,
      minimalPrompt: { enabled: true },
      bootstrap: { enabled: true, realPair: false },
    }, { realPairModules: null });

    const residentSession = {
      id: "s-res",
      header: { cwd: "/tmp/res", delegationDepth: 0 },
      events: [{ type: "assistant/message", seq: 1 }],
    };
    const agentResident = agent("s-res", "standard", residentSession);
    emit("agent/created", { agent: agentResident });
    const resRegs = toolRegistrations.filter((r) => r.agent === "s-res");
    expect(["dev_tool_search", "skill_search", "skill_load"].every((n) => resRegs.some((r) => r.name === n)), "AP: 晋升后注册常驻发现工具三件套").toBe(true);
    const resRestrictCalls = restrictCalls.filter((c) => c.agent === "s-res");
    const resBootstrap = resRestrictCalls.find((c) => c.deny.includes("read") && c.deny.includes("web_search"));
    expect(resBootstrap !== void 0 && !resBootstrap.deny.includes("bash") && !resBootstrap.deny.includes("str_replace_editor") && !resBootstrap.deny.includes("dev_tool_search") && !resBootstrap.deny.includes("skill_search") && !resBootstrap.deny.includes("skill_load") && resBootstrap.deny.includes("read") && resBootstrap.deny.includes("subagent"), "AP: 晋升后保留 resident 目录而非完整目录").toBe(true);
    const devTool = toolDefs.get("s-res:dev_tool_search");
    const beforeUnlockRestrict = restrictCalls.filter((c) => c.agent === "s-res").length;
    if (devTool !== void 0) {
      const out = await devTool.execute({ query: "", toolNames: ["read"] }, { agent: agentResident });
      expect(typeof out.text === "string" && out.text.includes("Unlocked"), "AP: dev_tool_search 解锁返回文本").toBe(true);
    } else {
      expect(false, "AP: dev_tool_search 解锁返回文本").toBe(true);
    }
    const unlockRestrictCalls = restrictCalls.filter((c) => c.agent === "s-res").slice(beforeUnlockRestrict);
    expect(unlockRestrictCalls.length > 0 && unlockRestrictCalls.some((c) => !c.deny.includes("read") && c.deny.includes("web_search")), "AP: dev_tool_search 解锁后 read 进入 resident 保留集").toBe(true);
    emit("agent/disposed", { agent: agentResident });
    expect(toolDisposals_has(toolDisposals, "s-res", "dev_tool_search"), "AP: agent 销毁释放 dev_tool_search").toBe(true);

    const agentBoot = agent("s-boot", "standard", { id: "s-boot", header: {}, events: [] });
    emit("agent/created", { agent: agentBoot });
    const bootRestrictCalls = restrictCalls.filter((c) => c.agent === "s-boot");
    expect(bootRestrictCalls.length === 5 && bootRestrictCalls.some((c) => c.deny.includes("read") && c.deny.includes("web_search") && !c.deny.includes("bash") && !c.deny.includes("str_replace_editor")), "AP: 首轮锚定-收窄到真实工具对").toBe(true);
    expect(!toolRegistrations.some((r) => r.agent === "s-boot" && r.name === "dev_tool_search"), "AP: bootstrap 阶段不注册发现工具").toBe(true);
    emit("agent/disposed", { agent: agentBoot });

    const ctxSession = { id: "s-ctx", header: { cwd: "/ctx" }, events: [{ type: "assistant/message", seq: 1 }] };
    const ctxAgent = agent("s-ctx", "standard", ctxSession);
    emit("agent/created", { agent: ctxAgent });
    expect(["dev_tool_search", "skill_search", "skill_load"].every((n) => toolRegistrations.some((r) => r.agent === "s-ctx" && r.name === n)), "AP: 晋升后注册发现工具三件套（resident）").toBe(true);
    const preStep = m.events["agent/pre-step"][0];
    const injectedMsgs = [
      { role: "user", source: { kind: "skill-catalog" }, content: [{ type: "text", text: "skills" }] },
      { role: "user", source: { kind: "agent-instructions" }, content: [{ type: "text", text: "agents" }] },
      { role: "user", source: { kind: "user" }, content: [{ type: "text", text: "real" }] },
    ];
    const stepRes = await preStep({ agent: ctxAgent, signal: undefined }, async () => ({ kind: "continue", messages: injectedMsgs }));
    const stepKinds = stepRes.messages.map((mm: any) => mm.source && mm.source.kind);
    expect(stepKinds.includes("user") && !stepKinds.includes("skill-catalog") && !stepKinds.includes("agent-instructions"), "AP: 常驻抑制开启-晋升后仍剥离注入").toBe(true);
    ctx.gateway.set({ suppressInjectedContext: false });
    const stepRes3 = await preStep({ agent: ctxAgent, signal: undefined }, async () => ({ kind: "continue", messages: injectedMsgs }));
    const stepKinds3 = stepRes3.messages.map((mm: any) => mm.source && mm.source.kind);
    expect(stepKinds3.includes("skill-catalog") && stepKinds3.includes("agent-instructions") && stepKinds3.includes("user"), "AP: 常驻抑制关闭-晋升后恢复注入").toBe(true);
    ctx.gateway.set({ suppressInjectedContext: true });
    const boot2 = agent("s-boot2", "standard", { id: "s-boot2", header: {}, events: [] });
    emit("agent/created", { agent: boot2 });
    const bootRes = await preStep({ agent: boot2, signal: undefined }, async () => ({ kind: "continue", messages: injectedMsgs }));
    const bootKinds = bootRes.messages.map((mm: any) => mm.source && mm.source.kind);
    expect(bootKinds.length === 1 && bootKinds[0] === "user", "AP: 首轮剥离注入").toBe(true);
    const freshAgent = agent("s-fresh", "standard", { id: "s-fresh", header: {}, events: [] });
    emit("agent/created", { agent: freshAgent });
    const freshDenies = restrictCalls.filter((c) => c.agent === "s-fresh");
    expect(freshDenies.some((c) => c.deny.includes("read") && c.deny.includes("web_search")), "AP: 增量晋升前-新会话处于首轮锚定").toBe(true);
    const freshDisposedBefore = disposedCalls.filter((c) => c.agent === "s-fresh").length;
    emit("session/event", freshAgent.session, { type: "tool/call", seq: 1 });
    const freshDisposedAfter = disposedCalls.filter((c) => c.agent === "s-fresh");
    expect(freshDisposedAfter.length === freshDisposedBefore + 1 && freshDisposedAfter.some((c) => c.deny.includes("read") && c.deny.includes("web_search")), "AP: 增量晋升-首个 tool/call 释放 bootstrap restrict").toBe(true);
    expect(["dev_tool_search", "skill_search", "skill_load"].every((n) => toolRegistrations.some((r) => r.agent === "s-fresh" && r.name === n)), "AP: 增量晋升后注册常驻发现工具").toBe(true);
    emit("agent/disposed", { agent: freshAgent });
    emit("agent/disposed", { agent: boot2 });
    emit("agent/disposed", { agent: ctxAgent });
  });

  it("真实工具对挂载（stub 模块注入）", async () => {
    const m = buildMocks();
    const { ctx, restrictCalls, sectionCalls, toolDisposals, events, agent } = m;
    const stubModules = {
      terminal: { name: "dsh-terminal" },
      terminalBash: { name: "dsh-terminal-bash" },
      bashPersistent: { name: "dsh-tool-bash-persistent" },
      fsLocal: { name: "dsh-fs-local" },
      strReplaceEditor: { name: "dsh-tool-str-replace-editor" },
    };
    await ap.apply(ctx, { presets: ["standard"], bootstrap: { enabled: true, realPair: true } }, { realPairModules: stubModules });
    const agentRp = agent("s-rp", "standard", { id: "s-rp", header: { cwd: "/rp" }, events: [] });
    (agentRp as any).ctx.plugin = (mod: any, cfg: any) => {
      rpMounted.push({ agent: agentRp.id, module: mod.name, config: cfg });
      return { dispose: () => rpFiberDisposed.push(agentRp.id) };
    };
    const rpMounted: any[] = [];
    const rpFiberDisposed: any[] = [];
    for (const listener of events["agent/created"] ?? []) listener({ agent: agentRp });
    expect(rpMounted.length === 5
      && rpMounted.some((mm) => mm.module === "dsh-tool-bash-persistent" && mm.config.description === ap.MINIMAL_BASH_DESCRIPTION)
      && rpMounted.some((mm) => mm.module === "dsh-tool-str-replace-editor")
      && rpMounted.some((mm) => mm.module === "dsh-terminal"), "AP: realPair 挂载 5 个官方插件").toBe(true);
    expect(sectionCalls.some((c) => c.agent === "s-rp" && c.name === "tool:bash" && c.text === ""), "AP: realPair 阴影 tool:bash 引导段").toBe(true);
    const mountedBefore = rpFiberDisposed.length;
    ctx.gateway.set({ bootstrap: { realPair: false } });
    expect(rpFiberDisposed.length === mountedBefore + rpMounted.length, "AP: realPair 热更新关闭后卸载").toBe(true);
    for (const listener of events["agent/disposed"] ?? []) listener({ agent: agentRp });
  });

  it("默认零裁剪（lean 为 opt-in）", async () => {
    const m = buildMocks();
    const { ctx, emit, agent, restrictCalls, suppressCalls, sectionCalls } = m;
    rmSync(join(fakeHome, "plugins", "adaptive-perf", "config.json"), { force: true });
    await ap.apply(ctx, {});
    const zeroAgent = agent("s-zero", "standard");
    for (const listener of m.events["agent/created"] ?? []) listener({ agent: zeroAgent });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(restrictCalls.filter((c) => c.agent === "s-zero").length === 0, "AP: 默认配置工具零裁剪").toBe(true);
    expect(suppressCalls.has("s-zero"), "AP: 默认配置运行时上下文抑制").toBe(true);
    expect((() => {
      const calls = sectionCalls.filter((c) => c.agent === "s-zero");
      return calls.length === 4 && calls.filter((c) => c.text === "").length === 3 && calls.some((c) => c.name === "deployment:persona" && c.text === "You are a helpful software engineer assistant.");
    })(), "AP: 默认配置提示段阴影").toBe(true);
    ctx.gateway.set({ leanByDefault: true });
    const zeroAgent2 = agent("s-zero2", "standard");
    for (const listener of m.events["agent/created"] ?? []) listener({ agent: zeroAgent2 });
    expect(restrictCalls.filter((c) => c.agent === "s-zero2").length === 4, "AP: opt-in 开启 lean 后新会话有 4 编排族限制").toBe(true);
    ctx.gateway.set({ leanByDefault: false });
    const zeroAgent3 = agent("s-zero3", "standard");
    for (const listener of m.events["agent/created"] ?? []) listener({ agent: zeroAgent3 });
    expect(restrictCalls.filter((c) => c.agent === "s-zero3").length === 0, "AP: 热关闭 lean 后新会话无编排族限制").toBe(true);
  });
});

function toolDisposals_has(disposals: any[], agent: string, name: string) {
  return disposals.some((d) => d.agent === agent && d.name === name);
}
