# AGENTS.md — AI 协作指引

DSH host 插件 monorepo，双分支跟随 DSH 宿主线。动手前先读
[RELEASING.md](RELEASING.md)（分支 / 版本号 / 发布流程的唯一权威约定）；
README 面向用户，面向开发者的内容以 RELEASING.md 为准。

## 分支模型

- `main` = dsh 稳定线适配（发 `latest`），工作树必须始终处于可直接发布状态，
  随时可热修；`alpha` = dsh 预发布线活跃开发线（`-alpha.N`，进入 rc 阶段换
  `-rc.N`，dist-tag 由版本后缀自动决定）。
- **功能一致性原则**：功能集两分支一致，唯一允许的代码差异是 dsh 预发布线
  破坏性 API 迫使的适配（详见 RELEASING.md 同名小节）。
- 依赖 range、`pnpm-lock.yaml`、`pnpm-workspace.yaml` 的排除清单**永不跨分支
  搬运**；基础设施文件（workflows / scripts / 根配置 / 文档）两分支保持一致，
  直接 cherry-pick。

## 常用命令

```bash
pnpm install            # 依赖安装（切分支后 lockfile 不同，记得重新 install）
pnpm run build          # tsc 编译 host + esbuild 打包 client
pnpm run typecheck      # host + client 两套 tsconfig --noEmit
pnpm run test           # vitest 回归
pnpm run test:ci        # build + typecheck + test（提交/发布前必跑）
pnpm run gate           # 发布门禁干跑：只读，看哪些包会被发布/为何被跳过
pnpm run adapt 0.1.2-alpha.4   # dsh 宿主升级适配（--dry-run 预览），详见 RELEASING.md
```

## 约定

- 版本号只在本地手工改（各包 `package.json` 的 `version`），CI 绝不改写。
  升版本必须同时补该包 `CHANGELOG.md` 的 `## <版本> (YYYY-MM-DD)` 小节
  （GitHub Release 说明自动取自这里）。
- 推送 `main` / `alpha` 即触发测试 + 发布（npm Trusted Publishing）；改动
  代码不升版本号会直接红（版本落后于 npm 的包会被门禁拒绝）。
- 提交信息用中文 + 类型前缀（`feat:` / `fix:` / `ci:` / `构建:` / `文档:`），
  与仓库现有风格一致。
- 测试环境通过 vitest 配置里的 `DSH_HOME` 与真实用户目录隔离，不要在测试里
  读写真实的 `~/.dsh`。
