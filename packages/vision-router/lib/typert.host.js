/**
 * typert.host.js — 手写的 Typert host 工件（typert-loader 机制）。
 *
 * DSH 的 typert-loader 会为「导出 ./typert 的 loader 条目」把本工件注册进
 * ctx.typert.local，于是 api-gateway 直接认领这些端点。这是官方扩展点：
 * 不依赖 remote.mjs 的 Remote 装饰器 markers（markers 表是 typert-protocol
 * 模块私有的 WeakMap，当插件从 profile 安装、typert-protocol 与 harness
 * 各持一份模块实例时 markers 会丢失，SRC 认领为空，web 设置页报
 * "transport failure ... HTTP 404"）。
 *
 * codec 使用最小透传 schema（{_zod, parse}）：typert-loader 的
 * requireStrictCodec 只校验这两个字段，网关 decode/encode 走 parse 透传，
 * 与 client.cjs 里 $mount 的透传描述符一致。
 */

const passthrough = (value) => value;
const codec = (typeSymbol) => ({
  mode: 'strict',
  typeSymbol,
  schema: { _zod: true, parse: passthrough },
});

export const TYPERT = {
  package: '@chaoset/vision-router',
  face: 'host',
  schemas: [],
  invocations: [
    {
      id: '@chaoset/vision-router#visionRouterConfig/get',
      service: 'visionRouterConfig',
      namespace: 'visionRouterConfig',
      method: 'get',
      invocation: { kind: 'direct' },
      parameters: [],
      result: codec('@chaoset/vision-router/types#VisionConfig'),
      sourceLocation: { file: 'packages/vision-router/lib/remote.mjs', line: 1, column: 1 },
    },
    {
      id: '@chaoset/vision-router#visionRouterConfig/set',
      service: 'visionRouterConfig',
      namespace: 'visionRouterConfig',
      method: 'set',
      invocation: { kind: 'direct' },
      parameters: [
        {
          name: 'partial',
          wire: 'partial',
          source: 'json',
          codec: codec('@chaoset/vision-router/types#PartialVisionConfig'),
        },
      ],
      result: codec('@chaoset/vision-router/types#SetResult'),
      sourceLocation: { file: 'packages/vision-router/lib/remote.mjs', line: 1, column: 1 },
    },
  ],
  model: { services: [], events: [], objects: [] },
};
