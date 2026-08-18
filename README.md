# dsh-plugins — DSH host 层插件集

DSH（DeepSeek Harness）host 层全局插件的 npm 包（monorepo）：

| 包 | 功能 |
|---|---|
| `@chaoset/vision-router` | 识图自动降级：纯文本模型收到图片时自动调用视觉模型转述（转述文本附带图片来源标注） |
| `@chaoset/sandbox-extra-roots` | 沙盒额外允许写入目录（Seatbelt/bwrap/Landlock + fs fence） |
| `@chaoset/adaptive-perf` | 极简性能自适应：标准/PTC 模式抑制运行时上下文并按需精简工具目录 |
| `@chaoset/session-archive` | 归档会话管理：浏览、批量恢复或彻底删除归档会话 |

每个包都提供：

- **host 插件**（`lib/`，纯 ESM，随 harness 加载）
- **client 插件**（`client/client.cjs`，`window.__ModuleLoader__.load` 格式，无需构建）——
  配置类插件在 DSH 设置页「插件配置」注册配置卡片；`session-archive` 在侧边栏提供归档面板
- **远程服务**：配置类插件通过 `ctx.remote.<svc>` 读写配置，持久化到
  `~/.dsh/plugins/<name>/config.json`，保存后**热生效**（无需重启）；
  `session-archive` 通过 `ctx.remote.sessionArchive` 提供归档列表/详情/删除/恢复
- **DSH bundle patch**：每个包自带 `cordis.patch.yml`，通过 `dsh plugin` 安装后
  自动成为 profile bundle 层，无需手改 `cordis.patch.yml`

## 目录结构

```
packages/
├── vision-router/            # @chaoset/vision-router
│   ├── lib/index.mjs         # host 插件（转述路由 + 压缩 + 配置网关）
│   ├── lib/config-store.mjs  # 配置持久化（config.json）
│   ├── lib/remote.mjs        # TypertRemoteService（无装饰器语法的手动标记）
│   ├── client/client.cjs     # 设置页配置卡片（浏览器端）
│   └── cordis.patch.yml      # bundle patch（dsh plugin 自动应用）
├── sandbox-extra-roots/      # @chaoset/sandbox-extra-roots（同上结构）
├── adaptive-perf/            # @chaoset/adaptive-perf（同上结构）
└── session-archive/          # @chaoset/session-archive（归档面板）
```

## 开发

`@deepseek-ai/*` 内部包来自公共 registry，作为根部 `devDependencies` 由 bun 安装：

```bash
bun install              # 安装依赖（含测试用的 @deepseek-ai/dsh-typert-protocol）
bun test                 # 运行 scripts/test.mjs（config-store / remote / host 插件回归）
```

## 版本管理与发布

版本号遵循**语义化版本** `MAJOR.MINOR.PATCH`，按变更类型更新对应位：

| 变更类型 | 更新位 | 示例 |
|---|---|---|
| 破坏性更新（不兼容的 API/行为变更） | `MAJOR`（第一位） | 0.2.1 → 1.0.0 |
| 非破坏性的小功能新增 | `MINOR`（第二位） | 0.2.1 → 0.3.0 |
| bug 修复 | `PATCH`（最后一位） | 0.2.1 → 0.2.2 |

**版本号在本地修改**，CI 不会改写版本号：直接编辑各包的 `package.json`
的 `version` 字段（或 `bunx npm version <major|minor|patch>`），提交并推送即可。

```bash
# 例：发一个 patch 修复
cd packages/vision-router && bunx npm version patch
cd ../sandbox-extra-roots && bunx npm version patch
cd ../adaptive-perf && bunx npm version patch
cd ../session-archive && bunx npm version patch
git add -A && git commit -m "fix: ..." && git push
```

GitHub Actions（`.github/workflows/publish.yml`）在推送到 `main` 且
`packages/*` 有变更时自动运行测试，并**按仓库里已提交的版本号**发布尚未
发布到 npm 的包（已存在的版本自动跳过，幂等）。它只负责发布，绝不改版本号；
版本号始终以本地提交为准。

手动发布同样可以：

```bash
cd packages/vision-router && bunx npm@latest publish --access public
cd ../sandbox-extra-roots && bunx npm@latest publish --access public
cd ../adaptive-perf && bunx npm@latest publish --access public
cd ../session-archive && bunx npm@latest publish --access public
```

## 安装（npm 生态方式）

推荐使用 DSH 自带的 `dsh plugin` 命令安装到指定 profile。它会初始化 profile、
调用 pnpm 安装依赖，并自动把声明了 `dsh.bundle` 的包加入
`dsh.profile.bundles`，随后 DSH 会应用包内 `cordis.patch.yml` 完成插件注册。

```bash
# 安装到默认 web profile（0.2.1+ 才包含 web boot 修复，见下文）
dsh plugin --profile web add @chaoset/vision-router
dsh plugin --profile web add @chaoset/sandbox-extra-roots
dsh plugin --profile web add @chaoset/adaptive-perf
dsh plugin --profile web add @chaoset/session-archive

# 指定其他 profile
dsh plugin --profile tui add @chaoset/vision-router

# 卸载
dsh plugin --profile web remove @chaoset/vision-router
dsh plugin --profile web remove @chaoset/sandbox-extra-roots
dsh plugin --profile web remove @chaoset/adaptive-perf
dsh plugin --profile web remove @chaoset/session-archive
```

> **不要只把包名写进 profile 的 `package.json` 就完事。** `dsh plugin add`
> 在 `pnpm add` 之后还会做一次 bundle 对账：把声明了 `dsh.bundle` 的已安装
> 依赖追加到 `dsh.profile.bundles`。手动改 `package.json`（或直接跑 `pnpm add`）
> 只会装依赖，不会注册 host 插件行，web boot 会报
> `pending (waiting for service: remote.xxxConfig)`。
> 对账逻辑见 dsh 的 `dsh plugin` 命令（plugin 子命令 = pnpm 转发 + bundles 对账）。

也可以直接用 pnpm 在 profile 目录操作，但必须**手动**把包追加到
`dsh.profile.bundles`（或把包内 `cordis.patch.yml` 的内容写进 profile 的
`cordis.patch.yml`）：

```bash
cd ~/.dsh/profiles/web
pnpm add @chaoset/vision-router @chaoset/sandbox-extra-roots @chaoset/adaptive-perf @chaoset/session-archive
# 然后编辑 package.json，把四个包名追加进 dsh.profile.bundles
```

### 从 npm 安装

包发布到 npm 后，直接使用包名：

```bash
dsh plugin --profile web add @chaoset/vision-router
dsh plugin --profile web add @chaoset/sandbox-extra-roots
dsh plugin --profile web add @chaoset/adaptive-perf
dsh plugin --profile web add @chaoset/session-archive
```

### 从 GitHub 安装

如果某个包有独立的 Git 仓库或 Release tarball，可以使用 pnpm 支持的 GitHub/git
依赖写法：

```bash
# 从 GitHub 仓库安装（owner/repo 换成实际仓库）
dsh plugin --profile web add github:owner/repo
dsh plugin --profile web add git+https://github.com/owner/repo.git#v1.0.0

# 从 GitHub Release 的 tarball 安装
dsh plugin --profile web add https://github.com/owner/repo/releases/download/v1.0.0/vision-router.tgz
```

> 注意：当前仓库是 monorepo，子包分散在 `packages/*` 下。若要从 GitHub
> 直接安装某个子包，建议先为该子包提供独立的 Git 仓库或 Release tarball；
> 否则请优先使用 npm 包名或本地路径安装。

### 从镜像站安装

通过 pnpm 的 `--registry` 参数指定镜像源，或设置 npm/pnpm registry 环境变量：

```bash
# 使用 npmmirror 镜像安装
dsh plugin --profile web add @chaoset/vision-router --registry=https://registry.npmmirror.com
dsh plugin --profile web add @chaoset/sandbox-extra-roots --registry=https://registry.npmmirror.com
dsh plugin --profile web add @chaoset/adaptive-perf --registry=https://registry.npmmirror.com
dsh plugin --profile web add @chaoset/session-archive --registry=https://registry.npmmirror.com

# 或者一次性设置 registry
npm_config_registry=https://registry.npmmirror.com dsh plugin --profile web add @chaoset/vision-router
```

也可以直接修改 profile 或全局 pnpm registry：

```bash
cd ~/.dsh/profiles/web
pnpm config set registry https://registry.npmmirror.com
pnpm add @chaoset/vision-router @chaoset/sandbox-extra-roots @chaoset/adaptive-perf @chaoset/session-archive
```

## 给 AI Agent 的安装指引

如果你是 AI agent，请按下面的步骤操作；这些包本身就是给 DSH agent 用的，
安装时**不要手动编辑 `cordis.patch.yml`**，直接使用 `dsh plugin` 即可。

1. **确认环境**
   - `dsh` 已在 `PATH` 中；
   - `pnpm` 可用（`dsh plugin` 依赖 pnpm 管理 profile 依赖）。
   - 如果缺少 pnpm：
     ```bash
     npm install -g pnpm
     # 或
     corepack enable pnpm
     ```

2. **确定目标 profile**
   - 默认是 `web`；
   - 也可能是 `tui`、`headless` 或用户自定义 profile。
   - 可用 `dsh --profile web --help` 确认目标 profile 能启动。

3. **安装插件**
   ```bash
   dsh plugin --profile web add @chaoset/vision-router
   dsh plugin --profile web add @chaoset/sandbox-extra-roots
   dsh plugin --profile web add @chaoset/adaptive-perf
   dsh plugin --profile web add @chaoset/session-archive
   ```
   - 如果这些包还没有发布，需要从本地源码安装，直接把包名换成对应路径：
     ```bash
     dsh plugin --profile web add /absolute/path/to/packages/vision-router
     dsh plugin --profile web add /absolute/path/to/packages/sandbox-extra-roots
     dsh plugin --profile web add /absolute/path/to/packages/adaptive-perf
     dsh plugin --profile web add /absolute/path/to/packages/session-archive
     ```
   - `dsh plugin` 会自动把声明了 `dsh.bundle` 的包加入
     `dsh.profile.bundles`，并应用包内的 `cordis.patch.yml`。

4. **验证安装**
   ```bash
   dsh plugin --profile web list
   # 或查看组合后的配置里是否出现插件行
   dsh --profile web --dump-config | grep -E "vision-router|sandbox-extra-roots|adaptive-perf|session-archive"
   ```

5. **启动/重启 DSH**
   ```bash
   dsh --profile web
   ```
   如果目标环境支持配置热更新，可能无需重启；否则需要重启后生效。

6. **卸载**
   ```bash
   dsh plugin --profile web remove @chaoset/vision-router
   dsh plugin --profile web remove @chaoset/sandbox-extra-roots
   dsh plugin --profile web remove @chaoset/adaptive-perf
   dsh plugin --profile web remove @chaoset/session-archive
   ```

> 注：client bundle 依赖 dsh 浏览器端模块（react、dsh-client-ui-slots 等），
> 由 host 的 `__ModuleLoader__` 提供，包内无需声明。

## 为什么 0.2.0 会报 "web boot: … did not activate"（已在 0.2.1 修复）

DSH 客户端的 `remote.<ns>` 服务**不会自动生成**：必须由某个客户端插件用
`ctx.remote.$mount(contribution)` 显式挂载（官方 `dsh-api-remotes` 就是这么
做的）。0.2.0 只在 `dsh.client.inject` 里声明了 `remote.visionRouterConfig`
等命名空间，但没有任何代码挂载它们，于是设置页卡片插件永远
`pending (waiting for service: remote.xxxConfig)`，web boot 直接失败。

0.2.1 起每个包的 `client/client.cjs` 会先 `await ctx.remote.$mount(...)`
挂载自己的命名空间，再用 `ctx.get("remote.xxxConfig")` 取回服务（不能把
命名空间写进 `inject`：它会和自己要等的外部服务形成死锁，属性访问
`ctx.remote.xxxConfig` 也会被 cordis 以 "without inject" 拒绝）。

排查顺序：`dsh plugin --profile web list` 确认依赖已装 →
`dsh --profile web --dump-config | grep chaoset` 确认 host 行已进组合树 →
浏览器打开设置 → 插件 → 插件配置，确认三张卡片能加载配置。
