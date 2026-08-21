import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply, registerSettingsNamespace } from "../src/index.js";
import { PluginConfigGateway } from "../src/remote.js";

const prevHome = process.env.HOME;
const prevDshHome = process.env.DSH_HOME;
let fakeHome: string;

beforeEach(() => {
  fakeHome = mkdtempSync(join(tmpdir(), "vr-fh-"));
  process.env.HOME = fakeHome;
  process.env.DSH_HOME = fakeHome;
});

afterEach(() => {
  process.env.HOME = prevHome;
  process.env.DSH_HOME = prevDshHome;
  rmSync(fakeHome, { recursive: true, force: true });
});

const CATALOG: any = {
  "zai-open": [
    { id: "glm-4v-flash", name: "GLM-4V-Flash", inputModalities: ["text", "image"] },
    { id: "glm-5.2", name: "GLM-5.2", inputModalities: ["text"] },
  ],
  deepseek: [{ id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", inputModalities: ["text"] }],
};

function makeHarness(attachments?: any) {
  const calls: any = { downstream: [], vision: 0 };
  const llm: any = {
    async listModels(provider: string) { return CATALOG[provider] ?? []; },
    async listProviders() { return [{ id: "zai-open" }, { id: "deepseek" }]; },
    async resolveModelInfo(provider: string, model: string) {
      const entry = (CATALOG[provider] ?? []).find((m: any) => m.id === model);
      return entry
        ? { provider, id: model, name: entry.name, ...(entry.inputModalities ? { inputModalities: entry.inputModalities } : {}) }
        : { provider, id: model, name: model };
    },
    streamWithRegistration(options: any) {
      calls.downstream.push(options);
      return (async function* () {
        yield { type: "text-delta", text: "主模型回复" };
        yield { type: "finish", reason: { kind: "success" } };
      })();
    },
    // 真实 dsh 中 stream 与 streamWithRegistration 是两条独立入口；这里独立实现，
    // 并记录调用次数，用于断言“不自动转述”时不会走到视觉模型流。
    async *stream(options: any) {
      calls.vision += 1;
      yield { type: "text-delta", text: "主模型回复" };
      yield { type: "finish", reason: { kind: "success" } };
    },
  };
  const events: Record<string, any[]> = {};
  const ctx: any = {
    llm,
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    get(name: string) { return name === "attachments" ? attachments : this[name]; },
    on(event: string, listener: any) { (events[event] ??= []).push(listener); },
    effect(fn: () => void) { fn(); },
    plugin(Cls: any, cfg: any) {
      const saved = this.reflect;
      this.reflect = { provide: () => {}, props: {} };
      try { this.gateway = new Cls(this, cfg); } finally { this.reflect = saved; }
    },
  };
  return { calls, llm, events, ctx };
}

const REQ = { provider: "deepseek", model: "deepseek-v4-flash", sessionId: "s9" };
function img(attachmentId: string) {
  return { type: "image", attachment: { attachmentId, mediaType: "image/png", bytes: 10, width: 10, height: 10 } };
}
async function sendRequest(h: any, messages: any[]) {
  for await (const _c of h.llm.streamWithRegistration({ ...REQ, messages })) {}
}

describe("resolveModelInfo 补充 image 能力", () => {
  it("为纯文本模型补充 image 模态", async () => {
    const h = makeHarness();
    apply(h.ctx);
    const mi = await h.llm.resolveModelInfo("deepseek", "deepseek-v4-flash");
    expect(mi.inputModalities.includes("image")).toBe(true);
  });
  it("原生多模态模型不被重复添加", async () => {
    const h = makeHarness();
    apply(h.ctx);
    const mi = await h.llm.resolveModelInfo("zai-open", "glm-4v-flash");
    expect(mi.inputModalities.filter((m: string) => m === "image").length).toBe(1);
  });
  it("未知模型也补 image（保证入口与 read_image 门禁放行）", async () => {
    const h = makeHarness();
    apply(h.ctx);
    const mi = await h.llm.resolveModelInfo("deepseek", "unknown-model");
    expect(mi.inputModalities.includes("image")).toBe(true);
  });
  it("解析失败原样抛出（不吞错误）", async () => {
    const h = makeHarness();
    const orig = h.llm.resolveModelInfo;
    h.llm.resolveModelInfo = () => { throw new Error("boom"); };
    apply(h.ctx);
    await expect(h.llm.resolveModelInfo("deepseek", "deepseek-v4-flash")).rejects.toThrow("boom");
    h.llm.resolveModelInfo = orig;
  });
});

describe("请求原样透传（主模型决定是否读图）", () => {
  it("不为纯文本模型自动转述历史/当前图片", async () => {
    const h = makeHarness();
    const originalSWR = h.llm.streamWithRegistration;
    apply(h.ctx);
    // 插件不应再包装 streamWithRegistration：模型请求按原样发给主模型，
    // 是否使用 read_image 由主模型自行决定。
    expect(h.llm.streamWithRegistration).toBe(originalSWR);
    const messages = [
      { role: "user", content: [img("a1"), { type: "text", text: "这是什么" }] },
      { role: "assistant", content: [{ type: "text", text: "已经看过了。" }] },
      { role: "user", content: [{ type: "text", text: "那这个呢？" }] },
    ];
    await sendRequest(h, messages);
    expect(h.calls.downstream).toHaveLength(1);
    expect(h.calls.downstream[0].messages).toBe(messages);
    expect(h.calls.vision).toBe(0);
  });
  it("原生多模态模型的图片请求也原样透传", async () => {
    const h = makeHarness();
    apply(h.ctx);
    const messages = [{ role: "user", content: [img("a1")] }];
    for await (const _c of h.llm.streamWithRegistration({ ...REQ, provider: "zai-open", model: "glm-4v-flash", messages }, undefined)) {}
    expect(h.calls.downstream).toHaveLength(1);
    expect(h.calls.downstream[0].messages).toBe(messages);
    expect(h.calls.vision).toBe(0);
  });
});

describe("能力提示（主模型认知补全）", () => {
  function makeHintAgent(id: string, provider?: string, model?: string) {
    return {
      id,
      options: { provider, model },
      ctx: { systemPrompt: { section(section: any) { return () => disposed.push(id); } } },
    };
  }
  const disposed: string[] = [];

  it("纯文本模型注入 read_image 提示，多模态模型不注入，销毁时释放", async () => {
    const h = makeHarness();
    apply(h.ctx);
    const textAgent = makeHintAgent("a-text", "deepseek", "deepseek-v4-flash");
    const visionAgent = makeHintAgent("a-vision", "zai-open", "glm-4v-flash");
    for (const listener of h.events["agent/created"] ?? []) {
      listener({ agent: textAgent });
      listener({ agent: visionAgent });
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
    for (const listener of h.events["agent/disposed"] ?? []) listener({ agent: textAgent });
    // 纯文本模型会注入一次，且随 agent 销毁被释放；多模态模型不注入。
    expect(disposed).toContain("a-text");
    expect(disposed).not.toContain("a-vision");
  });
});

describe("大图压缩（attachments.saveImage）", () => {
  it("包装 saveImage 并放行普通尺寸图片", async () => {
    const saved: any[] = [];
    const attachments = {
      saveImage: async (input: any) => { saved.push(input); return input; },
      validateImage: async () => {},
      imageLimits: { maxImagePixels: 1000 },
    };
    const originalSave = attachments.saveImage;
    const h = makeHarness(attachments);
    apply(h.ctx);
    expect(attachments.saveImage).not.toBe(originalSave);
    const small = { type: "image", mediaType: "image/png", data: Buffer.from("small") };
    await attachments.saveImage(small);
    expect(saved.length).toBe(1);
    expect(saved[0]).toBe(small);
  });
});

describe("配置（config store / gateway）", () => {
  it("默认配置仅含压缩字段，无读图相关字段", async () => {
    const h = makeHarness();
    apply(h.ctx);
    const cfg = h.ctx.gateway.get().config;
    expect(cfg.compressImageBytes).toBe(4194304);
    expect(cfg.compressMaxDimension).toBe(1600);
    expect((cfg as any).visionProvider).toBeUndefined();
    expect((cfg as any).visionModel).toBeUndefined();
    expect((cfg as any).autoDiscover).toBeUndefined();
    expect((cfg as any).maxVisionTokens).toBeUndefined();
    expect((cfg as any).prompt).toBeUndefined();
    expect((cfg as any).sourceHint).toBeUndefined();
  });
  it("非法压缩值被拒绝", async () => {
    const h = makeHarness();
    apply(h.ctx);
    expect(() => h.ctx.gateway.set({ compressImageBytes: -1 })).toThrow();
    expect(() => h.ctx.gateway.set({ compressMaxDimension: 0 })).toThrow();
  });
  it("合法压缩值可保存并热更新", async () => {
    const h = makeHarness();
    apply(h.ctx);
    expect(() => h.ctx.gateway.set({ compressImageBytes: 123 })).not.toThrow();
    expect(h.ctx.gateway.get().config.compressImageBytes).toBe(123);
  });
});

describe("registerSettingsNamespace", () => {
  it("缺 schema 库时安全跳过", () => {
    const ctx: any = { inject: () => {}, logger: { warn: () => {} } };
    expect(registerSettingsNamespace(ctx, "visionRouterConfig", null, (z: any) => z.object({}), {})).toBe(false);
  });
});
