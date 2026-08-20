// 全仓构建：每包 tsc 编译 src/ → lib/，esbuild 打包 client/index.tsx → client/client.cjs
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGES = ["vision-router", "sandbox-extra-roots", "adaptive-perf", "session-archive"];

function tsc(pkgDir) {
  execFileSync("tsc", ["-p", join(pkgDir, "tsconfig.json")], { stdio: "inherit", cwd: ROOT });
}

async function buildClient(pkgDir, pkgName, pkgId) {
  const result = await build({
    entryPoints: [join(pkgDir, "client", "index.tsx")],
    bundle: true,
    format: "cjs",
    platform: "browser",
    target: ["es2020"],
    external: ["react"],
    write: false,
  });
  const body = result.outputFiles[0].text;
  const wrapped = `window.__ModuleLoader__.load({
  id: ${JSON.stringify(pkgId)},
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
${body
  .split("\n")
  .map((line) => "    " + line)
  .join("\n")}
    return module.exports;
  }
});
`;
  if (!wrapped.includes("window.__ModuleLoader__.load")) {
    throw new Error(`client bundle for ${pkgName} is missing the __ModuleLoader__ wrapper`);
  }
  writeFileSync(join(pkgDir, "client", "client.cjs"), wrapped);
}

for (const pkg of PACKAGES) {
  const pkgDir = join(ROOT, "packages", pkg);
  const pkgJson = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
  tsc(pkgDir);
  await buildClient(pkgDir, pkg, pkgJson.name);
  console.log(`built ${pkg}`);
}
