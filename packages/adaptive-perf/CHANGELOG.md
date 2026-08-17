# Changelog

## [0.5.2](https://github.com/winliyou/dsh-plugins) (2026-08-17)


### Bug Fixes

* register the config namespace into the host settings service (`ctx.settings.register`) so the settings page's configurable-plugins tab lists it: the tab dispatches cards from `settings.describe()`, and a namespace that was never registered renders nothing even with a correctly keyed card. Registration is visibility-only — the card still reads/writes through the plugin's own config gateway (config.json stays authoritative, hot-reload preserved). Fail-safe when schemastery or the settings service is unavailable; duplicate registrations (HMR) are ignored

## [0.5.1](https://github.com/winliyou/dsh-plugins) (2026-08-17)


### Bug Fixes

* settings card registration: pass `key` (the settings namespace, matching the host-side service key) when registering into `settings.plugin.item` — the host `dsh-client-ui-slots` 0.1.0-rc.7 declares it as a keyed slot, and a registration without `key` fails the whole client bundle apply ("Failed to load plugins: keyed slot requires options.key")

## [0.5.0](https://github.com/winliyou/dsh-plugins) (2026-08-16)


### Features

* real Minimal tool pair on request #1 (`bootstrap.realPair`)

The bootstrap phase previously only *narrowed* the standard/PTC catalog, so
request #1 still exposed the sandboxed standard `bash` schema (and no
`str_replace_editor` at all — the standard preset does not mount it).
Per dsh-anchored-standard issue #11 the first-request trajectory is decided
by the *byte-identical* tool schema: the real Minimal pair anchors 5/5 while
every standard-family schema (including sandboxed bash) falls standard-like
11/11. The plugin now mounts the official minimal-preset plugins — the
persistent PTY bash (`@deepseek-ai/dsh-tool-bash-persistent` over
`dsh-terminal` + `dsh-terminal-bash`, with the exact minimal description)
and `str_replace_editor` over the bare local fs (`dsh-fs-local`) — into each
target agent's scoped tool layer, where scoped registrations shadow the
inherited sandboxed `bash` by name and own-layer registrations are exempt
from restrictions. The `tool:bash` guidance section is shadowed to empty at
the same time. The packages are optionalDependencies; when they cannot be
resolved (or on Windows, where the PTY backend is unavailable) the plugin
degrades to the previous catalog-only behavior with a warning.

* permanent injected-context suppression (`suppressInjectedContext`)

The skill-catalog reminder and the AGENTS.md digest were previously stripped
only on request #1 and re-injected after promotion. The reference implementation
removes both injections entirely: even post-promotion they perturb the
trajectory and cost thousands of tokens per request. With
`suppressInjectedContext: true` (default) the strip now applies to every
request of the session; `skill_search` / `skill_load` (resident after
promotion, gated by `skillDiscovery`) replace the ~9KB catalog dump, and the
new one-shot `instruction-hint` (`instructionHint`, default on) tells the
model once per session that instruction files exist and should be read when
relevant, instead of embedding their content. User-initiated skill gestures
(`skill-invocation`) are never filtered.

* resident discovery set now includes skill_search / skill_load

`bootstrap.discoveryTools` defaults to `[dev_tool_search, skill_search,
skill_load]` so the promoted catalog keeps the on-demand discovery surface of
the reference's resident set; skills stay reachable while the catalog
injection stays off.

## [0.4.0](https://github.com/winliyou/dsh-plugins) (2026-08-16)


### Features

* minimal-prompt layer (register anchoring, per dsh-anchored-standard)

The reference's full anchoring condition is the *complete minimal system
prompt*, not just the tool catalog: tool narrowing alone leaves the global
orientation sections (harness:identity / harness:source / app:web-surface)
and the standard persona in the prompt, and the model keeps narrating in the
standard-like register ("Let me…" thinking chains). The new `minimalPrompt`
layer shadows those sections to empty per target agent (same effect as
minimal's `complete` persona; plan-mode and the PTC SDK sections are
untouched) and shadows `deployment:persona` with the exact minimal-mode text
("You are a helpful software engineer assistant."), so the assembled system
prompt for standard / PTC sessions drops to the minimal register from request
#1 onward — including for resumed/already-promoted sessions, which the
bootstrap phase never touches. All knobs are configurable and hot-applied
(`minimalPrompt.enabled` / `.persona` / `.suppressSections`).

## [0.3.2](https://github.com/winliyou/dsh-plugins) (2026-08-16)


### Bug Fixes

* bootstrap tool narrowing now uses tools.restrict instead of filtering assembly.tools

In PTC/code mode the assembled tool catalog contains only run_code, so
filtering it down to the Minimal pair always hit the fail-safe and the
first request kept the full SDK (verified live: the model still saw 15
tools). tools.restrict drives both the API catalog and the PTC SDK
reference section (the same mechanism the family trimming uses), so the
bootstrap phase now temporarily denies everything except
run_code + the Minimal pair (plus the post-compaction work set) and
lifts the restriction on the first durable promotion signal. Verified
live: on request #1 the model reports run_code as the only direct tool
and the SDK declarations contain only the Minimal pair.

## [0.3.1](https://github.com/winliyou/dsh-plugins) (2026-08-16)


### Bug Fixes

* raise engines.node to >=22.19.0 (node 20 is EOL; aligns with the reference preset baseline and the current LTS floor)

## [0.3.0](https://github.com/winliyou/dsh-plugins/compare/adaptive-perf-v0.2.2...adaptive-perf-v0.3.0) (2026-08-16)


### Features

* first-request bootstrap anchoring (inspired by dsh-anchored-standard)

Request #1 for target presets now exposes only the real Minimal tool pair
(bash + str_replace_editor) and strips auto-injected context
(skill-catalog reminder, AGENTS.md digest), which anchors the first-request
trajectory on minimal conditions (the community measurements: the Minimal
pair anchors 5/5 at the adapter-default budget while every standard-family
schema falls into standard-like behavior 11/11, and a present skill catalog
breaks the anchor 0/9). The session promotes after its first durable
tool/call or assistant/message (promoteOn: either, or tool-call /
assistant-message) — phase derived from durable session events, resume-safe.
A compaction resets the phase (epoch-aware): after compaction/end the
session falls back to the bootstrap pair plus a configurable compactionTools
work set until a new promotion signal. bootstrap.maxTokens optionally caps
request #1's output budget and is stripped after promotion.

Wiring uses the harness's public waterfalls: system-prompt/assemble (tool
catalog narrowing), agent/pre-step (context stripping, prepend-registered so
the strip is the final transform), agent/request (budget cap), and
session/event (phase feed). Degrades to the full catalog on any filter
failure so a plugin bug can never brick a session.

## [0.2.2](https://github.com/winliyou/dsh-plugins/compare/adaptive-perf-v0.2.1...adaptive-perf-v0.2.2) (2026-08-16)


### Bug Fixes

* register config-gateway endpoints via a typert-loader host artifact (lib/typert.host.js) so the api-gateway claims them regardless of module-instance identity ([dsh-plugins#registry-install](https://github.com/winliyou/dsh-plugins))

When the package is installed from the npm registry, its typert-protocol copy differs from the harness's, so the Remote-decorator SRC markers are invisible to the gateway and settings-page calls fail with "transport failure ... HTTP 404". The typert artifact registers the same get/set endpoints into ctx.typert.local through the official loader mechanism.

## [0.2.1](https://github.com/winliyou/dsh-plugins/compare/adaptive-perf-v0.2.0...adaptive-perf-v0.2.1) (2026-08-16)


### Bug Fixes

* mount remote config namespaces in client bundles ([a647484](https://github.com/winliyou/dsh-plugins/commit/a64748489ddf003cb29c0527016ea089748e0c7b))

## [0.2.0](https://github.com/winliyou/dsh-plugins/compare/adaptive-perf-v0.1.2...adaptive-perf-v0.2.0) (2026-08-15)


### Features

* convert plugins to DSH bundle installation ([caae797](https://github.com/winliyou/dsh-plugins/commit/caae797acd12c70af52b0868ec352d91a0a7ef12))
