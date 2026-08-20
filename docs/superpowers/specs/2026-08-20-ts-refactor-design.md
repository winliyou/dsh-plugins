# TS 重构设计（dsh-plugins）

日期：2026-08-20
状态：已获用户批准（无向后兼容性要求）

## 目标

把整个 dsh-plugins monorepo（4 个 DSH host 插件包）从纯 ESM `.mjs`/`.cjs` + 手写测试重构为 TypeScript：

- host 插件源码 `.ts`，编译产物 `.js`（ESM）+ `.d.ts`
- client 浏览器 bundle 源码 `.tsx`，esbuild 打包回 `__ModuleLoader__` 格式 CJS
- 测试从 `scripts/test.mjs`（165 断言手写）迁移到 vitest
- 发布到 npm 后，已安装的 DSH profile 通过包名 + exports 自动解析新版本（无需向后兼容）

## 背景约束（已调研确认）

DSH 插件加载机制（deepseek-ai/deepseek-harness）：

1. **host 插件**：`cordis.patch.yml` 的 `name`（包名）→ cordis 按包名解析 → 读 `exports["."]` 的 ESM 入口。包名不变则已安装 profile 无需改动。
2. **client 插件**：`dsh.client` + `exports["./client"]` → 浏览器 lazy CJS module table（`window.__ModuleLoader__.load`，格式 `{id, factory}`）。**必须是 CJS，且扩展名必须 `.cjs`**（包内 `"type": "module"` 下 `.js` 会被当 ESM 解析导致报错）。
3. **typert 工件**：`exports["./typert"]` → `lib/typert.host.js`，typert-loader 注册进 `ctx.typert.local`。手写工件，不依赖 remote.mjs 的 markers（typert-protocol 模块私有 WeakMap，实例分裂会丢 markers）。
4. **直接发布 TS 不可行**：Node 22.x 的 type-stripping 需要显式 `--experimental-strip-types`，DSH 加载第三方插件不带此 flag；浏览器不认 TS；官方所有发布包均为编译产物（"Production runs require built package and frontend artifacts"）。

官方技术栈：pnpm + tsc + tsdown + vitest。本仓库沿用其核心：**tsc 编译 + esbuild 打包 + vitest 测试**（官方 tsdown 即 esbuild 内核）。

## 关键决策

### 1. 工具链

| 步骤 | 工具 | 理由（经验证） |
|---|---|---|
| host 编译 | tsc（每包 tsconfig） | 保留文件结构、正确改写 `.ts`→`.js` import、保留动态 import 容错、生成 `.d.ts` |
| client 打包 | esbuild | 官方同款内核；产出 `__ModuleLoader__` 格式 CJS |
| 类型检查 | `tsc --noEmit`（全仓聚合） | 官方同款 |
| 测试 | vitest | 官方同款，用户选定 |

**bun build 已排除**（实测验证）：
- 默认全内联单文件 → 破坏 `index.ts` 里 `await import('./remote.ts')` 的懒加载容错（typert-protocol 不可用时整包失败，而非仅远程面板降级）
- `--no-bundle` 有 bug：import 路径保留 `.ts` 不改写，node 无法加载
- 动态 import 的 `@deepseek-ai/*` external glob 不生效

### 2. 命名与扩展名

- 源码：`src/*.ts`（client 为 `client/index.tsx`）
- 产物：`lib/*.js` + `lib/*.d.ts`（`"type": "module"` 下即 ESM，无 `.mjs`）
- client 产物：`client/client.cjs`（CJS 格式，`.cjs` 扩展名必须保留）
- exports：全部从 `.mjs` 更新为 `.js`

### 3. 每包结构（统一）

```
packages/<pkg>/
├── src/
│   ├── index.ts          # host 插件（apply/name/inject/config）
│   ├── config-store.ts   # 配置持久化
│   ├── remote.ts         # TypertRemoteService（懒加载 typert-protocol）
│   ├── typert.host.ts    # TYPERT 工件常量
│   ├── common.ts         # 仅 sandbox-extra-roots
│   └── dsh.d.ts          # 内置 harness 服务最小类型声明
├── client/
│   ├── index.tsx         # 浏览器 bundle 源码
│   └── client.cjs        # esbuild 产物（构建生成）
├── test/
│   └── *.test.ts         # vitest 测试
├── lib/                  # tsc 产物（构建生成）
├── cordis.patch.yml      # 不变
└── package.json          # exports → ./lib/*.js
```

### 4. 类型策略

- `@deepseek-ai/dsh-typert-protocol` → `Remote`/`TypertRemoteService` 类型（已装）
- `@deepseek-ai/cordis` → `Context`/`Service`（新增 devDependency，类型检查用）
- `@deepseek-ai/schemastery` → 设置 schema 类型（新增 devDependency）
- **harness 服务类型**（`ctx.llm`/`ctx.sessions`/`ctx.sandbox`/`ctx.fs`/`ctx.attachments`/`ctx.workspaceRegistry`…）：DSH 未对外发布完整 ctx 类型，在 `src/dsh.d.ts` 手写最小接口（与现有代码实际使用的字段一一对应），内置在包内、不新增运行时依赖

### 5. 依赖变更

- 新增 devDeps（根 + 各包）：`typescript`、`esbuild`、`vitest`、`@deepseek-ai/cordis`、`@deepseek-ai/schemastery`、`@types/node`
- 运行时依赖不变（各包无运行时依赖，typert-protocol/schemastery 均为懒加载/类型）

### 6. 测试迁移

- `scripts/test.mjs`（1109 行，165 断言）拆分为各包 `test/*.test.ts`
- 保留：fake HOME/DSH_HOME 环境、动态 import 语义、mock ctx 结构
- vitest `describe/it/expect` 重写断言
- CI `test:ci` → `vitest run`

### 7. CI

- `.github/workflows/publish.yml` 测试命令更新为 `vitest run`
- 其余流程（bun install / npm publish OIDC）不变

## 兼容性结论

- 三种加载机制格式不变（host ESM / client CJS bundle / typert 工件）
- 包名与 `cordis.patch.yml` 不变
- exports 路径更新（`.mjs`→`.js`），发布后 profile 通过包名重新解析即自然生效
- 用户明确：不需要向后兼容考虑

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| typert 工件 markers 实例分裂 | 保持 typert.host.ts 独立文件、不 import remote.ts；工件内容纯数据 |
| remote 懒加载容错被破坏 | tsc 保留文件结构 + 动态 import；bun build 已排除 |
| harness 服务类型不全 | `dsh.d.ts` 最小接口 + `unknown` 兜底；tsc --noEmit 全仓把关 |
| client 打包格式偏差 | esbuild 产出后校验 `{id, factory}` 结构 + 现有 client 冒烟测试迁移 |

## 验收标准

1. `tsc --noEmit` 全仓零错误
2. 各包 `lib/*.js` + `.d.ts` 产物生成正确，node 可直接 import 运行
3. `client/client.cjs` 保留 `__ModuleLoader__.load({id, factory})` 结构
4. `vitest run` 全绿（165 断言等量迁移）
5. 包名、cordis.patch.yml、加载机制不变