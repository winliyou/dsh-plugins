# @dsh-plugins/vision-router — DSH 识图自动降级插件

让 **任何 preset** 的会话在**纯文本模型**（deepseek-v4-flash 等）下也能处理图片：
请求含图片而当前模型不支持时，自动调用视觉模型（默认 `zai-open / glm-4v-flash`，
智谱官方**免费**视觉模型）转述为文本，再交给原模型继续分析。

- 拖入对话框的图片 → 自动转述；agent 用 `read_image` 读到的图片 → 自动转述
- 转述结果按 `sessionId+图片` 缓存，同会话不重复调用
- 普通文本请求零影响（直接透传，历史图片已缓存时不打扰）
- 大图自动压缩（字节或像素超限触发；mediaType 按输出字节实际检测）
- **fail-safe**：插件任何内部错误只记日志并透传，不会拖垮 harness

## 安装

两种模式（任选其一）：

```bash
# file:// 模式：不依赖 npm，复制到 ~/.dsh/plugins/vision-router/
bash packages/vision-router/install.sh

# npm 模式：装入 profile node_modules，patch 引用包名（需先构建/发布）
bash packages/vision-router/install.sh --npm
```

安装后**重启 harness** 生效。卸载：`bash packages/vision-router/uninstall.sh`。

## 配置

三种方式（后者覆盖前者）：

1. 插件内置默认值
2. `cordis.patch.yml` 中 vision-router 行的 config（安装脚本生成的默认块）
3. **DSH 设置页 → 插件配置 → 识图降级**（保存到 `~/.dsh/plugins/vision-router/config.json`，
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
