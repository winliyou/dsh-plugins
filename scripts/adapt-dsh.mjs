// DSH 宿主升级适配：一条命令改齐所有 `@deepseek-ai/dsh-*` 依赖 range 与
// pnpm-workspace.yaml 里 minimumReleaseAgeExclude 清单的版本号。
// 用法：node scripts/adapt-dsh.mjs <新宿主版本> [--dry-run]
//   例：node scripts/adapt-dsh.mjs 0.1.2-alpha.4
//
// 覆盖范围：根 package.json 与 packages/*/package.json 的 dependencies /
// optionalDependencies / devDependencies / peerDependencies。@deepseek-ai/cordis、
// schemastery 等非 dsh-* 包不在范围内（独立版本线，另行手工升级）。
//
// 脚本不做的事（按 RELEASING.md 手工完成）：
//   - 升各包版本号、写 CHANGELOG（发布决策，不属于依赖适配）
//   - pnpm install 重新生成 lockfile（需要网络）
//   - 新引入 dsh 子依赖时向 exclude 清单补行（脚本只改写已有行的版本号）

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const version = args.find((a) => !a.startsWith("--"));
if (!version || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  console.error("用法: node scripts/adapt-dsh.mjs <版本> [--dry-run]    例: 0.1.2-alpha.4");
  process.exit(2);
}

const DEP_PREFIX = "@deepseek-ai/dsh-";
const SECTIONS = ["dependencies", "optionalDependencies", "devDependencies", "peerDependencies"];

function adaptPackageJson(path) {
  const rel = relative(ROOT, path);
  const json = JSON.parse(readFileSync(path, "utf8"));
  const changes = [];
  for (const section of SECTIONS) {
    const deps = json[section];
    if (!deps) continue;
    for (const name of Object.keys(deps)) {
      if (name.startsWith(DEP_PREFIX) && deps[name] !== `^${version}`) {
        changes.push([section, name, deps[name]]);
        deps[name] = `^${version}`;
      }
    }
  }
  if (changes.length === 0) return;
  for (const [section, name, from] of changes) {
    console.log(`  ${rel} [${section}] ${name}: ${from} → ^${version}`);
  }
  if (!dryRun) writeFileSync(path, JSON.stringify(json, null, 2) + "\n");
}

// 逐行改写 minimumReleaseAgeExclude 清单里的版本号；离开清单（遇到下一个
// 顶级键）即停。注释与空行原样保留。
function adaptWorkspaceYaml() {
  const path = join(ROOT, "pnpm-workspace.yaml");
  const lines = readFileSync(path, "utf8").split("\n");
  let inExcludes = false;
  let count = 0;
  const out = lines.map((line) => {
    if (/^minimumReleaseAgeExclude:/.test(line)) {
      inExcludes = true;
      return line;
    }
    if (!inExcludes) return line;
    const m = line.match(/^(\s*-\s*'[^']+@)[^']+(')\s*$/);
    if (m) {
      count++;
      return `${m[1]}${version}${m[2]}`;
    }
    if (line.trim() === "" || line.trim().startsWith("#")) return line;
    inExcludes = false;
    return line;
  });
  if (count > 0) {
    console.log(`  pnpm-workspace.yaml [minimumReleaseAgeExclude] ${count} 项 → @${version}`);
    if (!dryRun) writeFileSync(path, out.join("\n"));
  }
}

console.log(`适配 DSH 宿主 ${version}${dryRun ? "（dry-run，不写入）" : ""}:`);
adaptPackageJson(join(ROOT, "package.json"));
for (const entry of readdirSync(join(ROOT, "packages"), { withFileTypes: true })) {
  if (entry.isDirectory()) adaptPackageJson(join(ROOT, "packages", entry.name, "package.json"));
}
adaptWorkspaceYaml();

console.log(dryRun ? "\n[dry-run] 未写入任何文件。" : "\n已写入。");
console.log("后续手工步骤（详见 RELEASING.md）:");
console.log("  1. 升相关包 package.json 的 version，并在 CHANGELOG.md 记录本次适配");
console.log("  2. pnpm install 重新生成 lockfile");
console.log("  3. pnpm run test:ci 验证后提交推送");
