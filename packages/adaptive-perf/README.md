# @chaoset/adaptive-perf — DSH 极简性能自适应插件

让 **标准模式（standard）** 与 **PTC 模式（code）** 达到 **极简模式（minimal）**
级别的高性能，同时保留完整能力——不是静态裁剪，而是**动态自适应**：

- **首轮锚定（bootstrap）**：决定模型首轮"轨迹"（思维链风格）的是请求 #1 可见的
  **工具 schema** 与**自动注入的上下文提醒**（参照
  [dsh-anchored-standard](https://github.com/xiaobright/dsh-anchored-standard/)
  的实测：Minimal 真实工具对在 256000 输出预算下 5/5 锚定、任何 standard 系
  schema 11/11 落入 standard-like；技能目录在场时锚定完全无法复现 0/9）。因此：
  - 请求 #1 的工具目录收窄到真实 Minimal 工具对（`bash` + `str_replace_editor`）；
  - 请求 #1 剥离自动注入上下文（技能目录提醒 `skill-catalog`、AGENTS.md 摘要
    `agent-instructions`，用户主动的技能手势不过滤）；
  - 会话出现首个**持久**晋升信号（首个 `tool/call` 或 `assistant/message`，
    `promoteOn` 可选 `either`/`tool-call`/`assistant-message`）后恢复完整目录；
    阶段从持久会话事件推导，**resume / reload 不丢状态**；
  - compaction 会把会话打回"第二次首轮"：`compaction/end` 之后回到受控目录
    （bootstrap 工具对 + `compactionTools` 核心工作集），直到出现新的晋升信号；
  - `maxTokens > 0` 时可给请求 #1 封顶输出预算（晋升后自动剥离）。
- **运行时上下文抑制**：对目标 preset 的会话调用 `suppressRuntimeContext()`
  （与极简模式的 `includeRuntimeContext: false` 同一机制），每次模型请求省掉
  "Current runtime context" 快照文本，**零功能损失**。
- **工具目录自适应精简**：会话启动时按"工具族"默认隐藏高开销低频工具
  （子代理 / 工作流 / ralph / goal 等编排类），只保留核心编码工具
  （bash / 文件读写编辑 / 检索 / jobs / todo / 提问 / 网页搜索 / 技能 / 计划）。
  标准模式的工具目录因此逼近极简；PTC 模式系统提示里的 **SDK 参考段同步缩小**。
- **需求信号自动放行**（会话内单调升级，只升不降，限制请求缓存失效次数）：
  - 关键词信号：用户消息命中工具族触发词（如"子代理"、"工作流"）→ 放行该族；
  - 失败信号：PTC 程序调用被隐藏工具报 `UNKNOWN_TOOL` → 放行该族，下次即可调用。

所有开关与工具族可在设置页配置、随时放行；配置保存后**热生效**（无需重启）。

## 为什么极简模式最快（源码对照 + 社区实测结论）

| 维度 | 极简模式 | 标准 / PTC 模式 | 本插件做法 |
|---|---|---|---|
| 首轮轨迹（决定后续行为风格） | Minimal 工具对锚定（5/5） | 任何 standard 系 schema 落入 standard-like（11/11） | 请求 #1 收窄到真实 Minimal 工具对，首个持久信号后恢复 |
| 首轮注入提醒 | 无 skill 目录/AGENTS.md 注入 | 自动注入（在场时锚定 0/9） | 请求 #1 剥离 `skill-catalog` + `agent-instructions` |
| 运行时上下文快照 | 关闭（`includeRuntimeContext: false`） | 每次请求注入文件策略/审批策略等快照 | 同一机制：`suppressRuntimeContext()` |
| 模型可见工具目录 | 2 个（bash、str_replace_editor） | ~22 个工具 schema 全部进请求 | bootstrap 后默认隐藏 4 个编排类工具族（~11 个工具），按需放行 |
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
| `presets` | `["standard", "code"]` | 应用自适应的 preset id |
| `suppressRuntimeContext` | `true` | 抑制运行时上下文快照（零功能损失） |
| `leanByDefault` | `true` | 会话启动即隐藏编排类工具族 |
| `escalateOnKeyword` | `true` | 用户消息命中触发词 → 放行该族 |
| `escalateOnUnknownTool` | `true` | 工具调用失败（UNKNOWN_TOOL）→ 放行该族 |
| `coreTools` | 核心编码工具 | 展示用：不进入任何限制族 |
| `families` | 见下 | 工具族：`{ 族名: { enabled, tools, keywords } }` |

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
- 限制通过 `agent.ctx.tools.restrict({ deny })` 逐族注册：多族限制自动取交集，
  升级 = 释放该族 disposer（单会话单调、一次性目录变化，缓存失效有界）
- 会话启动/插件重载时用 `tools.schemas(agent)` 记录可见目录，限制与之取交集
- 全部副作用（抑制器、限制、监听）随 agent 销毁或插件卸载自动释放
- **fail-safe**：插件任何内部错误只记日志，不拖垮 harness
