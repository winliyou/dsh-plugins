# @chaoset/vision-router — DSH 识图自动降级插件

让 **任何 preset** 的会话在**纯文本模型**（deepseek-v4-flash 等）下也能处理图片：
请求含图片而当前模型不支持时，自动调用视觉模型（默认 `zai-open / glm-4v-flash`，
智谱官方**免费**视觉模型）转述为文本，再交给原模型继续分析。

- 拖入或粘贴到对话框的图片 → 自动转述；agent 用 `read_image` 读到的图片 → 自动转述
- 转述结果按 `sessionId+图片` 缓存，同会话不重复调用
- 普通文本请求零影响（直接透传，历史图片已缓存时不打扰）
- 大图自动压缩（字节或像素超限触发；mediaType 按输出字节实际检测；
  PNG/WebP/GIF 优先保持原格式）
- 压缩路径有 64 MiB / 64 MP 硬上限，超大图按原始附件限制拒绝，避免解压炸弹
- **fail-safe**：插件任何内部错误只记日志并透传，不会拖垮 harness

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
4. **DSH 设置页 → 插件配置 → 识图降级**（保存到 `$DSH_HOME/plugins/vision-router/config.json`，
   立即热生效，无需重启）

| 字段 | 默认值 | 说明 |
|---|---|---|
| `visionProvider` | `zai-open` | 视觉模型所在 provider |
| `visionModel` | `glm-4v-flash` | 视觉模型 id（必须真实声明 image 输入，否则报错） |
| `autoDiscover` | `true` | 配置的模型不可用时自动寻找支持图片的模型 |
| `maxVisionTokens` | `2048` | 转述输出上限 |
| `prompt` | 内置模板 | 转述提示词，`{count}` 为图片数 |
| `compressImageBytes` | `4194304` | 压缩触发字节数 |
| `compressMaxDimension` | `1600` | 压缩最大边长（px） |
| `compressTargetBytes` | `2097152` | 压缩目标字节数 |
| `compressFallbackDimension` | `1200` | 回退压缩边长（px） |

## 实现要点

- 包装 `resolveModelInfo` 为纯文本模型补充 `image` 模态（read_image 门禁放行），
  但视觉模型校验与请求路由基于未被包装的 `listModels`（配置成纯文本模型会直接报错）
- 包装 `streamWithRegistration`（llm.stream 与 agent loop 两条路径的汇聚点）：
  含图且目标模型原生不支持时转述，替换 image block 为文本后透传
- 进度提示仅在**真正发起转述**时显示（缓存命中的历史图片不打扰）
- 主请求取消时转述随之中止（signal 透传）
