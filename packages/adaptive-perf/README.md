# @chaoset/adaptive-perf — DSH 极简性能自适应插件

> **默认策略（0.7.0，首轮锚定、晋升后 resident 目录）**：只提高性能，不减少功能。
> 非极简模式会话的**请求 #1** 按极简模式条件组装——真实 Minimal 工具对
> 锚定首轮轨迹、极简 persona + 屏蔽全局引导段对齐语域、剥离技能目录/指令
> 摘要注入、抑制运行时快照；首个**持久**晋升信号（首个 `tool/call` 或
> `assistant/message`）后进入 **resident 阶段**——保留 bootstrap 工具对 +
> 常驻发现工具（`dev_tool_search` / `skill_search` / `skill_load`），完整
> 目录经 `dev_tool_search` 按需解锁，常规上下文注入恢复可见（与
> [dsh-anchored-standard](https://github.com/xiaobright/dsh-anchored-standard/)
> 语义一致：晋升按会话记忆化，compaction 不重置；晋升时一次性倒出完整目录
> 会把轨迹拉回 standard-like，故完整目录按需取用）。工具目录默认**零裁剪**
> （编排类工具族始终可用）；`leanByDefault` 是省 token 的 opt-in 开关，
> `suppressInjectedContext` 默认开启（注入剥离由发现工具承担可见性），
> 设置页按需调整。

让 **标准模式（standard）**、**PTC 模式（code）** 与 **创造模式（cordis）**
达到 **极简模式（minimal）** 级别的高性能，同时保留完整能力——不是静态裁剪，
而是**动态自适应**：

- **真实 Minimal 工具对（realPair）**：首轮"轨迹"由请求 #1 可见的**工具 schema**
  逐字决定——只有与 Minimal 完全相同的 schema 能锚定（参照
  [dsh-anchored-standard](https://github.com/xiaobright/dsh-anchored-standard/)
  实测：真实工具对 5/5 锚定，任何 standard 系 schema——包括 sandboxed
  bash/read——11/11 落入 standard-like）。本插件把官方 minimal preset 同款插件
  （持久 PTY bash + `str_replace_editor`，含逐字相同的描述）挂进会话作用域，
  按名阴影 standard 的 sandboxed bash——**不是**只把目录收窄到同名工具。
- **首轮锚定（bootstrap）**：决定首轮"轨迹"（思维链风格）的是请求 #1 可见的
  **工具 schema** 与**自动注入的上下文提醒**。因此：
  - 请求 #1 的工具目录 = 真实 Minimal 工具对（`bash` + `str_replace_editor`）；
  - 请求 #1 剥离自动注入上下文（技能目录提醒 `skill-catalog`、AGENTS.md 摘要
    `agent-instructions`，用户主动的技能手势不过滤）；
  - 会话出现首个**持久**晋升信号（首个 `tool/call` 或 `assistant/message`，
    `promoteOn` 可选 `either`/`tool-call`/`assistant-message`）后进入
    **resident 阶段**：保留 bootstrap 工具对 + 常驻发现工具（0.7.0 语义：
    只锚定首轮，不减少后续功能；完整目录经 `dev_tool_search` 按需解锁——
    晋升时一次性倒出完整目录会把轨迹拉回 standard-like，anchored-standard
    实测的"晋升后回退"问题），常规注入（技能目录提醒 + AGENTS.md 摘要）
    恢复可见；阶段从持久会话事件推导，**resume / reload 不丢状态**，晋升
    信号**持久**（`compaction/end` 不重置，与 dsh-anchored-standard 一致）；
  - `maxTokens > 0` 时可给请求 #1 封顶输出预算（晋升后自动剥离）。
- **常驻上下文抑制（suppressInjectedContext，默认开启）**：整个会话持续
  剥离技能目录提醒 + AGENTS.md 摘要注入——实测晋升后恢复注入会把轨迹拉回
  standard-like（"Let me…" 叙述回归），且每请求多耗数千 token。功能可见性
  由常驻发现工具承担：`dev_tool_search` 搜索完整目录并按名解锁、
  `skill_search` / `skill_load` 按需搜索/加载技能说明。设为 `false` 时只剥
  离请求 #1，晋升后恢复常规注入（功能不减少但轨迹回退，opt-in）。
- **运行时上下文抑制**：对目标 preset 的会话调用 `suppressRuntimeContext()`
  （与极简模式的 `includeRuntimeContext: false` 同一机制），每次模型请求省掉
  "Current runtime context" 快照文本，**零功能损失**。
- **极简提示词层（minimalPrompt）**：参考实现的完整锚定条件——首轮轨迹由
  **Minimal 的完整 system prompt** 决定，只收窄工具 schema 不够（标准/PTC 的
  系统提示仍带 `harness:identity` / `harness:source` / `app:web-surface` 三个
  全局引导段与标准 persona，思维链仍是 standard-like 的 "Let me…" 叙述）。本层
  对目标会话：
  - 按名阴影屏蔽三个全局引导段（空段在装配时被丢弃，等同极简 `complete`
    persona 的效果；plan-mode 与 PTC 的 SDK 段不受影响）；
  - 按名阴影替换 `deployment:persona` 为极简语域 persona（默认与极简模式
    逐字相同：`You are a helpful software engineer assistant.`）；
  - 挂载真实工具对时按名阴影 `tool:bash` 引导段（与可见工具一致）。
  各处均为 agent 作用域的 prompt 段阴影，仅影响目标会话；**对已恢复/已晋升的
  旧会话同样生效**（不依赖 bootstrap 阶段）。
- **工具目录自适应精简（leanByDefault，0.7.0 起为 opt-in）**：默认 `false` =
  工具目录零裁剪，编排类工具族（子代理 / 工作流 / ralph / goal）始终可用。
  设为 `true` 时会话启动按"工具族"隐藏高开销低频工具，只保留核心编码工具
  （bash / 文件读写编辑 / 检索 / jobs / todo / 提问 / 网页搜索 / 技能 / 计划），
  标准模式的工具目录因此逼近极简；PTC 模式系统提示里的 **SDK 参考段同步缩小**。
- **需求信号自动放行**（会话内单调升级，只升不降，限制请求缓存失效次数）：
  - 关键词信号：用户消息命中工具族触发词（如"子代理"、"工作流"）→ 放行该族；
  - 失败信号：PTC 程序调用被隐藏工具报 `UNKNOWN_TOOL` → 放行该族，下次即可调用。

所有开关与工具族可在设置页配置、随时放行；配置保存后**热生效**（无需重启）。

## 为什么极简模式最快（源码对照 + 社区实测结论）

| 维度 | 极简模式 | 标准 / PTC 模式 | 本插件做法 |
|---|---|---|---|
| 首轮轨迹（决定后续行为风格） | Minimal 真实工具对锚定（5/5） | 任何 standard 系 schema（含 sandboxed bash）落入 standard-like（11/11） | realPair 挂载官方同款插件：请求 #1 的 schema 与 Minimal 逐字相同 |
| 首轮注入提醒 | 无 skill 目录/AGENTS.md 注入 | 自动注入（在场时锚定 0/9） | 请求 #1 剥离 `skill-catalog` + `agent-instructions` |
| 后置阶段注入 | 永不注入 | 晋升后每请求恢复 ~9KB 目录 + AGENTS.md 全文 | 默认全程剥离（发现工具承担可见性）；`suppressInjectedContext=false` opt-in 恢复 |
| 系统提示语域（persona + 全局引导段） | 一句话 persona，无任何引导段 | identity/source/web-surface 引导段 + 标准 persona（"Let me…" 叙述来源） | minimalPrompt 层按名阴影屏蔽 3 个全局段 + 替换极简 persona（对旧会话同样生效） |
| 运行时上下文快照 | 关闭（`includeRuntimeContext: false`） | 每次请求注入文件策略/审批策略等快照 | 同一机制：`suppressRuntimeContext()` |
| 模型可见工具目录 | 2 个（bash、str_replace_editor） | ~22 个工具 schema 全部进请求 | 首轮 2 个；晋升后 resident（2 + 3 个发现工具，完整目录按需解锁）；opt-in lean 时隐藏编排族按需放行 |
| PTC SDK 参考段 | 无 | 全部工具的类型+描述渲染进提示 | 随目录缩小（同一 `visible` 视图驱动） |

## 安装（npm 生态方式）

本包是 DSH bundle：自带 `cordis.patch.yml`，使用 `dsh plugin` 安装后会
自动加入 profile 的 `dsh.profile.bundles`，无需手改 `cordis.patch.yml`。

> 给 AI agent：直接执行下面的 `dsh plugin ...` 命令即可，不要手动编辑 `cordis.patch.yml`。

```bash
# 安装到默认 web profile
dsh plugin --profile web add @chaoset/adaptive-perf

# 指定其他 profile
dsh plugin --profile tui add @chaoset/adaptive-perf

# 卸载
dsh plugin --profile web remove @chaoset/adaptive-perf
```

也可以从其他来源安装：

- **GitHub**：如果该包有独立 Git 仓库或 Release tarball，可用
  `dsh plugin --profile web add github:owner/repo` 或
  `dsh plugin --profile web add https://github.com/owner/repo/releases/download/v1.0.0/adaptive-perf.tgz`
- **镜像站**：`dsh plugin --profile web add @chaoset/adaptive-perf --registry=https://registry.npmmirror.com`

更完整的说明见仓库根目录 `README.md` 的「安装来源」。

安装后**重启 harness** 生效（或等待 DSH 对配置层变更的响应）。

## 配置

生效顺序（后者覆盖前者）：

1. 插件内置默认值
2. bundle patch 中 `cordis.patch.yml` 的 config
3. 用户 profile/home 的 `cordis.patch.yml` 覆盖
4. **DSH 设置页 → 插件配置 → 极简性能自适应**（保存到
   `$DSH_HOME/plugins/adaptive-perf/config.json`，立即热生效）

| 字段 | 默认值 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关 |
| `presets` | `["standard", "code", "cordis"]` | 应用自适应的 preset id |
| `suppressRuntimeContext` | `true` | 抑制运行时上下文快照（零功能损失） |
| `suppressInjectedContext` | `true` | 常驻上下文抑制（默认开启）：整个会话剥离技能目录/AGENTS.md 注入（发现工具承担可见性）；`false` = 只在请求 #1 剥离，晋升后恢复 |
| `leanByDefault` | `false` | 工具目录精简（opt-in）：`true` = 会话启动即隐藏编排类工具族；`false`（默认）= 零裁剪 |
| `escalateOnKeyword` | `true` | 用户消息命中触发词 → 放行该族（匹配方式见 `keywordMatchMode`） |
| `keywordMatchMode` | `"smart"` | 触发词匹配模式：`smart` = 含 CJK 的触发词子串匹配、纯 ASCII 词词边界匹配（`"goalish"` 不命中 `"goal"`，整词 `"the goal is"` 命中）；`substring` = 一律子串；`word` = 一律词边界 |
| `escalateOnUnknownTool` | `true` | 工具调用失败（UNKNOWN_TOOL）→ 放行该族 |
| `coreTools` | 核心编码工具 | 展示用：不进入任何限制族 |
| `families` | 见下 | 工具族：`{ 族名: { enabled, tools, keywords } }` |
| `bootstrap` | 见下 | 首轮锚定（真实工具对 / 晋升信号 / 剥离上下文 / 压缩恢复集 / resident 发现工具 / 预算封顶） |
| `minimalPrompt` | 见下 | 极简提示词层（语域锚定） |

`bootstrap`（首轮锚定）：

```json
{
  "enabled": true,
  "realPair": true,
  "tools": ["bash", "str_replace_editor"],
  "promoteOn": "either",
  "suppressedContextSources": ["skill-catalog", "agent-instructions"],
  "discoveryTools": ["dev_tool_search", "skill_search", "skill_load"],
  "maxTokens": 0
}
```

- `realPair`（0.5.0）：把官方 minimal preset 同款插件（持久 PTY bash +
  `str_replace_editor`）挂进会话作用域，按名阴影 standard 的 sandboxed
  bash——请求 #1 的 schema 与 Minimal 逐字相同（只有逐字相同的 schema 能
  锚定）。依赖 `@deepseek-ai` 官方插件包（optionalDependencies）；缺失或
  Windows（无 PTY 后端）时自动降级为"仅收窄目录"并告警。
- `tools`：请求 #1 可见的工具（真实 Minimal 对）。
- `promoteOn`：`either`（默认）/ `tool-call` / `assistant-message`。
- `suppressedContextSources`：首轮剥离的自动注入 source.kind；`[]` 关闭剥离。
- `discoveryTools`：晋升后 resident 目录的常驻发现工具——`dev_tool_search`
  （搜索完整目录并按名解锁，解锁结果下一请求生效且会话内保持）、
  `skill_search` / `skill_load`（无门控，按需搜索/加载技能说明，替代常驻
  ~9KB 技能目录）。
- `maxTokens`：请求 #1 输出预算封顶（0 = 不封顶，opt-in）。

> 0.7.0 破坏性变更：移除 `skillDiscovery` / `instructionHint` /
> `bootstrap.compactionTools` 三个字段（resident 语义下不再需要：
> `dev_tool_search` 常驻提供按需发现，无压缩回退、无指令提示补偿）；
> `bootstrap.discoveryTools` **恢复**为 resident 目录的常驻发现工具
> （默认 `dev_tool_search` / `skill_search` / `skill_load`）。已保存的旧配置
> 会自动忽略被移除字段。

`minimalPrompt`（极简提示词层，0.4.0 新增）：

```json
{
  "enabled": true,
  "persona": "You are a helpful software engineer assistant.",
  "suppressSections": true
}
```

- `persona`：按名阴影替换 `deployment:persona`；默认与极简模式逐字相同，留空
  （`""`）则不替换。
- `suppressSections`：屏蔽 `harness:identity` / `harness:source` / `app:web-surface`
  三个全局引导段（等同极简 `complete` persona 的效果；plan-mode 与 PTC 的
  SDK 段不受影响）。
- 生效范围：目标 preset 的全部会话，**包括已恢复/已晋升的旧会话**（不依赖
  bootstrap 阶段）；配置保存后热生效。

默认工具族（可整族禁用、改名、增删触发词）：

```json
{
  "delegation": { "tools": ["subagent", "subagent_fork", "send_message", "list_agents", "interrupt_agent"], "keywords": ["子代理", "子agent", "委托", "分派", "subagent", "delegate"] },
  "workflow":   { "tools": ["workflow"], "keywords": ["工作流", "workflow", "编排"] },
  "ralph":      { "tools": ["ralph"], "keywords": ["ralph"] },
  "goal":       { "tools": ["create_goal", "get_goal", "update_goal"], "keywords": ["长期目标", "跨轮次", "goal"] }
}
```

> 工具名只在目标 preset 目录中**实际存在**时才被隐藏（运行时取交集），preset
> 升级改名/删除工具不会导致插件报错；`tools.restrict()` 的限制按 agent 作用域
> 生效，子代理同样遵循自适应策略（其自身注册的委托机制工具不受影响）。

## 实现要点

- 监听 host 根作用域的 `agent/created` / `agent/disposed` / `agent/inbox/inserted`
  / `tools/result`（与 `dsh-agent-presets` 自身同款事件用法），按
  `agentPresets.composedPreset(agent.ctx)` 识别目标 preset
- **真实工具对**：`agent.ctx.plugin()` 把 `dsh-terminal` + `dsh-terminal-bash`
  + `dsh-tool-bash-persistent`（Minimal 逐字描述）+ `dsh-fs-local` +
  `dsh-tool-str-replace-editor` 挂进 agent 作用域；scoped registration 按名
  阴影继承的 sandboxed bash，且 `view()` 对 own layer 豁免 restrict——首轮
  目录 = 真实工具对 + 被 deny 的其他继承工具；每个挂载是独立 fiber，
  agent 销毁/插件卸载/配置关闭时全部撤销
- 限制通过 `agent.ctx.tools.restrict({ deny })` 逐族注册：多族限制自动取交集，
  升级 = 释放该族 disposer（单会话单调、一次性目录变化，缓存失效有界）
- 发现工具（`dev_tool_search` / `skill_search` / `skill_load`）同样注册在
  agent 作用域：已解锁工具写入会话状态并重算 deny 集；技能经宿主 `skills`
  服务按 agent scope 查询，`skill_load` 用 `agent.inject` 以
  `skill-invocation` 来源注入（用户技能手势同款，不被默认抑制集剥离）
- 上下文剥离与 instruction-hint 都在 `agent/pre-step`（prepend 注册，最后
  一道变换）：剥离失败绝不吞用户上下文；指令文件探测走宿主 `fs`，失败不注入
- 会话启动/插件重载时用 `tools.schemas(agent)` 记录可见目录，限制与之取交集
- 全部副作用（抑制器、限制、工具注册、提示段、监听）随 agent 销毁或插件
  卸载自动释放
- **fail-safe**：插件任何内部错误只记日志，不拖垮 harness；官方插件包缺失
  时自动降级
