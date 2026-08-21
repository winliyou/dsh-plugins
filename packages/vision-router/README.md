# @chaoset/vision-router — DSH 图片能力注入插件

让 **纯文本模型**（deepseek-v4-flash 等）也能在需要时“看图”：插件不替主模型分析图片，
而是把 `read_image` 工具所需的图片输入能力开放给纯文本模型，**是否读图、什么时候读图
完全由主模型自行决定**。需要时主模型直接调用 `read_image` 读取图片/附件，不需要时不会
产生任何额外的图片分析请求或“已收到图片，正在分析”之类的自动提示。

- **能力声明（resolveModelInfo）**：为纯文本模型补充 `image` 输入模态，让会话入口
  与 `read_image` 工具门禁放行
- **能力提示（能力提示注入）**：对纯文本模型路由的 agent 注入一段精简系统提示，告知
  `read_image` 可用、用 `read_image` 读图而不是用 python/脚本猜测；原生多模态模型
  不注入
- **大图压缩（attachments.saveImage）**：超过阈值的大图/超像素图自动压缩，让图片
  能进入会话并被 `read_image` 读取（服务端预处理，不涉及图片理解）
- 普通文本/历史图片请求**零影响**：插件不包装 `streamWithRegistration`，不扫描会话历史，
  不自动转述图片，也不显示转述进度
- 压缩路径有 64 MiB / 64 MP 硬上限，超大图按原始附件限制拒绝，避免解压炸弹
- **fail-safe**：插件内部错误只记日志并透传，不会拖垮 harness

## 安装（npm 生态方式）

本包是 DSH bundle：自带 `cordis.patch.yml`，使用 `dsh plugin` 安装后会
自动加入 profile 的 `dsh.profile.bundles`，无需手改 `cordis.patch.yml`。

> 给 AI agent：直接执行下面的 `dsh plugin ...` 命令即可，不要手动编辑 `cordis.patch.yml`。

```bash
# 安装到默认 web profile
dsh plugin --profile web add @chaoset/vision-router

# 指定其他 profile
dsh plugin --profile tui add @chaoset/vision-router

# 卸载
dsh plugin --profile web remove @chaoset/vision-router
```

也可以从其他来源安装：

- **GitHub**：如果该包有独立 Git 仓库或 Release tarball，可用
  `dsh plugin --profile web add github:owner/repo` 或
  `dsh plugin --profile web add https://github.com/owner/repo/releases/download/v1.0.0/vision-router.tgz`
- **镜像站**：`dsh plugin --profile web add @chaoset/vision-router --registry=https://registry.npmmirror.com`

更完整的说明见仓库根目录 `README.md` 的「安装来源」。

安装后**重启 harness** 生效（或等待 DSH 对配置层变更的响应）。

## 配置

生效顺序（后者覆盖前者）：

1. 插件内置默认值
2. bundle patch 中 `cordis.patch.yml` 的 config
3. 用户 profile/home 的 `cordis.patch.yml` 覆盖
4. **DSH 设置页 → 插件配置 → 图片能力**（保存到 `$DSH_HOME/plugins/vision-router/config.json`，
   立即热生效，无需重启）

| 字段 | 默认值 | 说明 |
|---|---|---|
| `compressImageBytes` | `4194304` | 压缩触发字节数 |
| `compressMaxDimension` | `1600` | 压缩最大边长（px） |
| `compressTargetBytes` | `2097152` | 压缩目标字节数 |
| `compressFallbackDimension` | `1200` | 回退压缩边长（px） |

## 实现要点

- 包装 `resolveModelInfo` 为纯文本模型补充 `image` 模态（会话入口与 `read_image` 门禁
  放行），模型是否真正读图由其自行决定
- 通过 `agent/created` 给纯文本模型路由的 agent 注入能力提示；原生多模态模型不注入，
  `agent/disposed` 时释放对应 system prompt section
- **不包装 `streamWithRegistration`**：插件不自动转述消息里的图片，也不根据历史图片
  触发视觉模型调用
- 包装 `attachments.saveImage`：大图/超像素图在落盘前压缩，确保图片能进入会话并被
  `read_image` 读取（预处理，非理解）
