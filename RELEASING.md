# 发布与分支管理（RELEASING）

本仓库是「一套插件 × 两条 DSH 宿主线」的 monorepo。本文是分支、版本号、
发布流程的唯一权威约定，README 只留速查；两者冲突时以本文为准。

## 分支模型

| 分支 | 适配的 DSH 线 | 版本号形态 | dist-tag |
|---|---|---|---|
| `main` | 稳定线（当前 `0.1.1-rc.2`） | 纯 semver（如 `0.10.1`） | `latest` |
| `alpha` | 预发布线（当前 `0.1.2-alpha.x`） | `-alpha.N` 后缀（如 `0.10.2-alpha.0`） | `alpha` |

分支跟随的是 **DSH 宿主线**，不是「开发/测试」阶段。用户装到哪个版本完全由
版本号后缀决定（见 dist-tag 规则），与改动发生在哪个分支无关——所以 main 上
出现 `-alpha.N` 版本不会污染 `latest`，只是意味着该包的稳定线源码暂时停在
上一个正式版本。

### 历史遗留的一次性状态（2026-09 记录）

`0.10.2-alpha.0`（adaptive-perf）/ `0.4.4-alpha.0`（sandbox-extra-roots）/
`0.3.4-alpha.0`（session-archive）这三个 alpha 适配是在双分支拆分（86cbdf5）
之前的共同历史（dba42b3）里完成并发布的，因此 **main 的工作树在这三个包上与
alpha 分支一致、版本号带 `-alpha.N` 后缀**。这不影响正确性（后缀决定
dist-tag），但意味着在 DSH `0.1.2` 转正、alpha 线内容晋升（见「正式化」）之前，
main 工作树不能直接用来给稳定线用户发 patch 版本。稳定线若确需热修：把该包的
`@deepseek-ai/dsh-*` 依赖 range 临时改回 `^0.1.1-rc.2`，`pnpm install` 后再改
代码、升 patch 号发布。

## 版本号规则

- 遵循 semver：破坏性变更 MAJOR、新功能 MINOR、修复 PATCH。版本号只在本地
  手工修改（直接编辑各包 `package.json` 的 `version`），CI 绝不改写。
- 同一个包在两条分支上的版本号**各自独立递增**，不要求两线同步跳号。
- alpha 线发版：在 alpha 分支升 `-alpha.N` 的 N（功能级变化也可升基础版本
  号），发布到 `alpha` dist-tag。
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

- **与宿主版本无关**的修复/功能：在 alpha 开发，cherry-pick 回 main（或反向）。
  只搬 `src/`、`client/`、`CHANGELOG.md` 和 `package.json` 里与依赖无关的字段；
  **依赖 range 与 `pnpm-lock.yaml` 永不跨分支搬运**——到达目标分支后按该线的
  宿主版本核对依赖，`pnpm install` 重新生成 lockfile。两分支的 lockfile 差异
  巨大，跨分支 merge 它们必然冲突。
- **基础设施文件**（`.github/workflows/`、`scripts/`、`RELEASING.md`、根
  `package.json`、`.npmrc`）：两分支保持一致，直接 cherry-pick，不手改。
- `pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude` 清单跟随各分支自己的
  宿主线，由 `scripts/adapt-dsh.mjs` 维护，同样不跨分支搬运。

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
依赖需要手工向 exclude 清单补行。

## 正式化（DSH 0.1.2 转正时）

1. 在 alpha 分支把各包版本号改为正式号（按版本号规则取号），推送——发布到
   `latest`，预发布线用户自动跟进。
2. `git checkout main && git merge alpha`：此时两线目标宿主相同，可以合并；
   `pnpm-lock.yaml` 冲突就任取一边后 `pnpm install` 重新生成。合并后 main
   回到「工作树 = latest 源码」的正常状态。
3. DSH 出下一条预发布线时，再从 main 拉出新的适配分支。

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
