// @ts-nocheck
/**
 * typert.host.js — 手写的 Typert host 工件（typert-loader 机制）。
 *
 * 通过 typert-loader 把端点注册
 * 进 ctx.typert.local，避免依赖 Remote 装饰器 markers（typert-protocol
 * 双实例时 markers 丢失导致 SRC 认领为空、web 设置页 404）。
 */

const passthrough = (value) => value;
const codec = (typeSymbol) => ({
  mode: 'strict',
  typeSymbol,
  schema: { _zod: true, parse: passthrough },
});

export const TYPERT = {
  package: '@chaoset/adaptive-perf',
  face: 'host',
  schemas: [],
  invocations: [
    {
      id: '@chaoset/adaptive-perf#adaptivePerfConfig/get',
      service: 'adaptivePerfConfig',
      namespace: 'adaptivePerfConfig',
      method: 'get',
      invocation: { kind: 'direct' },
      parameters: [],
      result: codec('@chaoset/adaptive-perf/types#AdaptivePerfConfig'),
      sourceLocation: { file: 'packages/adaptive-perf/src/remote.ts', line: 1, column: 1 },
    },
    {
      id: '@chaoset/adaptive-perf#adaptivePerfConfig/set',
      service: 'adaptivePerfConfig',
      namespace: 'adaptivePerfConfig',
      method: 'set',
      invocation: { kind: 'direct' },
      parameters: [
        {
          name: 'partial',
          wire: 'partial',
          source: 'json',
          codec: codec('@chaoset/adaptive-perf/types#PartialAdaptivePerfConfig'),
        },
      ],
      result: codec('@chaoset/adaptive-perf/types#SetResult'),
      sourceLocation: { file: 'packages/adaptive-perf/src/remote.ts', line: 1, column: 1 },
    },
  ],
  model: { services: [], events: [], objects: [] },
};
