# dsh-plugins — DSH host 层插件集

两个 DSH（DeepSeek Harness）host 层全局插件的 npm 包（monorepo）：

| 包 | 功能 |
|---|---|
| `@dsh-plugins/vision-router` | 识图自动降级：纯文本模型收到图片时自动调用视觉模型转述 |
| `@dsh-plugins/sandbox-extra-roots` | 沙盒额外允许写入目录（Seatbelt/bwrap/Landlock + fs fence） |

每个包同时提供：

- **host 插件**（`lib/`，纯 ESM，随 harness 加载）
- **client 插件**（`client/client.cjs`，`window.__ModuleLoader__.load` 格式，无需构建）——
  在 DSH 设置页「插件配置」标签注册配置卡片
- **远程配置服务**：设置页 UI 通过 `ctx.remote.<svc>` 读写配置，
  持久化到 `~/.dsh/plugins/<name>/config.json`，保存后**热生效**（无需重启）
- **双模式安装脚本**：`install.sh`（file:// 部署，不依赖 npm）与 `install.sh --npm`

## 目录结构

```
packages/
├── vision-router/            # @dsh-plugins/vision-router
│   ├── lib/index.mjs         # host 插件（转述路由 + 压缩 + 配置网关）
│   ├── lib/config-store.mjs  # 配置持久化（config.json）
│   ├── lib/remote.mjs        # TypertRemoteService（无装饰器语法的手动标记）
│   ├── client/client.cjs     # 设置页配置卡片（浏览器端）
│   └── install.sh / uninstall.sh
└── sandbox-extra-roots/      # @dsh-plugins/sandbox-extra-roots（同上结构）
```

## 开发

`@deepseek-ai/*` 包不在公共 npm registry（内部发布），本地开发用链接：

```bash
bash scripts/link-deps.sh   # 把全局安装的 @deepseek-ai 链接到 node_modules
npm test                    # 运行 scripts/test.mjs（config-store / remote / 两个 host 插件回归）
```

## 发布

```bash
cd packages/vision-router && npm publish
cd ../sandbox-extra-roots && npm publish
```

发布后用户安装：

```bash
# 安装到 dsh profile（npm 模式，patch 引用包名）
cd ~/.dsh/profiles/web
npm install @dsh-plugins/vision-router @dsh-plugins/sandbox-extra-roots
bash packages/<name>/install.sh --npm --profile web   # 或手动在 cordis.patch.yml insert 包名
```

> 注：client bundle 依赖 dsh 浏览器端模块（react、dsh-client-ui-slots 等），
> 由 host 的 `__ModuleLoader__` 提供，包内无需声明。
