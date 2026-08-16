# Changelog

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
