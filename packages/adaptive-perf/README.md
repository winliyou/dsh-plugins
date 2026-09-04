# @chaoset/adaptive-perf — DSH 极简性能自适应插件

让标准（standard）/ PTC（code）/ 创造（cordis）模式达到极简模式级别的高性能，
同时保留完整能力——不是静态裁剪，而是动态自适应。锚定条件参照社区实测的
[dsh-anchored-standard](https://github.com/xiaobright/dsh-anchored-standard/)。

- **首轮锚定（bootstrap，默认开启）**：请求 #1 按极简模式条件组装——挂载官方
  minimal preset 同款**真实工具对**（持久 PTY bash + `str_replace_editor`，
  schema 与 Minimal 逐字相同），剥离技能目录提醒（`skill-catalog`）与
  AGENTS.md 摘要（`agent-instructions`）注入，可选封顶首轮输出预算。首个持久
  晋升信号（首个 `tool/call` 或 `assistant/message`）后进入 resident 阶段：
  保留工具对与常驻发现工具（`dev_tool_search` / `skill_search` / `skill_load`），
  完整目录经 `dev_tool_search` 按需解锁，常规注入恢复可见。阶段从持久会话事件
  推导，resume / reload / compaction 不丢状态。
- **常驻上下文抑制（suppressInjectedContext，默认开启）**：整个会话持续剥离
  技能目录提醒与 AGENTS.md 摘要注入，功能可见性由发现工具承担；设为 `false`
  时只在请求 #1 剥离，晋升后恢复常规注入。
- **运行时上下文抑制（suppressRuntimeContext，默认开启）**：与极简模式同一
  机制关闭运行时快照注入，每次请求省掉快照文本，零功能损失。
- **极简提示词层（minimalPrompt，默认开启）**：屏蔽三个全局引导段
  （`harness:identity` / `harness:source` / `app:web-surface`）并把 persona
  替换为极简语域文本，让系统提示回到极简语域；对已恢复/已晋升的旧会话同样生效。
- **工具目录精简（leanByDefault，默认关闭）**：默认零裁剪。开启后按「工具族」
  隐藏编排类工具（子代理/工作流/ralph/goal），只保留核心编码工具，标准模式的
  工具目录逼近极简，PTC 的 SDK 参考段同步缩小。
- **需求信号自动放行**：用户消息命中工具族触发词，或 PTC 程序调用被隐藏工具报
  `UNKNOWN_TOOL` 时，放行对应工具族（会话内单调升级，只升不降）。失败信号对
  首轮锚定（bootstrap）隐藏的工具同样生效：命中的工具属于某个工具族时放行
  整族，不属于任何族（如 `read`/`write` 等核心编码工具）时按名解锁该工具。

所有开关与工具族可在设置页配置，保存后热生效（无需重启）。

## 安装

本包是 DSH bundle：自带 `cordis.patch.yml`，`dsh plugin` 安装后自动加入
profile 的 `dsh.profile.bundles`，无需手改 `cordis.patch.yml`。

```bash
dsh plugin --profile web add @chaoset/adaptive-perf
dsh plugin --profile web remove @chaoset/adaptive-perf
```

也支持本地路径 / GitHub / 镜像站安装，见仓库根 `README.md` 的「安装」。
安装后重启 harness 生效。

> 给 AI agent：直接执行 `dsh plugin ...` 命令即可，不要手动编辑 `cordis.patch.yml`。

## 配置

生效顺序（后者覆盖前者）：

1. 插件内置默认值
2. bundle patch 中 `cordis.patch.yml` 的 config
3. 用户 profile/home 的 `cordis.patch.yml` 覆盖
4. **DSH 设置页 → 插件配置 → 极简性能自适应**（保存到
   `~/.dsh/plugins/adaptive-perf/config.json`，立即热生效）

| 字段 | 默认值 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关 |
| `presets` | `["standard", "code", "ptc", "cordis"]` | 应用自适应的 preset id |
| `suppressRuntimeContext` | `true` | 抑制运行时上下文快照（零功能损失） |
| `suppressInjectedContext` | `true` | 整个会话剥离技能目录/AGENTS.md 注入；`false` = 只在请求 #1 剥离，晋升后恢复 |
| `leanByDefault` | `false` | 工具目录精简（opt-in）：`true` = 会话启动即隐藏编排类工具族 |
| `escalateOnKeyword` | `true` | 用户消息命中触发词 → 放行该族（匹配方式见 `keywordMatchMode`） |
| `keywordMatchMode` | `"smart"` | `smart` = 含 CJK 的触发词子串匹配、纯 ASCII 词词边界匹配；`substring` = 一律子串；`word` = 一律词边界 |
| `escalateOnUnknownTool` | `true` | 工具调用失败（UNKNOWN_TOOL）→ 放行该族；bootstrap 阶段隐藏的工具同样生效（族外工具按名解锁） |
| `coreTools` | 核心编码工具 | 展示用：不进入任何限制族 |
| `families` | 见下 | 工具族：`{ 族名: { enabled, tools, keywords } }` |
| `bootstrap` | 见下 | 首轮锚定 |
| `minimalPrompt` | 见下 | 极简提示词层 |

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

- `realPair`：挂载官方 minimal preset 同款插件（持久 PTY bash +
  `str_replace_editor`），请求 #1 的 schema 与 Minimal 逐字相同。依赖
  `@deepseek-ai` 官方插件包（optionalDependencies）；缺失或 Windows（无 PTY
  后端）时自动降级为「仅收窄目录」并告警。
- `tools`：请求 #1 可见的工具。
- `promoteOn`：`either`（默认）/ `tool-call` / `assistant-message`。
- `suppressedContextSources`：首轮剥离的自动注入 source.kind；`[]` 关闭剥离。
- `discoveryTools`：晋升后常驻的发现工具——`dev_tool_search` 搜索完整目录并
  按名解锁，`skill_search` / `skill_load` 按需搜索/加载技能说明。
- `maxTokens`：请求 #1 输出预算封顶（0 = 不封顶）。

`minimalPrompt`（极简提示词层）：

```json
{
  "enabled": true,
  "persona": "You are a helpful software engineer assistant.",
  "suppressSections": true
}
```

- `persona`：按名阴影替换 `deployment:persona`；默认与极简模式逐字相同，留空
  （`""`）则不替换。
- `suppressSections`：屏蔽 `harness:identity` / `harness:source` /
  `app:web-surface` 三个全局引导段（plan-mode 与 PTC 的 SDK 段不受影响）。
- 生效范围：目标 preset 的全部会话，包括已恢复/已晋升的旧会话。

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
> 升级改名/删除工具不会导致插件报错；限制按 agent 作用域生效，子代理同样遵循
> 自适应策略。
