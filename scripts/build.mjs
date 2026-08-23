// 全仓构建：每包 tsc 编译 src/ → lib/，esbuild 打包 client/index.tsx → client/client.cjs
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// 包列表从目录派生而非硬编码:硬编码清单在增删包时必然漂移
// (vision-router 删除时就漏改过这里,导致构建直接 ENOENT)。
const PACKAGES = readdirSync(join(ROOT, "packages"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

function tsc(pkgDir) {
  execFileSync(join(ROOT, "node_modules", ".bin", "tsc"), ["-p", join(pkgDir, "tsconfig.json")], { stdio: "inherit", cwd: ROOT });
}

// tsgo/tsc 不会把 .d.ts 输入复制到 outDir，src/dsh.d.ts 里的 declare module
// 增强（ctx.sandbox/fs/sandboxPolicy/settings 等）必须并入 lib/index.d.ts
// 才能随发布产物提供给消费者。tsgo 7.0.2 拒绝在 .ts 源码里内联这些
// declare module（TS2310 自引用 / TS2664 可选依赖不可解析），因此由
// 构建脚本在 tsc 之后把 dsh.d.ts 的内容追加进 lib/index.d.ts。
const AUGMENTATION_MARKER = "// ── dsh.d.ts augmentations (appended by scripts/build.mjs) ──";
function appendDshAugmentations(pkgDir) {
  const dshDts = join(pkgDir, "src", "dsh.d.ts");
  const indexPath = join(pkgDir, "lib", "index.d.ts");
  if (!existsSync(dshDts) || !existsSync(indexPath)) return;
  const indexContent = readFileSync(indexPath, "utf8");
  if (indexContent.includes(AUGMENTATION_MARKER)) return; // 幂等:重复构建不重复追加
  // 泛查 "declare module" 会误判:tsc 输出本身可能含 declare module 块,
  // 那种情况下追加会被跳过、增强丢失。改用本脚本写入的哨兵注释判定。
  const dshContent = readFileSync(dshDts, "utf8");
  writeFileSync(indexPath, AUGMENTATION_MARKER + "\n" + dshContent.trim() + "\n\n" + indexContent);
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
  if (body.includes("window.__ModuleLoader__.load")) {
    throw new Error(`client bundle for ${pkgName} is double-wrapped`);
  }
  const wrapped = `window.__ModuleLoader__.load({
  id: ${JSON.stringify(pkgId)},
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
${body
  .split("\n")
  .map((line) => (line === "" ? line : "    " + line))
  .join("\n")}
    return module.exports;
  }
});
`;
  writeFileSync(join(pkgDir, "client", "client.cjs"), wrapped);
}

for (const pkg of PACKAGES) {
  const pkgDir = join(ROOT, "packages", pkg);
  if (!existsSync(join(pkgDir, "src"))) {
    console.log(`skipped ${pkg}: no src/`);
    continue;
  }
  const pkgJson = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
  tsc(pkgDir);
  appendDshAugmentations(pkgDir);
  if (existsSync(join(pkgDir, "client", "index.tsx"))) {
    await buildClient(pkgDir, pkg, pkgJson.name);
  }
  console.log(`built ${pkg}`);
}
