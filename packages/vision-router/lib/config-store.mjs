/**
 * config-store — 插件配置持久化
 *
 * 配置文件位于 $DSH_HOME/plugins/<name>/config.json（默认 ~/.dsh，与
 * file:// 部署模式共用）。生效顺序（后者覆盖前者）：
 *   1. 插件内置默认值（DEFAULT_CONFIG）
 *   2. cordis.patch.yml 传入的 config（安装时生成的默认块）
 *   3. config.json（设置页 UI 保存，权威）
 *
 * 保存后通过 onUpdate 回调立即热更新运行中的配置（包装闭包读共享 state）。
 * 写入采用随机临时文件 + fsync + rename，权限 0600；损坏 JSON 只告警并回退。
 */

import { randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";

/**
 * 创建配置存储。
 * @param options - { name, defaults, patchConfig, onUpdate,
 *   validate?: (partial) => void, warn?: (message) => void }
 */
export function createConfigStore(options) {
  // 与 harness 的 DSH_HOME 约定保持一致：默认 ~/.dsh，可用 $DSH_HOME 覆盖。
  const dshHome = process.env.DSH_HOME?.trim() ? resolve(process.env.DSH_HOME) : join(homedir(), ".dsh");
  const file = join(dshHome, "plugins", options.name, "config.json");
  const warn = options.warn ?? (() => {});
  let readWarningShown = false;

  function readJson() {
    try {
      if (!existsSync(file)) return {};
      const parsed = JSON.parse(readFileSync(file, "utf8"));
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        readWarningShown = false;
        return parsed;
      }
      if (!readWarningShown) {
        readWarningShown = true;
        warn(`config file ${file} must contain a JSON object; using empty config`);
      }
      return {};
    } catch (error) {
      if (!readWarningShown) {
        readWarningShown = true;
        warn(`failed to read config file ${file}: ${error?.message || error}; using empty config`);
      }
      return {};
    }
  }

  /** 当前生效配置（默认 + patch + json 合并）。 */
  function effective() {
    return { ...options.defaults, ...options.patchConfig, ...readJson() };
  }

  /** 保存部分配置到 config.json 并触发热更新，返回新的生效配置。 */
  function set(partial) {
    if (partial === null || typeof partial !== "object" || Array.isArray(partial)) {
      throw new TypeError("set expects a plain config object");
    }
    options.validate?.(partial);
    const merged = { ...readJson(), ...partial };
    mkdirSync(dirname(file), { recursive: true });

    const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
    let fd;
    try {
      fd = openSync(tmp, "w", 0o600);
      writeFileSync(fd, JSON.stringify(merged, null, 2) + "\n", "utf8");
      fsyncSync(fd);
      closeSync(fd);
      fd = void 0;
      renameSync(tmp, file);
      // POSIX 目录项持久化（Windows 上目录句柄不可打开时忽略）。
      try {
        const dir = openSync(dirname(file), "r");
        try { fsyncSync(dir); } finally { closeSync(dir); }
      } catch {}
    } catch (error) {
      if (fd !== void 0) try { closeSync(fd); } catch {}
      try { unlinkSync(tmp); } catch {}
      throw error;
    }

    const next = { ...options.defaults, ...options.patchConfig, ...merged };
    try {
      options.onUpdate?.(merged, next);
    } catch (error) {
      warn(`onUpdate failed after config save: ${error?.message || error}`);
    }
    return next;
  }

  return { file, effective, set };
}
