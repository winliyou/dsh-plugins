# Changelog

## [0.4.3](https://github.com/winliyou/dsh-plugins) (2026-08-17)


### Bug Fixes

* pass the live config snapshot as `base` when registering the settings namespace: without `base`, a schema without defaults (adaptive-perf's `any()`) made `settings.describe()` return `value: undefined`, and the settings page's wire validation (`invalid_type: nonoptional` at `namespaces[n].value`) failed hard, breaking the whole settings UI. With `base` the resolved value is always the full config object

## [0.4.2](https://github.com/winliyou/dsh-plugins) (2026-08-17)


### Bug Fixes

* register the config namespace into the host settings service (`ctx.settings.register`) so the settings page's configurable-plugins tab lists it: the tab dispatches cards from `settings.describe()`, and a namespace that was never registered renders nothing even with a correctly keyed card. Registration is visibility-only — the card still reads/writes through the plugin's own config gateway (config.json stays authoritative, hot-reload preserved). Fail-safe when schemastery or the settings service is unavailable; duplicate registrations (HMR) are ignored

## [0.4.1](https://github.com/winliyou/dsh-plugins) (2026-08-17)


### Bug Fixes

* settings card registration: pass `key` (the settings namespace, matching the host-side service key) when registering into `settings.plugin.item` — the host `dsh-client-ui-slots` 0.1.0-rc.7 declares it as a keyed slot, and a registration without `key` fails the whole client bundle apply ("Failed to load plugins: keyed slot requires options.key")

## [0.4.0](https://github.com/winliyou/dsh-plugins) (2026-08-17)


### Features

* **re-look on follow-up**: transcription context and the caption cache key now include the user's latest question (the last non-empty user message in the request). When the user asks for image details in a later turn, historical images are re-transcribed by the vision model with the new question — matching how a native multimodal model re-examines the original image on every turn. Unchanged context (retries, agent tool-loop intermediate turns) still hits the cache
* exhaustive transcription prompt by default: transcribe all visible text verbatim, report chart values and spatial relationships, prioritize text/numbers when length-limited — the caption is consumed by a model that cannot see the image
* multi-image positional replacement: each image is replaced in place by a numbered placeholder with inline provenance; the joint caption sits at the first image's position, preserving "which image goes with which text" semantics
* transcribe multiple image-bearing messages in parallel, and show the progress hint at most once per request (no spam when a follow-up re-transcribes several historical images)

## [0.3.0](https://github.com/winliyou/dsh-plugins) (2026-08-17)


### Features

* annotate transcribed captions with image provenance (`sourceHint`, default on): images inside `read_image` tool results carry the `<path>` envelope's file path; pasted/dragged chat images get an explicit "no on-disk source file, do not search the filesystem" note plus the DSH durable object path (`$DSH_HOME/attachments/v1/objects/…`) when the sha256 attachment id resolves, so the text-only model no longer burns turns hunting for a file that may not exist

## [0.2.3](https://github.com/winliyou/dsh-plugins) (2026-08-16)


### Bug Fixes

* raise engines.node to >=22.19.0 (node 20 is EOL; aligns with the reference preset baseline and the current LTS floor)

## [0.2.2](https://github.com/winliyou/dsh-plugins/compare/vision-router-v0.2.1...vision-router-v0.2.2) (2026-08-16)


### Bug Fixes

* register config-gateway endpoints via a typert-loader host artifact (lib/typert.host.js) so the api-gateway claims them regardless of module-instance identity ([dsh-plugins#registry-install](https://github.com/winliyou/dsh-plugins))

When the package is installed from the npm registry, its typert-protocol copy differs from the harness's, so the Remote-decorator SRC markers are invisible to the gateway and settings-page calls fail with "transport failure ... HTTP 404". The typert artifact registers the same get/set endpoints into ctx.typert.local through the official loader mechanism.

## [0.2.1](https://github.com/winliyou/dsh-plugins/compare/vision-router-v0.2.0...vision-router-v0.2.1) (2026-08-16)


### Features

* convert plugins to DSH bundle installation ([caae797](https://github.com/winliyou/dsh-plugins/commit/caae797acd12c70af52b0868ec352d91a0a7ef12))
* dsh host plugin packages (vision-router + sandbox-extra-roots) with settings UI, remote config gateway, dual-mode install ([37a3e0d](https://github.com/winliyou/dsh-plugins/commit/37a3e0d39680bc26b4f0756c2ce7779cc4b936d8))
* harden dsh plugins and simplify vision image replacement ([f648237](https://github.com/winliyou/dsh-plugins/commit/f6482373d6b924cc7081a7300f2b4b50b682aaf8))


### Bug Fixes

* mount remote config namespaces in client bundles ([a647484](https://github.com/winliyou/dsh-plugins/commit/a64748489ddf003cb29c0527016ea089748e0c7b))
* remove sharp from vision-router optional deps to avoid pnpm build approval ([00a72fb](https://github.com/winliyou/dsh-plugins/commit/00a72fb1eea940b781575886ce1136abc6eb4993))

## [0.2.0](https://github.com/winliyou/dsh-plugins/compare/vision-router-v0.1.2...vision-router-v0.2.0) (2026-08-15)


### Features

* convert plugins to DSH bundle installation ([caae797](https://github.com/winliyou/dsh-plugins/commit/caae797acd12c70af52b0868ec352d91a0a7ef12))
* dsh host plugin packages (vision-router + sandbox-extra-roots) with settings UI, remote config gateway, dual-mode install ([37a3e0d](https://github.com/winliyou/dsh-plugins/commit/37a3e0d39680bc26b4f0756c2ce7779cc4b936d8))
* harden dsh plugins and simplify vision image replacement ([f648237](https://github.com/winliyou/dsh-plugins/commit/f6482373d6b924cc7081a7300f2b4b50b682aaf8))


### Bug Fixes

* remove sharp from vision-router optional deps to avoid pnpm build approval ([00a72fb](https://github.com/winliyou/dsh-plugins/commit/00a72fb1eea940b781575886ce1136abc6eb4993))
