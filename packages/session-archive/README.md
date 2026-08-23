# @chaoset/session-archive

DSH 插件：归档会话管理 —— 补上 DSH 缺失的"归档后半程"。

web 侧边栏底部新增 **归档** 面板（🗂）：

- **查看归档**：列出全部归档会话（标题、目录、创建/最后修改时间、体积、
  运行状态），点击任意会话可展开**只读浏览**其完整聊天内容（用户/助手文本
  消息）。
- **一次多选批量操作**：
  - **恢复归档**（unarchive）：把勾选的会话移回会话树，恢复其在原工作区的
    位置（归档时保留的 slot 会计不被破坏）。
  - **彻底删除**（delete）：删除勾选会话的持久化文件与会话目录。删除为
    两段式确认（第一次点击进入确认态，4 秒内再次点击执行），避免误删。
    删除后该会话在侧边栏对话列表与归档面板中都不会再出现。
- 工具条提供**全选**、已选计数；**运行中**（live）的会话显示黄色徽标且
  禁止勾选删除（请先停止会话）；列表随会话树变化自动可刷新（⟳）。

## 安装

```bash
dsh plugin --profile web add @chaoset/session-archive
```

重启 web profile 后，侧边栏底部出现"归档"按钮。插件由两部分组成：host
插件（归档读写/删除逻辑）与 web 客户端（面板 UI），随 `dsh.bundle.patch`
自动激活。

## 工作原理

- **列表**：`workspaceRegistry.archivedSessionIds` ∩ `sessionPersistence.list()`，
  标题从会话事件流折叠（最后一个 `session/title` 事件，与 dsh-session-title
  同规则）；文件信息来自 `sessionPersistence.locate()` + `stat`。
- **查看**：`sessionPersistence.readFrom(id, 0)` 只读解析会话事件，提取
  文本消息（`user/message` / `assistant/message` 的 text 块），不做任何
  写入/修复。
- **删除**：live 会话拒绝；每个会话删除持久化文件与会话目录（`locate()`
  定位）。删除后**保留**该会话在归档集合中的 ghost id：宿主的
  `archiveSession` 不停止内存会话，若把 id 移出归档集合，仍挂在内存中的
  会话会因"不再归档"而立刻重新出现在侧边栏对话列表（效果等同"恢复"）；
  保留 ghost id 后由 `list()` 的存在性过滤隐藏，面板与侧边栏都不再显示。
  归档集合没有官方写入 API，插件复用 registry 自身的串行化写入通道
  （`enqueueOperation → requireState → setState`，与 `archiveSession` 同一
  路径）；若内部形状变化会自动降级为"仅删文件"，归档列表按文件存在性
  过滤，功能不受影响。
- **恢复**：仅从归档集合移除**仍存在持久化文件**的会话 id，会话数据不动，
  恢复后回到原工作区位置；文件已删的已删除会话拒绝恢复（防"复活"）。

## Remote API（`ctx.remote.sessionArchive`）

| 方法 | 参数 | 返回 |
| --- | --- | --- |
| `list()` | — | `{ items: ArchiveRow[] }` |
| `count()` | — | `{ count }`（存在性过滤后的归档数量，徽标轮询轻端点） |
| `detail(sessionId)` | 会话 id | `{ sessionId, header, title, messageCount, totalMessageCount, truncated, messages, live }` |
| `delete(sessionIds[])` | id 数组 | `{ deleted, failed, removedFromArchive }` |
| `unarchive(sessionIds[])` | id 数组 | `{ restored, removedFromArchive }` |

> `delete` 的 `failed[].reason`：`not-archived`（非归档成员）、`live`（内存
> 中未归档会话）、`busy`（归档会话 60s 内仍有写入）、`unenumerable`（文件
> 存在但持久化枚举不到，如首行损坏的孤儿日志）、`reappeared`（删除后被
> 生成流重建、二次删除仍压不掉）；其余为底层删除错误消息。

> `delete` 的 `removedFromArchive` 恒为 0：删除保留归档 ghost id（见上），
> 侧边栏不会重新显示已删除的会话；`unarchive` 的 `removedFromArchive` 为
> 实际从归档集合移除的 id 数。

`ArchiveRow`：`{ sessionId, title, cwd, createdAt, updatedAt, size, live }`。

## 配置

config 字段（`cordis.patch.yml` 或 `~/.dsh/plugins/session-archive/config.json`）：

- `detailMaxMessages`（默认 200）：查看时返回的最大消息条数。
- `messagePreviewChars`（默认 2000）：单条消息预览的最大字符数。
- `titleReadConcurrency`（默认 4）：列表加载时并发读取标题的并行度。

## 限制

- 运行中（live）的会话无法删除 —— 先停止会话再删除。
- 无官方 unarchive API，恢复归档通过 registry 写入通道实现；若未来 DSH
  提供官方 API，插件会切换过去（行为不变）。
