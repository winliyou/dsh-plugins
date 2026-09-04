# 发布与分支管理（RELEASING）

本仓库是「一套插件 × 两条 DSH 宿主线」的 monorepo。本文是分支、版本号、
发布流程的唯一权威约定，README 只留速查；两者冲突时以本文为准。

## 分支模型

| 分支 | 适配的 DSH 线 | 跟随的宿主版本 | 版本号形态 | dist-tag |
|---|---|---|---|---|
| `main` | DSH 稳定线（当前 `0.1.2-rc.1`） | npm `latest` | 纯 semver（如 `0.10.3`） | `latest` |
| `alpha` | DSH 进行中的 alpha 线 | 基础号高于 `latest` 的最新 `-alpha`（无则休眠） | `-alpha.N` 后缀（进入 rc 阶段换 `-rc.N`，如 `0.10.4-alpha.0`） | `alpha` / `rc` |

**双线并行是常态，不是过渡方案**：DSH 快速迭代期间，稳定线与 alpha 预发布
线长期同时存在，两条分支各自跟随一条线持续维护。不变式只有一条：**main 的工作
树必须始终处于「可直接发布」状态**（版本号与依赖线 = npm 上 latest 的下一个
候选），任何时刻都能直接热修稳定线。分支跟随的是 **DSH 宿主线**，不是「开发/
测试」阶段；用户装到哪个版本完全由版本号后缀决定（见 dist-tag 规则），与改动
发生在哪个分支无关。

### 宿主跟随规则

DSH 的发布习惯：每条版本线都是 `<基础号>-alpha.N` 迭代若干版 → 进入 rc
（即稳定候选，直接发成 `latest`）→ **该基础号就此终结**——出了稳定版就不
会有同基础号的 alpha——下一条线从一个更高基础号的 `<新基础号>-alpha.0`
重新开始（如 `0.1.2` 终结后是 `0.1.3-alpha.0`）。由此归属判据是**版本号
语义**，不是 npm dist-tag（`alpha` tag 常滞后：线进入 rc 后不再更新，而该
线已归稳定线）：

- **main 跟 `latest`（稳定线本身）**。
- **alpha 跟「基础号高于 `latest` 的进行中 `-alpha` 线」**。这样的线存在
  时，alpha 分支依赖基线锚定它的最新版；**不存在时 alpha 分支休眠**——
  基线维持上一条线的 alpha 锚点（如 `^0.1.2-alpha.5`），同基础号的
  prerelease range 向上覆盖该线全部形态（含 `latest`），无需任何改动。

配套不变式：

- **收敛期对齐的暂替语义**：「双线生命周期」第 3 步的对齐会把 main 的
  range / lockfile / exclude 清单整体带进 alpha，alpha 分支暂时处于 main
  形态。这是合法状态，但 alpha 在此状态下不得发版；恢复 alpha 形态用
  `pnpm run adapt <上一条线的 alpha 锚点>` + `pnpm install`（adapt 不比较
  新旧，重跑即重建基线与排除清单）。

核对手段：`pnpm run dsh-status`（本地随时跑，输出稳定线、进行中线与两分支
基线的对照）；CI 的 `dsh-follow.yml` 每日与 push 时自动核对，不一致发
warning（刻意非阻塞——提醒，不是门禁）。

### dsh 适配归档 tag（main 专属）

main 分支的每次 dsh 稳定版适配都会被发布流水自动归档为一个 git tag：

- **命名**：`dsh-v<dsh 版本>`（如 `dsh-v0.1.2-rc.1`），与包发布归档 tag
  （`<目录>-v<版本>`）同一模式、互不冲突——`dsh` 不是任何包的目录名。
- **时机**：publish.yml 的 main 流水成功（测试全绿 + 门禁走完）后自动打在
  触发提交上，幂等——dsh 基线没变的日常发布跳过；基线前进（跟进新稳定版）
  的首次成功流水落一个新 tag。alpha 分支**不打**：它永远追随 dsh 最新的
  alpha 线，没有按宿主版本回退的管理需求。
- **用途**：「该提交 = 对 dsh 此稳定版的已验证适配」。回退场景（如某次
  适配引入问题、或需要为旧版 dsh 维护热修）从对应 tag 拉：

  ```bash
  git checkout dsh-v0.1.2-rc.1          # 查看某次适配的代码状态
  git worktree add -b hotfix/dsh-0.1.2 dsh-v0.1.2-rc.1   # 以它为基线热修
  ```

  回退后重新发布需要按「版本号规则」把包版本跳到高于 npm 现有版本（tag
  归档的旧版本号不可复用，npm 版本不可撤回）。
- **历史说明**：tag 体系自 2026-09-05 起；更早的适配（`0.1.1-rc.2` 等）
  的提交点被历史回退与补丁打断，不做回填——需要时以提交信息定位。

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
- **版本号是全时间线，alpha 线永远是开发前沿**：一个包的下一个预发布版本必须
  高于 npm 上所有已发布版本（含稳定线）——alpha 功能稳定后合并回稳定线，去掉
  后缀即成为正式版（`0.3.2-alpha.0` → `0.3.2`）。不存在预发布版本低于稳定版
  的状态，发布门禁会强制这一点。
- 预发布线发版：在 alpha 分支升 `-alpha.N` 的 N；dsh 线进入 rc 阶段后后缀换
  `-rc.N`（同一基础号内递增，`0.10.2-alpha.2` → `0.10.2-rc.1`），dist-tag
  自动变为 `rc`。
- 稳定线热修可能占用 alpha 线正在迭代的基础号（如稳定线发了 `0.3.2` 而 alpha
  在 `0.3.2-alpha.1`）——此时 alpha 线跳到下一个基础号（`0.3.3-alpha.0`）
  继续；门禁会拒绝一切低于已发布版本的发布。
- `dsh-any-connect` 历史遗留：`0.3.1-alpha.0` / `0.3.1-alpha.1` 低于稳定线的
  `0.3.1`（旧约定产物，已发布无法撤回）。alpha 线自 `0.3.2-alpha.0` 起回归
  上述不变式，不得再发布低于稳定线的版本。

## dist-tag 规则

版本后缀自动决定 dist-tag（`scripts/publish-gate.mjs` 派生）：`-alpha.N` →
`alpha`、`-rc.N` → `rc`、`-beta.N` → `beta`、无后缀 → `latest`。安装：
`npm install <pkg>` 拿正式版，`npm install <pkg>@alpha` 拿预发布线。

## 日常发布流程

**发布门槛：功能完全实现 + 测试全绿 + dsh 测试实例真实验证通过，三者齐备
才 bump 版本并推送。** 版本一旦发到 npm 不可撤回，"发布后再验证发现问题
再发一版"会产生大量无意义的版本号（2026-09-03 单日 6+ 版本的教训）。

1. 在目标分支改代码，`pnpm run test:ci` 全绿。
2. 启动隔离测试实例（独立 `DSH_HOME` + 本地路径安装插件），在真实浏览器
   里验证功能与控制台（详见 AGENTS.md「发布纪律」）。未通过就回到 1，
   **不要 push**。
3. 验证通过后，为每个受影响的包：
   - 在 `CHANGELOG.md` 顶部新增 `## <版本> (YYYY-MM-DD)` 小节——GitHub
     Release 说明自动取自这里（`scripts/release-notes.mjs`），不写就没有说明；
   - 升 `package.json` 的 `version`（bump 是最后一步）。
4. 提交推送。CI（`.github/workflows/publish.yml`）自动执行：测试 → 状态式
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

- **工作区隔离**：`main` 与 `alpha` 用 git worktree 并存（主检出目录固定停在
  `alpha`，`.worktrees/main` 是稳定线工作树），不要在主检出目录里切分支——
  `lib/` 与 `node_modules` 不受 git 管理，切分支会残留上一条线的构建产物与
  依赖解析。进入任一工作树后先 `pnpm install`，构建产物可疑就重新 build。
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

DSH 出新高基础号的 alpha 线（如 `0.1.2` 终结后的 `0.1.3-alpha.0`）后，在
alpha 分支：

```bash
node scripts/adapt-dsh.mjs 0.1.3-alpha.0   # 改全部 @deepseek-ai/dsh-* range + exclude 清单
pnpm install                                # 重新生成 lockfile
# 对照新宿主的 diff 复核用到的契约（参照历史 CHANGELOG 的记录方式），
# 升版本号、写 CHANGELOG，然后：
pnpm run test:ci && git push
```

`adapt-dsh.mjs` 支持 `--dry-run` 预览；它按 lockfile 闭包整块重建 exclude
清单，宿主新引入的 dsh 子依赖会自动纳入。若 `pnpm install` 仍报某 dsh 包
解析不到（闭包外的新依赖），把该包手工补进清单后重试。稳定线（main）跟进
`latest` 前进（如 `0.1.1-rc.2` → `0.1.2-rc.1`）时同样在 main 上执行同一
流程；稳定线无需维护排除清单。

`adapt-dsh.mjs` 同时把每个发布包 `package.json` 的 `dsh.host` 字段改写为
目标版本——那是 npm 消费者可见的「本包适配的宿主版本」声明
（`npm view <包名> dsh.host` 可查），跟随宿主版本自动维护，无需手工改。
`dsh-follow-status.mjs` 会核对它与依赖基线的一致性，漂移即 warning。

同一命令也用于把 alpha 分支重建回休眠基线：adapt 不比较新旧、按指定版本
整块覆写，收敛期对齐后恢复 alpha 形态（见「宿主跟随规则」）就是
`node scripts/adapt-dsh.mjs <上一条线的 alpha 锚点>` + `pnpm install`。

## 双线生命周期（常态循环）

1. **dsh 出新高基础号的 alpha 线**（如 `0.1.3-alpha.0`）：alpha 分支执行
   「DSH 宿主升级适配」流程，以 `-alpha.N` 版本发布到 `alpha` dist-tag。
   main 不动，继续服务稳定线。
2. **alpha 线进入 rc**：同基础号的 rc（如 `0.1.3-rc.1`）是稳定候选，dsh
   直接发成 `latest`，**该线就此归 main 线**——main 执行「DSH 宿主升级
   适配」跟进；alpha 分支的 range 基线不动（prerelease range 向上覆盖同
   基础号的 rc），通常随即进入下面的转正/休眠流程。
3. **插件双线收敛**：在 alpha 分支把各包版本号去掉预发布后缀
   （`0.3.2-alpha.0` → `0.3.2`；若稳定线热修已占用该基础号，先跳到下一个
   基础号），然后合并回稳定线：在 `.worktrees/main` 工作树里
   `git merge alpha`——此刻两线目标宿主相同，可以合并；`pnpm-lock.yaml`
   冲突任取一边后 `pnpm install` 重新生成。在 main 上推送发布 `latest`，再
   回到 alpha 分支 `git merge main`（可 ff 时快进）对齐两分支。
4. **休眠与循环**：对齐后 alpha 暂时处于 main 形态，用
   `node scripts/adapt-dsh.mjs <已终结线的 alpha 锚点>` + `pnpm install`
   恢复休眠基线（如 `0.1.2-alpha.5`），等待 dsh 的下一条 alpha 线（基础号
   必然高于刚终结的线），回到第 1 步。若某个时期同时活跃的宿主线超过两条，
   照同样模型再拉一条分支即可——分支数跟随活跃宿主线数，dist-tag 始终由
   版本后缀决定、与分支名无关。

## 手动兜底

CI 失败或需要立即发布时：`cd packages/<pkg> && pnpm publish --access public
--no-git-checks --tag <dist-tag>`（本地需 npm 登录；CI 走 OIDC Trusted
Publishing）。之后手工补归档，否则门禁不认识这个版本：
`git tag <目录>-v<版本> && git push origin <目录>-v<版本>`；GitHub Release
在网页上补，说明用 `node scripts/release-notes.mjs <目录> <版本>` 生成。

## 分支保护（暂不开启）

当前只有仓库所有者一人提交，未开启分支保护。若未来开放协作或 PR，建议给
`main` 与 `alpha` 开保护并要求 "Publish to npm" / "Test" check 通过——本仓库
是 push 即发布（npm Trusted Publishing），保护能拦住误推直接进 npm。
