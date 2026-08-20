import type { Context as CordisContext } from "@deepseek-ai/cordis";

declare module "@deepseek-ai/cordis" {
  interface Context extends CordisContext {
    llm: {
      [key: string]: any;
      [key: symbol]: any;
      complete?: (...args: any[]) => Promise<any>;
    };
    sessions: {
      [key: string]: any;
      [key: symbol]: any;
    };
    attachments: {
      [key: string]: any;
      [key: symbol]: any;
    };
  }

  interface Events {
    "llm/adapters-updated"(): void;
    "agent/created"(payload: any): void;
    "agent/disposed"(payload: any): void;
  }
}