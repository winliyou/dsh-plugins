import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { remoteMethods } from "@deepseek-ai/dsh-typert-protocol";
import { apply, registerSettingsNamespace } from "../src/index.js";
import { createConfigStore } from "../src/config-store.js";
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

// ── harness ─────────────────────────────────────────────────────────────
const CATALOG: any = {
  "zai-open": [
    { id: "glm-4v-flash", name: "GLM-4V-Flash", inputModalities: ["text", "image"] },
    { id: "glm-5.2", name: "GLM-5.2", inputModalities: ["text"] },
  ],
  deepseek: [{ id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", inputModalities: ["text"] }],
};

function makeHarness() {
  const calls: any = { transcription: 0, downstream: [], vision: [] };
  const llm: any = {
    async listModels(provider: string) {
      return CATALOG[provider] ?? [];
    },
    async listProviders() {
      return [{ id: "zai-open" }, { id: "deepseek" }];
    },
    async resolveModelInfo(provider: string, model: string) {
      const entry = (CATALOG[provider] ?? []).find((m: any) => m.id === model);
      return entry
        ? { provider, id: model, name: entry.name, ...(entry.inputModalities ? { inputModalities: entry.inputModalities } : {}) }
        : { provider, id: model, name: model };
    },
    streamWithRegistration(options: any) {
      if (options.messages && options.messages.length === 1 && options.messages[0].role === "user" && options.messages[0].content.some((b: any) => b.type === "image")) {
        calls.transcription += 1;
        calls.vision.push(options);
        return (async function* () {
          yield { type: "text-delta", text: "图片转述结果" };
          yield { type: "finish", reason: { kind: "success" } };
        })();
      }
      calls.downstream.push(options);
      return (async function* () {
        yield { type: "text-delta", text: "主模型回复" };
        yield { type: "finish", reason: { kind: "success" } };
      })();
    },
    stream(options: any) {
      return this.streamWithRegistration(options);
    },
  };
  const appended: any[] = [];
  const events: Record<string, any[]> = {};
  const ctx: any = {
    llm,
    sessions: {
      get: (id: string) =>
        id === "s9"
          ? { log: [{ type: "step/start", data: { turn: 3, step: 0 } }], append: (t: string, d: any) => appended.push({ t, d }) }
          : undefined,
    },
    attachments: undefined,
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    get(name: string) {
      return this[name];
    },
    on(event: string, listener: any) {
      (events[event] ??= []).push(listener);
    },
    effect(fn: () => void) {
      fn();
    },
    plugin(Cls: any, cfg: any) {
      const saved = this.reflect;
      this.reflect = { provide: () => {}, props: {} };
      try {
        this.gateway = new Cls(this, cfg);
      } finally {
        this.reflect = saved;
      }
    },
  };
  return { calls, llm, appended, events, ctx };
}

const VISION_CONFIG = { visionProvider: "zai-open", visionModel: "glm-4v-flash" };
const REQ = { provider: "deepseek", model: "deepseek-v4-flash", sessionId: "s9" };

function img(attachmentId: string) {
  return { type: "image", attachment: { attachmentId, mediaType: "image/png", bytes: 10, width: 10, height: 10 } };
}

async function sendRequest(h: any, messages: any[]) {
  for await (const _c of h.llm.streamWithRegistration({ ...REQ, messages })) {}
}

function progressCount(h: any) {
  return h.appended.filter((a: any) => a.t === "assistant/chunk" && a.d.chunk.text.includes("已收到图片")).length;
}

describe("vision-router 主流程", () => {
  let h: any;

  beforeEach(() => {
    h = makeHarness();
    apply(h.ctx, VISION_CONFIG);
  });

  it("resolveModelInfo 补 image", async () => {
    const mi = await h.llm.resolveModelInfo("deepseek", "deepseek-v4-flash");
    expect(mi.inputModalities.includes("image")).toBe(true);
  });

  it("含图转述+替换", async () => {
    await sendRequest(h, [{ role: "user", content: [img("a1")] }]);
    expect(h.calls.transcription).toBe(1);
    expect(h.calls.downstream[0].messages[0].content[0].type).toBe("text");
  });

  it("提示 1 次", async () => {
    await sendRequest(h, [{ role: "user", content: [img("a1")] }]);
    expect(progressCount(h)).toBe(1);
  });

  it("转述请求使用详尽 prompt（逐字转录指引）", async () => {
    await sendRequest(h, [{ role: "user", content: [img("a1")] }]);
    expect(h.calls.vision[0].messages[0].content[0].text.includes("逐字转录")).toBe(true);
  });
});

describe("vision-router 追问重看（re-look）", () => {
  let h: any;

  beforeEach(async () => {
    h = makeHarness();
    apply(h.ctx, VISION_CONFIG);
    // 基线：原始含图请求先转述一次（与旧回归脚本主流程段一致）。
    await sendRequest(h, [{ role: "user", content: [img("a1")] }]);
  });

  const followupReq = [
    { role: "user", content: [img("a1")] },
    { role: "assistant", content: [{ type: "text", text: "这张图是一个示例。" }] },
    { role: "user", content: [{ type: "text", text: "左下角写的是什么？" }] },
  ];

  it("追问触发历史图片重新转述", async () => {
    await sendRequest(h, followupReq);
    expect(h.calls.transcription).toBe(2);
  });

  it("重转述请求携带最新问题", async () => {
    await sendRequest(h, followupReq);
    const followVisionText = h.calls.vision[1].messages[0].content[0].text;
    expect(followVisionText.includes("用户当前最新的问题")).toBe(true);
    expect(followVisionText.includes("左下角写的是什么？")).toBe(true);
  });

  it("追问时重新提示", async () => {
    await sendRequest(h, followupReq);
    expect(progressCount(h)).toBe(2);
  });

  it("上下文不变命中缓存", async () => {
    await sendRequest(h, followupReq);
    const visionBeforeRetry = h.calls.transcription;
    const appendedBeforeRetry = h.appended.length;
    await sendRequest(h, followupReq);
    expect(h.calls.transcription).toBe(visionBeforeRetry);
    expect(h.appended.length).toBe(appendedBeforeRetry);
  });

  it("同一图片+不同问题不误用缓存", async () => {
    await sendRequest(h, followupReq);
    await sendRequest(h, [{ role: "user", content: [{ type: "text", text: "图片里的文字是什么？" }, img("a1")] }]);
    expect(h.calls.transcription).toBe(3);
  });

  it("粘贴 raw image 块不崩溃并转述", async () => {
    await sendRequest(h, followupReq);
    await sendRequest(h, [{ role: "user", content: [{ type: "text", text: "图片里的文字是什么？" }, img("a1")] }]);
    const rawPasteBlock = { type: "image", mediaType: "image/png", data: "aGVsbG8=", name: "clipboard.png" };
    await sendRequest(h, [{ role: "user", content: [rawPasteBlock] }]);
    expect(h.calls.transcription).toBe(4);
    expect(h.calls.downstream.at(-1).messages[0].content[0].type).toBe("text");
  });
});

describe("vision-router 来源标注（sourceHint）", () => {
  let h: any;

  beforeEach(() => {
    h = makeHarness();
    apply(h.ctx, VISION_CONFIG);
  });

  it("粘贴图片标注来源（显示名+勿搜索）", async () => {
    const rawPasteBlock = { type: "image", mediaType: "image/png", data: "aGVsbG8=", name: "clipboard.png" };
    await sendRequest(h, [{ role: "user", content: [rawPasteBlock] }]);
    const clipCaption = h.calls.downstream.at(-1).messages[0].content[0].text;
    expect(clipCaption.includes("clipboard.png")).toBe(true);
    expect(clipCaption.includes("不存在于文件系统")).toBe(true);
    expect(clipCaption.includes("不要尝试在文件系统里搜索")).toBe(true);
  });

  it("read_image 图片标注文件路径", async () => {
    const toolImage = img("a2");
    const readImageMsg = [
      {
        role: "user",
        content: [
          { type: "tool-result", toolCallId: "c1", content: [
            { type: "text", text: "<path>/tmp/shot.png</path>\n<type>image</type>\n<content>\nimage/png image, 10x10 px, 10 bytes\n</content>" },
            toolImage,
          ] },
        ],
      },
    ];
    await sendRequest(h, readImageMsg);
    const toolResult = h.calls.downstream.at(-1).messages[0].content[0];
    expect(toolResult.content[1].type === "text" && toolResult.content[1].text.includes("read_image 从文件读取：/tmp/shot.png")).toBe(true);
  });

  it("read_image 信封保留", async () => {
    const toolImage = img("a2");
    const readImageMsg = [
      {
        role: "user",
        content: [
          { type: "tool-result", toolCallId: "c1", content: [
            { type: "text", text: "<path>/tmp/shot.png</path>\n<type>image</type>\n<content>\nimage/png image, 10x10 px, 10 bytes\n</content>" },
            toolImage,
          ] },
        ],
      },
    ];
    await sendRequest(h, readImageMsg);
    const toolResult = h.calls.downstream.at(-1).messages[0].content[0];
    expect(toolResult.content[0].text.includes("<path>/tmp/shot.png</path>")).toBe(true);
  });

  it("本地附件副本路径标注", async () => {
    const durableHome = mkdtempSync(join(tmpdir(), "vr-durable-"));
    const sha = "ab".repeat(32);
    const objectFile = join(durableHome, "attachments", "v1", "objects", "ab", sha);
    mkdirSync(dirname(objectFile), { recursive: true });
    writeFileSync(objectFile, "png");
    process.env.DSH_HOME = durableHome;
    try {
      const durableImage = { type: "image", attachment: { attachmentId: `sha256:${sha}`, mediaType: "image/png", bytes: 3, width: 4, height: 4 } };
      await sendRequest(h, [{ role: "user", content: [durableImage] }]);
      const durableCaption = h.calls.downstream.at(-1).messages[0].content[0].text;
      expect(durableCaption.includes(objectFile)).toBe(true);
      expect(durableCaption.includes("原图副本")).toBe(true);
    } finally {
      process.env.DSH_HOME = fakeHome;
      rmSync(durableHome, { recursive: true, force: true });
    }
  });

  it("sourceHint 关闭不附带来源", async () => {
    h.ctx.gateway.set({ sourceHint: false });
    await sendRequest(h, [{ role: "user", content: [img("a4")] }]);
    const hintOffCaption = h.calls.downstream.at(-1).messages[0].content[0].text;
    expect(hintOffCaption.includes("图片转述结果")).toBe(true);
    expect(hintOffCaption.includes("[图片 1]")).toBe(true);
    expect(hintOffCaption.includes("[图片 1｜")).toBe(false);
  });

  it("sourceHint 拒绝非法值", () => {
    h.ctx.gateway.set({ sourceHint: true });
    expect(() => h.ctx.gateway.set({ sourceHint: "yes" })).toThrow();
  });
});

describe("vision-router 多图位置保留", () => {
  let h: any;

  beforeEach(() => {
    h = makeHarness();
    apply(h.ctx, VISION_CONFIG);
  });

  it("多图逐位替换保留位置", async () => {
    const imgA5 = img("a5");
    const imgA6 = { type: "image", attachment: { attachmentId: "a6", mediaType: "image/jpeg", bytes: 10, width: 10, height: 10 } };
    await sendRequest(h, [{ role: "user", content: [
      { type: "text", text: "对比这两张图" }, imgA5, { type: "text", text: "中间的说明" }, imgA6,
    ] }]);
    const multiBlocks = h.calls.downstream.at(-1).messages[0].content;
    expect(multiBlocks.length).toBe(4);
    expect(multiBlocks[1].text.startsWith("[图片 1｜")).toBe(true);
    expect(multiBlocks[1].text.includes("图片转述结果")).toBe(true);
    expect(multiBlocks[2].text).toBe("中间的说明");
    expect(multiBlocks[3].text.startsWith("[图片 2｜")).toBe(true);
    expect(multiBlocks[3].text.includes("图片转述结果")).toBe(false);
  });

  it("多图联合转述头", async () => {
    const imgA5 = img("a5");
    const imgA6 = { type: "image", attachment: { attachmentId: "a6", mediaType: "image/jpeg", bytes: 10, width: 10, height: 10 } };
    await sendRequest(h, [{ role: "user", content: [
      { type: "text", text: "对比这两张图" }, imgA5, { type: "text", text: "中间的说明" }, imgA6,
    ] }]);
    const multiBlocks = h.calls.downstream.at(-1).messages[0].content;
    expect(multiBlocks[1].text.includes("[视觉模型对全部 2 张图片的分析")).toBe(true);
  });

  it("联合转述一次请求带全部图", async () => {
    const imgA5 = img("a5");
    const imgA6 = { type: "image", attachment: { attachmentId: "a6", mediaType: "image/jpeg", bytes: 10, width: 10, height: 10 } };
    await sendRequest(h, [{ role: "user", content: [
      { type: "text", text: "对比这两张图" }, imgA5, { type: "text", text: "中间的说明" }, imgA6,
    ] }]);
    expect(h.calls.vision.at(-1).messages[0].content.filter((b: any) => b.type === "image").length).toBe(2);
  });
});

describe("vision-router agent 场景（tool-result 无顶层文本）", () => {
  let h: any;

  beforeEach(() => {
    h = makeHarness();
    apply(h.ctx, VISION_CONFIG);
  });

  const agentReq = [
    { role: "user", content: [{ type: "text", text: "看看这个目录里的截图配色" }] },
    { role: "user", content: [{ type: "tool-result", toolCallId: "c9", content: [img("a8")] }] },
  ];

  it("agent tool-result 图回溯任务文本", async () => {
    await sendRequest(h, agentReq);
    const text = h.calls.vision.at(-1).messages[0].content[0].text;
    expect(text.includes("用户当前最新的问题")).toBe(true);
    expect(text.includes("看看这个目录里的截图配色")).toBe(true);
  });

  it("agent 中间轮命中缓存", async () => {
    await sendRequest(h, agentReq);
    const agentVisionCount = h.calls.transcription;
    await sendRequest(h, agentReq);
    expect(h.calls.transcription).toBe(agentVisionCount);
  });

  it("remote 网关注册", () => {
    expect(h.ctx.gateway !== undefined && h.ctx.gateway.get().config.visionProvider === "zai-open").toBe(true);
  });

  it("remote 拒绝非法配置", () => {
    expect(() => h.ctx.gateway.set({ maxVisionTokens: -1 })).toThrow();
  });
});

describe("vision-router 能力提示注入（纯文本模型认知补全）", () => {
  let h: any;

  beforeEach(() => {
    h = makeHarness();
    apply(h.ctx, VISION_CONFIG);
  });

  it("纯文本模型注入；多模态与无路由不注入；销毁释放", async () => {
    const sectionCalls: any[] = [];
    const disposedAgents: string[] = [];
    function makeHintAgent(id: string, provider: string | undefined, model: string | undefined) {
      return {
        id,
        options: { provider, model },
        ctx: { systemPrompt: { section(section: any) { sectionCalls.push({ id, section }); return () => disposedAgents.push(id); } } },
      };
    }
    const textAgent = makeHintAgent("a-text", "deepseek", "deepseek-v4-flash");
    const visionAgent = makeHintAgent("a-vision", "zai-open", "glm-4v-flash");
    const noRouteAgent = makeHintAgent("a-noroute", undefined, undefined);
    for (const listener of h.events["agent/created"] ?? []) {
      listener({ agent: textAgent });
      listener({ agent: visionAgent });
      listener({ agent: noRouteAgent });
    }
    await new Promise((resolve) => setTimeout(resolve, 20)); // 注入异步查模型目录
    const textSections = sectionCalls.filter((c) => c.id === "a-text");
    expect(textSections.length === 1 && textSections[0].section.name === "vision-router:capability"
      && textSections[0].section.text.includes("read_image") && textSections[0].section.text.includes("转述")).toBe(true);
    expect(sectionCalls.filter((c) => c.id === "a-vision").length).toBe(0);
    expect(sectionCalls.filter((c) => c.id === "a-noroute").length).toBe(0);
    for (const listener of h.events["agent/disposed"] ?? []) listener({ agent: textAgent });
    expect(disposedAgents.includes("a-text")).toBe(true);
  });
});

describe("config-store + remote（vision-router）", () => {
  it("store 生命周期与 remote 端点", () => {
    const updates: any[] = [];
    const store = createConfigStore({
      name: "vision-router",
      defaults: { a: 1, b: 2 },
      patchConfig: { b: 20 },
      onUpdate: (merged) => updates.push(merged),
    });
    expect(store.effective().a === 1 && store.effective().b === 20).toBe(true);
    const next = store.set({ b: 200 });
    expect(next.b === 200 && updates.length === 1).toBe(true);
    const fake = Object.create(PluginConfigGateway.prototype) as any;
    fake.store = store;
    expect(remoteMethods(fake).some((m: any) => m.method === "get") && remoteMethods(fake).some((m: any) => m.method === "set")).toBe(true);
    expect(fake.get().config.b === 200 && fake.set({ b: 300 }).saved === true).toBe(true);
  });
});

describe("settings namespace 注册（vision-router）", () => {
  const stubZ: any = {
    object: (fields: any) => ({ stub: "object", fields }),
    any: () => ({ stub: "any" }),
    string: () => ({ stub: "string" }),
  };

  it("注册 namespace 并传 buildSchema 产物与 base", () => {
    const registered: any[] = [];
    const regCtx: any = {
      inject(names: string[], fn: any) { if (names.includes("settings")) fn(regCtx); },
      settings: { register(ns: string, schema: any, options: any) { registered.push({ ns, schema, options }); } },
      logger: { warn: () => {} },
    };
    expect(registerSettingsNamespace(regCtx, "visionRouterConfig", stubZ, (z: any) => z.object({ a: z.string() }), { base: { a: "v" } })).toBe(true);
    expect(registered.length === 1 && registered[0].ns === "visionRouterConfig"
      && registered[0].schema.stub === "object"
      && registered[0].options !== undefined && registered[0].options.base.a === "v").toBe(true);
  });

  it("重复注册静默忽略（HMR/多挂载点幂等）", () => {
    const registered: any[] = [];
    const regCtx: any = {
      inject(names: string[], fn: any) { if (names.includes("settings")) fn(regCtx); },
      settings: { register(ns: string, schema: any, options: any) { registered.push({ ns, schema, options }); } },
      logger: { warn: () => {} },
    };
    registerSettingsNamespace(regCtx, "visionRouterConfig", stubZ, (z: any) => z.object({}));
    regCtx.settings.register = () => { throw new Error('settings namespace "visionRouterConfig" is already registered'); };
    expect(registerSettingsNamespace(regCtx, "visionRouterConfig", stubZ, (z: any) => z.object({}))).toBe(true);
  });

  it("schema 库缺失跳过", () => {
    const regCtx: any = {
      inject(names: string[], fn: any) { if (names.includes("settings")) fn(regCtx); },
      settings: { register() {} },
      logger: { warn: () => {} },
    };
    expect(registerSettingsNamespace(regCtx, "x", null, (z: any) => z.any())).toBe(false);
  });

  it("ctx 无 inject 跳过", () => {
    expect(registerSettingsNamespace({}, "x", stubZ, (z: any) => z.any())).toBe(false);
  });
});