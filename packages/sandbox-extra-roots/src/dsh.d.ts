import type { Context as CordisContext } from "@deepseek-ai/cordis";

declare module "@deepseek-ai/cordis" {
  interface Context extends CordisContext {
    sandbox: {
      [key: string]: any;
      [key: symbol]: any;
      confine?: (...args: any[]) => Promise<any>;
    };
    fs: {
      [key: string]: any;
      [key: symbol]: any;
      checkedTarget?: (...args: any[]) => Promise<any>;
    };
    sandboxPolicy: {
      resolve(): Promise<{ mode: string; workspaceRoot?: string }>;
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