# dsh-plugins — DSH host 层插件集

DSH（DeepSeek Harness）host 层全局插件的 npm 包（monorepo）：

| 包 | 功能 |
|---|---|
| `@dsh-plugins/vision-router` | 识图自动降级：纯文本模型收到图片时自动调用视觉模型转述 |
| `@dsh-plugins/sandbox-extra-roots` | 沙盒额外允许写入目录（Seatbelt/bwrap/Landlock + fs fence） |
| `@dsh-plugins/adaptive-perf` | 极简性能自适应：标准/PTC 模式抑制运行时上下文并按需精简工具目录 |

每个包同时提供：

- **host 插件**（`lib/`，纯 ESM，随 harness 加载）
- **client 插件**（`client/client.cjs`，`window.__ModuleLoader__.load` 格式，无需构建）——
  在 DSH 设置页「插件配置」标签注册配置卡片
- **远程配置服务**：设置页 UI 通过 `ctx.remote.<svc>` 读写配置，
  持久化到 `~/.dsh/plugins/<name>/config.json`，保存后**热生效**（无需重启）
- **DSH bundle patch**：每个包自带 `cordis.patch.yml`，通过 `dsh plugin` 安装后
  自动成为 profile bundle 层，无需手改 `cordis.patch.yml`

## 目录结构

```
packages/
├── vision-router/            # @dsh-plugins/vision-router
│   ├── lib/index.mjs         # host 插件（转述路由 + 压缩 + 配置网关）
│   ├── lib/config-store.mjs  # 配置持久化（config.json）
│   ├── lib/remote.mjs        # TypertRemoteService（无装饰器语法的手动标记）
│   ├── client/client.cjs     # 设置页配置卡片（浏览器端）
│   └── cordis.patch.yml      # bundle patch（dsh plugin 自动应用）
├── sandbox-extra-roots/      # @dsh-plugins/sandbox-extra-roots（同上结构）
└── adaptive-perf/            # @dsh-plugins/adaptive-perf（同上结构）
```

## 开发

`@deepseek-ai/*` 包不在公共 npm registry（内部发布），本地开发用链接：

```bash
bash scripts/link-deps.sh   # 把全局安装的 @deepseek-ai 链接到 node_modules
npm test                    # 运行 scripts/test.mjs（config-store / remote / host 插件回归）
```

## 发布

```bash
cd packages/vision-router && npm publish
cd ../sandbox-extra-roots && npm publish
cd ../adaptive-perf && npm publish
```

## 安装（npm 生态方式）

推荐使用 DSH 自带的 `dsh plugin` 命令安装到指定 profile。它会初始化 profile、
调用 pnpm 安装依赖，并自动把声明了 `dsh.bundle` 的包加入
`dsh.profile.bundles`，随后 DSH 会应用包内 `cordis.patch.yml` 完成插件注册。

```bash
# 安装到默认 web profile
dsh plugin --profile web add @dsh-plugins/vision-router
dsh plugin --profile web add @dsh-plugins/sandbox-extra-roots
dsh plugin --profile web add @dsh-plugins/adaptive-perf

# 指定其他 profile
dsh plugin --profile tui add @dsh-plugins/vision-router

# 卸载
dsh plugin --profile web remove @dsh-plugins/vision-router
dsh plugin --profile web remove @dsh-plugins/sandbox-extra-roots
dsh plugin --profile web remove @dsh-plugins/adaptive-perf
```

也可以直接用 pnpm 在 profile 目录操作，但 `dsh plugin` 会自动处理 bundle
激活：

```bash
cd ~/.dsh/profiles/web
pnpm add @dsh-plugins/vision-router @dsh-plugins/sandbox-extra-roots @dsh-plugins/adaptive-perf
```

### 从 npm 安装

包发布到 npm 后，直接使用包名：

```bash
dsh plugin --profile web add @dsh-plugins/vision-router
dsh plugin --profile web add @dsh-plugins/sandbox-extra-roots
dsh plugin --profile web add @dsh-plugins/adaptive-perf
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
dsh plugin --profile web add @dsh-plugins/vision-router --registry=https://registry.npmmirror.com
dsh plugin --profile web add @dsh-plugins/sandbox-extra-roots --registry=https://registry.npmmirror.com
dsh plugin --profile web add @dsh-plugins/adaptive-perf --registry=https://registry.npmmirror.com

# 或者一次性设置 registry
npm_config_registry=https://registry.npmmirror.com dsh plugin --profile web add @dsh-plugins/vision-router
```

也可以直接修改 profile 或全局 pnpm registry：

```bash
cd ~/.dsh/profiles/web
pnpm config set registry https://registry.npmmirror.com
pnpm add @dsh-plugins/vision-router @dsh-plugins/sandbox-extra-roots @dsh-plugins/adaptive-perf
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
   dsh plugin --profile web add @dsh-plugins/vision-router
   dsh plugin --profile web add @dsh-plugins/sandbox-extra-roots
   dsh plugin --profile web add @dsh-plugins/adaptive-perf
   ```
   - 如果这些包还没有发布，需要从本地源码安装，直接把包名换成对应路径：
     ```bash
     dsh plugin --profile web add /absolute/path/to/packages/vision-router
     dsh plugin --profile web add /absolute/path/to/packages/sandbox-extra-roots
     dsh plugin --profile web add /absolute/path/to/packages/adaptive-perf
     ```
   - `dsh plugin` 会自动把声明了 `dsh.bundle` 的包加入
     `dsh.profile.bundles`，并应用包内的 `cordis.patch.yml`。

4. **验证安装**
   ```bash
   dsh plugin --profile web list
   # 或查看组合后的配置里是否出现插件行
   dsh --profile web --dump-config | grep -E "vision-router|sandbox-extra-roots|adaptive-perf"
   ```

5. **启动/重启 DSH**
   ```bash
   dsh --profile web
   ```
   如果目标环境支持配置热更新，可能无需重启；否则需要重启后生效。

6. **卸载**
   ```bash
   dsh plugin --profile web remove @dsh-plugins/vision-router
   dsh plugin --profile web remove @dsh-plugins/sandbox-extra-roots
   dsh plugin --profile web remove @dsh-plugins/adaptive-perf
   ```

> 注：client bundle 依赖 dsh 浏览器端模块（react、dsh-client-ui-slots 等），
> 由 host 的 `__ModuleLoader__` 提供，包内无需声明。
