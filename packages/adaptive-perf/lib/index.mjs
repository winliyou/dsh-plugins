/**
 * adaptive-perf — 极简性能自适应插件（@dsh-plugins/adaptive-perf）
 *
 * 目标：让「标准模式（standard）」与「PTC 模式（code）」达到与「极简模式
 * （minimal）」相同级别的高性能。极简模式快的原因（对源码的对照结论）：
 *   1. persona 配置了 includeRuntimeContext: false —— 每次模型请求不注入
 *      "Current runtime context" 快照（文件策略 / 审批策略等动态段）；
 *   2. 工具目录极小（只有 bash + str_replace_editor）—— 每个请求的
 *      tool schema 与（PTC 的）SDK 参考段都随之变小；
 *   3. persona 为 complete 固定提示，无其它全局 prompt 段。
 *
 * 本插件在两个维度上做"动态自适应"（而不是静态裁剪）：
 *   A. 运行时上下文抑制：对目标 preset 的会话调用
 *      agent.ctx.systemPrompt.suppressRuntimeContext()（与极简模式同一机制），
 *      每次请求省掉快照文本，零功能损失。
 *   B. 工具目录自适应精简：会话启动时按"工具族"默认隐藏高开销低频工具
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
 *   - agent/created、agent/disposed、agent/inbox/inserted、tools/result 事件
 * 监听器都注册在 host 根作用域（与 dsh-agent-presets 自身同款用法），事件按
 * scope 过滤分发，子作用域派发的事件根监听器可收到。
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
  return {
    enabled: boolValue(merged.enabled, defaults.enabled),
    presets: stringList(merged.presets, defaults.presets),
    suppressRuntimeContext: boolValue(merged.suppressRuntimeContext, defaults.suppressRuntimeContext),
    leanByDefault: boolValue(merged.leanByDefault, defaults.leanByDefault),
    escalateOnKeyword: boolValue(merged.escalateOnKeyword, defaults.escalateOnKeyword),
    escalateOnUnknownTool: boolValue(merged.escalateOnUnknownTool, defaults.escalateOnUnknownTool),
    coreTools: stringList(merged.coreTools, defaults.coreTools),
    families,
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
}

// ── 纯函数（导出便于回归测试）────────────────────────────────────────────

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

    /** 应用/更新工具族限制（lean 模式）。总开关关闭、族被禁用、已升级、
     *  已从配置删除的族一律放行。 */
    function applyFamilies(a) {
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
        familyDisposers: new Map(),
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
      applyFamilies(a);
      info(`agent ${agent.id}: adaptive-perf active (preset ${String(agentPresets.composedPreset(agent.ctx))})`);
    }

    /** 释放一个 agent 的全部副作用。 */
    function releaseAgent(agentId) {
      const a = agents.get(agentId);
      if (a === void 0) return;
      agents.delete(agentId);
      if (a.suppressDisposer !== null) {
        try { a.suppressDisposer(); } catch {}
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
        // 目标 preset）：新符合条件的 agent 立即接管。
        if (agentsService !== void 0 && typeof agentsService.list === 'function') {
          try {
            for (const agent of agentsService.list()) handleAgent(agent);
          } catch (error) {
            warn(`config-update agent sweep failed: ${error && error.message || error}`);
          }
        }
        for (const a of agents.values()) {
          applySuppression(a);
          applyFamilies(a);
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
