// 发布门禁：按「git tag + npm 注册表状态」判定每个包本次是否要发布，
// 取代旧的 diff 式变更检测。状态式判定不依赖推送形状（多提交推送、新分支
// 首推、force push、GitHub Release / workflow_dispatch 触发都一致），且
// 重跑天然幂等：发布中途失败后直接重跑 job，已发布的包会被跳过。
//
// 判定规则（对每个包依次）：
//   1. git tag `<目录>-v<版本>` 已存在           → 静默跳过（该版本已发布并归档）
//   2. npm 上该包不存在 / 该版本不存在           → 发布
//   3. npm 上该版本已存在                        → 警告跳过（tag 机制上线前的历史版本，
//                                                  无法区分「故意不重发」与「忘了升版本」）
//   4. npm 的同线（stable/alpha/rc…）存在更高版本 → 失败（改了代码没升版本号从此是红灯；
//                                                  任一包失败则本次不发布任何包）
//
// stdout 只输出计划 JSON（`[{"dir","name","version","tag"}]`），人类可读
// 日志全部走 stderr——workflow 里用 `PLAN=$(node scripts/publish-gate.mjs)`
// 捕获计划。dist-tag 由版本后缀派生：`0.10.2-alpha.0` → alpha、`1.2.3-rc.4`
// → rc、无后缀 → latest（纯字符串解析，不引入 semver 依赖）。

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REGISTRY = "https://registry.npmjs.org";

const PACKAGES = readdirSync(join(ROOT, "packages"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

// semver 比较（不含 build metadata）：主/次/补丁按数值比；带 prerelease 的
// 版本小于同号正式版；prerelease 标识符逐段比，数字段小于字母段，段数少的
// 是前缀、更小。语义与 npm 一致。
function compareVersions(a, b) {
  function parse(v) {
    const dash = v.indexOf("-");
    const core = dash === -1 ? v : v.slice(0, dash);
    const [maj, min, pat] = core.split(".").map(Number);
    return { maj, min, pat, pre: dash === -1 ? null : v.slice(dash + 1).split(".") };
  }
  const x = parse(a);
  const y = parse(b);
  for (const k of ["maj", "min", "pat"]) {
    if (x[k] !== y[k]) return x[k] - y[k];
  }
  if (x.pre === null && y.pre === null) return 0;
  if (x.pre === null) return 1;
  if (y.pre === null) return -1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const xi = x.pre[i];
    const yi = y.pre[i];
    if (xi === undefined) return -1;
    if (yi === undefined) return 1;
    const nx = /^\d+$/.test(xi);
    const ny = /^\d+$/.test(yi);
    if (nx && ny) {
      const d = Number(xi) - Number(yi);
      if (d) return d;
    } else if (nx) {
      return -1;
    } else if (ny) {
      return 1;
    } else if (xi !== yi) {
      return xi < yi ? -1 : 1;
    }
  }
  return 0;
}

function log(...args) {
  console.error(...args);
}

function gitTagExists(tag) {
  const r = spawnSync("git", ["tag", "-l", tag], { cwd: ROOT, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git tag -l ${tag} 失败: ${r.stderr}`);
  return r.stdout.trim() !== "";
}

// 返回 npm 上已发布的全部版本；包不存在（E404）返回空数组。其他错误（网络
// 等）直接抛出、中止整个 job——绝不吞成「未发布」，那会导致对已存在版本的
// 重发被 npm 拒绝，且环境问题本就应当中止发布。
function npmVersions(name) {
  const r = spawnSync("npm", ["view", name, "versions", "--json", `--registry=${REGISTRY}`], {
    encoding: "utf8",
  });
  if (r.status === 0) return JSON.parse(r.stdout);
  if (/E404/.test(r.stderr)) return [];
  throw new Error(`npm view ${name} 失败（非 404，疑似网络/registry 问题）:\n${r.stderr}`);
}

function distTag(version) {
  const m = version.match(/^[^-]*-([A-Za-z][A-Za-z0-9]*)/);
  return m ? m[1] : "latest";
}

// 版本所属的"线"：预发布标识（alpha/rc/beta…）或 stable。双分支模型下
// 预发布线与稳定线各自独立递增（如 alpha 线的 0.3.1-alpha.1 低于稳定线的
// 0.3.1 是文档化常态），"版本落后"只应在线内判定。
function versionLine(version) {
  return distTag(version) === "latest" ? "stable" : distTag(version);
}

// CHANGELOG 是否有该版本的小节（与 scripts/release-notes.mjs 同一判定）。
// 缺失不阻断发布，但 GitHub Release 说明会退化为占位文本，提前警告。
function changelogHasSection(dir, version) {
  const p = join(ROOT, "packages", dir, "CHANGELOG.md");
  if (!existsSync(p)) return false;
  return readFileSync(p, "utf8")
    .split("\n")
    .some((l) => l === `## ${version}` || l.startsWith(`## ${version} `));
}

const plan = [];
let failed = false;

for (const dir of PACKAGES) {
  const { name, version } = JSON.parse(readFileSync(join(ROOT, "packages", dir, "package.json"), "utf8"));

  if (gitTagExists(`${dir}-v${version}`)) {
    log(`= ${name}@${version} 已有 git tag ${dir}-v${version}，跳过（已发布并归档）`);
    continue;
  }

  const published = npmVersions(name);
  if (published.includes(version)) {
    log(`! ${name}@${version} 已在 npm 上但无 git tag（tag 机制上线前的历史版本），跳过。若这是新改动，请升版本号后再推。`);
    continue;
  }

  const line = versionLine(version);
  const newer = published.find((v) => versionLine(v) === line && compareVersions(v, version) > 0);
  if (newer) {
    log(`✗ ${name}@${version} 落后于 ${line} 线 npm 上已有的 ${newer}，拒绝发布。请升 package.json 的 version 并补 CHANGELOG。`);
    failed = true;
    continue;
  }

  log(`→ ${name}@${version} 计划发布，dist-tag: ${distTag(version)}`);
  if (!changelogHasSection(dir, version)) {
    log(`! ${name}@${version} 在 CHANGELOG.md 中没有对应小节，GitHub Release 说明将使用占位文本。`);
  }
  plan.push({ dir, name, version, tag: distTag(version) });
}

if (failed) {
  log("存在版本号落后于 npm 的包，本次不发布任何包（整体失败）。");
  process.exit(1);
}

console.log(JSON.stringify(plan));
