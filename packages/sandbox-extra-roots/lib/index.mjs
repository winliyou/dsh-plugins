/**
 * sandbox-extra-roots — 沙盒额外允许目录插件（@dsh-plugins/sandbox-extra-roots，host 层）
 *
 * 目标:在不修改全局安装、不替换任何配置行的情况下,给 dsh 沙盒的
 * workspace-write 模式增加"额外允许写入的目录"列表(工具缓存目录等)。
 *
 * 实现(沿用 vision-router 的成熟范式:包装服务实例方法,幂等、可卸载):
 *   1. 包装 ctx.sandbox(本地沙盒 provider 实例)的 confine:
 *      - Seatbelt(macOS):把官方 SBPL profile(工作区根 + /tmp + 平台
 *        临时目录)替换为"官方白名单 + 配置的额外目录"版本;
 *      - bwrap(Linux):在 "--" 分隔符前插入 "--bind <root> <root>"
 *        (bwrap 后挂载覆盖 "--ro-bind / /",等价于追加可写根);
 *      - Landlock(Linux):在 "--" 分隔符前插入 "--rw <root>";
 *      - Windows ACL runner:argv 层面无法追加额外根目录(官方 runner
 *        只认 --workspace/--temp/--write-sid),仅记录一次告警,
 *        bash 侧不生效(fs fence 侧仍生效)。
 *   2. 包装 ctx.fs(沙盒文件系统实例)的 checkedTarget:
 *      workspace-write 模式下,目标路径若落在额外目录内则放行(返回
 *      规范化后的 fresh target,与官方语义一致);否则委托原实现
 *      (保持官方的拒绝文本与 FS_SANDBOX_DENIED)。
 *   3. 幂等与热切换:共享状态挂在底层实例的私有 symbol 上,按"挂载点
 *      引用计数"管理——每次 apply 计数 +1(已包装则跳过安装,但配置
 *      刷新到共享状态,热更新立即生效);卸载时计数 -1,只有最后一个
 *      挂载点退出才还原。这样 loader 热切换(新 entry 先 apply、旧
 *      entry 后 dispose)时包装不会丢失。
 *
 * 官方白名单始终保留(workspace 根 + /tmp + 平台临时目录),额外目录只是追加。
 *
 * 配置:cordis.patch.yml 的 config 与
 *      ~/.dsh/plugins/sandbox-extra-roots/config.json(设置页 UI,权威)合并。
 */

import { isAbsolute } from "node:path";
import { canonicalPath, isPathUnder, landlock, seatbeltProfileArgs, writableRoots } from "./common.mjs";
import { createConfigStore } from "./config-store.mjs";

// remote 服务（设置页 UI 的配置读写）可选：typert-protocol 不可用时
// 动态 import 失败，核心功能（沙盒包装）照常工作。
let PluginConfigGateway = null;
try {
  ({ PluginConfigGateway } = await import("./remote.mjs"));
} catch (error) {
  console.warn("sandbox-extra-roots: settings gateway unavailable: " + (error && error.message || error));
}

export const name = "sandbox-extra-roots";

export const inject = ["sandbox", "fs", "sandboxPolicy"];

/** 默认配置。apply 时与 YAML 传入的 config 合并(cordis 不合并小写 config 导出)。 */
const DEFAULT_CONFIG = {
  extraWritableRoots: []
};

export const config = { ...DEFAULT_CONFIG };

/** 包装状态标记:挂在被包装的底层实例上,保证幂等与跨挂载点共享。 */
const STATE = Symbol("sandbox-extra-roots.state");
/** 取底层实例(与 vision-router 一致;sandbox/fs 通常就是 raw,防御性写法)。 */
const ORIGINAL = Symbol.for("cordis.original");

/** Landlock runner 可执行路径(仅在 Linux 上被选中;解析失败时置 null)。 */
const LANDLOCK_EXEC = (() => {
  try { return landlock.launcherPath(); } catch { return null; }
})();

export function apply(ctx, config) {
  // fail-safe:初始化失败只记录,绝不让本插件拖垮 harness(host 层挂载时
  // entry 异常会导致进程启动失败)。
  try {
    const patchConfig = config || {};
    const rawSandbox = ctx.sandbox[ORIGINAL] ?? ctx.sandbox;
    const rawFs = ctx.fs[ORIGINAL] ?? ctx.fs;

    // 共享状态(跨挂载点):计数 + 包装句柄 + 当前生效的额外目录。
    const sandboxState = rawSandbox[STATE] ?? (rawSandbox[STATE] = {
      mounts: 0,
      extraRoots: [],
      installed: null,
      hadOwn: false,
      origConfine: null,
      wrapped: false,
      warned: new Set(),
      checkedProfile: false
    });
    sandboxState.mounts += 1;

    const fsState = rawFs[STATE] ?? (rawFs[STATE] = {
      mounts: 0,
      extraRoots: [],
      installed: null,
      hadOwn: false,
      origCheckedTarget: null,
      wrapped: false
    });
    fsState.mounts += 1;

    // 配置存储:patch config 低优先级,config.json(设置页 UI)权威。
    // 热更新:onUpdate 里同步刷新两个 state 的 extraRoots。
    const store = createConfigStore({
      name: "sandbox-extra-roots",
      defaults: DEFAULT_CONFIG,
      patchConfig,
      onUpdate: (merged) => {
        sandboxState.extraRoots = normalizeRoots({ ...DEFAULT_CONFIG, ...patchConfig, ...merged });
        fsState.extraRoots = sandboxState.extraRoots;
      }
    });
    const cfg = store.effective();

    // 远程配置服务(设置页 UI 读写；typert 不可用时跳过)
    if (PluginConfigGateway !== null) {
      ctx.plugin(PluginConfigGateway, { store, serviceKey: "sandboxExtraRootsConfig" });
    }

    // 只接受绝对路径:相对路径/空值会破坏词法包含判断,直接拒绝并告警。
    function normalizeRoots(c) {
      return (c.extraWritableRoots ?? [])
        .filter((root) => {
          if (typeof root === "string" && root.length > 0 && isAbsolute(root)) return true;
          ctx.logger?.warn?.(`sandbox-extra-roots: ignoring non-absolute extra writable root ${JSON.stringify(root)}`);
          return false;
        })
        .map((root) => canonicalPath(root));
    }
    sandboxState.extraRoots = normalizeRoots(cfg);
    fsState.extraRoots = sandboxState.extraRoots;

    // 卸载计数:每个挂载点(含重复 apply)都登记,最后一次退出才还原。
    ctx.effect(() => () => {
      sandboxState.mounts -= 1;
      if (sandboxState.mounts <= 0) {
        if (sandboxState.wrapped && rawSandbox.confine === sandboxState.installed) {
          if (sandboxState.hadOwn) rawSandbox.confine = sandboxState.origConfine;
          else delete rawSandbox.confine;
        }
        sandboxState.installed = null;
        sandboxState.wrapped = false;
        sandboxState.extraRoots = [];
        try { delete rawSandbox[STATE]; } catch {}
      }
      fsState.mounts -= 1;
      if (fsState.mounts <= 0) {
        if (fsState.wrapped && rawFs.checkedTarget === fsState.installed) {
          if (fsState.hadOwn) rawFs.checkedTarget = fsState.origCheckedTarget;
          else delete rawFs.checkedTarget;
        }
        fsState.installed = null;
        fsState.wrapped = false;
        fsState.extraRoots = [];
        try { delete rawFs[STATE]; } catch {}
      }
    });

    // ── 1. 包装 bash 沙盒的 confine:按 runner 追加额外可写目录 ──
    if (!sandboxState.wrapped) {
      sandboxState.hadOwn = Object.hasOwn(rawSandbox, "confine");
      const originalConfine = rawSandbox.confine;
      if (sandboxState.hadOwn) sandboxState.origConfine = originalConfine;
      const installedConfine = function confineWithExtraRoots(argv, policy) {
        const wrapped = originalConfine.call(this, argv, policy);
        if (policy?.mode !== "workspace-write") return wrapped;
        const roots = sandboxState.extraRoots;
        if (roots.length === 0) return wrapped;
        const a = wrapped.argv;
        // Seatbelt:官方 argv 为 [sandbox-exec, -p, <profile>, --, ...inner]。
        if (a[1] === "-p" && typeof a[2] === "string" && a[2].includes("(version 1)")) {
          // 漂移自检:官方 profile(空额外目录)应与本实现重建结果一致。
          if (!sandboxState.checkedProfile) {
            sandboxState.checkedProfile = true;
            try {
              const official = seatbeltProfileArgs(policy, []);
              if (official[1] !== a[2]) {
                ctx.logger?.warn?.("sandbox-extra-roots: official seatbelt profile shape changed; plugin may be stale (check common.mjs seatbeltProfileArgs against dsh-sandbox-local)");
              }
            } catch {}
          }
          wrapped.argv = [a[0], ...seatbeltProfileArgs(policy, roots), ...a.slice(3)];
          return wrapped;
        }
        // bwrap:在 -- 前插入 --bind <root> <root>(后挂载覆盖 --ro-bind / /)。
        if (a[0] === "bwrap") {
          const sep = a.indexOf("--");
          if (sep !== -1) {
            const extra = [];
            for (const root of roots) extra.push("--bind", root, root);
            wrapped.argv = [...a.slice(0, sep), ...extra, ...a.slice(sep)];
          }
          return wrapped;
        }
        // Landlock:在 -- 前插入 --rw <root>(runner 原生参数)。
        if (LANDLOCK_EXEC !== null && a[0] === LANDLOCK_EXEC) {
          const sep = a.indexOf("--");
          if (sep !== -1) {
            const extra = [];
            for (const root of roots) extra.push("--rw", root);
            wrapped.argv = [...a.slice(0, sep), ...extra, ...a.slice(sep)];
          }
          return wrapped;
        }
        // Windows ACL runner:argv 层面无法追加额外根目录,仅告警一次。
        if (a.includes("--workspace")) {
          if (!sandboxState.warned.has("windows-acl")) {
            sandboxState.warned.add("windows-acl");
            ctx.logger?.warn?.("sandbox-extra-roots: windows-acl runner cannot grant extra writable roots; bash-side extra roots are not granted on Windows (the fs fence still grants them)");
          }
          return wrapped;
        }
        return wrapped;
      };
      rawSandbox.confine = installedConfine;
      sandboxState.installed = installedConfine;
      sandboxState.wrapped = true;
    }

    // ── 2. 包装文件系统 fence 的 checkedTarget:额外目录放行 ──
    if (!fsState.wrapped) {
      fsState.hadOwn = Object.hasOwn(rawFs, "checkedTarget");
      const originalCheckedTarget = rawFs.checkedTarget;
      if (fsState.hadOwn) fsState.origCheckedTarget = originalCheckedTarget;
      const installedCheckedTarget = async function checkedTargetWithExtraRoots(target, sandboxPolicy) {
        const policy = sandboxPolicy ?? ctx.sandboxPolicy.resolve();
        if (policy.mode === "workspace-write") {
          const fresh = await this.resolve(target.displayPath);
          for (const root of [...writableRoots(policy), ...fsState.extraRoots]) {
            if (await isPathUnder(fresh.targetKey, root)) return fresh;
          }
        }
        return originalCheckedTarget.call(this, target, sandboxPolicy);
      };
      rawFs.checkedTarget = installedCheckedTarget;
      fsState.installed = installedCheckedTarget;
      fsState.wrapped = true;
    }
  } catch (error) {
    ctx.logger?.warn?.(`sandbox-extra-roots: init failed: ${error.message}`);
  }
}
