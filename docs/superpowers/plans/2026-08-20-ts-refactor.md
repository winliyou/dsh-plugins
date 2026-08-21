# dsh-plugins TS 重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 dsh-plugins monorepo（4 个 DSH host 插件包）从纯 ESM `.mjs`/`.cjs` + 手写测试重构为 TypeScript：源码 `.ts`/`.tsx`，tsc 编译 host 产物 `.js` + `.d.ts`，esbuild 打包 client 为 `__ModuleLoader__` 格式 `.cjs`，测试迁移 vitest。

**Architecture:** 每包 `src/*.ts`（host 插件）+ `client/index.tsx`（浏览器 bundle）；构建管线 = 每包 tsc 编译 `src/` → `lib/*.js` + esbuild 打包 `client/index.tsx` → `client/client.cjs`；测试 = vitest（`packages/*/test/*.test.ts` + 根 `test/*.test.ts`）。构建产物（`lib/`、`client/client.cjs`）gitignore，由 `prepublishOnly` 构建后发布。包名、`cordis.patch.yml`、加载机制不变。

**Tech Stack:** TypeScript（tsc 6.x）、esbuild、vitest、bun 1.3.14（包管理/脚本执行）、`@deepseek-ai/dsh-typert-protocol`（类型 + 运行时）、`@deepseek-ai/cordis`（类型）、`@deepseek-ai/schemastery`（类型）。

**设计文档:** `docs/superpowers/specs/2026-08-20-ts-refactor-design.md`

---

## 关键转换规则（所有包通用，先读）

1. **host 源码**：`lib/xxx.mjs` → `src/xxx.ts`，内容基本原样复制，仅：
   - import 相对路径从 `'./config-store.mjs'` 改为 `'./config-store.js'`（tsc NodeNext 解析 `.js` → `.ts` 源文件）
   - `await import('./remote.mjs')` 改为 `await import('./remote.js')`
   - 新增 `import type` 标注（若 tsc 报错 `verbatimModuleSyntax`）
   - JSDoc 保留
2. **typert 工件**：`lib/typert.host.js` → `src/typert.host.ts`，TYPERT 常量对象原样复制，`sourceLocation.file` 字段更新为 `'packages/<pkg>/src/remote.ts'`。它不 import 任何模块（独立工件，markers 分裂约束）。
3. **client**：`client/client.cjs` → `client/index.tsx`：去掉 `window.__ModuleLoader__.load({...})` 包装、`var module/exports` 样板、`let react = require("react")`；顶部改 `import * as React from "react"`（或按需具名 import）；末尾导出 `apply`、`inject`（保留原 `exports.apply = apply; exports.inject = inject` 的语义）。`__ModuleLoader__` 包装由 esbuild 构建脚本生成。
4. **harness 服务类型**：每包 `src/dsh.d.ts` 用 `declare module '@deepseek-ai/cordis' { interface Context { ... } }` 扩展（官方模式，参考 launch-environment）。只声明该包实际使用的服务字段（见下方各包清单）。`logger` 等 cordis 自带字段不需要。
5. **config-store/remote 三包同构**（vision-router、sandbox-extra-roots、adaptive-perf）：转换后内容保持一致（原测试断言三包实现相同，迁移后改为断言 `src/` 文件相同）。

---

### Task 1: 根基础设施（tsconfig、vitest、esbuild 构建脚本、依赖）

**Files:**
- Create: `tsconfig.base.json`
- Create: `tsconfig.json`（根，host typecheck 聚合）
- Create: `tsconfig.client.json`（client typecheck 聚合）
- Create: `vitest.config.ts`
- Create: `scripts/build.mjs`（tsc 各包 + esbuild 各 client）
- Modify: `package.json`（scripts、devDependencies）
- Modify: `.gitignore`（忽略构建产物）

- [ ] **Step 1: 安装 devDependencies**

```bash
bun add -d typescript esbuild vitest @deepseek-ai/cordis @deepseek-ai/schemastery @types/node
```

注意：`@deepseek-ai/cordis` 目前未安装（peer dep 未 hoist），必须装才能让 typert-protocol 的 `.d.ts` 通过类型检查。若 `@deepseek-ai/schemastery` 版本号需与 harness 匹配（rc.7 系列），确认 `bun add` 后实际版本。

- [ ] **Step 2: 创建 `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": false,
    "outDir": "lib",
    "rootDir": "src"
  }
}
```

- [ ] **Step 3: 创建根 `tsconfig.json`（host typecheck 聚合，不产出）**

```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "declaration": false,
    "declarationMap": false,
    "sourceMap": false
  },
  "include": ["packages/*/src/**/*.ts"],
  "exclude": ["packages/*/src/**/*.tsx"]
}
```

- [ ] **Step 4: 创建 `tsconfig.client.json`（client typecheck 聚合，不产出）**

```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "declaration": false,
    "declarationMap": false,
    "sourceMap": false,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "jsxImportSource": "react"
  },
  "include": ["packages/*/client/**/*.tsx"]
}
```

- [ ] **Step 5: 创建 `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "packages/*/test/**/*.test.ts"],
    environment: "node",
    testTimeout: 30000,
  },
});
```

- [ ] **Step 6: 创建 `scripts/build.mjs`（全仓构建）**

```js
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
```

- [ ] **Step 7: 更新根 `package.json` scripts**

```json
{
  "scripts": {
    "build": "bun scripts/build.mjs",
    "typecheck": "tsc -p tsconfig.json --noEmit && tsc -p tsconfig.client.json --noEmit",
    "test": "vitest run",
    "test:ci": "bun run build && vitest run"
  }
}
```

- [ ] **Step 8: 更新 `.gitignore`**

追加：

```
# build artifacts
packages/*/lib/
packages/*/client/client.cjs
```

- [ ] **Step 9: 验证基础设施**

Run: `bun run typecheck`
Expected: 输出为空（此时 packages 还是 .mjs，tsconfig 只 include src/，src/ 尚不存在，`tsc` 对空 include 静默通过或报无输入——若报错，先把 include 路径暂时改为空目录，确认 tsc/esbuild/vitest 均可执行）。
Run: `bunx vitest --version`
Expected: 打印 vitest 版本。

- [ ] **Step 10: Commit**

```bash
git add tsconfig.base.json tsconfig.json tsconfig.client.json vitest.config.ts scripts/build.mjs package.json .gitignore
git commit -m "build: add TS toolchain scaffold (tsconfig, vitest, esbuild build script)"
```

---

### Task 2: sandbox-extra-roots 源码转换（试点包，验证整条管线）

**Files:**
- Create: `packages/sandbox-extra-roots/src/index.ts`
- Create: `packages/sandbox-extra-roots/src/config-store.ts`
- Create: `packages/sandbox-extra-roots/src/remote.ts`
- Create: `packages/sandbox-extra-roots/src/typert.host.ts`
- Create: `packages/sandbox-extra-roots/src/common.ts`
- Create: `packages/sandbox-extra-roots/src/dsh.d.ts`
- Create: `packages/sandbox-extra-roots/client/index.tsx`
- Create: `packages/sandbox-extra-roots/tsconfig.json`
- Modify: `packages/sandbox-extra-roots/package.json`
- Delete: `packages/sandbox-extra-roots/lib/*.mjs`、`packages/sandbox-extra-roots/lib/*.js`、`packages/sandbox-extra-roots/client/client.cjs`（旧产物，git 提交过则 git rm）

- [ ] **Step 1: 创建 `tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 2: 创建 `src/config-store.ts`**

从 `lib/config-store.mjs` 复制全部内容，做以下修改：
- import `'./config-store.mjs'` 无（config-store 自身不 import 包内模块）
- 函数签名加类型：

```ts
export interface ConfigStoreOptions {
  name: string;
  defaults: Record<string, any>;
  patchConfig: Record<string, any>;
  onUpdate?: (merged: Record<string, any>, next: Record<string, any>) => void;
  validate?: (partial: Record<string, any>) => void;
  warn?: (message: string) => void;
}

export interface ConfigStore {
  file: string;
  effective(): Record<string, any>;
  set(partial: Record<string, any>): Record<string, any>;
}

export function createConfigStore(options: ConfigStoreOptions): ConfigStore
```

- `const warn = options.warn ?? (() => {})` → `const warn = options.warn ?? (() => {});` 保留
- 内部 `readJson()` 返回类型标注 `Record<string, any>`；`effective()`、`set()` 返回类型标注
- `error?.message || error` 处 `error` 为 `unknown`：改为 `(error as Error)?.message || String(error)` 或在 catch 处标注 `catch (error: any)`——**用 `catch (error)` 保留，访问处改 `(error as Error).message ?? String(error)`**

- [ ] **Step 3: 创建 `src/common.ts`**

从 `lib/common.mjs` 复制，修改：
- `import { stat } from "node:fs/promises"` 保留
- `loadPackage(specifier: string): Promise<any>`（返回 `any`，因为 dsh-sandbox 无类型；`any` 用 `// eslint-disable` 不需要，仓库无 eslint）
- `const sandbox = await loadPackage("@deepseek-ai/dsh-sandbox") as any;`
- `sbplString(path: string): string`
- `seatbeltProfileArgs(policy: { mode: string; workspaceRoot?: string }, extraRoots: string[]): string[]`
- `isPathUnder(path: string, root: string, caseSensitive?: boolean): Promise<boolean>`；内部 `error` 访问 `.code` 处用 `(error as NodeJS.ErrnoException).code`
- 保留 `export const { canonicalPath, writableRoots } = sandbox;`（sandbox 为 any，解构 OK）

- [ ] **Step 4: 创建 `src/remote.ts`**

从 `lib/remote.mjs` 复制，修改：
- `loadTypert()` 返回类型：`Promise<typeof import("@deepseek-ai/dsh-typert-protocol")>`；`const { Remote, TypertRemoteService } = await loadTypert();`
- `pending` 类型：`{ initializers: Array<() => void> }[]`；`context` 对象用 `as ClassMethodDecoratorContext` 断言（`import type { ClassMethodDecoratorContext } from "typescript"` 不可用——改为构造为满足 `Remote(exportName)(proto[method], context)` 签名的最小形状，用 `as any` 于 context 参数；**推荐：直接复制原逻辑，context 标注为 `Parameters<typeof Remote>[1]` 不可行（Remote 有重载），用 `as never` 不行——用显式 `any`**）：

```ts
async function loadTypert(): Promise<typeof import("@deepseek-ai/dsh-typert-protocol")> {
  // 原逻辑原样
}

let pending: Array<{ initializers: Array<() => void> }> = [];

function markRemoteMethod(proto: object, method: string, exportName?: string) {
  const initializers: Array<() => void> = [];
  const context = {
    kind: "method",
    name: method,
    private: false,
    static: false,
    addInitializer(fn: () => void) { initializers.push(fn); },
  } as any;
  Remote(exportName ?? method)((proto as any)[method], context);
  pending.push({ initializers });
}

function runPendingMarks(instance: object) {
  const batch = pending;
  pending = [];
  for (const { initializers } of batch) {
    for (const init of initializers) init.call(instance);
  }
}

export class PluginConfigGateway extends TypertRemoteService {
  private store: ConfigStore;
  constructor(ctx: any, config: { store: ConfigStore; serviceKey: string }) {
    super(ctx, config.serviceKey);
    runPendingMarks(this);
    this.store = config.store;
  }
  get() {
    return { config: this.store.effective() };
  }
  set(partial: Record<string, any>) {
    if (partial === null || typeof partial !== "object" || Array.isArray(partial)) {
      throw new TypeError("set expects a plain config object");
    }
    this.store.set(partial);
    return { saved: true };
  }
}
```

- `import type { ConfigStore } from "./config-store.js"`（config-store.ts 导出）
- `ctx` 参数类型：`Context`（来自 `@deepseek-ai/cordis`，`import type { Context } from "@deepseek-ai/cordis"`）
- 尾部 `markRemoteMethod(...)` 与 `runPendingMarks(Object.create(...))` 保留

- [ ] **Step 5: 创建 `src/typert.host.ts`**

从 `lib/typert.host.js` 复制，修改：
- `sourceLocation.file` 全部改为 `'packages/sandbox-extra-roots/src/remote.ts'`
- `TYPERT` 对象标注类型 `import type { ... } from "@deepseek-ai/dsh-typert-protocol/types"`——若该类型不可直接构造，则保留无类型对象并用 `satisfies` 关键字（需要时）：`export const TYPERT = { ... } satisfies Record<string, unknown>`——**保守做法：不加类型注解，保持原样导出**（工件是运行时常量，无类型安全诉求）

- [ ] **Step 6: 创建 `src/dsh.d.ts`**

sandbox-extra-roots 实际使用的服务：`sandbox`、`fs`、`sandboxPolicy`、`settings`（registerSettingsNamespace 内）、`logger`（cordis 自带，不声明）。从 `lib/index.mjs` 的使用点提取：

```ts
declare module "@deepseek-ai/cordis" {
  interface Context {
    sandbox: {
      [key: string]: any;
      confine?: (...args: any[]) => Promise<any>;
    };
    fs: {
      [key: string]: any;
      checkedTarget?: (...args: any[]) => Promise<any>;
    };
    sandboxPolicy: {
      resolve(): Promise<{ mode: string; workspaceRoot?: string }>;
    };
    settings: {
      register(ns: string, schema: any, options?: any): void;
    };
  }
}

declare module "@deepseek-ai/dsh-sandbox" {
  export const canonicalPath: (p: string) => string;
  export const writableRoots: (policy: any) => string[];
}

declare module "@deepseek-ai/node-addon-landlock-run" {
  export function launcherPath(): string;
}
```

- [ ] **Step 7: 创建 `src/index.ts`**

从 `lib/index.mjs` 复制全部内容，修改：
- `import { statSync } from "node:fs"` 保留
- `import { canonicalPath, isPathUnder, loadLandlock, seatbeltProfileArgs } from "./common.mjs"` → `"./common.js"`
- `import { createConfigStore } from "./config-store.mjs"` → `"./config-store.js"`
- `await import("./remote.mjs")` → `await import("./remote.js")`
- `({ PluginConfigGateway } = await import("./remote.js"))` 保持
- `await import("@deepseek-ai/schemastery")` 保持（动态 import，`Schema` 为 any）
- `export function registerSettingsNamespace(ctx: any, ns: string, schemaLib: any, buildSchema: (z: any) => any, options: any): boolean`（保持原逻辑）
- `export function apply(ctx: Context, config?: any): void | Promise<void>`（`import type { Context } from "@deepseek-ai/cordis"`）
- 内部 `ctx.sandbox[ORIGINAL] ?? ctx.sandbox`、`ctx.sandboxPolicy?.resolve()` 等不变（dsh.d.ts 已声明）
- `STATE`、`ORIGINAL` symbol 保留
- `getLandlockExec()` 返回类型 `Promise<string | null> | null`

- [ ] **Step 8: 创建 `client/index.tsx`**

从 `client/client.cjs` 复制，修改：
- 删除顶部 `window.__ModuleLoader__.load({...})`、`factory: (require) => {`、`var module = {...}`、`var exports = module.exports`、`let react = require("react")`
- 顶部加 `import * as React from "react";`
- 所有 `react.createElement` → `React.createElement`（或 `import { createElement } from "react"` 后保留 `createElement`——**选择 `import * as React from "react"` 并全局替换 `react.` → `React.`，最小 diff**）
- 文件末尾：
  - 原 `exports.apply = apply; exports.inject = inject; return module.exports;` → `export { apply, inject };`
- 组件函数参数加类型：`(props: { ... })`——**保守：参数标注 `any`，仅当 tsc 报错时补精确类型**（避免逐组件手写 props 类型拖慢进度；tsconfig strict 下无隐式 any 错误因为显式 `any` 合法）
- CSS 字符串、字典对象原样保留
- 若 client 内有 `ctx.get`、`ctx.slots`、`ctx.remote`、`ctx.locale`、`ctx.effect` 等：`apply(ctx: any)` 参数标注 `any`（client 端 ctx 类型不属于 host 的 dsh.d.ts 范围）

- [ ] **Step 9: 更新 `package.json`**

```json
{
  "exports": {
    ".": "./lib/index.js",
    "./client": "./client/client.cjs",
    "./typert": "./lib/typert.host.js",
    "./cordis.patch.yml": "./cordis.patch.yml",
    "./package.json": "./package.json"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "prepublishOnly": "bun ../../scripts/build.mjs && bun run test"
  }
}
```

注意：`dsh`、`dependencies`、`optionalDependencies` 字段不变。`test` script 本任务先不动（Task 3 迁移测试后更新）。

- [ ] **Step 10: 删除旧文件并验证**

```bash
git rm packages/sandbox-extra-roots/lib/index.mjs packages/sandbox-extra-roots/lib/config-store.mjs packages/sandbox-extra-roots/lib/remote.mjs packages/sandbox-extra-roots/lib/typert.host.js packages/sandbox-extra-roots/lib/common.mjs packages/sandbox-extra-roots/client/client.cjs
```

Run: `bun scripts/build.mjs`
Expected: 输出 `built sandbox-extra-roots`；`lib/` 下生成 `index.js`、`config-store.js`、`remote.js`、`typert.host.js`、`common.js` + `.d.ts`；`client/client.cjs` 以 `window.__ModuleLoader__.load({` 开头。
Run: `bun run typecheck`
Expected: 无错误。若有类型错误，逐一修复（多为 `any` 标注不足或 catch 的 unknown 访问）。
Run: `node -e "import('./packages/sandbox-extra-roots/lib/index.js').then(m => console.log(m.name, m.inject))"`
Expected: `sandbox-extra-roots [ 'sandbox', 'fs', 'sandboxPolicy' ]`

- [ ] **Step 11: Commit**

```bash
git add -A packages/sandbox-extra-roots
git commit -m "refactor(sandbox-extra-roots): convert to TypeScript (tsc + esbuild pipeline)"
```

---

### Task 3: sandbox-extra-roots 测试迁移（vitest 试点）

**Files:**
- Create: `packages/sandbox-extra-roots/test/config-store.test.ts`
- Create: `packages/sandbox-extra-roots/test/index.test.ts`
- Modify: `packages/sandbox-extra-roots/package.json`（test script）

- [ ] **Step 1: 创建 `test/config-store.test.ts`**

从 `scripts/test.mjs` 第 42-45 行（sandbox config-store 回归）+ 第 59-67 行（三包一致性）迁移。**一致性断言放根 `test/`（Task 7），这里只放本包 config-store 功能**：

```ts
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConfigStore } from "../src/config-store.js";

let fakeHome: string;

beforeAll(() => {
  fakeHome = mkdtempSync(join(tmpdir(), "sb-"));
  process.env.DSH_HOME = fakeHome;
  process.env.HOME = fakeHome;
});

afterAll(() => {
  rmSync(fakeHome, { recursive: true, force: true });
});

describe("config-store (sandbox-extra-roots)", () => {
  it("set 后可重新读取配置（换行转义回归）", () => {
    const store = createConfigStore({
      name: "sandbox-extra-roots-store-test",
      defaults: { extraWritableRoots: [] },
      patchConfig: {},
    });
    store.set({ extraWritableRoots: ["/tmp/regression"] });
    expect(store.effective().extraWritableRoots[0]).toBe("/tmp/regression");
  });
});
```

- [ ] **Step 2: 创建 `test/index.test.ts`**

从 `scripts/test.mjs` 第 419-499 行（sandbox-extra-roots 行为段）迁移。先读原段落，按以下模板迁移（`check(name, cond)` → `expect(cond).toBe(true)`）：

```ts
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply } from "../src/index.js";
import { seatbeltProfileArgs, isPathUnder } from "../src/common.js";

let fakeHome: string;

beforeAll(() => {
  fakeHome = mkdtempSync(join(tmpdir(), "sb-"));
  process.env.DSH_HOME = fakeHome;
  process.env.HOME = fakeHome;
});

afterAll(() => {
  rmSync(fakeHome, { recursive: true, force: true });
});

describe("sandbox-extra-roots host", () => {
  // 从 scripts/test.mjs 419-499 逐条迁移：
  // - seatbeltProfileArgs：workspace-write 含额外目录 / read-only 不含
  // - bwrap/Landlock：不存在目录运行时过滤（对应原 466 行注释的断言）
  // - fs fence：checkedTarget 放行额外目录内路径
  // - 幂等 apply / 卸载还原
});
```

**迁移要求：原段落的每一条 `check()` 都必须变成一条 `expect`，一条不落。** 原 sandbox 段落结构（419-499）：`seatbeltProfileArgs` 形状断言（含 extraRoots）、read-only 模式不加目录、`isPathUnder` 词法/身份判断、apply 包装 sandbox.confine 与 fs.checkedTarget、幂等与 dispose 还原。执行时对照原文件逐条搬运，mock ctx 形状保持。

- [ ] **Step 3: 更新 `package.json` test script**

```json
"test": "vitest run --config ../../vitest.config.ts"
```

- [ ] **Step 4: 验证**

Run: `bun run build`
Expected: 构建成功。
Run: `bunx vitest run packages/sandbox-extra-roots/test`
Expected: 全部 PASS，断言数与迁移的 check 数一致（对照原 test.mjs 计数）。

- [ ] **Step 5: Commit**

```bash
git add packages/sandbox-extra-roots
git commit -m "test(sandbox-extra-roots): migrate regression tests to vitest"
```

---

### Task 4: vision-router 源码转换

**Files:**
- Create: `packages/vision-router/src/index.ts`、`config-store.ts`、`remote.ts`、`typert.host.ts`、`dsh.d.ts`
- Create: `packages/vision-router/client/index.tsx`
- Create: `packages/vision-router/tsconfig.json`
- Modify: `packages/vision-router/package.json`
- Delete: `packages/vision-router/lib/*`、`client/client.cjs`

- [ ] **Step 1: 创建 `tsconfig.json`**（同 Task 2 Step 1，包路径换成 vision-router）

- [ ] **Step 2: 创建 `src/config-store.ts`**（同 Task 2 Step 2 的完整内容，两包保持字节级一致）

- [ ] **Step 3: 创建 `src/remote.ts`**（同 Task 2 Step 4 内容；类名为 `PluginConfigGateway`，与 sandbox 相同）

- [ ] **Step 4: 创建 `src/typert.host.ts`**（复制 `lib/typert.host.js`，`sourceLocation.file` 改 `'packages/vision-router/src/remote.ts'`）

- [ ] **Step 5: 创建 `src/dsh.d.ts`**

vision-router 实际使用的服务：`llm`、`sessions`、`attachments`（可选）、`agentPresets`（apply 里可能用）、`tools`（可选）、`logger`（cordis 自带）。从 `lib/index.mjs` 使用点（398 行 `ctx.sessions.get`、460/478/496 `ctx.llm.*`、731 `ctx.llm.stream`、435 行 `injectCapabilityHint(ctx, state, agent)` 内 `agent.ctx.*`）提取：

```ts
declare module "@deepseek-ai/cordis" {
  interface Context {
    llm: {
      listModels(provider: string): Promise<Array<Record<string, any>>>;
      listProviders(): Promise<Array<{ id: string }>>;
      resolveModelInfo(provider: string, model: string): Promise<Record<string, any>>;
      streamWithRegistration(options: Record<string, any>): AsyncIterable<Record<string, any>>;
      stream(options: Record<string, any>): AsyncIterable<Record<string, any>>;
    };
    sessions: {
      get(sessionId: string): { log: Array<Record<string, any>>; append(type: string, data: Record<string, any>): void } | undefined;
    };
    attachments?: {
      [key: string]: any;
    };
    agentPresets?: {
      [key: string]: any;
    };
    tools?: {
      [key: string]: any;
    };
  }
}
```

**执行时对照 `lib/index.mjs` 实际访问的服务字段增补**（如 `ctx.llm` 是否还有别的调用、`ctx.sessions` 方法名、`state` 上挂的服务）。原则：声明 `[key: string]: any` 兜底，具体字段用于已确认的使用点。

- [ ] **Step 6: 创建 `src/index.ts`**

从 `lib/index.mjs`（1054 行）复制全部内容，修改：
- import 路径 `.mjs` → `.js`（`./config-store.js`、`./remote.js`）
- `await import('./remote.js')`、`await import('@deepseek-ai/schemastery')` 保持
- `apply(ctx: Context, config?: any)`、`registerSettingsNamespace(ctx: any, ns: string, schemaLib: any, buildSchema: (z: any) => any, options: any): boolean`（签名同 sandbox）
- 导出函数加类型：
  - `detectMediaType(buffer: Buffer | Uint8Array): string`
  - `compressImage(buffer: Buffer | Uint8Array, mediaType: string, cfg: Record<string, any>): Promise<Buffer>`
  - `exceedsMaxPixels(buffer: Buffer | Uint8Array, maxPixels: number, fallback?: boolean): Promise<boolean>`
- 内部 `error` unknown 访问（`failChunk` 等）处按 `(error as Error).message ?? String(error)` 处理
- `loadSharp()` 返回 `Promise<any>`（sharp 惰性加载）
- 文件内所有 `ctx.` 访问保持（dsh.d.ts 兜底）

- [ ] **Step 7: 创建 `client/index.tsx`**（同 Task 2 Step 8 规则；vision-router 的 client 有 `PasteImageEnhancer` 组件、`apply` 里 `ctx.get("conversation")` 等，原样保留）

- [ ] **Step 8: 更新 `package.json`**（同 Task 2 Step 9：exports `.mjs`→`.js`、scripts 增 build/typecheck/prepublishOnly）

- [ ] **Step 9: 删除旧文件并验证**

```bash
git rm packages/vision-router/lib/index.mjs packages/vision-router/lib/config-store.mjs packages/vision-router/lib/remote.mjs packages/vision-router/lib/typert.host.js packages/vision-router/client/client.cjs
```

Run: `bun scripts/build.mjs`
Expected: `built vision-router`；lib 产物生成。
Run: `bun run typecheck`
Expected: 无错误。
Run: `node -e "import('./packages/vision-router/lib/index.js').then(m => console.log(m.name, m.inject))"`
Expected: `vision-router [ 'llm', 'sessions' ]`

- [ ] **Step 10: Commit**

```bash
git add -A packages/vision-router
git commit -m "refactor(vision-router): convert to TypeScript (tsc + esbuild pipeline)"
```

---

### Task 5: vision-router 测试迁移

**Files:**
- Create: `packages/vision-router/test/config-store.test.ts`
- Create: `packages/vision-router/test/index.test.ts`
- Modify: `packages/vision-router/package.json`（test script）

- [ ] **Step 1: 创建 `test/config-store.test.ts`**

从 `scripts/test.mjs` 第 22-39 行迁移（vision-router config-store + remote 标记）：

```ts
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConfigStore } from "../src/config-store.js";
import { PluginConfigGateway } from "../src/remote.js";
import { remoteMethods } from "@deepseek-ai/dsh-typert-protocol";

let fakeHome: string;

beforeAll(() => {
  fakeHome = mkdtempSync(join(tmpdir(), "vr-"));
  process.env.DSH_HOME = fakeHome;
  process.env.HOME = fakeHome;
});

afterAll(() => {
  rmSync(fakeHome, { recursive: true, force: true });
});

describe("config-store + remote (vision-router)", () => {
  it("合并默认+patch，set 持久化+热更新回调", () => {
    const updates: Array<Record<string, any>> = [];
    const store = createConfigStore({
      name: "vision-router",
      defaults: { a: 1, b: 2 },
      patchConfig: { b: 20 },
      onUpdate: (merged) => updates.push(merged),
    });
    expect(store.effective().a).toBe(1);
    expect(store.effective().b).toBe(20);
    const next = store.set({ b: 200 });
    expect(next.b).toBe(200);
    expect(updates.length).toBe(1);
  });

  it("remote 标记生效，get/set 调用", () => {
    const store = createConfigStore({
      name: "vision-router",
      defaults: { a: 1, b: 2 },
      patchConfig: {},
    });
    const fake = Object.create(PluginConfigGateway.prototype) as PluginConfigGateway;
    (fake as any).store = store;
    const methods = remoteMethods(fake);
    expect(methods.some((m) => m.method === "get")).toBe(true);
    expect(methods.some((m) => m.method === "set")).toBe(true);
    expect((fake as any).get().config.b).toBe(2);
    expect((fake as any).set({ b: 300 }).saved).toBe(true);
  });
});
```

- [ ] **Step 2: 创建 `test/index.test.ts`**

从 `scripts/test.mjs` 第 221-418 行迁移（vision-router 全部行为：基础转述、追问重看、来源标注、多图位置保留、agent 场景、能力提示注入）。原段落结构：`applyVision(ctx, {...})` + `llmMock`（listModels/listProviders/resolveModelInfo/streamWithRegistration）+ `ctx` mock（llm/sessions/attachments/logger/get/on/effect/plugin）+ 多条 `check`。**逐条迁移所有 `check` 为 `expect`，mock 结构原样保留**，`await import("../src/index.js")` 替代动态 import：

```ts
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply as applyVision } from "../src/index.js";
import { detectMediaType, compressImage, exceedsMaxPixels } from "../src/index.js";

let fakeHome: string;

beforeAll(() => {
  fakeHome = mkdtempSync(join(tmpdir(), "vr-"));
  process.env.DSH_HOME = fakeHome;
  process.env.HOME = fakeHome;
});

afterAll(() => {
  rmSync(fakeHome, { recursive: true, force: true });
});

describe("vision-router host", () => {
  it("resolveModelInfo 补 image", async () => {
    // 原 test.mjs 221-418 的 llmMock + ctx + 断言，逐条迁移
  });
  // 其余 it 块按原段落分组：含图转述、追问重看、缓存、来源标注、多图、agent、能力提示
});
```

**迁移要求：原 221-418 行每一条 `check` 必须迁移为 `expect`，共约 40 条，一条不落。** 建议按原注释分段（`// ── vision-router ──`、`// ── vision-router 追问重看`、`// ── vision-router 来源标注`、`// ── vision-router 多图位置保留`、`// ── vision-router agent 场景`、`// ── vision-router 能力提示注入`）拆成多个 `it`。mock 的 `calls`、`appended`、`vrEvents` 等计数器每个 `it` 内重新初始化（原文件是单文件顺序执行，拆分时注意状态隔离）。

- [ ] **Step 3: 更新 `package.json` test script**（同 Task 3 Step 3）

- [ ] **Step 4: 验证**

Run: `bun run build && bunx vitest run packages/vision-router/test`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/vision-router
git commit -m "test(vision-router): migrate regression tests to vitest"
```

---

### Task 6: adaptive-perf 源码转换

**Files:**
- Create: `packages/adaptive-perf/src/index.ts`、`config-store.ts`、`remote.ts`、`typert.host.ts`、`dsh.d.ts`
- Create: `packages/adaptive-perf/client/index.tsx`
- Create: `packages/adaptive-perf/tsconfig.json`
- Modify: `packages/adaptive-perf/package.json`
- Delete: `packages/adaptive-perf/lib/*`、`client/client.cjs`

- [ ] **Step 1: 创建 `tsconfig.json`**（同 Task 2 Step 1，包路径换 adaptive-perf）

- [ ] **Step 2: 创建 `src/config-store.ts`**（与 vision-router/sandbox 字节级一致）

- [ ] **Step 3: 创建 `src/remote.ts`**（类名 `PluginConfigGateway`，与 sandbox/vision-router 一致）

- [ ] **Step 4: 创建 `src/typert.host.ts`**（`sourceLocation.file` 改 `'packages/adaptive-perf/src/remote.ts'`）

- [ ] **Step 5: 创建 `src/dsh.d.ts`**

adaptive-perf 实际使用的服务：`agentPresets`（54 行 `composedPreset(agent.ctx)`）、`tools`（56 行 `schemas(agent)`、57 行 `restrict({ deny })`）、`systemPrompt`（`agent.ctx.systemPrompt.suppressRuntimeContext()`/`section()`）、`settings`（844 行 registerSettingsNamespace）、`llm`（可能）、`sessions`（可能）、`logger`。**注意：systemPrompt/tools 挂在 `agent.ctx` 上（agent 对象），不是根 ctx**：

```ts
declare module "@deepseek-ai/cordis" {
  interface Context {
    agentPresets: {
      composedPreset(ctx: any): Record<string, any> | undefined;
    };
    settings: {
      register(ns: string, schema: any, options?: any): void;
    };
    llm?: {
      [key: string]: any;
    };
    sessions?: {
      [key: string]: any;
    };
    tools?: {
      [key: string]: any;
    };
  }
}
```

在 `src/index.ts` 内部定义 agent 相关类型（或放 dsh.d.ts）：

```ts
declare module "@deepseek-ai/cordis" {
  interface Context {
    systemPrompt: {
      suppressRuntimeContext(): () => void;
      section(name: string): any;
    };
    tools: {
      schemas(agent: any): Array<Record<string, any>>;
      restrict(options: { deny?: string[]; allow?: string[] }): () => void;
    };
  }
}
```

**执行时对照 `lib/index.mjs` 的 agent 使用点（945、1010、1342 行）确认 `agent.ctx.*` 的实际字段，增补到 dsh.d.ts。**

- [ ] **Step 6: 创建 `src/index.ts`**

从 `lib/index.mjs`（1470 行）复制全部内容，修改：
- 无包内相对 import（adaptive-perf 的 index 不 import config-store/remote？——**执行时检查**：若 `apply` 内通过 `ctx.plugin(PluginConfigGateway, ...)` 使用，则 index 顶部有 `await import('./remote.mjs')`，改为 `./remote.js`；config-store 同理）
- 导出函数全部加类型标注（对照 export 清单：`normalizeConfig`、`validateConfig`、`extractUserText`、`matchKeywords`、`collectFailureText`、`loadRealPairModules`、`realPairMounts`、`mountRealPair`、`stripSuppressedMessages`、`createDevToolSearch`、`createSkillSearch`、`createSkillLoad`、`extractSkillBody`、`scanPhase`、`observePhase`、`filterBootstrapTools`、`filterBootstrapMessages`、`applyBootstrapBudget`、`registerSettingsNamespace`、`apply`）：
  - `normalizeConfig(source: Record<string, any>, defaults?: Record<string, any>): Record<string, any>`
  - `validateConfig(partial: Record<string, any>): void`
  - `extractUserText(message: Record<string, any>): string`
  - `matchKeywords(text: string, keywords: string[]): boolean`
  - `collectFailureText(result: Record<string, any>): string`
  - `loadRealPairModules(importFn: (id: string) => Promise<any>): Promise<Record<string, any>>`
  - `realPairMounts(modules: Record<string, any>, cwd: string): Array<Record<string, any>>`
  - `mountRealPair(agent: any, mounts: Array<Record<string, any>>, warn: (m: string) => void): void`
  - `stripSuppressedMessages(messages: any[], suppressedSources: Set<string>): any[]`
  - `createDevToolSearch(options: Record<string, any>): (q: string) => Promise<Array<Record<string, any>>>`
  - `createSkillSearch(options: Record<string, any>): (q: string) => Promise<Array<Record<string, any>>>`
  - `createSkillLoad(options: Record<string, any>): (id: string) => Promise<Record<string, any>>`
  - `extractSkillBody(skill: Record<string, any>): string`
  - `scanPhase(events: any[], promoteEvents: Set<string>): string`
  - `observePhase(state: Record<string, any>, sessionId: string, event: Record<string, any>): void`
  - `filterBootstrapTools(assembly: any, keep: Set<string>): any`
  - `filterBootstrapMessages(messages: any[], suppressedSources: Set<string>): any[]`
  - `applyBootstrapBudget(config: Record<string, any>, promoted: boolean, maxTokens: number): number`
  - `registerSettingsNamespace` 签名同其他包
  - `apply(ctx: Context, config?: any, options?: Record<string, any>): Promise<void> | void`
- 内部 `error` unknown 处理同上
- `DEFAULT_CONFIG` 保留并加 `satisfies Record<string, any>` 或直接原样

- [ ] **Step 7: 创建 `client/index.tsx`**（同 Task 2 Step 8 规则）

- [ ] **Step 8: 更新 `package.json`**（exports/scripts 同前）

- [ ] **Step 9: 删除旧文件并验证**

```bash
git rm packages/adaptive-perf/lib/index.mjs packages/adaptive-perf/lib/config-store.mjs packages/adaptive-perf/lib/remote.mjs packages/adaptive-perf/lib/typert.host.js packages/adaptive-perf/client/client.cjs
```

Run: `bun scripts/build.mjs && bun run typecheck`
Expected: 构建成功、无类型错误。
Run: `node -e "import('./packages/adaptive-perf/lib/index.js').then(m => console.log(m.name, typeof m.apply, typeof m.normalizeConfig))"`
Expected: `adaptive-perf function function`

- [ ] **Step 10: Commit**

```bash
git add -A packages/adaptive-perf
git commit -m "refactor(adaptive-perf): convert to TypeScript (tsc + esbuild pipeline)"
```

---

### Task 7: adaptive-perf 测试迁移

**Files:**
- Create: `packages/adaptive-perf/test/config-store.test.ts`
- Create: `packages/adaptive-perf/test/index.test.ts`
- Modify: `packages/adaptive-perf/package.json`（test script）

- [ ] **Step 1: 创建 `test/config-store.test.ts`**

从 `scripts/test.mjs` 第 46-57 行迁移（adaptive 嵌套默认配置持久化）：

```ts
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConfigStore } from "../src/config-store.js";

let fakeHome: string;

beforeAll(() => {
  fakeHome = mkdtempSync(join(tmpdir(), "ap-"));
  process.env.DSH_HOME = fakeHome;
  process.env.HOME = fakeHome;
});

afterAll(() => {
  rmSync(fakeHome, { recursive: true, force: true });
});

describe("config-store (adaptive-perf)", () => {
  it("嵌套默认+patch+json 合并", () => {
    const defaults = {
      enabled: true,
      presets: ["standard", "code"],
      families: { delegation: { enabled: true, tools: ["subagent"], keywords: ["子代理"] } },
    };
    const store = createConfigStore({
      name: "adaptive-perf-store-test",
      defaults,
      patchConfig: { presets: ["code"] },
      onUpdate: () => {},
    });
    store.set({ enabled: false });
    const eff = store.effective();
    expect(eff.enabled).toBe(false);
    expect(eff.presets[0]).toBe("code");
    expect(eff.families.delegation.tools[0]).toBe("subagent");
  });
});
```

- [ ] **Step 2: 创建 `test/index.test.ts`**

从 `scripts/test.mjs` 第 500-1006 行迁移（adaptive-perf 全部行为：自适应引擎、首轮锚定、minimalPrompt 归一化、0.7.0 默认配置、0.5.0 真实工具对、上下文剥离、resident 目录、bootstrap 阶段、realPair stub 注入、零裁剪）。**逐条迁移所有 `check` 为 `expect`（约 40 条），mock 结构原样保留**。原段落大量使用纯函数导出（`normalizeConfig`、`stripSuppressedMessages`、`scanPhase`、`observePhase`、`filterBootstrapTools`、`applyBootstrapBudget`、`extractUserText`、`matchKeywords`、`collectFailureText` 等），直接 `import { ... } from "../src/index.js"`。`apply` 相关段落用 mock ctx 原样搬运。原 722 行注释（realPairModules: null 注入 = 官方包缺失降级路径）的断言保留。

- [ ] **Step 3: 更新 `package.json` test script**

- [ ] **Step 4: 验证**

Run: `bun run build && bunx vitest run packages/adaptive-perf/test`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/adaptive-perf
git commit -m "test(adaptive-perf): migrate regression tests to vitest"
```

---

### Task 8: session-archive 源码转换

**Files:**
- Create: `packages/session-archive/src/index.ts`、`config-store.ts`、`remote.ts`、`typert.host.ts`、`dsh.d.ts`
- Create: `packages/session-archive/client/index.tsx`
- Create: `packages/session-archive/tsconfig.json`
- Modify: `packages/session-archive/package.json`
- Delete: `packages/session-archive/lib/*`、`client/client.cjs`

- [ ] **Step 1: 创建 `tsconfig.json`**（同前）

- [ ] **Step 2: 创建 `src/config-store.ts`**（与三包一致；session-archive 也用同一实现——已验证 diff 为空）

- [ ] **Step 3: 创建 `src/remote.ts`**

session-archive 的 remote 是 **SessionArchiveGateway**（不同实现）：从 `lib/remote.mjs` 复制，修改：
- `loadTypert()` 同 Task 2 Step 4
- `export class SessionArchiveGateway extends TypertRemoteService { ... }` 类型化：

```ts
export class SessionArchiveGateway extends TypertRemoteService {
  private host: {
    list(): Promise<unknown>;
    detail(sessionId: string): Promise<unknown>;
    deleteArchived(sessionIds: string[]): Promise<unknown>;
    unarchive(sessionIds: string[]): Promise<unknown>;
  };
  constructor(ctx: Context, config: { host: SessionArchiveGateway["host"]; serviceKey: string }) {
    super(ctx, config.serviceKey);
    runPendingMarks(this);
    this.host = config.host;
  }
  list() { return this.host.list(); }
  detail(sessionId: string) { /* 原校验逻辑 */ }
  delete(sessionIds: string[]) { /* 原校验逻辑 */ }
  unarchive(sessionIds: string[]) { /* 原校验逻辑 */ }
}
```

- `markRemoteMethod`、`runPendingMarks` 同 Task 2 Step 4；尾部 `markRemoteMethod(SessionArchiveGateway.prototype, "list"/"detail"/"delete"/"unarchive")` + `runPendingMarks(Object.create(SessionArchiveGateway.prototype))` 保留
- `import type { Context } from "@deepseek-ai/cordis"`

- [ ] **Step 4: 创建 `src/typert.host.ts`**（`sourceLocation.file` 改 `'packages/session-archive/src/remote.ts'`；invocations 的 id/service 用 `sessionArchive`，保持原样）

- [ ] **Step 5: 创建 `src/dsh.d.ts`**

session-archive 实际使用的服务：`workspaceRegistry`（archivedSessionIds、enqueueOperation→requireState→setState）、`sessionPersistence`（list/locate/readFrom）、`sessions`（get）、`logger`。从 `lib/index.mjs` 使用点提取：

```ts
declare module "@deepseek-ai/cordis" {
  interface Context {
    workspaceRegistry: {
      archivedSessionIds: {
        has(id: string): boolean;
        [key: string]: any;
      };
      [key: string]: any;
    };
    sessionPersistence: {
      list(): Promise<Array<Record<string, any>>>;
      locate(id: string): Promise<string | null>;
      readFrom(id: string, offset: number): Promise<any>;
      [key: string]: any;
    };
    sessions: {
      get(sessionId: string): { [key: string]: any } | undefined;
    };
  }
}
```

**执行时对照 `lib/index.mjs` 133-326 行 `createArchiveHost` 内实际访问的字段增补。**

- [ ] **Step 6: 创建 `src/index.ts`**

从 `lib/index.mjs`（345 行）复制全部内容，修改：
- `import { createConfigStore } from './config-store.mjs'` → `'./config-store.js'`
- `await import('./remote.mjs')` → `'./remote.js'`
- `createArchiveHost(ctx: Context, cfg: Record<string, any>): { list: () => Promise<unknown>; detail: (id: string) => Promise<unknown>; deleteArchived: (ids: string[]) => Promise<unknown>; unarchive: (ids: string[]) => Promise<unknown> }`（返回类型按实际使用点定，保守 `Record<string, any>` 形状）
- `apply(ctx: Context, config?: any)`、`validateConfig`、`normalizeConfig` 加类型
- `limitedConcurrency<T>(limit: number, tasks: Array<() => Promise<T>>): Promise<T[]>`
- `foldTitle(events: any[]): string`、`messageText(message: any, maxChars: number): string`
- 内部 `error` unknown 处理同上

- [ ] **Step 7: 创建 `client/index.tsx`**（同前规则；session-archive client 有侧边栏面板组件，原样保留）

- [ ] **Step 8: 更新 `package.json`**（exports/scripts 同前）

- [ ] **Step 9: 删除旧文件并验证**

```bash
git rm packages/session-archive/lib/index.mjs packages/session-archive/lib/config-store.mjs packages/session-archive/lib/remote.mjs packages/session-archive/lib/typert.host.js packages/session-archive/client/client.cjs
```

Run: `bun scripts/build.mjs && bun run typecheck`
Expected: 构建成功、无类型错误。
Run: `node -e "import('./packages/session-archive/lib/index.js').then(m => console.log(m.name, m.inject))"`
Expected: `session-archive [ 'workspaceRegistry', 'sessionPersistence', 'sessions' ]`

- [ ] **Step 10: Commit**

```bash
git add -A packages/session-archive
git commit -m "refactor(session-archive): convert to TypeScript (tsc + esbuild pipeline)"
```

---

### Task 9: session-archive 测试迁移

**Files:**
- Create: `packages/session-archive/test/index.test.ts`
- Modify: `packages/session-archive/package.json`（test script）

- [ ] **Step 1: 创建 `test/index.test.ts`**

从 `scripts/test.mjs` 第 1007-1109 行迁移（session-archive：list/detail/delete/unarchive、ghost id 保留、live 拒绝删除、busy 兜底）。**逐条迁移所有 `check` 为 `expect`，mock ctx 原样保留**。注意原段落用 `createArchiveHost(ctx, cfg)` 导出 + mock 的 workspaceRegistry/sessionPersistence/sessions。`createArchiveHost` 从 `../src/index.js` import。busy 兜底段（1076 行注释）的断言保留（文件 mtime 60s 内 → 拒绝）。

- [ ] **Step 2: 更新 `package.json` test script**

- [ ] **Step 3: 验证**

Run: `bun run build && bunx vitest run packages/session-archive/test`
Expected: 全部 PASS。

- [ ] **Step 4: Commit**

```bash
git add packages/session-archive
git commit -m "test(session-archive): migrate regression tests to vitest"
```

---

### Task 10: 根级共享测试 + 清理 + CI

**Files:**
- Create: `test/bundle.test.ts`（npm bundle metadata + 三包一致性 + client 冒烟 + settings 注册）
- Delete: `scripts/test.mjs`
- Modify: `package.json`（移除对 scripts/test.mjs 的引用）
- Modify: `.github/workflows/publish.yml`（test 命令不变——已是 `bun run test:ci`，只需确认 test:ci 现在跑 build + vitest）

- [ ] **Step 1: 创建 `test/bundle.test.ts`**

从 `scripts/test.mjs` 第 69-219 行迁移，全部 `check` → `expect`：

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const PACKAGES = ["vision-router", "sandbox-extra-roots", "adaptive-perf", "session-archive"];

describe("npm bundle metadata", () => {
  for (const name of PACKAGES) {
    const pkgPath = join(ROOT, "packages", name, "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    const patchFile = join(ROOT, "packages", name, "cordis.patch.yml");
    const patch = readFileSync(patchFile, "utf8");

    it(`${name}: 声明 dsh.bundle.patch`, () => {
      expect(pkg.dsh?.bundle?.patch).toBe("./cordis.patch.yml");
    });
    it(`${name}: files 包含 cordis.patch.yml`, () => {
      expect(pkg.files).toContain("cordis.patch.yml");
    });
    it(`${name}: exports 暴露 cordis.patch.yml`, () => {
      expect(pkg.exports?.["./cordis.patch.yml"]).toBe("./cordis.patch.yml");
    });
    it(`${name}: exports 暴露 package.json`, () => {
      expect(pkg.exports?.["./package.json"]).toBe("./package.json");
    });
    it(`${name}: package name 与 patch 一致`, () => {
      expect(pkg.name).toBe(`@chaoset/${name}`);
    });
    it(`${name}: patch 文件存在并插入自身`, () => {
      expect(patch).toContain("- insert:");
      expect(patch).toContain(`@chaoset/${name}`);
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

describe("三包共享实现一致性", () => {
  it("config-store/remote 三包 src 一致", () => {
    const read = (pkg: string, file: string) =>
      readFileSync(join(ROOT, "packages", pkg, "src", file), "utf8");
    for (const file of ["config-store.ts", "remote.ts"]) {
      const vr = read("vision-router", file);
      const sb = read("sandbox-extra-roots", file);
      const ap = read("adaptive-perf", file);
      expect(vr).toBe(sb);
      expect(sb).toBe(ap);
    }
  });
});
```

**settings namespace 注册 + client 冒烟（原 84-219 行）迁移：**

client 冒烟原逻辑：`requireCjs(client.cjs)` + `entries[0].factory(requireStub)` → `bundleExports.apply(ctx)`。迁移后 client 已变为 `client/index.tsx` 源码，**冒烟改为直接 import `packages/<pkg>/client/index.tsx` 的 `apply`**，react 用 mock 注入。由于 `index.tsx` 顶部 `import * as React from "react"`，vitest 需要能解析 react——**根 devDeps 需加 `react`（或测试里 `vi.mock("react", ...)`）**：

```ts
import { describe, expect, it, vi } from "vitest";

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

describe("client bundles", () => {
  it("配置类包 settings.plugin.item 注册带 key", async () => {
    const cases: Array<[string, string]> = [
      ["vision-router", "visionRouterConfig"],
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
        get: (svc: string) => (svc.startsWith("remote.") ? { get: async () => ({ ok: true, value: { config: {} } }), set: async (p: any) => ({ ok: true, value: p }) } : {}),
      };
      await mod.apply(ctx as any);
      const item = registrations.find((r) => r.options.name === "settings.plugin.item");
      expect(item?.options.key).toBe(key);
    }
  });

  it("session-archive 侧边栏归档入口 + remote 贡献挂载", async () => {
    // 原 136-184 行逻辑：import ../packages/session-archive/client/index.tsx，
    // mock slots/locale/effect/remote/get，断言 sidebar.footer.action 注册与
    // remote $mount 贡献 package === "@chaoset/session-archive"
  });
});
```

**注意：`vi.mock("react")` 的模块路径解析**——vitest 会尝试从根 node_modules 解析 react。根安装 `bun add -d react`（仅类型/测试用，client 打包 external 不需要运行时）。若 `vi.mock` 失效（react 未安装解析失败），改为安装 react 到根 devDeps。

settings namespace 注册段（原 187-219 行）同样迁移为 `test/bundle.test.ts` 内的 `describe`（import 各包 `src/index.js` 的 `registerSettingsNamespace` + stubZ + regCtx）。

- [ ] **Step 2: 删除 `scripts/test.mjs`，更新根 `package.json`**

```bash
git rm scripts/test.mjs
```

根 package.json scripts 已在 Task 1 Step 7 更新（test → vitest run）。确认无残留引用（`rg "scripts/test.mjs" . --hidden -g '!node_modules'` 应为空）。

- [ ] **Step 3: 更新 CI**

`.github/workflows/publish.yml` 的 "Run tests" 步骤已是 `bun run test:ci`，无需改动（test:ci = build + vitest run）。**但需确认**：CI 的 `bun install --frozen-lockfile` 会安装新 devDeps（typescript/esbuild/vitest/cordis/schemastery/react/@types/node）——确认 `bun.lock` 已更新并提交（Task 1 的 bun add 会改 lockfile，随 Task 1 commit 提交）。

- [ ] **Step 4: 全量验证**

Run: `rm -rf packages/*/lib packages/*/client/client.cjs && bun install --frozen-lockfile`
Run: `bun run build`
Expected: 4 个包全部 `built <pkg>`。
Run: `bun run typecheck`
Expected: 无错误。
Run: `bun run test`
Expected: 全部 PASS，**断言总数 = 原 scripts/test.mjs 的 165**（每个测试文件内可数；`bunx vitest run` 输出会打印总 test 数，与 165 核对——注意原 check 数与 vitest it 数可能不同，因为一条 check 可能拆成多个 expect 或多个 check 合并进一个 it；**验收标准：所有原 check 断言都有对应的 expect 且全绿**，通过对照每个迁移文件与原 test.mjs 段落逐条核对）。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test: migrate shared regression tests to vitest, remove legacy test runner"
```

---

### Task 11: 最终验收

- [ ] **Step 1: 干净克隆验证（模拟 CI）**

```bash
git status --short  # 应无未提交修改
bun install --frozen-lockfile
bun run build
bun run typecheck
bun run test
```

Expected: build 输出 4 个包；typecheck 无错误；vitest 全绿。

- [ ] **Step 2: 产物加载验证（host ESM 三入口）**

```bash
for pkg in vision-router sandbox-extra-roots adaptive-perf session-archive; do
  node -e "import('./packages/$pkg/lib/index.js').then(m => console.log('$pkg', m.name))"
  node -e "import('./packages/$pkg/lib/typert.host.js').then(m => console.log('$pkg typert', m.TYPERT.package))"
  node -e "const fs=require('fs'); const s=fs.readFileSync('./packages/$pkg/client/client.cjs','utf8'); if(!s.startsWith('window.__ModuleLoader__.load')) process.exit(1); console.log('$pkg client ok')"
done
```

Expected: 每个包三行都打印成功（`client ok` 表示产物以 `__ModuleLoader__.load` 开头）。

- [ ] **Step 3: 对照设计文档验收标准逐条核对**

- [x] `tsc --noEmit` 全仓零错误（typecheck 通过）
- [ ] 各包 `lib/*.js` + `.d.ts` 产物生成正确，node 可直接 import 运行（Step 2 验证）
- [ ] `client/client.cjs` 保留 `__ModuleLoader__.load({id, factory})` 结构（Step 2 验证）
- [ ] `vitest run` 全绿（165 断言等量迁移）
- [ ] 包名、cordis.patch.yml、加载机制不变（git diff 检查 cordis.patch.yml 无改动）

- [ ] **Step 4: 汇报**

向用户汇报：构建管线（tsc + esbuild）、测试迁移完成、验收结果、遗留事项（若有）。

---

## 自审记录

**Spec 覆盖核对：**
- 目录布局（src/ + client/ + test/ + lib/ + client.cjs）→ Task 2-9 ✓
- tsc 编译 host、esbuild 打包 client → Task 1 Step 6 + 各包 build ✓
- exports 更新 `.mjs`→`.js` → 各包 Step 9 ✓
- 类型策略（cordis 扩展 + schemastery/typert-protocol 类型）→ 各包 dsh.d.ts ✓
- 测试迁移 165 断言 → Task 3/5/7/9/10 ✓
- CI 更新 → Task 10 Step 3 ✓
- 依赖变更 → Task 1 Step 1 ✓
- 兼容性（包名/patch 不变、产物格式保留）→ 各包转换规则 + Task 11 Step 3 ✓

**占位符扫描：** 无 TBD/TODO；迁移类步骤均注明"逐条迁移原 test.mjs 段落"并给出模板与核对要求（原文件存在，执行者可对照）。dsh.d.ts 的类型以"从使用点提取"为规则并给出已确认的使用点行号，属转换任务而非占位符。

**类型一致性：** `ConfigStore`/`ConfigStoreOptions` 接口在 Task 2 Step 2 定义，Task 2 Step 4（remote.ts）、Task 3/5/7 Step 1（config-store 测试）复用同名同形；`PluginConfigGateway` 三包同名；`SessionArchiveGateway` 仅 session-archive；`registerSettingsNamespace` 四包签名统一 `(ctx: any, ns: string, schemaLib: any, buildSchema: (z: any) => any, options: any): boolean`；exports 路径统一 `./lib/index.js`/`./client/client.cjs`/`./lib/typert.host.js` ✓

**风险备注（执行时注意）：**
1. `tsconfig.base.json` 的 `noUncheckedIndexedAccess: true` 可能对大量索引访问（`calls.vision[0]`、`cfg.presets[0]`）报错——若报错面过大，改为 `false`（保守）并记录在 commit message。
2. `exactOptionalPropertyTypes: false` 已显式设置避免可选字段赋值报错。
3. adaptive-perf 的 `apply` 使用 `options = {}` 默认参数与 `satisfies`——若 tsc 对 1470 行大文件报过多类型错误，优先放宽 `dsh.d.ts` 的兜底 `[key: string]: any` 而非逐个精确化。
4. client 冒烟测试需要 react 可解析：优先 `bun add -d react`（Task 10 Step 1 已注明），若 `vi.mock("react")` 仍失败（vitest 模块图不匹配），回退方案为直接 `import * as React from "react"` 实际安装 react 运行时（devDep 即可，不发布）。