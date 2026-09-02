# Changelog

## 0.3.2 (2026-09-02)

### Bug Fixes

* 额度统计计入未开始的周期授予：周期型套餐当月额度用尽但 `RemainCycles > 0`
  时，真实剩余 = 当前周期剩余 + 未开始周期数 × 周期额度——此前只算当前周期，
  会把还有后续周期的套餐显示成 0；卡片进度条分子分母同步跨同一范围
* 插件卡片的免费模型不再显示「x0.00 积分/次」速率行（免费徽章已表达该事实），
  促销模型的倍率行保持不变
* 静态兜底模型目录对照 2026-09-02 线上数据复核：15/15 完全一致

与 alpha 线的 0.3.2-alpha.1 内容对应（宿主依赖线不同：本版锁 `^0.1.1-rc.2`）。

## 0.3.1 (2026-09-02)

### Changes

* npm 包名定为 `@chaoset/dsh-any-connect`（原迁移时的 `dsh-anyconnect` 因
  unpublish 后 24 小时同名保护无法复用，且更清晰的连字符命名与 monorepo 目录
  `packages/dsh-any-connect` 一致）。同步更新：heartbeat `package` 字段、
  status 路由路径、CLI 命令名（`dsh-any-connect`）、client 插件名、
  `cordis.patch.yml`。内部标识（provider 路由 `workbuddy`、设置命名空间
  `anyconnect`）不变——它们是接入的 Agent 名与产品标识，非包名。

## 0.3.0 (2026-09-02)

本包的第一个独立版本：由 corrinehu/dsh-workbuddy-connect 迁移而来，纳入
dsh-plugins monorepo，标识改为 @chaoset/dsh-any-connect（插件名
`llm-anyconnect`、设置命名空间 `anyconnect`；provider 路由保留 `workbuddy`）。

### Features

* 费率显示：模型选择列表每个模型名直接带积分倍率（`GLM-5.2 · x0.79`），
  `/model` 弹窗与 composer 下拉都可见；设置卡片「模型优惠」区块含倍率行、
  免费 / 限时免费 / 夜间折扣徽章。`normalizeCredits` 把上游 `x0.79 credits`
  归一成语言无关的 `x0.79`（host 侧 LLM seam 无 locale 服务）
* 思考强度：解析上游 `reasoning` 的 `supportedEfforts` / `canDisableThinking`，
  逐模型映射 pi-ai 思考等级；旧形态行提供完整档位，`off` 仅当
  `canDisableThinking:true` 才提供
* `developer` → `system` 角色改写：pi-ai 把系统提示作为 `role:"developer"`
  发送，WorkBuddy 上游拒绝该 role（HTTP 400 code 11128）
* 兜底目录同步到 cli 的 15 个模型（新增 hy4-preview / hy3-x / glm-5.3 /
  glm-5.3-flash）
* 保留 `dsh-any-connect` CLI（doctor / status / logout，含宿主心跳检测）
* 版本改为运行时读 `package.json`（monorepo 用 tsc 构建，无 tsdown `define`；
  顺带消除"发布产物报旧版本号"的失败模式）

### Notes

* 本包锁 dsh 0.1.1-rc.2 稳定线依赖；适配 dsh alpha 的版本在 alpha 分支维护
* 基于 upstream 的 LICENSE 为 MIT；README 顶部声明了来源与致谢
