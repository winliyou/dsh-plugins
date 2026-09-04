// 输出当前分支的 dsh 依赖基线（全部 @deepseek-ai/dsh-* range 的共同
// `^<版本>` 锚点，如 `0.1.2-rc.1`）。publish.yml 在 main 流水成功后用
// 它打 `dsh-v<基线>` 归档 tag（表示"该提交 = 对 dsh 此稳定版的已验证
// 适配"）；`pnpm run dsh-status` 的判定逻辑见 dsh-follow-status.mjs。
//
// 基线不一致（不同包指向不同版本）时 exit 1——那意味着适配只做了一半。

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEP_PREFIX = "@deepseek-ai/dsh-";
const SECTIONS = ["dependencies", "optionalDependencies", "devDependencies", "peerDependencies"];

const baselines = new Set();
const paths = [
  "package.json",
  ...readdirSync(join(ROOT, "packages"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `packages/${entry.name}/package.json`),
];
for (const path of paths) {
  const manifest = JSON.parse(readFileSync(join(ROOT, path), "utf8"));
  for (const section of SECTIONS) {
    const deps = manifest[section];
    if (!deps) continue;
    for (const [name, range] of Object.entries(deps)) {
      if (!name.startsWith(DEP_PREFIX)) continue;
      const m = /^\^([0-9][^\s]*)$/.exec(range);
      if (m === null) {
        console.error(`dsh-baseline: ${path} [${section}] ${name} 不是 ^<版本> 形态: ${range}`);
        process.exit(1);
      }
      baselines.add(m[1]);
    }
  }
}
if (baselines.size === 0) {
  console.error("dsh-baseline: 未找到任何 @deepseek-ai/dsh-* 依赖");
  process.exit(1);
}
if (baselines.size > 1) {
  console.error(`dsh-baseline: 依赖基线不一致: ${[...baselines].join(" / ")}`);
  process.exit(1);
}
console.log([...baselines][0]);
