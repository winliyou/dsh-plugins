/**
 * adaptive-perf — 极简性能自适应插件（@chaoset/adaptive-perf）
 *
 * 目标：让「标准模式（standard）」与「PTC 模式（code）」达到与「极简模式
 * （minimal）」相同级别的高性能。极简模式快的原因（对源码的对照结论）：
 *   1. persona 配置了 includeRuntimeContext: false —— 每次模型请求不注入
 *      "Current runtime context" 快照（文件策略 / 审批策略等动态段）；
 *   2. 工具目录极小（只有 bash + str_replace_editor）—— 每个请求的
 *      tool schema 与（PTC 的）SDK 参考段都随之变小；
 *   3. persona 为 complete 固定提示，无其它全局 prompt 段。
 *
 * 本插件在三个维度上做"动态自适应"（而不是静态裁剪）：
 *   A. 运行时上下文抑制：对目标 preset 的会话调用
 *      agent.ctx.systemPrompt.suppressRuntimeContext()（与极简模式同一机制），
 *      每次请求省掉快照文本，零功能损失。
 *   B. 首轮锚定（bootstrap，参照 dsh-anchored-standard 的实测结论）：
 *      决定首轮"轨迹"（模型思维链风格）的是请求 #1 可见的**工具 schema**
 *      与**自动注入的上下文提醒**，而不是静态目录大小。因此：
 *        - 请求 #1 的工具目录收窄到真实 Minimal 工具对
 *          （bash + str_replace_editor）——256000 输出预算下 5/5 锚定，
 *          而任何 standard 系 schema 11/11 落入 standard-like 轨迹；
 *        - 请求 #1 剥离自动注入的上下文（技能目录提醒 skill-catalog、
 *          AGENTS.md 摘要 agent-instructions）——目录在场时锚定完全无法
 *          复现（0/9）；用户主动的技能手势不过滤；
 *        - 会话出现首次**持久**晋升信号（首个 tool/call 或 assistant/message，
 *          promoteOn 可选 either/tool-call/assistant-message）后恢复完整目录；
 *          阶段从持久会话事件推导，resume/reload 不丢状态；
 *        - compaction 会把会话打回"第二次首轮"：compaction/end 之后回到
 *          受控目录（bootstrap 工具对 + compactionTools 核心工作集），直到
 *          出现新的持久晋升信号（纪元感知）；
 *        - bootstrap.maxTokens（可选）给请求 #1 封顶输出预算，晋升后剥离。
 *   C. 工具目录自适应精简：会话启动时按"工具族"默认隐藏高开销低频工具
 *      （子代理 / 工作流 / ralph / goal 等编排类），只保留核心编码工具，
 *      让标准模式的目录逼近极简、PTC 的 SDK 段同步缩小；随后根据两类信号
 *      在会话内"单调升级"放行对应工具族（只升不降，限制请求缓存失效次数）：
 *        - 关键词信号：用户消息命中某工具族的触发词（如"子代理"）→ 放行该族；
 *        - 失败信号：PTC 的 run_code 程序调用被隐藏工具报 UNKNOWN_TOOL
 *          （tools/result 失败文本含工具名）→ 放行该族，下次程序即可调用。
 *
 * 实现全部使用 dsh 公开服务契约（Inspect 确认）：
 *   - ctx.agentPresets.composedPreset(agent.ctx)  读取会话所属 preset
 *   - agent.ctx.systemPrompt.suppressRuntimeContext()  抑制上下文快照
 *   - agent.ctx.tools.schemas(agent)  读取该 agent 当前可见工具（限制交集）
 *   - agent.ctx.tools.restrict({ deny })  按 agent 作用域裁剪继承工具
 *   - system-prompt/assemble（waterfall） 请求装配（早期实现；bootstrap 目录
 *       收窄改用 tools.restrict——PTC 模式下 assembly.tools 只有 run_code，
 *       过滤会降级失效，而 restrict 同时驱动 API 目录与 PTC SDK 参考段）
 *   - agent/pre-step（waterfall） 剥离自动注入的上下文消息（source.kind）
 *   - agent/request（waterfall） 首轮输出预算封顶
 *   - session/event  增量喂入持久事件（晋升 / compaction 纪元）
 *   - agent/created、agent/disposed、agent/inbox/inserted、tools/result 事件
 * 监听器都注册在 host 根作用域（与 dsh-agent-presets 自身同款用法），事件按
 * scope 过滤分发，子作用域派发的事件根监听器可收到；三个 waterfall 均以
 * prepend 注册保证"最外层"（剥离是最后一道变换）。
 *
 * 配置：cordis.patch.yml 的 config（安装默认）与
 *       ~/.dsh/plugins/adaptive-perf/config.json（设置页 UI，权威）合并，
 *       保存后热生效（新会话立即生效；已运行会话按新配置重算限制）。
 *
 * 本文件不依赖任何 dsh 内部包（纯 ESM + ctx 服务），可独立安装。
 */

import { createConfigStore } from './config-store.mjs';

// remote 服务（设置页 UI 的配置读写）可选：typert-protocol 不可用时
// 动态 import 失败，核心功能（自适应）照常工作。
let PluginConfigGateway = null;
try {
  ({ PluginConfigGateway } = await import('./remote.mjs'));
} catch (error) {
  console.warn('adaptive-perf: settings gateway unavailable: ' + (error && error.message || error));
}

export const name = 'adaptive-perf';

/**
 * 默认配置。apply 时与 YAML 传入的 config 合并（cordis 不合并小写 config 导出）。
 *
 * families：工具族。每族可配 tools（该族工具名，需存在于目标 preset 的目录，
 * 插件运行时按实际可见工具取交集，不会因改名/缺失而崩溃）与 keywords（用户消息
 * 命中任一触发词即放行该族；大小写不敏感，子串匹配）。
 *
 * bootstrap：首轮锚定（参照 dsh-anchored-standard 的实测结论）。请求 #1 只暴露
 * bootstrap.tools（真实 Minimal 工具对），剥离 suppressedContextSources 列出的
 * 自动注入上下文；首个持久晋升信号（promoteOn）后恢复；compaction/end 之后回到
 * 受控目录（bootstrap 工具对 + compactionTools）直到新的晋升信号；maxTokens>0
 * 时给请求 #1 封顶输出预算（晋升后剥离）。
 */
export const DEFAULT_CONFIG = {
  /** 总开关：关闭后插件对会话不产生任何影响。 */
  enabled: true,
  /** 应用自适应的 agent preset 列表（composedPreset 返回值）。 */
  presets: ['standard', 'code'],
  /** 抑制运行时上下文快照（等同极简模式的 includeRuntimeContext: false）。 */
  suppressRuntimeContext: true,
  /** 会话启动时默认隐藏编排类工具族（核心编码工具始终保留）。 */
  leanByDefault: true,
  /** 用户消息命中工具族触发词时自动放行该族（会话内单调）。 */
  escalateOnKeyword: true,
  /** 工具调用失败（UNKNOWN_TOOL 文本含隐藏工具名）时自动放行该族。 */
  escalateOnUnknownTool: true,
  /** 核心编码工具（不进入任何限制族；此处仅作文档展示）。 */
  coreTools: [
    'bash', 'read', 'write', 'edit', 'glob', 'grep', 'read_image',
    'job_output', 'job_list', 'job_kill',
    'todo_write', 'ask_user_question', 'web_search', 'skill', 'exit_plan_mode',
  ],
  /** 默认隐藏、按需放行的工具族。 */
  families: {
    delegation: {
      enabled: true,
      tools: ['subagent', 'subagent_fork', 'send_message', 'list_agents', 'interrupt_agent'],
      keywords: ['子代理', '子agent', '委托', '分派', '派给', '子任务', 'subagent', 'delegate', 'fork'],
    },
    workflow: {
      enabled: true,
      tools: ['workflow'],
      keywords: ['工作流', 'workflow', '编排', '多阶段'],
    },
    ralph: {
      enabled: true,
      tools: ['ralph'],
      keywords: ['ralph', '全新agent', 'fresh agent'],
    },
    goal: {
      enabled: true,
      tools: ['create_goal', 'get_goal', 'update_goal'],
      keywords: ['长期目标', '跨轮次', '目标追踪', 'goal'],
    },
  },
  /** 首轮锚定（参照 dsh-anchored-standard）。 */
  bootstrap: {
    /** 是否启用首轮锚定。 */
    enabled: true,
    /** 请求 #1 可见的工具（真实 Minimal 工具对）。 */
    tools: ['bash', 'str_replace_editor'],
    /** 晋升触发：either（默认）/ tool-call / assistant-message。 */
    promoteOn: 'either',
    /** 请求 #1 剥离的自动注入上下文 source.kind；[] 关闭剥离。 */
    suppressedContextSources: ['skill-catalog', 'agent-instructions'],
    /** compaction/end 之后、再次晋升前可用的额外核心工作集。 */
    compactionTools: ['read', 'write', 'edit', 'glob', 'grep', 'todo_write', 'ask_user_question'],
    /** 请求 #1 的输出预算封顶（token）；0 = 不封顶（opt-in）。 */
    maxTokens: 0,
  },
  /**
   * 极简提示词层（语域锚定，参照 dsh-anchored-standard 的完整条件）。
   *
   * 参考实现指出：首轮"轨迹"（思维链风格）锚定需要 **Minimal 的完整 system
   * prompt**——只收窄工具 schema 不够。本层对目标 preset 的会话：
   *   - suppressSections：按名阴影屏蔽全局引导段（harness:identity、
   *     harness:source、app:web-surface），空段在装配时被丢弃，等同极简
   *     complete persona 的效果（plan-mode 段、PTC 的 SDK 段不受影响）；
   *   - persona：按名阴影替换 deployment:persona 为极简语域的短 persona
   *     （默认与极简模式逐字相同；留空则不替换）。
   * 两处都是 agent 作用域的 prompt 段阴影，仅影响目标会话，随会话销毁自动
   * 释放；对已恢复/已晋升的旧会话同样生效（不依赖 bootstrap 阶段）。
   */
  minimalPrompt: {
    /** 是否启用极简提示词层。 */
    enabled: true,
    /** 替换后的 persona 文本；与极简模式相同可完全对齐语域。留空不替换。 */
    persona: 'You are a helpful software engineer assistant.',
    /** 屏蔽全局引导段（identity / source / web-surface）。 */
    suppressSections: true,
  },
};

/** 轻量配置校验/归一化：非法字段回退默认值，避免 config.json 或 remote.set
 * 写入错误类型后在事件路径上抛 TypeError。 */
function boolValue(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function stringList(value, fallback) {
  if (Array.isArray(value)) {
    const out = value.filter((v) => typeof v === 'string' && v.trim().length > 0).map((v) => v.trim());
    return out.length > 0 ? out : fallback;
  }
  if (typeof value === 'string') {
    const out = value.split(/[,，\s]+/).filter((v) => v.length > 0);
    return out.length > 0 ? out : fallback;
  }
  return fallback;
}

/** 与 stringList 相同，但显式空数组保持为空（语义是有意义的配置值）。 */
function stringListOrEmpty(value, fallback) {
  if (value === undefined) return fallback;
  return stringList(value, []);
}

export function normalizeConfig(source, defaults = DEFAULT_CONFIG) {
  const raw = source !== null && typeof source === 'object' && !Array.isArray(source) ? source : {};
  const merged = { ...defaults, ...raw };
  const families = {};
  const rawFamilies = raw.families !== null && typeof raw.families === 'object' && !Array.isArray(raw.families)
    ? raw.families
    : defaults.families;
  for (const [id, fam] of Object.entries(defaults.families)) {
    const candidate = rawFamilies[id] !== null && typeof rawFamilies[id] === 'object' && !Array.isArray(rawFamilies[id])
      ? rawFamilies[id]
      : fam;
    families[id] = {
      enabled: boolValue(candidate.enabled, fam.enabled),
      tools: stringList(candidate.tools, fam.tools),
      keywords: stringList(candidate.keywords, fam.keywords),
    };
  }
  const rawBootstrap = raw.bootstrap !== null && typeof raw.bootstrap === 'object' && !Array.isArray(raw.bootstrap)
    ? raw.bootstrap
    : defaults.bootstrap;
  const db = defaults.bootstrap;
  const promoteOn = rawBootstrap.promoteOn === 'tool-call' || rawBootstrap.promoteOn === 'assistant-message'
    ? rawBootstrap.promoteOn
    : rawBootstrap.promoteOn === 'either' ? 'either' : db.promoteOn;
  const maxTokensRaw = rawBootstrap.maxTokens;
  const maxTokens = Number.isSafeInteger(maxTokensRaw) && maxTokensRaw > 0 ? maxTokensRaw : 0;
  const bootstrap = {
    enabled: boolValue(rawBootstrap.enabled, db.enabled),
    tools: stringList(rawBootstrap.tools, db.tools),
    promoteOn,
    suppressedContextSources: stringListOrEmpty(rawBootstrap.suppressedContextSources, db.suppressedContextSources),
    compactionTools: stringListOrEmpty(rawBootstrap.compactionTools, db.compactionTools),
    maxTokens,
  };
  const rawMP = raw.minimalPrompt !== null && typeof raw.minimalPrompt === 'object' && !Array.isArray(raw.minimalPrompt)
    ? raw.minimalPrompt
    : defaults.minimalPrompt;
  const dm = defaults.minimalPrompt;
  const minimalPrompt = {
    enabled: boolValue(rawMP.enabled, dm.enabled),
    persona: typeof rawMP.persona === 'string' ? rawMP.persona.trim() : dm.persona,
    suppressSections: boolValue(rawMP.suppressSections, dm.suppressSections),
  };
  return {
    enabled: boolValue(merged.enabled, defaults.enabled),
    presets: stringList(merged.presets, defaults.presets),
    suppressRuntimeContext: boolValue(merged.suppressRuntimeContext, defaults.suppressRuntimeContext),
    leanByDefault: boolValue(merged.leanByDefault, defaults.leanByDefault),
    escalateOnKeyword: boolValue(merged.escalateOnKeyword, defaults.escalateOnKeyword),
    escalateOnUnknownTool: boolValue(merged.escalateOnUnknownTool, defaults.escalateOnUnknownTool),
    coreTools: stringList(merged.coreTools, defaults.coreTools),
    families,
    bootstrap,
    minimalPrompt,
  };
}

/** remote.set 的严格校验：非法值直接拒绝并返回错误，而不是静默写坏文件。 */
export function validateConfig(partial) {
  if (partial === null || typeof partial !== 'object' || Array.isArray(partial)) {
    throw new TypeError('adaptive-perf config must be a plain object');
  }
  const boolFields = ['enabled', 'suppressRuntimeContext', 'leanByDefault', 'escalateOnKeyword', 'escalateOnUnknownTool'];
  for (const key of boolFields) {
    if (partial[key] !== void 0 && typeof partial[key] !== 'boolean') {
      throw new TypeError(`adaptive-perf config field "${key}" must be a boolean`);
    }
  }
  for (const key of ['presets', 'coreTools']) {
    if (partial[key] !== void 0 && !(Array.isArray(partial[key]) && partial[key].every((v) => typeof v === 'string'))) {
      throw new TypeError(`adaptive-perf config field "${key}" must be an array of strings`);
    }
  }
  if (partial.families !== void 0) {
    if (partial.families === null || typeof partial.families !== 'object' || Array.isArray(partial.families)) {
      throw new TypeError('adaptive-perf config field "families" must be an object');
    }
    for (const [id, fam] of Object.entries(partial.families)) {
      if (fam === null || typeof fam !== 'object' || Array.isArray(fam)) {
        throw new TypeError(`adaptive-perf config family "${id}" must be an object { enabled, tools, keywords }`);
      }
      if (fam.enabled !== void 0 && typeof fam.enabled !== 'boolean') {
        throw new TypeError(`adaptive-perf config family "${id}".enabled must be a boolean`);
      }
      for (const key of ['tools', 'keywords']) {
        if (fam[key] !== void 0 && !(Array.isArray(fam[key]) && fam[key].every((v) => typeof v === 'string'))) {
          throw new TypeError(`adaptive-perf config family "${id}".${key} must be an array of strings`);
        }
      }
    }
  }
  if (partial.bootstrap !== void 0) {
    const b = partial.bootstrap;
    if (b === null || typeof b !== 'object' || Array.isArray(b)) {
      throw new TypeError('adaptive-perf config field "bootstrap" must be an object');
    }
    if (b.enabled !== void 0 && typeof b.enabled !== 'boolean') {
      throw new TypeError('adaptive-perf config field "bootstrap.enabled" must be a boolean');
    }
    if (b.promoteOn !== void 0 && !['either', 'tool-call', 'assistant-message'].includes(b.promoteOn)) {
      throw new TypeError('adaptive-perf config field "bootstrap.promoteOn" must be "either" | "tool-call" | "assistant-message"');
    }
    if (b.maxTokens !== void 0 && !(Number.isSafeInteger(b.maxTokens) && b.maxTokens >= 0)) {
      throw new TypeError('adaptive-perf config field "bootstrap.maxTokens" must be a non-negative safe integer');
    }
    for (const key of ['tools', 'suppressedContextSources', 'compactionTools']) {
      if (b[key] !== void 0 && !(Array.isArray(b[key]) && b[key].every((v) => typeof v === 'string'))) {
        throw new TypeError(`adaptive-perf config field "bootstrap.${key}" must be an array of strings`);
      }
    }
  }
  if (partial.minimalPrompt !== void 0) {
    const m = partial.minimalPrompt;
    if (m === null || typeof m !== 'object' || Array.isArray(m)) {
      throw new TypeError('adaptive-perf config field "minimalPrompt" must be an object');
    }
    if (m.enabled !== void 0 && typeof m.enabled !== 'boolean') {
      throw new TypeError('adaptive-perf config field "minimalPrompt.enabled" must be a boolean');
    }
    if (m.suppressSections !== void 0 && typeof m.suppressSections !== 'boolean') {
      throw new TypeError('adaptive-perf config field "minimalPrompt.suppressSections" must be a boolean');
    }
    if (m.persona !== void 0 && typeof m.persona !== 'string') {
      throw new TypeError('adaptive-perf config field "minimalPrompt.persona" must be a string');
    }
  }
}

// ── 纯函数（导出便于回归测试）────────────────────────────────────────────

/** 被极简提示词层屏蔽的全局引导段（name, order，与 dsh-app-boot /
 * dsh-web-app / dsh-system-prompt 的注册一致）。 */
export const SECTION_SHADOWS = [
  ['harness:identity', -100],
  ['harness:source', -99],
  ['app:web-surface', -98],
];

/** persona 段的注册名与顺序（dsh-system-prompt 的 PERSONA_SECTION/PERSONA_ORDER）。 */
export const PERSONA_SECTION_NAME = 'deployment:persona';
export const PERSONA_SECTION_ORDER = 0;

/** 提取一条用户消息的顶层文本（text 块拼接）。 */
export function extractUserText(message) {
  if (message === null || typeof message !== 'object' || !Array.isArray(message.content)) return '';
  let text = '';
  for (const block of message.content) {
    if (block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
      text += block.text;
    }
  }
  return text;
}

/** 大小写不敏感的子串匹配：任一关键词命中即返回 true。 */
export function matchKeywords(text, keywords) {
  if (!Array.isArray(keywords) || keywords.length === 0) return false;
  const haystack = String(text ?? '').toLowerCase();
  return keywords.some((k) => typeof k === 'string' && k.length > 0 && haystack.includes(k.toLowerCase()));
}

/** 收集一次工具调用失败的模型可见文本（error 字段 + content 文本块）。 */
export function collectFailureText(result) {
  if (result === null || typeof result !== 'object') return '';
  const parts = [];
  const error = result.error;
  if (error !== null && typeof error === 'object') {
    if (typeof error.code === 'string') parts.push(error.code);
    if (typeof error.message === 'string') parts.push(error.message);
    if (typeof error.text === 'string') parts.push(error.text);
  }
  if (Array.isArray(result.content)) {
    for (const block of result.content) {
      if (block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
        parts.push(block.text);
      }
    }
  }
  return parts.join('\n');
}

// ── bootstrap 锚定（参照 dsh-anchored-standard 的实测结论）──────────────

/** promoteOn 配置 → 晋升的持久事件类型集合。 */
export const PROMOTE_EVENTS = {
  'tool-call': ['tool/call'],
  'assistant-message': ['assistant/message'],
  either: ['tool/call', 'assistant/message'],
};

/**
 * 扫描一段持久会话日志，推导 { boundary, promoted } 阶段。
 * compaction/end 之后需要新的晋升信号（纪元感知）；boundary 为 -1 表示
 * 尚无压缩。事件无 seq 时按"边界之后"处理（与参考实现一致）。
 */
export function scanPhase(events, promoteEvents) {
  let boundary = -1;
  let promoted = false;
  if (Array.isArray(events)) {
    for (const event of events) {
      const seq = typeof event?.seq === 'number' ? event.seq : 0;
      if (event?.type === 'compaction/end') {
        boundary = seq;
        promoted = false;
        continue;
      }
      if (promoteEvents.includes(event?.type) && seq > boundary) promoted = true;
    }
  }
  return { boundary, promoted };
}

/** 增量喂入一个持久事件（仅更新已存在条目；冷会话由 scanPhase 全量推导）。 */
export function observePhase(state, sessionId, event) {
  const entry = state.get(sessionId);
  if (entry === void 0) return;
  const seq = typeof event?.seq === 'number' ? event.seq : 0;
  if (event?.type === 'compaction/end') {
    state.set(sessionId, { boundary: seq, promoted: false, promoteEvents: entry.promoteEvents });
    return;
  }
  if (entry.promoted) return;
  const promoteEvents = entry.promoteEvents;
  if (promoteEvents.includes(event?.type) && seq > entry.boundary) {
    state.set(sessionId, { ...entry, promoted: true });
  }
}

/**
 * 按 keep 集合收窄装配后的工具目录。
 * @returns { tools, missing } —— missing 非空表示 keep 中的工具在目录里缺失，
 * 调用方决定是否降级（全目录放行）。
 */
export function filterBootstrapTools(assembly, keep) {
  const keepSet = keep instanceof Set ? keep : new Set(keep);
  const tools = Array.isArray(assembly?.tools) ? assembly.tools : [];
  const available = new Set(tools.map((tool) => tool?.name).filter((n) => typeof n === 'string'));
  const missing = [...keepSet].filter((n) => !available.has(n));
  return {
    tools: tools.filter((tool) => keepSet.has(tool.name)),
    missing,
  };
}

/** 按 source.kind 剥离自动注入的上下文消息（保留主动的用户消息）。 */
export function filterBootstrapMessages(messages, suppressedSources) {
  if (!Array.isArray(messages) || suppressedSources.size === 0) return messages;
  const kept = messages.filter((message) => {
    const kind = message?.source?.kind;
    return typeof kind !== 'string' || !suppressedSources.has(kind);
  });
  return kept.length === messages.length ? messages : kept;
}

/** 首轮输出预算：未晋升 → 封顶；已晋升 → 若仍带着封顶值则剥离。 */
export function applyBootstrapBudget(config, promoted, maxTokens) {
  if (!promoted) return { ...config, maxTokens };
  if (config?.maxTokens === maxTokens) {
    const { maxTokens: _drop, ...rest } = config;
    return rest;
  }
  return config;
}

// ── host 插件 ────────────────────────────────────────────────────────────

export function apply(ctx, config) {
  // fail-safe：初始化失败只记录，绝不让本插件拖垮 harness（host 层挂载时
  // entry 异常会导致进程启动失败）。
  try {
    const systemPrompt = ctx.get('systemPrompt');
    const tools = ctx.get('tools');
    if (systemPrompt === void 0 || tools === void 0) {
      ctx.logger?.warn?.('adaptive-perf: systemPrompt/tools service unavailable; plugin inactive');
      return;
    }
    const agentPresets = ctx.get('agentPresets');
    if (agentPresets === void 0) {
      ctx.logger?.warn?.('adaptive-perf: agentPresets service unavailable (no agent presets composed); plugin inactive');
      return;
    }
    const agentsService = ctx.get('agents');

    const patchConfig = config !== null && typeof config === 'object' && !Array.isArray(config) ? config : {};
    /** 当前生效配置（热更新；后续 store 创建后以 config.json 权威合并结果覆盖）。 */
    let cfg = normalizeConfig(patchConfig);

    /** agentId -> 会话自适应状态。 */
    const agents = new Map();

    const warn = (message) => { try { ctx.logger?.warn?.(`adaptive-perf: ${message}`); } catch {} };
    const info = (message) => { try { ctx.logger?.info?.(`adaptive-perf: ${message}`); } catch {} };

    /** 该会话是否为目标 preset。 */
    function isTarget(agent) {
      if (!cfg.enabled) return false;
      try {
        const presetId = agentPresets.composedPreset(agent.ctx);
        return presetId !== void 0 && cfg.presets.includes(presetId);
      } catch (error) {
        warn(`preset lookup failed for agent ${agent.id}: ${error && error.message || error}`);
        return false;
      }
    }

    /** 计算某族当前应隐藏的工具名（与该 agent 实际可见目录取交集）。 */
    function familyDeny(a, family) {
      if (!Array.isArray(family.tools)) return [];
      return family.tools.filter((n) => typeof n === 'string' && a.visibleNames.has(n));
    }

    /** 应用/更新运行时上下文抑制。总开关关闭时一并释放。 */
    function applySuppression(a) {
      const want = cfg.enabled && cfg.suppressRuntimeContext;
      if (want && a.suppressDisposer === null) {
        try {
          a.suppressDisposer = a.agent.ctx.systemPrompt.suppressRuntimeContext();
          info(`agent ${a.agent.id}: runtime context suppressed`);
        } catch (error) {
          warn(`suppressRuntimeContext failed for agent ${a.agent.id}: ${error && error.message || error}`);
        }
      } else if (!want && a.suppressDisposer !== null) {
        try { a.suppressDisposer(); } catch {}
        a.suppressDisposer = null;
      }
    }

    /** 应用/更新极简提示词层（persona 阴影 + 全局引导段屏蔽）。 */
    function applyMinimalPrompt(a) {
      for (const disposer of a.promptDisposers) {
        try { disposer(); } catch {}
      }
      a.promptDisposers = [];
      if (!cfg.enabled || !cfg.minimalPrompt.enabled) return;
      const sp = a.agent.ctx.systemPrompt;
      try {
        if (cfg.minimalPrompt.suppressSections) {
          for (const [name, order] of SECTION_SHADOWS) {
            a.promptDisposers.push(sp.section({ name, order, text: '' }));
          }
        }
        const persona = cfg.minimalPrompt.persona.trim();
        if (persona.length > 0) {
          a.promptDisposers.push(sp.section({ name: PERSONA_SECTION_NAME, order: PERSONA_SECTION_ORDER, text: persona }));
        }
        info(`agent ${a.agent.id}: minimal prompt layer active`);
      } catch (error) {
        warn(`minimalPrompt failed for agent ${a.agent.id}: ${error && error.message || error}`);
      }
    }

    /** 应用/更新工具族限制（lean 模式）。总开关关闭、族被禁用、已升级、
     *  已从配置删除的族一律放行。 */    function applyFamilies(a) {
      if (!cfg.enabled || !cfg.leanByDefault) {
        for (const [id, disposer] of a.familyDisposers) {
          try { disposer(); } catch {}
          a.familyDisposers.delete(id);
        }
        return;
      }
      // 1) 清理不再需要的限制（族被禁用 / 已升级 / 配置里已不存在）。
      for (const [id, disposer] of a.familyDisposers) {
        const family = cfg.families[id];
        if (family === void 0 || family.enabled === false || a.escalated.has(id)) {
          try { disposer(); } catch {}
          a.familyDisposers.delete(id);
        }
      }
      // 2) 补齐需要的新限制。
      for (const [id, family] of Object.entries(cfg.families)) {
        if (a.familyDisposers.has(id)) continue;
        if (family.enabled === false || a.escalated.has(id)) continue;
        const deny = familyDeny(a, family);
        if (deny.length === 0) continue;
        try {
          const disposer = a.agent.ctx.tools.restrict({ deny });
          a.familyDisposers.set(id, disposer);
        } catch (error) {
          warn(`restrict failed for agent ${a.agent.id} family "${id}": ${error && error.message || error}`);
        }
      }
    }

    /** 当前隐藏的工具名（活跃限制族的 deny 并集，供失败信号匹配）。 */
    function hiddenNames(a) {
      const out = new Set();
      for (const [id, family] of Object.entries(cfg.families)) {
        if (!a.familyDisposers.has(id)) continue;
        for (const n of familyDeny(a, family)) out.add(n);
      }
      return out;
    }

    /** 放行一个工具族（会话内单调：只升不降）。 */
    function escalate(a, familyId, trigger) {
      if (a.escalated.has(familyId)) return;
      a.escalated.add(familyId);
      const disposer = a.familyDisposers.get(familyId);
      if (disposer !== void 0) {
        try { disposer(); } catch {}
        a.familyDisposers.delete(familyId);
      }
      info(`agent ${a.agent.id}: escalated family "${familyId}" (${trigger})`);
    }

    /** 完整接管一个 agent（幂等）。 */
    function handleAgent(agent) {
      if (agents.has(agent.id)) return;
      if (!isTarget(agent)) return;
      const a = {
        agent,
        suppressDisposer: null,
        promptDisposers: [],
        familyDisposers: new Map(),
        bootstrapDisposer: null,
        bootstrapKey: null,
        escalated: new Set(),
        visibleNames: new Set(),
      };
      // 记录当前可见目录（限制前）；仅记录真实存在的工具，后续 restrict 与
      // 实际目录取交集，preset 升级改名/删除工具不会让本插件崩溃。
      try {
        for (const schema of tools.schemas(agent)) {
          if (schema !== null && typeof schema === 'object' && typeof schema.name === 'string') {
            a.visibleNames.add(schema.name);
          }
        }
      } catch (error) {
        warn(`schemas lookup failed for agent ${agent.id}: ${error && error.message || error}`);
      }
      agents.set(agent.id, a);
      applySuppression(a);
      applyMinimalPrompt(a);
      applyFamilies(a);
      syncBootstrap(a);
      info(`agent ${agent.id}: adaptive-perf active (preset ${String(agentPresets.composedPreset(agent.ctx))})`);
    }

    /** 释放一个 agent 的全部副作用。 */
    function releaseAgent(agentId) {
      const a = agents.get(agentId);
      agents.delete(agentId);
      bootstrapState.delete(agentId);
      if (a === void 0) return;
      if (a.suppressDisposer !== null) {
        try { a.suppressDisposer(); } catch {}
      }
      for (const disposer of a.promptDisposers) {
        try { disposer(); } catch {}
      }
      a.promptDisposers = [];
      if (a.bootstrapDisposer !== null) {
        try { a.bootstrapDisposer(); } catch {}
      }
      for (const disposer of a.familyDisposers.values()) {
        try { disposer(); } catch {}
      }
    }

    // ── 事件监听（注册在 host 根作用域，与 dsh-agent-presets 同款用法）──
    ctx.on('agent/created', ({ agent }) => {
      handleAgent(agent);
    });
    ctx.on('agent/disposed', ({ agent }) => {
      releaseAgent(agent.id);
    });

    // 关键词信号：用户消息进入收件箱（早于回合处理与请求装配）。
    // 监听器无条件注册，事件时按实时 cfg 判断，热更新开关即时生效。
    ctx.on('agent/inbox/inserted', ({ agent, message }) => {
      if (!cfg.enabled || !cfg.escalateOnKeyword) return;
      const a = agents.get(agent.id);
      if (a === void 0) return;
      const text = extractUserText(message);
      if (text.length === 0) return;
      for (const [id, family] of Object.entries(cfg.families)) {
        if (a.escalated.has(id) || family.enabled === false) continue;
        if (matchKeywords(text, family.keywords)) escalate(a, id, 'keyword');
      }
    });

    // 失败信号：PTC 程序调用隐藏工具报错（文本含工具名）时放行对应族。
    ctx.on('tools/result', (exec, result) => {
      if (!cfg.enabled || !cfg.escalateOnUnknownTool) return;
      const agent = exec !== null && typeof exec === 'object' ? exec.agent : void 0;
      if (agent === void 0) return;
      const a = agents.get(agent.id);
      if (a === void 0) return;
      if (result === null || typeof result !== 'object' || result.isError !== true) return;
      const text = collectFailureText(result);
      if (text.length === 0) return;
      const hidden = hiddenNames(a);
      if (hidden.size === 0) return;
      for (const [id, family] of Object.entries(cfg.families)) {
        if (a.escalated.has(id) || family.enabled === false) continue;
        for (const n of family.tools) {
          if (hidden.has(n) && text.includes(n)) {
            escalate(a, id, 'unknown-tool');
            break;
          }
        }
      }
    });

    // ── 首轮锚定（bootstrap，参照 dsh-anchored-standard 的实测结论）─────
    // 阶段状态：sessionId -> { boundary, promoted, promoteEvents }。冷会话在
    // handleAgent 时全量扫描持久日志（resume 安全），此后 session/event 增量
    // 更新。子代理（delegationDepth > 0）恒为已晋升。所有 waterfall 用
    // prepend 注册，保证本插件是"最外层"变换（剥离是最后一道）。
    const bootstrapState = new Map();
    let bootstrapWarned = false;
    const warnBootstrapOnce = (message) => {
      if (bootstrapWarned) return;
      bootstrapWarned = true;
      warn(message);
    };

    function bootstrapPhaseOf(agent) {
      const session = agent !== null && typeof agent === 'object' ? agent.session : void 0;
      if (session === void 0 || typeof session.id !== 'string') return { boundary: -1, promoted: true };
      // 子代理首轮即可用工具（与参考实现一致）。
      if ((session.header?.delegationDepth ?? 0) > 0) return { boundary: -1, promoted: true };
      let entry = bootstrapState.get(session.id);
      if (entry === void 0) {
        entry = {
          ...scanPhase(session.events, PROMOTE_EVENTS[cfg.bootstrap.promoteOn]),
          promoteEvents: PROMOTE_EVENTS[cfg.bootstrap.promoteOn],
        };
        bootstrapState.set(session.id, entry);
      }
      return entry;
    }

    /** bootstrap 是否对该会话生效（总开关 + 目标 preset + 无会话时放行）。 */
    function bootstrapActiveFor(agent) {
      if (!cfg.enabled || !cfg.bootstrap.enabled) return false;
      if (agent === void 0) return true;
      return isTarget(agent);
    }

    /**
     * bootstrap 阶段的保留工具集：bootstrap 工具对 + PTC 的直接调用工具
     * （run_code）+ compaction 后恢复期的工作集。已晋升返回 null。
     *
     * 注意：不能靠过滤 system-prompt/assemble 的 assembly.tools 来实现——
     * PTC 模式下 assembly.tools 只有 [run_code]，Minimal 工具对不在其中，
     * 过滤会触发降级（实测首轮模型仍看到 15 个工具）。正确做法是
     * tools.restrict（与族限制同一机制）：它同时驱动 API 目录和 PTC 的
     * SDK 参考段，且天然保留 run_code（不在 deny 里）。
     */
    function bootstrapKeepSet(a) {
      const phase = bootstrapPhaseOf(a.agent);
      if (phase.promoted) return null;
      const keep = new Set(cfg.bootstrap.tools);
      if (a.visibleNames.has('run_code')) keep.add('run_code');
      if (phase.boundary >= 0) for (const name of cfg.bootstrap.compactionTools) keep.add(name);
      return keep;
    }

    /** 按当前阶段同步 bootstrap 的临时 restrict（幂等；仅阶段/配置变化时重挂）。 */
    function syncBootstrap(a) {
      const keep = bootstrapKeepSet(a);
      const key = keep === null ? null : [...keep].sort().join(',');
      if (key === a.bootstrapKey) return;
      if (a.bootstrapDisposer !== null) {
        try { a.bootstrapDisposer(); } catch {}
        a.bootstrapDisposer = null;
        a.bootstrapKey = null;
      }
      if (keep === null) return;
      const deny = [...a.visibleNames].filter((name) => !keep.has(name));
      if (deny.length === 0) return;
      try {
        a.bootstrapDisposer = a.agent.ctx.tools.restrict({ deny });
        a.bootstrapKey = key;
        info(`agent ${a.agent.id}: bootstrap restrict deny=${deny.length} keep=[${[...keep].join(',')}]`);
      } catch (error) {
        warn(`bootstrap restrict failed for agent ${a.agent.id}: ${String((error && error.message) || error)}`);
      }
    }

    // 持久事件增量喂入：晋升信号 / compaction 纪元；阶段变化时同步 bootstrap 限制。
    ctx.on('session/event', (session, event) => {
      if (session === null || typeof session !== 'object' || typeof session.id !== 'string') return;
      const before = bootstrapState.get(session.id);
      observePhase(bootstrapState, session.id, event);
      const a = agents.get(session.id);
      if (a !== void 0) {
        const after = bootstrapState.get(session.id);
        if (before === void 0 || after === void 0 || before.promoted !== after.promoted || before.boundary !== after.boundary) {
          syncBootstrap(a);
        }
      }
    });

    // 首轮剥离自动注入的上下文（技能目录提醒 / AGENTS.md 摘要）。prepend +
    // 根作用域注册保证是最后一道变换（后注册的注入者无法再补回）。
    ctx.on('agent/pre-step', async ({ agent }, next) => {
      const decision = await next();
      if (decision === null || typeof decision !== 'object' || decision.kind === 'reject') return decision;
      try {
        if (!bootstrapActiveFor(agent)) return decision;
        const phase = bootstrapPhaseOf(agent);
        if (phase.promoted || cfg.bootstrap.suppressedContextSources.length === 0) return decision;
        if (!Array.isArray(decision.messages)) return decision;
        const kept = filterBootstrapMessages(decision.messages, new Set(cfg.bootstrap.suppressedContextSources));
        return kept === decision.messages ? decision : { ...decision, messages: kept };
      } catch (error) {
        // 过滤失败绝不吞掉用户的上下文：原样放行。
        warnBootstrapOnce(`bootstrap context filter failed, keeping injected context: ${String((error && error.message) || error)}`);
        return decision;
      }
    }, { prepend: true });

    // 可选：请求 #1 输出预算封顶（晋升后剥离，避免封顶沿 header 种子延续）。
    if (cfg.bootstrap.maxTokens > 0) {
      ctx.on('agent/request', async ({ agent }, next) => {
        const resolved = await next();
        try {
          if (!bootstrapActiveFor(agent)) return resolved;
          const phase = bootstrapPhaseOf(agent);
          return applyBootstrapBudget(resolved, phase.promoted, cfg.bootstrap.maxTokens);
        } catch (error) {
          warnBootstrapOnce(`bootstrap budget filter failed: ${String((error && error.message) || error)}`);
          return resolved;
        }
      }, { prepend: true });
    }

    // 已运行会话补挂（插件热重载/重装时）。
    if (agentsService !== void 0 && typeof agentsService.list === 'function') {
      try {
        for (const agent of agentsService.list()) handleAgent(agent);
      } catch (error) {
        warn(`existing agent sweep failed: ${error && error.message || error}`);
      }
    }

    // 配置存储：patch config 为低优先级，config.json（设置页 UI）权威。
    // onUpdate 把 UI 保存的改动热更新进 cfg，并对所有已接管会话重算。
    const store = createConfigStore({
      name: 'adaptive-perf',
      defaults: DEFAULT_CONFIG,
      patchConfig,
      validate: validateConfig,
      warn,
      onUpdate: (merged) => {
        cfg = normalizeConfig({ ...patchConfig, ...merged });
        info('config hot-updated; recomputing restrictions for live agents');
        // 补挂此前创建的会话（例如插件从 disabled 切换为 enabled，或新增了
        // 目标 preset）：新符合条件的 agent 立即接管（handleAgent 已应用全部
        // 层，下面的重算只针对此前已接管的 agent，避免同一 onUpdate 内重复）。
        const existing = new Set(agents.keys());
        if (agentsService !== void 0 && typeof agentsService.list === 'function') {
          try {
            for (const agent of agentsService.list()) handleAgent(agent);
          } catch (error) {
            warn(`config-update agent sweep failed: ${error && error.message || error}`);
          }
        }
        for (const agentId of existing) {
          const a = agents.get(agentId);
          if (a === void 0) continue;
          applySuppression(a);
          applyMinimalPrompt(a);
          applyFamilies(a);
          syncBootstrap(a);
        }
      },
    });
    cfg = normalizeConfig(store.effective());

    // 远程配置服务（设置页 UI 读写；typert 不可用时跳过）
    if (PluginConfigGateway !== null) {
      ctx.plugin(PluginConfigGateway, { store, serviceKey: 'adaptivePerfConfig' });
    }

    // 卸载清理：释放全部会话副作用与监听。
    ctx.effect(() => () => {
      for (const agentId of [...agents.keys()]) releaseAgent(agentId);
    });
  } catch (error) {
    try { ctx.logger?.error?.(`adaptive-perf: init failed (harness continues without adaptive performance): ${error && error.message || error}`); } catch {}
  }
}
