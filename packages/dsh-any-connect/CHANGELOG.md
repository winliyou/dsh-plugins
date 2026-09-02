# Changelog

## 0.3.4-alpha.0 (2026-09-03)

### Bug Fixes

* 修复全新安装后插件读取不到桌面端登录态：settings 文档把未设置的
  `authFile` 物化成空串并原样传给 `setDesktopPath`，空串覆盖把桌面凭据
  探测路径钉死为单个空路径，整包被判定为未登录（status 接口返回
  signed-out，设置页卡片因此没有账号与额度内容）。空串/纯空白覆盖现在
  回退到平台默认探测顺序，与空环境变量的既有行为一致

### Changes

* 版本号跳号：稳定线发布了同基础号的 `0.3.3`（同一批修复的 rc.2 线版本），
  alpha 线按「预发布必须高于一切已发布版本」的不变式跳到 0.3.4-alpha.0。

## 0.3.3-alpha.0 (2026-09-02)

### Changes

* 版本号跳号：稳定线发布了同基础号的 `0.3.2`（同一批修复的 rc.2 线版本），
  alpha 线按「预发布必须高于一切已发布版本」的不变式跳到 0.3.3-alpha.0。
  包内容与 0.3.2-alpha.1 完全一致（适配 DSH 0.1.2-alpha.5 + 额度统计修复，
  详见对应小节）。

## 0.3.2-alpha.1 (2026-09-02)

### Bug Fixes

* 额度统计计入未开始的周期授予：周期型套餐当月额度用尽但 `RemainCycles > 0`
  时，真实剩余 = 当前周期剩余 + 未开始周期数 × 周期额度——此前只算当前周期，
  会把还有后续周期的套餐显示成 0；卡片进度条分子分母同步跨同一范围
* 插件卡片的免费模型不再显示「x0.00 积分/次」速率行（免费徽章已表达该事实），
  促销模型的倍率行保持不变
* 静态兜底模型目录对照 2026-09-02 线上数据复核：15/15 完全一致

## 0.3.2-alpha.0 (2026-09-02)

### Changes

* 版本号重编号：`0.3.1-alpha.1` → `0.3.2-alpha.0`，包内容与 0.3.1-alpha.1
  完全一致（适配 DSH 0.1.2-alpha.5，详见该节）。版本号不变式自本版起校正：
  alpha 线是开发前沿，预发布版本必须高于稳定线的一切已发布版本
  （`0.3.1-alpha.x` < `0.3.1` 的倒挂是旧约定产物）；此后 alpha 线以
  `0.3.2-alpha.N` 递增，功能稳定合并稳定线时去后缀成为 `0.3.2`。

## 0.3.1-alpha.1 (2026-09-02)

### Changes

* 适配 DSH 0.1.2-alpha.5：dsh 子包与 devDeps peers 依赖下限从 `^0.1.2-alpha.3` 升到
  `^0.1.2-alpha.5`（声明实测基线）；仓库侧 exclude 清单按 lockfile 闭包重建
  （27 → 35 项）
* 已对照 0.1.2-alpha.5 全量 diff 官方包：dsh-llm-pi-ai 的模型发现路径内部重构
  （`storedApiKey` 裸函数 → `storedProfile`（headers + 惰性凭证解析）），导出面与
  配置 schema 无变化，adapter 自有的 `resolveApiKey` 不经过该内部路径；dsh-llm 的
  typert 快照更新（`CoordinatorMessageSource` → `AgentMessageSource`，宿主内部消息
  分类，插件不引用）；dsh-client-ui-renderer 为 inject face 新增 `keyedHooks` 轴
  （加法兼容，原 `hooks` 轴不变）；dsh-settings / dsh-attachment / dsh-home-paths /
  dsh-host-webserver / dsh-atomic-write 仅移除内联 invariant 助手；多数官方包移除了
  dsh-invariants peer（下游依赖压力变小）；全仓 build + typecheck + 152 项测试在
  alpha.5 依赖闭包上通过

## 0.3.1-alpha.0 (2026-09-02)

alpha 线首版：与 main 的 0.3.1 功能一致，依赖适配到最新 dsh（0.1.2-alpha.3
线，与 monorepo 其余包对齐）。

### Changes

* 依赖升级：dsh 子包 `^0.1.2-alpha.3`、cordis `^4.0.2`、schemastery
  `^3.18.2`、pi-ai `^0.84.2`
* 跟随 dsh 0.1.2 API 变化：`settingsNamespace()` / `installSettingsSection()`
  移除 → `SettingsNamespace` 名义类型 + `ctx.settings.installSection(...)`；
  `@deepseek-ai/dsh-client-runtime` 移除 → client 用 cordis `Context` +
  `dsh-client-ui-renderer` 类型
* 补齐 dsh-llm-pi-ai 的 peer devDeps（authorization / invariants /
  launch-environment / timeout / fs）——auto-install-peers 关闭后 peers 不
  自动安装，测试需显式解析
* 版本 `-alpha.N` 后缀，CI 发布到 `alpha` dist-tag

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
