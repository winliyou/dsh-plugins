/**
 * remote.ts — 归档管理插件的远程服务（侧边栏归档面板通过 ctx.remote.sessionArchive 调用）
 *
 * DSH 的 Remote 装饰器是 ECMAScript 标准装饰器语法（Node 默认未启用），
 * 这里用"手动构造装饰器上下文"的方式等价调用：Remote(name)(method, context)
 * 把标记初始化器收集起来，在模块加载时用 Object.create 模拟实例执行
 * （mark 以实例原型为准，与真实实例化等价）。
 *
 * typert-protocol 惰性加载：npm 模式从包内 node_modules 解析；file:// 模式
 * （~/.dsh/plugins/）从 harness 的 profile 依赖树解析。两者都不可用时
 * 模块加载失败，由 index.ts 的动态 import 捕获——核心 host 逻辑照常注册，
 * 仅侧边栏面板的远程读写不可用。
 */

import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Context } from "@deepseek-ai/cordis";
import type { ConfigStore } from "./config-store.js";

// @deepseek-ai/dsh-typert-protocol 是 ESM 包。Node 20 早期版本尚不支持
// require(ESM)，因此统一用 import() 加载；fallback 时先用 createRequire
// 解析出实际文件，再以 file URL 导入。
async function loadTypert(): Promise<typeof import("@deepseek-ai/dsh-typert-protocol")> {
  try {
    return await import("@deepseek-ai/dsh-typert-protocol");
  } catch {}
  const dshHome = process.env.DSH_HOME?.trim() ? resolve(process.env.DSH_HOME) : join(homedir(), ".dsh");
  const candidates = [
    join(dshHome, "profiles", "web", "package.json"),
    join(dshHome, "profiles", "tui", "package.json"),
    join(dshHome, "profiles", "headless", "package.json"),
  ];
  for (const base of candidates) {
    try {
      const resolved = createRequire(base).resolve("@deepseek-ai/dsh-typert-protocol");
      return await import(pathToFileURL(resolved).href);
    } catch {}
  }
  throw new Error("typert-protocol is unavailable (neither package deps nor harness profiles resolve it)");
}

const { Remote, TypertRemoteService } = await loadTypert();

let pending: Array<{ initializers: Array<() => void> }> = [];

/** 手动标记一个类原型方法为 Remote 端点（等价 @Remote(exportName)）。 */
function markRemoteMethod(proto: object, method: string, exportName?: string) {
  const initializers: Array<() => void> = [];
  const context = {
    kind: "method",
    name: method,
    private: false,
    static: false,
    addInitializer(fn: () => void) { initializers.push(fn); },
  } as any;
  Remote(exportName ?? method)((proto as any)[method], context);
  pending.push({ initializers });
}

/** 执行收集到的标记（mark 以 Object.getPrototypeOf(this) 为原型）。 */
function runPendingMarks(instance: object) {
  const batch = pending;
  pending = [];
  for (const { initializers } of batch) {
    for (const init of initializers) init.call(instance);
  }
}

/**
 * 归档管理远程服务：list 列出归档会话；detail 读取会话内容；
 * delete 批量删除归档会话（文件删除，归档集合保留 ghost id 防止内存会话
 * 重现侧边栏）；unarchive 批量恢复归档（仅限仍存在文件的会话）。
 * 所有逻辑委托给 host 模块（lib/index.ts 传入的 archiveHost）。
 * @param ctx - 插件上下文。
 * @param config - { host: archiveHost, serviceKey: 远程服务名 }。
 */
export class SessionArchiveGateway extends TypertRemoteService {
  private host: any;
  constructor(ctx: Context, config: { host: any; serviceKey: string }) {
    super(ctx, config.serviceKey);
    runPendingMarks(this);
    this.host = config.host;
  }
  list() {
    return this.host.list();
  }
  detail(sessionId: string) {
    if (typeof sessionId !== "string" || sessionId.length === 0) {
      throw new TypeError("detail expects a session id string");
    }
    return this.host.detail(sessionId);
  }
  delete(sessionIds: string[]) {
    if (!Array.isArray(sessionIds) || sessionIds.some((id) => typeof id !== "string")) {
      throw new TypeError("delete expects an array of session id strings");
    }
    return this.host.deleteArchived(sessionIds);
  }
  unarchive(sessionIds: string[]) {
    if (!Array.isArray(sessionIds) || sessionIds.some((id) => typeof id !== "string")) {
      throw new TypeError("unarchive expects an array of session id strings");
    }
    return this.host.unarchive(sessionIds);
  }
}
markRemoteMethod(SessionArchiveGateway.prototype, "list");
markRemoteMethod(SessionArchiveGateway.prototype, "detail");
markRemoteMethod(SessionArchiveGateway.prototype, "delete");
markRemoteMethod(SessionArchiveGateway.prototype, "unarchive");
// 模块加载时立即执行标记（Object.create 模拟实例；构造函数里的 runPendingMarks 幂等保留无害）。
runPendingMarks(Object.create(SessionArchiveGateway.prototype));
