# dsh-plugins — DSH host 层插件集

DSH（DeepSeek Harness）host 层全局插件的 monorepo：

| 包 | 功能 |
|---|---|
| [`@chaoset/sandbox-extra-roots`](packages/sandbox-extra-roots/) | 沙盒额外允许写入目录（Seatbelt/bwrap/Landlock + fs fence） |
| [`@chaoset/adaptive-perf`](packages/adaptive-perf/) | 极简性能自适应：标准/PTC 模式首轮按极简条件锚定，能力按需放行 |
| [`@chaoset/session-archive`](packages/session-archive/) | 归档会话管理：浏览、批量恢复或彻底删除归档会话 |
| [`@chaoset/dsh-anyconnect`](packages/dsh-anyconnect/) | 接入 WorkBuddy 桌面 App 的模型到 DSH（零配置 + 思考强度/费率显示；源自 corrinehu/dsh-workbuddy-connect 的独立分支） |

每个包都提供：

- **host 插件**（`src/` 编译为 `lib/`，纯 ESM，随 harness 加载）
- **client 插件**（`client/index.tsx` 预打包为 `client/client.cjs`，宿主直接加载）——
  配置类插件在设置页「插件配置」提供配置卡片；`session-archive` 在侧边栏提供归档面板
- **远程服务**：配置经 `ctx.remote.<svc>` 读写，持久化到 `~/.dsh/plugins/<name>/config.json`，
  保存后热生效；`session-archive` 提供 `ctx.remote.sessionArchive`（列表/详情/删除/恢复）
- **bundle patch**：自带 `cordis.patch.yml`，`dsh plugin` 安装后自动成为 profile bundle 层

## 安装

推荐用 DSH 自带的 `dsh plugin`：它会调用 pnpm 安装依赖，并把声明了 `dsh.bundle`
的包加入 `dsh.profile.bundles`，随后 DSH 应用包内 `cordis.patch.yml` 完成插件注册。

```bash
# 从 npm 安装（四个包一起）
dsh plugin --profile web add @chaoset/sandbox-extra-roots
dsh plugin --profile web add @chaoset/adaptive-perf
dsh plugin --profile web add @chaoset/session-archive
dsh plugin --profile web add @chaoset/dsh-anyconnect

# 从本地源码安装（包名换成 monorepo 子包的绝对路径）
dsh plugin --profile web add /absolute/path/to/dsh-plugins/packages/session-archive

# 卸载
dsh plugin --profile web remove @chaoset/sandbox-extra-roots
dsh plugin --profile web remove @chaoset/adaptive-perf
dsh plugin --profile web remove @chaoset/session-archive
dsh plugin --profile web remove @chaoset/dsh-anyconnect
```

其他来源：

- **GitHub**：`dsh plugin --profile web add github:owner/repo` 或 Release tarball 的
  URL。本仓库是 monorepo，子包若未提供独立仓库/Release tarball，请优先用 npm
  包名或本地路径安装。
- **镜像站**：`dsh plugin --profile web add @chaoset/session-archive --registry=https://registry.npmmirror.com`（或设置 `npm_config_registry`）。

安装后**重启 harness** 生效（或等待 DSH 对配置层变更的响应）。

> 不要只把包名写进 profile 的 `package.json`（或直接跑 `pnpm add`）：那只会安装
> 依赖，不会做 bundle 对账、不会注册 bundle 层，web boot 会报
> `pending (waiting for service: remote.xxxConfig)`。

### 给 AI agent

这些包常由 DSH agent 代为安装。直接执行 `dsh plugin ...` 命令即可，**不要手动
编辑 `cordis.patch.yml`**：

1. 确认 `dsh` 在 PATH 中、`pnpm` 可用（缺失时 `npm install -g pnpm` 或
   `corepack enable pnpm`）。
2. 确定目标 profile（默认 `web`，也可能是 `tui` / `headless` / 自定义；
   `dsh --profile web --help` 可验证）。
3. 按上面的命令安装；包未发布时用本地路径。
4. 验证：`dsh plugin --profile web list`，或
   `dsh --profile web --dump-config | grep chaoset`。
5. 重启 DSH。

### 从 DSH 源码运行 DSH 时

DSH 从源码仓库运行（不全局安装 `dsh` 与 `@deepseek-ai/*`）时，插件无需任何额外
配置：harness 启动时会把依赖闭包 symlink 镜像到 `$DSH_HOME/profiles/node_modules`，
插件加载 `@deepseek-ai/*` 官方包时优先从这里以 realpath 导入（与 harness 同一
模块实例），失败才回落插件自身依赖树。安装命令与上面相同，包名换成本地路径。

## 开发

`@deepseek-ai/*` 内部包来自公共 registry，作为根部 `devDependencies` 由 pnpm 安装
（workspace 声明在 `pnpm-workspace.yaml`，pnpm 版本由根 `package.json` 的
`packageManager` 字段锁定，Corepack 会自动匹配）：

```bash
pnpm install       # 安装依赖
pnpm run build     # 全仓构建：每包 tsc 编译 src/ → lib/，esbuild 打包 client
pnpm run typecheck # tsc --noEmit（host + client 两套 tsconfig）
pnpm run test      # vitest 回归（host 插件 / config-store / 自适应引擎等）
pnpm run test:ci   # build + test（发布前验证）
```

## 版本管理与发布

版本号遵循语义化版本：破坏性变更升 MAJOR，新功能升 MINOR，修复升 PATCH。
**版本号在本地修改**，CI 绝不改写：直接编辑各包 `package.json` 的 `version`
（或 `npm version patch`），提交并推送即可。GitHub Actions
（`.github/workflows/publish.yml`）在推送 main 且 `packages/*` 有变更时自动测试，
并按已提交的版本号发布尚未发布过的包（已存在的版本自动跳过，幂等）。

```bash
# 例：发一个 patch
(cd packages/sandbox-extra-roots && npm version patch)
(cd packages/adaptive-perf && npm version patch)
(cd packages/session-archive && npm version patch)
git add -A && git commit -m "..." && git push
```

也可手动发布单个包（CI 走的是 npm OIDC Trusted Publishing，本地手发需要自己
登录 npm）：`cd packages/<pkg> && pnpm publish --access public --no-git-checks`。
