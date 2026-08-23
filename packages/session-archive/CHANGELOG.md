# Changelog

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
