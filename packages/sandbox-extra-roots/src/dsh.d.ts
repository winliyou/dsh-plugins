import type { Context as CordisContext } from "@deepseek-ai/cordis";

declare module "@deepseek-ai/cordis" {
  interface Context extends CordisContext {
    sandbox: {
      [key: string]: any;
      [key: symbol]: any;
      /** 官方 dsh-sandbox-local 的 confine(argv, policy) 同步返回包装结果
       * ({ argv, enforcement, ... }),并非 Promise。confine 包装按同步消费
       * (wrapped.argv 立即取用);宿主若异步化此处需同步改造。 */
      confine?: (...args: any[]) => { argv: string[]; [key: string]: any };
    };
    fs: {
      [key: string]: any;
      [key: symbol]: any;
      checkedTarget?: (...args: any[]) => Promise<any>;
    };
    sandboxPolicy: {
      /** 宿主契约:dsh-sandbox-policy 的 resolve() 是同步调用,返回普通
       * 对象而非 Promise。checkedTarget 包装依赖该同步性——若宿主改为
       * 异步,包装里 policy.mode 将是 undefined,额外目录在 fs 侧静默
       * 失效;升级 DSH 时请核对该签名。 */
      resolve(): { mode: string; workspaceRoot?: string };
    };
    settings: {
      register(ns: string, schema: any, options?: any): void;
    };
  }
}

declare module "@deepseek-ai/dsh-sandbox" {
  export const canonicalPath: (p: string) => string;
  export const writableRoots: (policy: any) => string[];
}

declare module "@deepseek-ai/node-addon-landlock-run" {
  export function launcherPath(): string;
}