# Changelog

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
