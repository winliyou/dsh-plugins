# Changelog

## [0.3.0](https://github.com/winliyou/dsh-plugins) (2026-08-25)

### Features

* **实时徽标与列表**：订阅宿主 workspaces 服务的归档集合 store——会话菜单点「归档」、其它标签页变更、宿主推送 `host/archived-sessions-changed` 都即时反映到侧边栏徽标与打开中的面板，不再等 5s 轮询；集合含 ghost id 与 `count()` 口径不同，故仅作触发信号、数目仍以 `count()` 为准；store 不可用时经 `ctx.get` 探测降级为纯轮询（不写 inject，插件不因等待挂起）
* `count()` 调用失败自动退回一次 `list()` 取数并同步徽标：任何 host 版本组合（如宿主进程旧于 lib、端点缺失）下徽标都能自我纠正，不再卡在过期值
* **徽标 hover 与「设置」入口对齐**：几何与官方侧边栏设置触发按钮逐字一致（`calc(100% + 4px)` 宽 / 42px 高 / 负外边距 / 非对称内边距 / 12px 圆角 / 同一 hover 变量；收起态 36×36 圆形、图标 18px）。根因修复：`.sa_root` 是 `footerActions`（flex 容器）的直接 flex 项会收缩到内容宽，显式 `width:100%` 撑满后 hover 命中面积与设置入口完全一致

### Bug Fixes

* `deleteArchived` 冷文件快速路径：不在内存且 60s 内无写入的归档删除跳过固定 2×300ms settle 复验（重现只可能来自内存生成流或刚写过的 tab），批量清理陈旧归档从 ~12s/20 个降到 <1s；可能活跃的会话维持原两段复验与 `reappeared` 语义
* 徽标关闭态轮询在标签页隐藏时暂停 interval，恢复可见立即刷一次并重启（隐藏页轮询是纯浪费）；面板打开期间新增 30s 静默刷新（`sameItems` 比较，数据不变不重渲染、不打断勾选）
* 批量删除成功后清理 `details`/`expanded` 缓存：内存不再随操作缓慢增长，展开态不再指向已删除的行

### Accessibility / UI

* 面板焦点管理：打开时焦点移入面板、关闭时归还徽标按钮（`prevOpen` 防首次挂载误触发）
* 徽标按钮补回 `aria-label`（icon-only 场景 accessible name 自带语义与数量，不依赖 `title`）
* warn 级通知独立 warn 色（`state-warn-primary`），不再与错误同红
* 面板 150ms 入场动画（淡入 + 轻微上移，respect `prefers-reduced-motion`）；z-index 层级来源注释

## [0.2.4](https://github.com/winliyou/dsh-plugins) (2026-08-23)

### Bug Fixes

* **RemoteAPI: `SessionArchiveGateway` 缺少 0.2.3 引入的 `count()` 方法认领**——徽标轮询端点实际返回 404（客户端静默吞错，表现为计数不更新）；补齐方法与 marker。
* `detail()` 达到 `detailMaxMessages` 后只递增计数、不再做文本提取；响应新增 `totalMessageCount` 与 `truncated`，客户端如实显示"共 N 条消息（已截断）"而非歧义计数。
* `deleteArchived` 对 ghost id 先经 `locate()` 探测孤儿文件：首行损坏、被 `persistence.list()` 静默跳过的日志计入 `failed('unenumerable')`，不再谎报成功并把文件留在磁盘上。
* rm 后约 300ms 复验：文件被进行中的生成流重建则再删一次，仍压不掉计入 `failed('reappeared')`。
* 客户端：列表浅比较（sessionId+updatedAt+size+live）未变化跳过重渲染；选择集自动剔除已消失项；批量异常提示带请求数量；零体积显示 "—"；`detail.messages` 渲染前加形状防御。

### Accessibility

* 行标题由 span 改为真 button（键盘可达）；面板补 `role="dialog"` 与 aria-label；Escape 关闭面板。

## [0.2.3](https://github.com/winliyou/dsh-plugins) (2026-08-22)

### Features

* `count()` 轻端点 + 按 mtime 的标题缓存：面板关闭态的徽标轮询不再每 5 秒全量解析归档事件流。
* 删除失败原因端到端透出（`not-archived` / `busy` 等）。
* 客户端：成功通知独立样式；删除确认锁定选择集并显示数量；批量失败原因逐条展示；detail 加载失败可重试；复选框 aria-label。

### Bug Fixes

* `deleteArchived`/`detail` 前置校验归档成员资格：未归档的持久化会话不再可能经远程端点被不可逆删除/读取。
* busy 判定 TOCTOU：rm 前重取 mtime 复核；unarchive 的存在性确认移入 registry 写锁临界区，并发删除不再能把已删会话"复活"回侧边栏。

## [0.2.2](https://github.com/winliyou/dsh-plugins) (2026-08-22)

### Dependencies

* update @deepseek-ai/* to 0.1.0-rc.8

## [0.2.1](https://github.com/winliyou/dsh-plugins) (2026-08-22)

### Refactor

* republish TypeScript-refactor build output (tsc + esbuild pipeline)

## [0.2.0](https://github.com/winliyou/dsh-plugins) (2026-08-21)

### Bug Fixes

* expanded badge keeps text/icon state aligned with the sidebar wide prop

## [0.1.3](https://github.com/winliyou/dsh-plugins) (2026-08-18)

### Bug Fixes

* confirm-delete button hover: red text on red background was unreadable; changed to red background with white text

## [0.1.2](https://github.com/winliyou/dsh-plugins) (2026-08-18)

### Bug Fixes

* keep ghost archived id after deleting archived sessions so in-memory sessions don't reappear in the sidebar

## [0.1.1](https://github.com/winliyou/dsh-plugins) (2026-08-17)

### Bug Fixes

* archived sessions no longer mislabeled as running; restored selectable deletion

## [0.1.0](https://github.com/winliyou/dsh-plugins) (2026-08-17)

### Features

* initial session archive plugin: archived session list, read-only detail, batch restore and permanent delete
