# Changelog

## [0.9.0](https://github.com/winliyou/dsh-plugins) (2026-08-25)

### Features

* 设置卡片按语义分组折叠（首轮锚定 / 极简提示词层 / 高级 JSON 默认收起）：20+ 字段不再一屏平铺，渐进披露；分组头带 `aria-expanded`
* `bootstrap.maxTokens` 数字输入改草稿态：编辑期保留原始输入（清空/删改中间态不立即跳回 0），失焦才归一化显示，消除输入被强制改写的突兀感

### Bug Fixes

* `session/event` 处理器对 `agents.get(session.id)` 的 `agent.id === session.id` 隐含契约加防御性兜底（按 `agent.session.id` 匹配）并注释说明：未来二者分离时晋升信号不再静默丢配导致 bootstrap restrict 不释放
* 修复 `applyFamilies` 的 JSDoc 注释与函数签名挤在同一行的格式瑕疵

## [0.8.0](https://github.com/winliyou/dsh-plugins) (2026-08-22)

### Features

* **`keywordMatchMode` config** (`smart`(default) | `substring` | `word`): escalation keywords containing CJK keep substring matching (CJK has no word boundaries — `\b` would never match a pure-CJK keyword), pure-ASCII words match on word boundaries via lookarounds (`(?<![a-z0-9_])kw(?![a-z0-9_])`, more predictable than `\b`). Statement text like "the goal is to refactor" or "goalish" no longer falsely escalates the goal family on the substring "goal"; `substring` restores pre-0.8.0 behavior; validated in `remote.set` and normalized with fallback
* explicit empty arrays are now legal values for all string-list config fields (`presets`, `bootstrap.tools`, family tools/keywords…): previously an emptied list was silently reverted to the default on save, so "apply no preset" was impossible to express

### Bug Fixes

* pre-step injected-context stripping now requires bootstrap enabled: with `bootstrap.enabled=false` injections were stripped while no discovery tools were registered as compensation — unrecoverable context loss
* hot-updating `bootstrap.promoteOn` now takes effect for already-tracked sessions: the phase cache is invalidated and rebuilt from the persistent journal (persistent promotion signals survive the rebuild)
* per-message overhead reduced: composed preset resolved once per agent instead of once per message; suppressed-context-sources Set cached by content key instead of rebuilt per message; preset lookup failure warning capped at 20 occurrences
* settings card: `promoteOn` is a select, `maxTokens` a number input (invalid input can no longer be saved); loading placeholder for `suppressInjectedContext` matches the real default; error notices render in the header badge so they are visible while collapsed; dirty detection compares field-by-field instead of order-sensitive JSON.stringify; error color referenced the non-existent `state-danger-primary` token so errors never rendered red (now `state-error-primary`)
* removed `filterBootstrapMessages` (exact duplicate of `stripSuppressedMessages`); fixed malformed nested JSDoc on dev_tool_search; description truncation operator-precedence bug (`split('\n')[0].slice(...)` could throw under `noUncheckedIndexedAccess` semantics)

## [0.7.3](https://github.com/winliyou/dsh-plugins) (2026-08-22)

### Bug Fixes

* **P0 dev_tool_search used the post-restrict catalog**: tools hidden by restrict layers were undiscoverable/unlockable; it now searches a pre-restrict snapshot captured at agent setup
* **P0 escalate() did not recompute the bootstrap deny set**: after an escalation signal, family tools stayed hidden behind the second restrict layer; escalate now resyncs the keep-set so the release takes effect on the next request
* real Minimal tool pair remounts idempotently via a state key: unrelated hot-updates no longer destroy/recreate persistent PTY bashes (cwd/env/background jobs survive)
* first-round maxTokens cap: listener always registered with in-callback branching (0→N hot-update works; N→0 strips the field instead of injecting 0); promotion strips any cap injected this session including stale values from before a hot-update change
* custom tool families defined in settings survive normalizeConfig (previously silently dropped)
* test mocks made host-faithful (schemas reflect active restrict layers); regression tests added for both P0s

## [0.7.2](https://github.com/winliyou/dsh-plugins) (2026-08-22)

* align with dsh 0.1.0-rc.8 dependency set

## [0.7.0](https://github.com/winliyou/dsh-plugins) (2026-08-18)

### Features

* **first-round anchoring, resident catalog after promotion (anchored-standard semantics).** Only request #1 is composed under Minimal conditions (real Minimal tool pair + minimal persona + suppressed global guide sections + stripped `skill-catalog`/`agent-instructions` injections + suppressed runtime snapshot); after the first persistent promotion signal (first `tool/call` or `assistant/message`) the session enters the **resident phase**: the bootstrap tool pair stays resident together with the discovery tools (`dev_tool_search`/`skill_search`/`skill_load`), the full catalog is unlocked on demand via `dev_tool_search`, and normal context injection becomes visible again. Performance is raised without reducing functionality — dumping the full catalog at promotion pulls the trajectory back to standard-like (the reference implementation's post-promotion regression), so the full catalog is fetched on demand instead. The tool/skill/web-search/plan/goal/subagent/workflow abilities of each mode remain fully available

* **promotion is now persistent.** `scanPhase`/`observePhase` no longer reset on `compaction/end` (epoch-aware boundary removed); promotion is remembered per session like the reference implementation, so resume/reload and post-compaction rounds keep the resident catalog

* **catalog is zero-trimmed by default.** `leanByDefault` defaults to `false`: orchestration tool families (subagent/workflow/ralph/goal) are never hidden unless explicitly opted in. `suppressInjectedContext` defaults to `true` (injections stay stripped for the whole session; visibility is carried by the resident discovery tools — measured: restoring injections after promotion pulls the trajectory back to standard-like, "Let me…" narration returns). Setting it to `false` restores post-promotion injections as an opt-in

* **creator mode (cordis) is a target preset.** `presets` defaults to `["standard", "code", "cordis"]` in the bundle patch, the settings UI, and DEFAULT_CONFIG — the creator preset gets the same minimal-anchored first round

### ⚠ Breaking (config)

* **removed `skillDiscovery`, `instructionHint`, `bootstrap.compactionTools`; restored `bootstrap.discoveryTools`.** Under resident-catalog semantics the on-demand discovery is done by the resident `dev_tool_search`, so the one-shot instruction hint and the post-compaction work set are no longer needed; `bootstrap.discoveryTools` (default `dev_tool_search`/`skill_search`/`skill_load`) is restored as the resident post-promotion discovery set. The discovery tool factories (`createDevToolSearch`/`createSkillSearch`/`createSkillLoad`/`extractSkillBody`) and `loadUnlockedFromEvents` are back; saved configs ignore the removed fields; the settings UI renders the discovery-tools control again; `leanByDefault` keeps its new default (false) while `suppressInjectedContext` defaults to `true`

## [0.6.0](https://github.com/winliyou/dsh-plugins) (2026-08-17)


### ⚠ Breaking (behavior)

* **function-first defaults — every optimization is now opt-in.** The previous defaults broke standard/PTC functionality: tool families removed from the catalog (PTC program calls hit `UNKNOWN_TOOL` outright), skill-catalog/AGENTS.md injections stripped, official prompt sections shadowed, request #1 restricted to two tools. These mechanisms have no lossless form (their savings come from removing context/tools), so `leanByDefault`, `suppressRuntimeContext`, `suppressInjectedContext`, `minimalPrompt.enabled`, and `bootstrap.enabled` all default to **false**: a fresh install is a zero-intervention no-op and official presets keep full functionality. Enable any mechanism on demand from the settings page; compensation paths (keyword/failure-signal escalation, `skill_search` discovery, instruction-hint) activate together with them. Tests now cover both the zero-intervention defaults and each mechanism under explicit opt-in config

## [0.5.3](https://github.com/winliyou/dsh-plugins) (2026-08-17)


### Bug Fixes

* pass the live config snapshot as `base` when registering the settings namespace: without `base`, a schema without defaults (adaptive-perf's `any()`) made `settings.describe()` return `value: undefined`, and the settings page's wire validation (`invalid_type: nonoptional` at `namespaces[n].value`) failed hard, breaking the whole settings UI. With `base` the resolved value is always the full config object

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
