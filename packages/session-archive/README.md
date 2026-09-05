# @chaoset/session-archive — DSH 归档会话管理

补上 DSH 缺失的「归档后半程」：web 侧边栏底部新增**归档**面板。

- **查看归档**：列出全部归档会话（标题、目录、时间、体积、运行状态）；点击
  会话可展开**只读浏览**其聊天内容（用户/助手文本消息）。
- **批量恢复**：勾选多个会话一键移回会话树，恢复其在原工作区的位置。
- **彻底删除**：删除勾选会话的持久化文件与会话目录；两段式确认（第一次点击
  进入确认态，4 秒内再次点击执行）避免误删。有近期写入的会话（生成流可能
  还在落盘）拒绝删除；若宿主允许归档运行中会话，插件同样拒绝。
- 工具条提供全选与已选计数；侧边栏徽标实时显示归档数量（订阅宿主归档集合，
  轻量轮询兜底）。

## 安装

> 适配的 DSH 版本见本包 `package.json` 的 `dsh.host` 字段
> （`npm view <包名> dsh.host` 可查）；仓库的 `dsh-v*` git tag 是各次
> 稳定版适配的归档点。

```bash
dsh plugin --profile web add @chaoset/session-archive
dsh plugin --profile web remove @chaoset/session-archive
```

重启 web profile 后，侧边栏底部出现「归档」入口。其他安装来源见仓库根
`README.md` 的「安装」。

## 工作原理

- **列表**：宿主归档集合 ∩ 持久化会话列表；标题折叠自会话事件流的最后一个
  `session/title` 事件，体积来自文件 stat。
- **查看**：只读解析会话事件流，提取用户/助手文本消息；超过 `detailMaxMessages`
  条时截断并如实标注。
- **恢复**：仅从归档集合移除仍存在持久化文件的会话 id，会话数据不动；文件已删
  的会话拒绝恢复。
- **删除**：live 会话拒绝；每个会话删除持久化文件与会话目录。删除后**保留**
  该会话在归档集合中的占位 id——否则仍挂在内存中的会话会因「不再归档」立刻
  重新出现在侧边栏（效果等同恢复）；列表按文件存在性过滤，面板与侧边栏都不再
  显示该会话。宿主内部形状变化时自动降级为「仅删文件」，功能不受影响。

## Remote API（`ctx.remote.sessionArchive`）

| 方法 | 参数 | 返回 |
| --- | --- | --- |
| `list()` | — | `{ items: ArchiveRow[] }` |
| `count()` | — | `{ count }`（存在性过滤后的归档数量，徽标轮询轻端点） |
| `detail(sessionId)` | 会话 id | `{ sessionId, header, title, messageCount, totalMessageCount, truncated, messages, live }` |
| `delete(sessionIds[])` | id 数组 | `{ deleted, failed, removedFromArchive }` |
| `unarchive(sessionIds[])` | id 数组 | `{ restored, removedFromArchive }` |

> `delete` 的 `failed[].reason`：`not-archived`（非归档成员）、`live`（内存中
> 未归档会话）、`busy`（归档会话 60s 内仍有写入）、`unenumerable`（文件存在但
> 持久化枚举不到）、`reappeared`（删除后被生成流重建）；其余为底层删除错误消息。

> `delete` 的 `removedFromArchive` 恒为 0（删除保留归档占位 id，见上）；
> `unarchive` 的为实际从归档集合移除的 id 数。

`ArchiveRow`：`{ sessionId, title, cwd, createdAt, updatedAt, size, live }`。

## 配置

config 字段（`cordis.patch.yml` 或 `~/.dsh/plugins/session-archive/config.json`）：

- `detailMaxMessages`（默认 200）：查看时返回的最大消息条数。
- `messagePreviewChars`（默认 2000）：单条消息预览的最大字符数。
- `titleReadConcurrency`（默认 4）：列表加载时并发读取标题的并行度。

## 限制

- 有近期写入或运行中的会话拒绝删除——先停止会话、等写入完成再删除。
- 无官方 unarchive API，恢复归档通过 registry 写入通道实现；若未来 DSH 提供
  官方 API，插件会切换过去（行为不变）。
