// DSH 宿主跟随状态核对：对比 npm 上 @deepseek-ai/dsh 的 dist-tags 与两条
// 分支实际的 dsh-* 依赖基线，报告谁落后、谁漂移。
//
// 分支模型（RELEASING.md「宿主跟随规则」）：
//   main  ↔ dsh 的 `latest` dist-tag（稳定线）
//   alpha ↔ dsh 的 `alpha` dist-tag（预发布线；range 以该版本为基线，
//           semver 上 ^X.Y.Z-alpha.N 天然向上覆盖同段 rc/正式版）
//
// 用法：node scripts/dsh-follow-status.mjs [--ci]
//   --ci  落后/漂移时输出 GitHub Actions `::warning::` annotation
//         （非阻塞，永远 exit 0——这是提醒，不是门禁）。
//
// 本脚本只读：不改任何文件、不 install、不发布。

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ci = process.argv.includes("--ci");
const DEP_PREFIX = "@deepseek-ai/dsh-";
const SECTIONS = ["dependencies", "optionalDependencies", "devDependencies", "peerDependencies"];

/** 解析 dsh 版本号为可比较结构（0.1.2-alpha.5 → {n:[0,1,2], pre:["alpha",5]}）。 */
function parseVersion(v) {
  const [core, pre = ""] = v.split("-");
  const [major, minor, patch] = core.split(".").map(Number);
  const preParts = pre === "" ? [] : pre.split(".").map((p) => (/^\d+$/.test(p) ? Number(p) : p));
  return { n: [major, minor, patch], pre: preParts };
}

function cmpVersion(a, b) {
  const A = parseVersion(a);
  const B = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (A.n[i] !== B.n[i]) return A.n[i] - B.n[i];
  }
  if (A.pre.length === 0 && B.pre.length === 0) return 0;
  // 无 prerelease 的一版更大
  if (A.pre.length === 0) return 1;
  if (B.pre.length === 0) return -1;
  for (let i = 0; i < Math.max(A.pre.length, B.pre.length); i++) {
    const x = A.pre[i];
    const y = B.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const bothNumeric = typeof x === "number" && typeof y === "number";
    if (bothNumeric) return x - y;
    // semver：数字 identifier 小于字符串 identifier
    if (typeof x === "number") return -1;
    if (typeof y === "number") return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

/** 从一个 package.json 对象提取 dsh-* 依赖基线的 Set（去 ^ 前缀后的版本）。 */
function dshBaselines(manifest) {
  const baselines = new Set();
  for (const section of SECTIONS) {
    const deps = manifest[section];
    if (!deps) continue;
    for (const [name, range] of Object.entries(deps)) {
      if (!name.startsWith(DEP_PREFIX)) continue;
      const m = /^\^([0-9][^\s]*)$/.exec(range);
      if (m === null) {
        baselines.add(`(非 ^ range: ${range})`);
        continue;
      }
      baselines.add(m[1]);
    }
  }
  return baselines;
}

/** 解析分支名到可 git show 的引用：CI 的 checkout 只有 origin/<branch>
 *  远端引用而没有本地分支，本地恰好相反的场景也存在——两者按序回退。 */
function branchRef(branch) {
  for (const ref of [`origin/${branch}`, branch]) {
    try {
      execFileSync("git", ["rev-parse", "--verify", "--quiet", ref], { cwd: ROOT });
      return ref;
    } catch {}
  }
  return branch;
}

/** 读某分支的全部 package.json 基线并聚合成单一基线（应全仓一致）。 */
function branchBaseline(ref) {
  const resolved = ref === null ? null : branchRef(ref);
  const read = (path) => {
    if (resolved === null) return JSON.parse(readFileSync(join(ROOT, path), "utf8"));
    return JSON.parse(execFileSync("git", ["show", `${resolved}:${path}`], { cwd: ROOT, encoding: "utf8" }));
  };
  const paths = ["package.json", ...readdirSync(join(ROOT, "packages"), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => `packages/${e.name}/package.json`)];
  const all = new Set();
  for (const p of paths) {
    for (const b of dshBaselines(read(p))) all.add(b);
  }
  if (all.size > 1) return { baseline: `[不一致: ${[...all].join(" / ")}]`, mixed: true };
  return { baseline: [...all][0] ?? "(无 dsh 依赖)", mixed: false };
}

function currentBranch() {
  if (process.env.GITHUB_REF_NAME) return process.env.GITHUB_REF_NAME;
  return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
}

const distTags = JSON.parse(execFileSync("npm", ["view", "@deepseek-ai/dsh", "dist-tags", "--json"], { encoding: "utf8" }));
const head = currentBranch();
const other = head === "main" ? "alpha" : "main";
const expectedTag = { main: distTags.latest, alpha: distTags.alpha };

const rows = [];
for (const branch of ["main", "alpha"]) {
  const { baseline, mixed } = branchBaseline(branch === head ? null : branch);
  const tag = expectedTag[branch];
  const cmp = mixed ? NaN : cmpVersion(baseline, tag);
  const state = mixed ? "漂移(基线不一致)" : cmp === 0 ? "就位" : cmp < 0 ? "落后" : "超前于 tag";
  rows.push({ branch, baseline, tag, state, cmp });
}

console.log(`@deepseek-ai/dsh dist-tags: latest=${distTags.latest}  alpha=${distTags.alpha}`);
for (const { branch, baseline, tag, state } of rows) {
  const mark = state === "就位" ? "✔" : "✖";
  console.log(`${mark} ${branch.padEnd(5)} 依赖基线 ${baseline.padEnd(16)} ↔ dsh ${branch === "main" ? "latest" : "alpha "} ${String(tag).padEnd(16)} ${state}`);
}

let problems = 0;
for (const { branch, baseline, tag, state } of rows) {
  if (state === "就位") continue;
  problems++;
  const advice = state === "落后"
    ? `请在该分支执行 pnpm run adapt ${tag} 跟进`
    : branch === "alpha"
      ? "alpha 分支的依赖基线应以 dsh alpha dist-tag 为准（收敛期对齐后的暂替状态请尽快重建 alpha 形态，见 RELEASING.md「宿主跟随规则」）"
      : "main 分支的依赖基线应以 dsh latest 为准";
  const message = `dsh 跟随: ${branch} 分支依赖基线 ${baseline} 与 dsh ${branch === "main" ? "latest" : "alpha"} (${tag}) 不一致（${state}）。${advice}`;
  if (ci) console.log(`::warning::${message}`);
  console.log(`⚠ ${message}`);
}
process.exit(0);
