# 发布与分支管理（RELEASING）

本仓库是「一套插件 × 两条 DSH 宿主线」的 monorepo。本文是分支、版本号、
发布流程的唯一权威约定，README 只留速查；两者冲突时以本文为准。

## 分支模型

| 分支 | 适配的 DSH 线 | 版本号形态 | dist-tag |
|---|---|---|---|
| `main` | 稳定线（当前 `0.1.1-rc.2`） | 纯 semver（如 `0.10.1`） | `latest` |
| `alpha` | 下一条预发布线（当前 `0.1.2-alpha.x`） | `-alpha.N` 后缀（如 `0.10.2-alpha.0`） | `alpha` |

**双线并行是常态，不是过渡方案**：DSH 快速迭代期间，rc 稳定线与 alpha 预发布
线长期同时存在，两条分支各自跟随一条线持续维护。不变式只有一条：**main 的工作
树必须始终处于「可直接发布」状态**（版本号与依赖线 = npm 上 latest 的下一个
候选），任何时刻都能直接热修稳定线。分支跟随的是 **DSH 宿主线**，不是「开发/
测试」阶段；用户装到哪个版本完全由版本号后缀决定（见 dist-tag 规则），与改动
发生在哪个分支无关。

> 2026-09 已把 main 上误入的 alpha 适配内容回退（三个包依赖回 `^0.1.1-rc.2`、
> 版本号回 `0.10.1` / `0.4.3` / `0.3.3`，CHANGELOG 的 alpha 小节归还 alpha
> 分支），并补齐 rc.2 闭包的 peer devDeps（`dsh-timeout` 等——auto-install-peers
> 关闭后，`dsh-sandbox`→`dsh-llm`、`dsh-llm-pi-ai` 的 peers 需要显式声明才能
> 在测试环境解析）。

### 功能一致性原则

两条分支的**功能集保持一致**：一个功能要么两边都有，要么两边都没有。唯一
允许的代码差异是 **dsh 预发布线的破坏性 API 变更迫使的适配**（现状即
`dsh-any-connect`：dsh 0.1.2 移除了 `settingsNamespace()`、把
`installSettingsSection()` 挪到 provider 服务，分线实现不可避免）——适配只
改变「怎么接进宿主」，不改变功能本身。

由此推论：

- 功能开发默认落在活跃的 alpha 分支，完成后 cherry-pick 回 main（宿主无关的
  改动通常零冲突）；只在稳定线有意义的功能（如针对 rc.2 的修复）直接在 main
  做并反向同步。
- CHANGELOG 双记录：同一功能在两条分支各记一节，版本号按各自规则取。
- 周期性体检（每次宿主适配完成后跑一次）：

  ```bash
  # 三个无分线代码的包：预期零差异
  git diff main alpha -- packages/adaptive-perf/src packages/adaptive-perf/client
  # 有分线实现的包：预期 diff 全部是 dsh API 适配，不出现功能增删
  git diff main alpha -- packages/dsh-any-connect/src
  ```

## 版本号规则

- 遵循 semver：破坏性变更 MAJOR、新功能 MINOR、修复 PATCH。版本号只在本地
  手工修改（直接编辑各包 `package.json` 的 `version`），CI 绝不改写。
- 同一个包在两条分支上的版本号**各自独立递增**，不要求两线同步跳号。
- 预发布线发版：在 alpha 分支升 `-alpha.N` 的 N（功能级变化也可升基础版本
  号），发布到 `alpha` dist-tag；该 dsh 线进入 rc 阶段后，后缀换 `-rc.N`
  （同一基础号内递增，如 `0.10.2-alpha.2` → `0.10.2-rc.1`），dist-tag 自动
  变为 `rc`。
- 正式版永远取**下一个未被任何线占用**的正式号：`0.10.2-alpha.0` 的正式化
  版本是 `0.10.2`（semver 中正式版大于同号预发布版）；若该号已被另一条线
  占用，取下一位。
- `dsh-any-connect` 特别注意：main 的 `0.3.1` 与 alpha 的 `0.3.1-alpha.0`
  **内容相同、仅宿主依赖线不同**（版本倒挂，`0.3.1-alpha.0 < 0.3.1`）。alpha
  线从这里继续递增：下一个版本用 `0.3.1-alpha.1`，而不是 `0.3.2-alpha.0`
  ——基础号与 main 的 `0.3.1` 保持同源，直到两线内容真正分叉。

## dist-tag 规则

版本后缀自动决定 dist-tag（`scripts/publish-gate.mjs` 派生）：`-alpha.N` →
`alpha`、`-rc.N` → `rc`、`-beta.N` → `beta`、无后缀 → `latest`。安装：
`npm install <pkg>` 拿正式版，`npm install <pkg>@alpha` 拿预发布线。

## 日常发布流程

1. 在目标分支改代码，为每个受影响的包：
   - 在 `CHANGELOG.md` 顶部新增 `## <版本> (YYYY-MM-DD)` 小节——GitHub
     Release 说明自动取自这里（`scripts/release-notes.mjs`），不写就没有说明；
   - 升 `package.json` 的 `version`。
2. 改了依赖就 `pnpm install`；然后 `pnpm run test:ci`。
3. 提交推送。CI（`.github/workflows/publish.yml`）自动执行：测试 → 状态式
   门禁 → 发布 → 打 git tag `<目录>-v<版本>` → 创建 GitHub Release。

发布门禁（`scripts/publish-gate.mjs`）的判定，按每个包依次：

| 状态 | 结果 |
|---|---|
| git tag `<目录>-v<版本>` 已存在 | 静默跳过（已发布并归档，重跑幂等的保证） |
| npm 上无该版本 | 发布 |
| npm 上已有该版本、但无 git tag | 警告跳过（tag 机制上线前的历史版本） |
| npm 上已有**更高**版本 | **CI 失败**（改了代码没升版本号从此是红灯，不再是静默跳过） |

发布中途失败：直接重跑整个 job。已发布的包被 git tag 跳过（tag 在发布成功
后才打），未完成的继续，不会重复发布。

## 跨分支同步

同步的目标是维持功能一致性原则：功能差异零容忍，宿主适配差异才合法。

- **与宿主版本无关**的修复/功能：在 alpha 开发，cherry-pick 回 main（或反向）。
  只搬 `src/`、`client/`、`CHANGELOG.md` 和 `package.json` 里与依赖无关的字段；
  **依赖 range 与 `pnpm-lock.yaml` 永不跨分支搬运**——到达目标分支后按该线的
  宿主版本核对依赖，`pnpm install` 重新生成 lockfile。两分支的 lockfile 差异
  巨大，跨分支 merge 它们必然冲突。
- **基础设施文件**（`.github/workflows/`、`scripts/`、`RELEASING.md`、根
  `package.json`、`.npmrc`）：两分支保持一致，直接 cherry-pick，不手改。
- `pnpm-workspace.yaml` 两分支内容不同（`minimumReleaseAgeExclude` 清单各自
  跟随自己的宿主线；稳定线的官方包都超过发布时长门槛、无需清单），cherry-pick
  基建提交时跳过该文件。

## DSH 宿主升级适配

DSH 发新预发布版（如 `0.1.2-alpha.4`）后，在 alpha 分支：

```bash
node scripts/adapt-dsh.mjs 0.1.2-alpha.4   # 改全部 @deepseek-ai/dsh-* range + exclude 清单
pnpm install                                # 重新生成 lockfile
# 对照新宿主的 diff 复核用到的契约（参照历史 CHANGELOG 的记录方式），
# 升版本号、写 CHANGELOG，然后：
pnpm run test:ci && git push
```

`adapt-dsh.mjs` 支持 `--dry-run` 预览；它只改写已有依赖行，新引入的 dsh 子
依赖需要手工向 exclude 清单补行。稳定线（main）跟进新的 rc（如 `0.1.1-rc.3`）
时同样在 main 上执行同一流程；稳定线无需维护排除清单。

## 双线生命周期（常态循环）

1. **dsh 出新预发布线**：alpha 分支执行「DSH 宿主升级适配」流程，以
   `-alpha.N` 版本发布到 `alpha` dist-tag。main 不动，继续服务稳定线。
2. **预发布线进入 rc**：dsh 发 `0.1.2-rc.1` 时仍在 alpha 分支适配，版本后缀
   换成 `-rc.N`，发布到 `rc` dist-tag。
3. **dsh 转正**：在 alpha 分支把各包版本号改为正式号（按版本号规则取号），
   `git checkout main && git merge alpha`——此刻两线目标宿主相同，可以合并；
   `pnpm-lock.yaml` 冲突任取一边后 `pnpm install` 重新生成。在 main 上推送
   发布 `latest`，然后 `git checkout alpha && git merge main` 对齐两分支，
   等待 dsh 的下一条预发布线。
4. **循环**：dsh 出下一条预发布线，回到第 1 步。若某个时期同时活跃的宿主线
   超过两条（如 `0.1.2-rc` 与 `0.1.3-alpha` 并行），照同样模型再拉一条分支
   即可——分支数跟随活跃宿主线数，dist-tag 始终由版本后缀决定、与分支名无关。

## 手动兜底

CI 失败或需要立即发布时：`cd packages/<pkg> && pnpm publish --access public
--no-git-checks --tag <dist-tag>`（本地需 npm 登录；CI 走 OIDC Trusted
Publishing）。之后手工补归档，否则门禁不认识这个版本：
`git tag <目录>-v<版本> && git push origin <目录>-v<版本>`；GitHub Release
在网页上补，说明用 `node scripts/release-notes.mjs <目录> <版本>` 生成。

## 一次性设置建议

在 GitHub → Settings → Branches 给 `main` 与 `alpha` 开分支保护（要求
"Publish to npm" / "Test" check 通过）。本仓库是 push 即发布（npm Trusted
Publishing），分支保护能拦住误推直接进 npm。
