# Changelog

## 0.3.0 (2026-09-02)

本包的第一个独立版本：由 corrinehu/dsh-workbuddy-connect 迁移而来，纳入
dsh-plugins monorepo，标识改为 @chaoset/dsh-anyconnect（插件名
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
* 保留 `dsh-anyconnect` CLI（doctor / status / logout，含宿主心跳检测）
* 版本改为运行时读 `package.json`（monorepo 用 tsc 构建，无 tsdown `define`；
  顺带消除"发布产物报旧版本号"的失败模式）

### Notes

* 本包锁 dsh 0.1.1-rc.2 稳定线依赖；适配 dsh alpha 的版本在 alpha 分支维护
* 基于 upstream 的 LICENSE 为 MIT；README 顶部声明了来源与致谢
