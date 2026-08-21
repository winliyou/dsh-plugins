import type { Context as CordisContext } from "@deepseek-ai/cordis";

declare module "@deepseek-ai/cordis" {
  interface Context extends CordisContext {
    workspaceRegistry: {
      [key: string]: any;
      [key: symbol]: any;
      archivedSessionIds: any;
      enqueueOperation(operation: () => void | Promise<void>): Promise<void>;
      requireState(): { archivedSessionIds: string[]; [key: string]: any };
      setState(next: Record<string, any>): Promise<void> | void;
    };
    sessionPersistence: {
      [key: string]: any;
      [key: symbol]: any;
      list(): Promise<Array<{ id: string; cwd?: string; createdAt?: number; [key: string]: any }>>;
      locate(meta: { id: string; [key: string]: any }): { kind: string; path: string; [key: string]: any };
      readFrom(id: string, offset: number): Promise<{ meta: Record<string, any>; events: Array<any> }>;
    };
    sessions: {
      [key: string]: any;
      [key: symbol]: any;
      get(id: string): any;
    };
  }
}
