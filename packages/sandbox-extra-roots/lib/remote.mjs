/**
 * remote.mjs — 插件配置的远程服务（设置页 UI 通过 ctx.remote.<svc> 调用）
 *
 * DSH 的 Remote 装饰器是 ECMAScript 标准装饰器语法（Node 默认未启用），
 * 这里用"手动构造装饰器上下文"的方式等价调用：Remote(name)(method, context)
 * 把标记初始化器收集起来，在模块加载时用 Object.create 模拟实例执行
 * （mark 以实例原型为准，与真实实例化等价）。
 *
 * typert-protocol 惰性加载：npm 模式从包内 node_modules 解析；file:// 模式
 * （~/.dsh/plugins/）从 harness 的 profile 依赖树解析。两者都不可用时
 * 模块加载失败，由 index.mjs 的动态 import 捕获——核心功能不受影响，
 * 仅设置页 UI 的配置读写不可用。
 */

import { createRequire } from "node:module";

const requireSelf = createRequire(import.meta.url);

function loadTypert() {
  try {
    return requireSelf("@deepseek-ai/dsh-typert-protocol");
  } catch {}
  const home = process.env.HOME || "";
  const candidates = [
    `${home}/.dsh/profiles/web/package.json`,
    `${home}/.dsh/profiles/tui/package.json`,
    `${home}/.dsh/profiles/headless/package.json`,
  ];
  for (const base of candidates) {
    try {
      return createRequire(base)("@deepseek-ai/dsh-typert-protocol");
    } catch {}
  }
  throw new Error("typert-protocol is unavailable (neither package deps nor harness profiles resolve it)");
}

const { Remote, TypertRemoteService } = loadTypert();

let pending = [];

/** 手动标记一个类原型方法为 Remote 端点（等价 @Remote(exportName)）。 */
function markRemoteMethod(proto, method, exportName) {
  const initializers = [];
  const context = {
    kind: "method",
    name: method,
    private: false,
    static: false,
    addInitializer(fn) { initializers.push(fn); },
  };
  Remote(exportName ?? method)(proto[method], context);
  pending.push({ initializers });
}

/** 执行收集到的标记（mark 以 Object.getPrototypeOf(this) 为原型）。 */
function runPendingMarks(instance) {
  const batch = pending;
  pending = [];
  for (const { initializers } of batch) {
    for (const init of initializers) init.call(instance);
  }
}

/**
 * 配置远程服务：get() 返回当前生效配置；set(partial) 持久化并热更新。
 * 通过 ctx.plugin(PluginConfigGateway, { store, serviceKey }) 注册。
 * @param ctx - 插件上下文。
 * @param config - { store: createConfigStore 返回的存储, serviceKey: 远程服务名 }。
 */
export class PluginConfigGateway extends TypertRemoteService {
  constructor(ctx, config) {
    super(ctx, config.serviceKey);
    runPendingMarks(this);
    this.store = config.store;
  }
  get() {
    return { config: this.store.effective() };
  }
  set(partial) {
    if (partial === null || typeof partial !== "object" || Array.isArray(partial)) {
      throw new TypeError("set expects a plain config object");
    }
    this.store.set(partial);
    return { saved: true };
  }
}
markRemoteMethod(PluginConfigGateway.prototype, "get");
markRemoteMethod(PluginConfigGateway.prototype, "set");
// 模块加载时立即执行标记（Object.create 模拟实例；构造函数里的 runPendingMarks 幂等保留无害）。
runPendingMarks(Object.create(PluginConfigGateway.prototype));
