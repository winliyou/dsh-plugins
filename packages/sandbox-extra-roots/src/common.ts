/**
 * sandbox-extra-roots-common — 共享工具模块（@chaoset/sandbox-extra-roots）
 *
 * 目标:在不修改全局安装的前提下,给 dsh 沙盒的 workspace-write 模式
 * 增加"额外允许写入的目录"列表(工具缓存目录等)。
 *
 * 官方依赖惰性加载（loadPackage）：npm 模式从包内 node_modules 解析；
 * file:// 模式（~/.dsh/plugins/）从 harness 的 profile 依赖树解析。
 * 两者都解析到全局安装的同一 realpath，模块实例与 harness 一致。
 * Seatbelt SBPL profile 与 fs fence 的包含判断都在这里实现,保证
 * bash 与文件工具的白名单不漂移。
 *
 * 本模块不注册任何服务,只导出工具函数与包实例。
 */

import { createRequire } from "node:module";
import { stat } from "node:fs/promises";
import type { BigIntStats } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

function dshHome() {
  return process.env.DSH_HOME?.trim() ? resolve(process.env.DSH_HOME) : join(homedir(), ".dsh");
}

function profileAnchors() {
  const home = dshHome();
  return [
    join(home, "profiles", "web", "package.json"),
    join(home, "profiles", "tui", "package.json"),
    join(home, "profiles", "headless", "package.json"),
  ];
}

/** 加载一个官方 ESM 包。优先本包依赖树，失败后从 harness profile 解析文件
 * URL 再 import——这样 Node 20 早期版本（尚不支持 require(ESM)）也能工作，
 * 且与 harness 解析到同一 realpath、共享模块实例。 */
async function loadPackage(specifier: string): Promise<any> {
  try {
    return await import(specifier);
  } catch {}
  for (const base of profileAnchors()) {
    try {
      const resolved = createRequire(base).resolve(specifier);
      return await import(pathToFileURL(resolved).href);
    } catch {}
  }
  throw new Error(`cannot resolve ${specifier} (neither package deps nor harness profiles resolve it)`);
}

const sandbox = (await loadPackage("@deepseek-ai/dsh-sandbox")) as any;

/** @deepseek-ai/dsh-sandbox 命名空间（canonicalPath / writableRoots）。 */
export const { canonicalPath, writableRoots } = sandbox;

/** 惰性加载 @deepseek-ai/node-addon-landlock-run（仅 Linux 需要）。 */
export async function loadLandlock(): Promise<any> {
  return loadPackage("@deepseek-ai/node-addon-landlock-run");
}

/** 转义一个路径为 SBPL 字符串字面量(与官方实现一致)。 */
export function sbplString(path: string): string {
  return `"${path.replaceAll("\\", String.raw`\\`).replaceAll("\"", String.raw`\"`)}"`;
}

/**
 * 构造带额外可写目录的 Seatbelt SBPL 参数(与官方 seatbeltProfileArgs
 * 形状一致:["-p", profile])。只在 workspace-write 模式下追加额外目录;
 * read-only 与官方行为完全一致(不允许任何写入)。
 *
 * ⚠️ 官方 seatbeltProfileArgs 在 dsh-sandbox-local 的运行时导出中不存在
 * (profiles.d.ts 有声明但 lib/index.js 未导出),这里只能复制实现。
 * 升级 DSH 时请对照 @deepseek-ai/dsh-sandbox-local/lib/index.js 检查
 * 是否漂移 —— index.ts 里对每个 confine 调用做了一次"官方 profile 与
 * 本实现(空额外目录)重建结果一致性"自检,不一致会打 warn 日志。
 *
 * @param policy - 逐调用解析出的沙盒策略(mode/workspaceRoot)。
 * @param extraRoots - 已规范化的额外可写根目录列表。
 * @returns sandbox-exec 的 profile 参数。
 */
export function seatbeltProfileArgs(policy: { mode: string; workspaceRoot?: string }, extraRoots: string[]): string[] {
  const forms = [
    "(version 1)",
    "(allow default)",
    "(deny file-write*)",
    `(allow file-write* (literal ${sbplString("/dev/null")}))`
  ];
  if (policy.mode === "workspace-write") {
    const roots = [...new Set([
      ...writableRoots(policy),
      ...extraRoots
    ])];
    if (roots.length > 0) {
      forms.push(`(allow file-write* ${roots.map((root) => `(subpath ${sbplString(root)})`).join(" ")})`);
    }
  }
  return ["-p", forms.join(" ")];
}

// ── 以下为路径包含判断(从 @deepseek-ai/dsh-fs-sandbox 原样搬来,保持语义一致)──

const MISSING_CODES = new Set(["ENOENT", "ENOTDIR"]);

function isMissing(error: unknown) {
  const code = (error as NodeJS.ErrnoException).code;
  return code !== void 0 && MISSING_CODES.has(code);
}

function comparablePath(path: string, caseSensitive: boolean) {
  return caseSensitive ? path : path.toLowerCase();
}

function isLexicallyUnder(path: string, root: string, caseSensitive: boolean) {
  const comparableTarget = comparablePath(path, caseSensitive);
  const comparableRoot = comparablePath(root, caseSensitive);
  if (comparableTarget === comparableRoot) return true;
  const prefix = comparableRoot.endsWith(sep) ? comparableRoot : comparableRoot + sep;
  return comparableTarget.startsWith(prefix);
}

async function statIfPresent(path: string) {
  try {
    return await stat(path, { bigint: true });
  } catch (error) {
    if (isMissing(error)) return void 0;
    throw error;
  }
}

function sameIdentity(left: BigIntStats, right: BigIntStats) {
  return left.dev === right.dev && left.ino === right.ino;
}

/**
 * 判断规范化后的目标路径是否等于某个可写根目录或位于其下。
 * 词法快路径处理常规拼写;拼写不一致时(如大小写/别名)退化为
 * 沿祖先链比对文件系统身份。
 */
export async function isPathUnder(path: string, root: string, caseSensitive: boolean = process.platform !== "win32"): Promise<boolean> {
  if (isLexicallyUnder(path, root, caseSensitive)) return true;
  const rootInfo = await statIfPresent(root);
  if (!rootInfo) return false;
  let ancestor = path;
  while (true) {
    const ancestorInfo = await statIfPresent(ancestor);
    if (ancestorInfo && sameIdentity(ancestorInfo, rootInfo)) return true;
    const parent = dirname(ancestor);
    if (parent === ancestor) return false;
    ancestor = parent;
  }
}