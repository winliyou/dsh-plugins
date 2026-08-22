import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const PACKAGES = ["sandbox-extra-roots", "adaptive-perf", "session-archive"];

// 客户端 bundle 冒烟需要 react 可解析；用 vi.mock 注入一个最小 stub，
// 这样 client/index.tsx 的 `import * as React from "react"` 会被桩替换，
// 且无需安装 react 运行时（仅类型/测试用，react 已是根 devDep，不发布）。
vi.mock("react", () => ({
  createElement: (...args: any[]) => ({ args }),
  Fragment: "fragment",
  useMemo: (fn: any) => fn(),
  useState: (init: any) => [typeof init === "function" ? init() : init, () => {}],
  useCallback: (fn: any) => fn,
  useEffect: () => {},
  useRef: () => ({ current: null }),
  default: undefined,
}));

const reactStub = {
  createElement: (...args: any[]) => ({ args }),
  Fragment: "fragment",
  useMemo: (fn: any) => fn(),
  useState: (init: any) => [typeof init === "function" ? init() : init, () => {}],
  useCallback: (fn: any) => fn,
  useEffect: () => {},
  useRef: () => ({ current: null }),
};

describe("npm bundle metadata", () => {
  for (const name of PACKAGES) {
    const pkgPath = join(ROOT, "packages", name, "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    const patchFile = join(ROOT, "packages", name, "cordis.patch.yml");
    const patch = readFileSync(patchFile, "utf8");
    const scopedName = `@chaoset/${name}`;

    it(`${name}: 声明 dsh.bundle.patch`, () => {
      expect(pkg.dsh?.bundle?.patch).toBe("./cordis.patch.yml");
    });
    it(`${name}: files 包含 cordis.patch.yml`, () => {
      expect(Array.isArray(pkg.files) && pkg.files.includes("cordis.patch.yml")).toBe(true);
    });
    it(`${name}: exports 暴露 cordis.patch.yml`, () => {
      expect(pkg.exports?.["./cordis.patch.yml"]).toBe("./cordis.patch.yml");
    });
    it(`${name}: exports 暴露 package.json（client 发现机制依赖）`, () => {
      expect(pkg.exports?.["./package.json"]).toBe("./package.json");
    });
    it(`${name}: package name 与 patch 一致`, () => {
      expect(pkg.name).toBe(scopedName);
    });
    it(`${name}: patch 文件存在并插入自身`, () => {
      expect(patch.includes("- insert:") && patch.includes(scopedName)).toBe(true);
    });
    it(`${name}: exports 指向 lib/index.js（ESM 产物）`, () => {
      expect(pkg.exports?.["."]).toBe("./lib/index.js");
    });
    it(`${name}: exports 指向 client/client.cjs`, () => {
      expect(pkg.exports?.["./client"]).toBe("./client/client.cjs");
    });
    it(`${name}: exports 指向 lib/typert.host.js`, () => {
      expect(pkg.exports?.["./typert"]).toBe("./lib/typert.host.js");
    });
  }
});

describe("两包共享实现一致性", () => {
  it("config-store/remote 两包 src 一致", () => {
    const read = (pkg: string, file: string) =>
      readFileSync(join(ROOT, "packages", pkg, "src", file), "utf8");
    for (const file of ["config-store.ts", "remote.ts"]) {
      const sb = read("sandbox-extra-roots", file);
      const ap = read("adaptive-perf", file);
      expect(sb).toBe(ap);
    }
  });
});

describe("client bundles", () => {
  const configServiceStub = {
    get: async () => ({ ok: true, value: { config: {} } }),
    set: async (partial: any) => ({ ok: true, value: partial }),
  };

  it("配置类包 settings.plugin.item 注册带 key", async () => {
    const cases: Array<[string, string]> = [
      ["sandbox-extra-roots", "sandboxExtraRootsConfig"],
      ["adaptive-perf", "adaptivePerfConfig"],
    ];
    for (const [pkg, key] of cases) {
      const mod = await import(`../packages/${pkg}/client/index.tsx`);
      const registrations: Array<{ options: any }> = [];
      const ctx = {
        slots: {
          inject: (_slot: string, fn: () => void) => { fn(); },
          register: (options: any) => registrations.push({ options }),
        },
        locale: Object.assign(() => () => "", { bind: () => () => "", register: () => {} }),
        effect: (fn: () => void) => { fn(); },
        remote: { $mount: async () => {} },
        get: (svc: string) =>
          typeof svc === "string" && svc.startsWith("remote.") ? configServiceStub : {},
      };
      await mod.apply(ctx as any);
      const item = registrations.find((r) => r.options.name === "settings.plugin.item");
      expect(item?.options.key).toBe(key);
    }
  });

  it("session-archive 侧边栏归档入口 + remote 贡献挂载", async () => {
    const mod = await import("../packages/session-archive/client/index.tsx");
    const registrations: Array<{ options: any }> = [];
    const mounted: Array<any> = [];
    const archiveServiceStub = {
      list: async () => ({ ok: true, value: { items: [] } }),
      detail: async () => ({ ok: true, value: {} }),
      delete: async () => ({ ok: true, value: { deleted: [], failed: [], removedFromArchive: 0 } }),
      unarchive: async () => ({ ok: true, value: { restored: [], removedFromArchive: 0 } }),
    };
    const ctx = {
      slots: {
        inject: (_slot: string, fn: () => void) => { fn(); },
        register: (options: any) => registrations.push({ options }),
      },
      locale: Object.assign(() => () => "", { bind: () => () => "", register: () => {} }),
      effect: (fn: () => void) => { fn(); },
      remote: { $mount: async (contribution: any) => mounted.push(contribution) },
      get: (svc: string) => (svc === "remote.sessionArchive" ? archiveServiceStub : {}),
    };
    await mod.apply(ctx as any);
    const action = registrations.find((r) => r.options.name === "sidebar.footer.action");
    expect(action !== undefined && action.options.id === "session-archive").toBe(true);
    expect(mounted.length === 1 && mounted[0].package === "@chaoset/session-archive").toBe(true);
  });
});

describe("settings namespace 注册（宿主 rc.7+ 设置页可见性）", () => {
  it("两包均导出注册函数", async () => {
    const sbNS = await import("../packages/sandbox-extra-roots/src/index.js");
    const apNS = await import("../packages/adaptive-perf/src/index.js");
    expect(typeof sbNS.registerSettingsNamespace).toBe("function");
    expect(typeof apNS.registerSettingsNamespace).toBe("function");
  });
});
