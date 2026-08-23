# Changelog

## [0.3.0](https://github.com/winliyou/dsh-plugins) (2026-08-22)

### Features

* **dangerous-root validation**: `remote.set` rejects canonical `/`, Windows drive roots (`C:` etc.), and the home directory itself with a `TypeError` — granting any of them equals giving up the sandbox boundary; `normalizeRoots` warns and filters system directories (`/etc` `/usr` `/bin` `/sbin`) as a backstop for patch/YAML paths that bypass strict validation; both literal and canonical spellings match, covering macOS `/etc → /private/etc`
* `engines: { node: ">=22.19.0" }` declared

### Bug Fixes

* bwrap/Landlock branches merge official writable roots with extra roots (deduplicated, minus roots the official argv already grants) instead of appending raw extras — no duplicate `--bind`/`--rw` grants, aligned with the Seatbelt table-rebuild semantics
* extra roots are re-canonicalized at each confine/fs-fence call, so symlink redirections are picked up live; the fs fence now filters non-directory roots exactly like the bash side — a configured-but-not-yet-created directory is no longer granted by fs before it exists (behavior change; Seatbelt subpath matching unaffected)
* config-gateway and settings-namespace registration moved after core sandbox wrapping with independent try/catch: a gateway/settings failure can no longer leave the sandbox unextended, and vice versa
* client `locale.register` tolerates duplicate registration (HMR remount) silently and only warns on other errors
* `dsh.d.ts`: `sandboxPolicy.resolve()` is declared synchronous — the host contract is sync; typing it async invited an await that would silently drop extra roots from the fs fence

## [0.2.9](https://github.com/winliyou/dsh-plugins) (2026-08-22)

### Bug Fixes

* fail-safe module init: when `@deepseek-ai/dsh-sandbox` cannot be resolved the plugin degrades to a warned no-op instead of letting a top-level await rejection break harness startup
* settings card keeps the textarea's raw draft text while editing (newlines are parsed only on save) — previously typing `/tmp/a` ⏎ `b` silently merged into `/tmp/a/b`

## [0.2.8](https://github.com/winliyou/dsh-plugins) (2026-08-22)

### Dependencies

* align `@deepseek-ai/*` peers with dsh 0.1.0-rc.8

## [0.2.7](https://github.com/winliyou/dsh-plugins) (2026-08-22)

* republish TypeScript-refactor content (no runtime change)

## [0.2.6](https://github.com/winliyou/dsh-plugins) (2026-08-17)


### Bug Fixes

* pass the live config snapshot as `base` when registering the settings namespace: without `base`, a schema without defaults (adaptive-perf's `any()`) made `settings.describe()` return `value: undefined`, and the settings page's wire validation (`invalid_type: nonoptional` at `namespaces[n].value`) failed hard, breaking the whole settings UI. With `base` the resolved value is always the full config object

## [0.2.5](https://github.com/winliyou/dsh-plugins) (2026-08-17)


### Bug Fixes

* register the config namespace into the host settings service (`ctx.settings.register`) so the settings page's configurable-plugins tab lists it: the tab dispatches cards from `settings.describe()`, and a namespace that was never registered renders nothing even with a correctly keyed card. Registration is visibility-only — the card still reads/writes through the plugin's own config gateway (config.json stays authoritative, hot-reload preserved). Fail-safe when schemastery or the settings service is unavailable; duplicate registrations (HMR) are ignored

## [0.2.4](https://github.com/winliyou/dsh-plugins) (2026-08-17)


### Bug Fixes

* settings card registration: pass `key` (the settings namespace, matching the host-side service key) when registering into `settings.plugin.item` — the host `dsh-client-ui-slots` 0.1.0-rc.7 declares it as a keyed slot, and a registration without `key` fails the whole client bundle apply ("Failed to load plugins: keyed slot requires options.key")

## [0.2.3](https://github.com/winliyou/dsh-plugins) (2026-08-16)


### Bug Fixes

* raise engines.node to >=22.19.0 (node 20 is EOL; aligns with the reference preset baseline and the current LTS floor)

## [0.2.2](https://github.com/winliyou/dsh-plugins/compare/sandbox-extra-roots-v0.2.1...sandbox-extra-roots-v0.2.2) (2026-08-16)


### Bug Fixes

* register config-gateway endpoints via a typert-loader host artifact (lib/typert.host.js) so the api-gateway claims them regardless of module-instance identity ([dsh-plugins#registry-install](https://github.com/winliyou/dsh-plugins))

When the package is installed from the npm registry, its typert-protocol copy differs from the harness's, so the Remote-decorator SRC markers are invisible to the gateway and settings-page calls fail with "transport failure ... HTTP 404". The typert artifact registers the same get/set endpoints into ctx.typert.local through the official loader mechanism.

## [0.2.1](https://github.com/winliyou/dsh-plugins/compare/sandbox-extra-roots-v0.2.0...sandbox-extra-roots-v0.2.1) (2026-08-16)


### Bug Fixes

* mount remote config namespaces in client bundles ([a647484](https://github.com/winliyou/dsh-plugins/commit/a64748489ddf003cb29c0527016ea089748e0c7b))

## [0.2.0](https://github.com/winliyou/dsh-plugins/compare/sandbox-extra-roots-v0.1.2...sandbox-extra-roots-v0.2.0) (2026-08-15)


### Features

* convert plugins to DSH bundle installation ([caae797](https://github.com/winliyou/dsh-plugins/commit/caae797acd12c70af52b0868ec352d91a0a7ef12))
* dsh host plugin packages (vision-router + sandbox-extra-roots) with settings UI, remote config gateway, dual-mode install ([37a3e0d](https://github.com/winliyou/dsh-plugins/commit/37a3e0d39680bc26b4f0756c2ce7779cc4b936d8))
* harden dsh plugins and simplify vision image replacement ([f648237](https://github.com/winliyou/dsh-plugins/commit/f6482373d6b924cc7081a7300f2b4b50b682aaf8))


### Bug Fixes

* lazy-load official deps for file:// deployments; add test suite; docs ([f33dda2](https://github.com/winliyou/dsh-plugins/commit/f33dda2de7df3af7908fd5c2b0595a704c053fe1))
