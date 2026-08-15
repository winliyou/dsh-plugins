/**
 * config-store — 插件配置持久化
 *
 * 配置文件位于 ~/.dsh/plugins/<name>/config.json（与 file:// 部署模式共用）。
 * 生效顺序（后者覆盖前者）：
 *   1. 插件内置默认值（DEFAULT_CONFIG）
 *   2. cordis.patch.yml 传入的 config（安装时生成的默认块）
 *   3. config.json（设置页 UI 保存，权威）
 *
 * 保存后通过 onUpdate 回调立即热更新运行中的配置（包装闭包读共享 state）。
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

/** 创建配置存储。@param options - { name, defaults, patchConfig, onUpdate } */
export function createConfigStore(options) {
  const file = join(homedir(), ".dsh", "plugins", options.name, "config.json");

  function readJson() {
    try {
      if (!existsSync(file)) return {};
      const parsed = JSON.parse(readFileSync(file, "utf8"));
      return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  /** 当前生效配置（默认 + patch + json 合并）。 */
  function effective() {
    return { ...options.defaults, ...options.patchConfig, ...readJson() };
  }

  /** 保存部分配置到 config.json 并触发热更新，返回新的生效配置。 */
  function set(partial) {
    const merged = { ...readJson(), ...(partial ?? {}) };
    mkdirSync(dirname(file), { recursive: true });
    const tmp = file + ".tmp";
    writeFileSync(tmp, JSON.stringify(merged, null, 2) + "\n", "utf8");
    renameSync(tmp, file);
    const next = { ...options.defaults, ...options.patchConfig, ...merged };
    try { options.onUpdate?.(merged, next); } catch {}
    return next;
  }

  return { file, effective, set };
}
