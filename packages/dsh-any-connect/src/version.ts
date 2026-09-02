/**
 * Package version reported by the status CLI and the host heartbeat.
 *
 * Read from package.json at runtime rather than injected by a build-time
 * `define`: this monorepo builds with plain `tsc` (see `scripts/build.mjs`),
 * which has no define facility — the upstream project this package came from
 * used `tsdown`'s `define` for this, and that mechanism does not exist here.
 * Reading the manifest keeps the single source of truth in package.json
 * either way, so a release can never ship artifacts reporting the previous
 * version (the drift that produced issue #1 upstream, where v0.2.2 bundles
 * reported 0.2.1).
 *
 * Resolution is relative to this module, so it works unchanged from
 * `src/version.ts` under vitest and from the built `lib/version.js` — both sit
 * one level below the package root. The fallback keeps a broken install
 * harmless instead of throwing at import time.
 */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

function readVersion(): string | undefined {
  try {
    const pkg = require('../package.json') as { version?: unknown }
    return typeof pkg.version === 'string' ? pkg.version : undefined
  } catch {
    return undefined
  }
}

export const ANYCONNECT_VERSION: string = readVersion() ?? '0.0.0-dev'
