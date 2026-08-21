import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply } from "../src/index.js";
import { canonicalPath, writableRoots } from "../src/common.js";

const prevHome = process.env.HOME;
const prevDshHome = process.env.DSH_HOME;

let fakeHome: string;

beforeEach(() => {
  fakeHome = mkdtempSync(join(tmpdir(), "ser-fh-"));
  process.env.HOME = fakeHome;
  process.env.DSH_HOME = fakeHome;
});

afterEach(() => {
  process.env.HOME = prevHome;
  process.env.DSH_HOME = prevDshHome;
  rmSync(fakeHome, { recursive: true, force: true });
});

const WS = "/ws";
const EXTRA = "/tmp/extra";

function sbpl(roots: string[]): string {
  const forms = ["(version 1)", "(allow default)", "(deny file-write*)", '(allow file-write* (literal "/dev/null"))'];
  forms.push("(allow file-write* " + roots.map((r) => '(subpath "' + r + '")').join(" ") + ")");
  return forms.join(" ");
}

function makeSandboxMock() {
  return {
    confine(argv: string[], policy: any) {
      const roots = writableRoots(policy);
      return { argv: ["sandbox-exec", "-p", sbpl(roots), "--", ...argv], enforcement: "full", denialSignatures: [], runnerFailureRules: [] };
    },
  };
}

function makeFsMock() {
  return {
    async resolve(displayPath: string) { return { targetKey: displayPath }; },
    async checkedTarget(target: any) {
      throw Object.assign(new Error("FS_SANDBOX_DENIED"), { code: "FS_SANDBOX_DENIED" });
    },
  };
}

function makeCtx(sandbox: any, fs: any): any {
  return {
    sandbox,
    fs,
    sandboxPolicy: { resolve: () => ({ mode: "workspace-write", workspaceRoot: WS }) },
    logger: { warn: () => {} },
    effect(fn: () => void) { fn(); },
    plugin(Cls: any, cfg: any) {
      const saved = this.reflect;
      this.reflect = { provide: () => {}, props: {} };
      try { this.gateway = new Cls(this, cfg); } finally { this.reflect = saved; }
    },
  };
}

describe("sandbox-extra-roots host (Seatbelt)", () => {
  let sandboxMock: any;
  let fsMock: any;
  let ctx: any;

  beforeEach(async () => {
    sandboxMock = makeSandboxMock();
    fsMock = makeFsMock();
    ctx = makeCtx(sandboxMock, fsMock);
    await apply(ctx, { extraWritableRoots: [EXTRA] });
  });

  it("seatbelt 额外目录+官方根", () => {
    const out = sandboxMock.confine(["bash", "-c", "x"], { mode: "workspace-write", workspaceRoot: WS });
    expect(out.argv[2]).toContain('(subpath "/tmp/extra")');
    expect(out.argv[2]).toContain('(subpath "/ws")');
  });

  it("fs fence 放行额外根目录", async () => {
    const granted = await fsMock.checkedTarget({ displayPath: EXTRA + "/foo" });
    expect(granted.targetKey).toBe(EXTRA + "/foo");
  });

  it("fs fence 仍拒绝非额外路径", async () => {
    await expect(fsMock.checkedTarget({ displayPath: "/tmp/other/bar" })).rejects.toThrow("FS_SANDBOX_DENIED");
  });

  it("remote set 热更新", () => {
    ctx.gateway.set({ extraWritableRoots: ["/tmp/hot"] });
    const out2 = sandboxMock.confine(["x"], { mode: "workspace-write", workspaceRoot: WS });
    expect(out2.argv[2].includes('(subpath "/tmp/hot")')).toBe(true);
  });

  it("remote 拒绝相对路径", () => {
    expect(() => ctx.gateway.set({ extraWritableRoots: ["relative/path"] })).toThrow(/absolute path/);
  });
});

describe("sandbox-extra-roots host (bwrap)", () => {
  it("bwrap 只授予存在的额外目录", async () => {
    const fakeHome2 = mkdtempSync(join(tmpdir(), "ser-fh2-"));
    const existingExtra = mkdtempSync(join(tmpdir(), "ser-existing-"));
    const missingExtra = join(fakeHome2, "missing-root");
    process.env.HOME = fakeHome2;
    process.env.DSH_HOME = fakeHome2;
    try {
      const bwrapMock = {
        confine(argv: string[], policy: any) {
          return { argv: ["bwrap", "--ro-bind", "/", "/", "--", ...argv], enforcement: "full", denialSignatures: [], runnerFailureRules: [] };
        },
      };
      const fsMock = makeFsMock();
      const ctx = makeCtx(bwrapMock, fsMock);
      await apply(ctx, { extraWritableRoots: [missingExtra, existingExtra] });
      const bwrapOut = bwrapMock.confine(["bash", "-c", "x"], { mode: "workspace-write", workspaceRoot: WS });
      const bindArgs = bwrapOut.argv.slice(0, bwrapOut.argv.indexOf("--"));
      const canonicalExistingExtra = canonicalPath(existingExtra);
      const canonicalMissingExtra = canonicalPath(missingExtra);
      expect(bindArgs).toContain("--bind");
      expect(bindArgs).toContain(canonicalExistingExtra);
      expect(bindArgs).not.toContain(canonicalMissingExtra);
    } finally {
      process.env.HOME = fakeHome;
      process.env.DSH_HOME = fakeHome;
      rmSync(fakeHome2, { recursive: true, force: true });
      rmSync(existingExtra, { recursive: true, force: true });
    }
  });
});