import type { Context as CordisContext } from "@deepseek-ai/cordis";

declare module "@deepseek-ai/cordis" {
  interface Context extends CordisContext {
    agentPresets: {
      [key: string]: any;
      [key: symbol]: any;
      composedPreset(ctx: any): string | undefined;
    };
    settings: {
      [key: string]: any;
      [key: symbol]: any;
      register(ns: string, schema: any, options?: any): void;
    };
    llm: {
      [key: string]: any;
      [key: symbol]: any;
    };
    sessions: {
      [key: string]: any;
      [key: symbol]: any;
    };
    tools: {
      [key: string]: any;
      [key: symbol]: any;
      schemas(agent: any): any[];
      restrict(config: { deny?: string[]; allow?: string[] }): () => void;
    };
    skills: {
      [key: string]: any;
      [key: symbol]: any;
      list(lookup?: any): Promise<any[]>;
      get(name: string, lookup?: any): Promise<any>;
    };
    systemPrompt: {
      [key: string]: any;
      [key: symbol]: any;
      suppressRuntimeContext(): () => void;
      section(section: { name: string; order?: number; text?: string }): () => void;
    };
  }
}
