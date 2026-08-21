/**
 * vision-router — 图片多模态能力注入插件（@chaoset/vision-router）
 *
 * 本插件不做任何图片理解/转述：读图完全交给主模型自行调用 read_image。
 * 插件只做三件事，均为"让模型具备读图能力"，绝不替模型看图片：
 *   1. 能力声明：包装 resolveModelInfo，为纯文本模型补充 image 输入模态声明，
 *      让会话入口与 read_image 工具门禁放行——模型"看得到图"才会去决定读不读。
 *   2. 能力提示：对纯文本模型路由的 agent 注入系统提示，告知 read_image 可用，
 *      引导模型用 read_image 而非 python/脚本猜测图片内容；原生多模态模型不注入。
 *   3. 大图压缩：包装 attachments.saveImage，超过阈值的大图/超像素图自动压缩，
 *      让图片能进入会话并被 read_image 读取（服务端预处理，不涉及图片理解）。
 *
 * 配置：cordis.patch.yml 的 config（安装默认）与
 *       ~/.dsh/plugins/vision-router/config.json（设置页 UI，权威）合并。
 * 仅含压缩相关字段。本文件不依赖任何 dsh 内部包（纯 ESM + ctx.llm）。
 */

import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import { createConfigStore } from './config-store.js';

// remote 服务（设置页 UI 的配置读写）可选：typert-protocol 不可用时
// 动态 import 失败，核心功能（能力声明/提示/压缩）照常工作。
let PluginConfigGateway: any = null;
try {
  ({ PluginConfigGateway } = await import('./remote.js'));
} catch (error) {
  console.warn('vision-router: settings gateway unavailable: ' + ((error as Error)?.message ?? String(error)));
}

// 宿主 settings 体系的 schema 库（dsh-settings 0.1.0-rc.7+ 用 schemastery）。
// DSH profile 的 hoisted node_modules 直接解析；仓库测试环境无此包时为
// null，settings namespace 注册段静默跳过（fail-safe）。
let Schema: any = null;
try {
  ({ default: Schema } = await import('@deepseek-ai/schemastery'));
} catch {}

export const name = 'vision-router';

/** 本插件依赖 llm（能力声明/提示）；attachments 为可选服务，由 ctx.get 获取。 */
export const inject = ['llm'];

/** 默认配置。apply 时与 YAML 传入的 config 合并（cordis 不合并小写 config 导出）。 */
const DEFAULT_CONFIG = {
  /** 超过该字节数的图片在保存前自动压缩（sharp）。 */
  compressImageBytes: 4 * 1024 * 1024,
  /** 压缩后的最大像素边长（fit inside）。视觉模型按 512px 切块计 token，
   * 1600px 约 10 块，远低于上下文上限，且清晰度足够。 */
  compressMaxDimension: 1600,
  /** 压缩后的最大字节数；超出则第二轮降尺寸并转 JPEG。 */
  compressTargetBytes: 2 * 1024 * 1024,
  /** 第二轮回退的最大像素边长。 */
  compressFallbackDimension: 1200,
};

export const config = { ...DEFAULT_CONFIG };

/** 压缩路径的绝对资源上限：超过该上限不再绕过附件服务的原始限制，
 * 避免把“合理大图压缩”变成解压炸弹/内存 DoS 入口。 */
const HARD_MAX_SOURCE_IMAGE_BYTES = 64 * 1024 * 1024;
const HARD_MAX_SOURCE_IMAGE_PIXELS = 64_000_000;

/** 轻量配置校验/归一化：不引入 schema 依赖，但避免 config.json 或 remote.set
 * 写入错误类型后在压缩路径上抛 TypeError。非法字段回退默认值。 */
function positiveInteger(value: number, fallback: number): number {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function normalizeVisionConfig(source: any) {
  const raw = source !== null && typeof source === 'object' && !Array.isArray(source) ? source : {};
  const merged = { ...DEFAULT_CONFIG, ...raw };
  return {
    ...merged,
    compressImageBytes: positiveInteger(merged.compressImageBytes, DEFAULT_CONFIG.compressImageBytes),
    compressMaxDimension: positiveInteger(merged.compressMaxDimension, DEFAULT_CONFIG.compressMaxDimension),
    compressTargetBytes: positiveInteger(merged.compressTargetBytes, DEFAULT_CONFIG.compressTargetBytes),
    compressFallbackDimension: positiveInteger(merged.compressFallbackDimension, DEFAULT_CONFIG.compressFallbackDimension),
  };
}

/** remote.set 的严格校验：非法值直接拒绝并返回错误，而不是静默写坏文件。 */
function validateVisionConfig(partial: any) {
  if (partial === null || typeof partial !== 'object' || Array.isArray(partial)) {
    throw new TypeError('vision-router config must be a plain object');
  }
  const intFields = ['compressImageBytes', 'compressMaxDimension', 'compressTargetBytes', 'compressFallbackDimension'];
  for (const key of intFields) {
    if (partial[key] !== void 0 && !(Number.isInteger(partial[key]) && partial[key] > 0)) {
      throw new TypeError(`vision-router config field "${key}" must be a positive integer`);
    }
  }
}

/** 共享状态（挂在底层 llm 实例上，跨挂载点幂等）。 */
const STATE = Symbol('vision-router.state');
/** cordis traceable 代理暴露底层实例的全局符号。 */
const ORIGINAL = Symbol.for('cordis.original');
/** attachments 包装标记（挂在底层 attachment 实例上）。 */
const ATTACHMENTS_KEY = Symbol.for('vision-router.attachments');

/** 加载 sharp：优先包内 optionalDependencies，失败回退 harness 依赖树。 */
let sharpModule: any = null;
function loadSharp(): any {
  if (sharpModule !== null) return sharpModule;
  // 1) 本包声明的 sharp（optionalDependencies）
  try {
    sharpModule = createRequire(import.meta.url)('sharp');
    return sharpModule;
  } catch {}
  // 2) harness 依赖树（profile 共享 node_modules；尊重 $DSH_HOME）
  const dshHome = process.env.DSH_HOME?.trim() ? resolve(process.env.DSH_HOME) : join(homedir(), '.dsh');
  const candidates = [
    join(dshHome, 'profiles', 'web', 'package.json'),
    join(dshHome, 'profiles', 'tui', 'package.json'),
    join(dshHome, 'profiles', 'headless', 'package.json'),
  ];
  for (const base of candidates) {
    try {
      sharpModule = createRequire(base)('sharp');
      return sharpModule;
    } catch {}
  }
  sharpModule = undefined;
  return sharpModule;
}

/** 检测编码字节的真实光栅格式（与 dsh-attachment 的 MEDIA_TYPES 一致）。 */
export function detectMediaType(buffer: Uint8Array): string | null {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg';
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png';
  if (buffer.length >= 12 && buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) return 'image/webp';
  if (buffer.length >= 6 && buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) return 'image/gif';
  return null;
}

/** 用 sharp 压缩图片：先降像素，仍超字节目标则转 JPEG 再降质量。失败返回 null。
 * 返回的 mediaType 按输出字节实际检测（与源文件类型无关）。 */
export async function compressImage(buffer: any, mediaType: string, cfg: any): Promise<any> {
  const sharp = loadSharp();
  if (sharp === undefined || sharp === null) return null;
  try {
    const animated = mediaType === 'image/gif' || mediaType === 'image/webp';
    const target = sharp(buffer, { failOn: 'none', animated }).rotate().resize({
      width: cfg.compressMaxDimension,
      height: cfg.compressMaxDimension,
      fit: 'inside',
      withoutEnlargement: true,
    });
    // 首选保持原始编码格式：JPEG/PNG/WebP 走原生编码器；GIF 保持动画帧。
    let out;
    if (mediaType === 'image/jpeg') {
      out = await target.jpeg({ quality: 82 }).toBuffer();
    } else if (mediaType === 'image/webp') {
      out = await target.webp({ quality: 82 }).toBuffer();
    } else if (mediaType === 'image/gif') {
      out = await target.gif().toBuffer();
    } else {
      out = await target.png({ compressionLevel: 6 }).toBuffer();
    }
    if (out.byteLength > cfg.compressTargetBytes) {
      const fallback = sharp(buffer, { failOn: 'none', animated }).rotate().resize({
        width: cfg.compressFallbackDimension,
        height: cfg.compressFallbackDimension,
        fit: 'inside',
        withoutEnlargement: true,
      });
      if (mediaType === 'image/gif') {
        // 动图第二轮仍保持 GIF，避免转成静态 JPEG 丢失动画。
        out = await fallback.gif().toBuffer();
      } else if (mediaType === 'image/webp') {
        out = await fallback.webp({ quality: 70 }).toBuffer();
      } else {
        out = await fallback.jpeg({ quality: 70 }).toBuffer();
      }
    }
    if (out.byteLength >= buffer.byteLength) return null;
    return { data: out, mediaType: detectMediaType(out) ?? mediaType };
  } catch (error) {
    try { console.error(`vision-router: compress failed: ${(error as Error)?.message ?? String(error)}`); } catch {}
    return null;
  }
}

/** 解码像素数是否超过上限（sharp 只读头部元数据，代价低）。
 * 解析失败时返回 fallback：常规路径 fail-safe 用 false；硬上限检查用 true（拒绝）。 */
export async function exceedsMaxPixels(buffer: any, maxPixels: any, fallback: boolean = false): Promise<boolean> {
  if (maxPixels === void 0 || maxPixels <= 0) return false;
  const sharp = loadSharp();
  if (sharp === undefined || sharp === null) return fallback;
  try {
    const meta = await sharp(buffer, { failOn: 'none' }).metadata();
    if (!Number.isInteger(meta.width) || !Number.isInteger(meta.height)) return fallback;
    return meta.width * meta.height > maxPixels;
  } catch {
    return fallback;
  }
}

/** 判断目标模型原生是否支持图片输入。
 * 直接读模型目录 listModels——adapter 的目录数据未被任何包装增强，结果最准。
 * 这里仅用于能力提示：原生多模态模型不需要额外提示，纯文本模型需要提示
 * read_image 可用。无法确认时按纯文本模型处理（保守提示）。 */
async function targetSupportsImage(ctx: Context, state: any, options: any): Promise<boolean> {
  const cacheKey = `${options.provider}\u0000${options.model}`;
  const cached = state.targetImageCache.get(cacheKey);
  if (cached !== void 0) return cached;
  let supported = false;
  try {
    const models = await ctx.llm.listModels(options.provider);
    const model = models.find((entry: any) => entry.id === options.model);
    supported = model !== void 0 && model.inputModalities !== void 0 && model.inputModalities.includes('image');
  } catch {
    supported = false;
  }
  state.targetImageCache.set(cacheKey, supported);
  return supported;
}

/** 注入给纯文本模型 agent 的能力提示段：纠正“我不支持图片”的自我认知，
 * 引导模型在需要读图时直接调用 read_image，而不是用 python/脚本猜测。 */
const CAPABILITY_HINT = `## 图片能力（本部署）

当前部署已为纯文本模型开放 read_image 工具所需的图片输入能力。需要查看或分析用户消息中的图片、工作区或工具返回的 PNG/JPEG/WebP/GIF 图片文件时，请直接调用 read_image 读取对应附件/文件，不要用 python/脚本去猜测或分析图片内容。是否读图、什么时候读图由你根据用户意图自行决定。`;

/** 对纯文本模型路由的 agent 注入能力提示段（agent/created）。
 * 模型路由取 agent.options；原生支持图片的模型不注入。fail-safe：任何异常只记日志。 */
async function injectCapabilityHint(ctx: Context, state: any, agent: any): Promise<void> {
  try {
    const provider = agent?.options?.provider;
    const model = agent?.options?.model;
    const sp = agent?.ctx?.systemPrompt;
    if (provider === void 0 || model === void 0 || sp === void 0 || typeof sp.section !== 'function') return;
    const supportsImage = await targetSupportsImage(ctx, state, { provider, model });
    if (supportsImage) return;
    const disposer = sp.section({ name: 'vision-router:capability', order: 45, text: CAPABILITY_HINT });
    if (typeof disposer === 'function') state.promptDisposers.set(agent.id, disposer);
  } catch (error) {
    try { ctx.logger?.warn?.(`vision-router: capability hint skipped: ${(error as Error)?.message ?? String(error)}`); } catch {}
  }
}

/** 把配置 namespace 注册进宿主 settings 体系（dsh-settings 0.1.0-rc.7+）。
 * 设置页 describe() 只枚举 settings.register 注册过的 namespace；本插件
 * 的卡片读写不经过宿主 settings 文档，注册只为让卡片出现在设置页。
 * fail-safe（schema 库/服务缺失静默跳过）+ 幂等（重复注册忽略）。
 * 导出以便测试注入 Schema stub。 */
export function registerSettingsNamespace(ctx: any, ns: string, schemaLib: any, buildSchema: (z: any) => any, options: any): boolean {
  if (schemaLib === null || schemaLib === undefined) return false;
  if (ctx === null || typeof ctx !== 'object' || typeof ctx.inject !== 'function') return false;
  try {
    ctx.inject(['settings'], (settingsCtx: any) => {
      try {
        settingsCtx.settings.register(ns, buildSchema(schemaLib), options);
      } catch (error) {
        const message = String((error as Error)?.message ?? String(error));
        if (!message.includes('already registered')) throw error;
      }
    });
    return true;
  } catch (error) {
    try { ctx.logger?.warn?.(`vision-router: settings namespace registration skipped: ${(error as Error)?.message ?? String(error)}`); } catch {}
    return false;
  }
}

export function apply(ctx: Context, config?: any): void {
  // fail-safe：初始化失败只记录，绝不让本插件拖垮 harness（host 层挂载时
  // entry 异常会导致进程启动失败）。
  try {
    const llm = ctx.llm;
    /** 底层 llm 实例（traceable 代理的 set 落到底层，但 symbol 读取会被代理拦截）。 */
    const raw = llm[ORIGINAL] ?? llm;

    // 幂等：共享状态只初始化一次（跨挂载点），挂载点引用计数。
    const state = raw[STATE] ?? (raw[STATE] = {
      mounts: 0,
      /** 当前生效配置：每次 apply 刷新（热更新立即生效），包装闭包读取它。 */
      cfg: null,
      origResolveModelInfo: null,
      installedResolveModelInfo: null,
      resolveWrapped: false,
      /** 目标模型图片能力缓存（provider/model -> boolean）。 */
      targetImageCache: new Map(),
      /** 已注入能力提示的 agent（agentId -> section disposer）。 */
      promptDisposers: new Map(),
      disposers: [],
    });
    state.mounts += 1;
    const patchConfig = config !== null && typeof config === 'object' && !Array.isArray(config) ? config : {};
    state.cfg = normalizeVisionConfig(patchConfig);

    // 卸载计数：在继续初始化之前登记，后续任何 setup 失败也由本 fiber 负责递减，
    // 不会泄漏挂载点计数。最后一次退出才还原包装。
    ctx.effect(() => () => {
      state.mounts -= 1;
      if (state.mounts <= 0) {
        for (const disposer of state.promptDisposers.values()) {
          try { disposer(); } catch {}
        }
        state.promptDisposers.clear();
        for (const fn of state.disposers) {
          try { fn(); } catch {}
        }
        state.disposers = [];
        state.resolveWrapped = false;
        state.installedResolveModelInfo = null;
        state.targetImageCache.clear();
        try { delete raw[STATE]; } catch {}
      }
    });

    // 配置存储：patch config 为低优先级，config.json（设置页 UI）权威。
    // onUpdate 把 UI 保存的改动热更新进 state.cfg（同样经过归一化）。
    const store = createConfigStore({
      name: 'vision-router',
      defaults: DEFAULT_CONFIG,
      patchConfig,
      validate: validateVisionConfig,
      warn: (message) => ctx.logger?.warn?.(`vision-router: ${message}`),
      onUpdate: (merged) => {
        state.cfg = normalizeVisionConfig({ ...patchConfig, ...merged });
      },
    });
    state.cfg = normalizeVisionConfig(store.effective());

    // 模型目录可能随时注册/注销（HMR、provider 配置变更）。目录变化后必须
    // 失效目标模型能力缓存，否则能力提示会基于已下线/新增的模型状态。
    ctx.on?.('llm/adapters-updated', () => {
      state.targetImageCache.clear();
    });

    // ── 能力提示（模型认知补全）──────────────────────────────────────────
    // 纯文本模型通常自认“不支持图片”，不会主动使用 read_image；这里对纯文本
    // 模型路由的 agent 注入一段系统提示，告知 read_image 可用、由模型自行决定
    // 何时读图。原生多模态模型不注入（无谓噪声）。监听随本插件 fiber 自动销毁。
    ctx.on?.('agent/created', ({ agent }: any) => {
      void injectCapabilityHint(ctx, state, agent);
    });
    ctx.on?.('agent/disposed', ({ agent }: any) => {
      const disposer = state.promptDisposers.get(agent?.id);
      if (disposer !== undefined) {
        try { disposer(); } catch {}
        state.promptDisposers.delete(agent.id);
      }
    });

    // 远程配置服务（设置页 UI 读写；typert 不可用时跳过）
    if (PluginConfigGateway !== null) {
      ctx.plugin(PluginConfigGateway, { store, serviceKey: 'visionRouterConfig' });
    }

    // 注册进宿主 settings 体系（可见性）：设置页的 configurable-plugins 标签
    // 用 settings.describe() 枚举 registrations，未注册的 namespace 即使卡片
    // 带了正确的 key 也不渲染。注册只提供 describe 元数据；卡片的实际读写
    // 仍走上面的 config gateway（config.json 权威、热更新）。
    registerSettingsNamespace(ctx, 'visionRouterConfig', Schema, (z) => z.object({
      compressImageBytes: z.number().default(DEFAULT_CONFIG.compressImageBytes),
      compressMaxDimension: z.number().default(DEFAULT_CONFIG.compressMaxDimension),
      compressTargetBytes: z.number().default(DEFAULT_CONFIG.compressTargetBytes),
      compressFallbackDimension: z.number().default(DEFAULT_CONFIG.compressFallbackDimension),
    }), { base: state.cfg });

    // ── 大图压缩：包装 attachments.saveImage ──────────────────────────────
    // 与 llm 包装相互独立：每次 apply 都尝试（attachments 后挂载也能补装），
    // 已包装（ATTACHMENTS_KEY 标记）则跳过。图片先在浏览器端按 limits 检查、
    // 在服务端 saveImage 校验。本插件把超过阈值（字节或解码像素）的图片压缩
    // 后再保存（sharp），让大图也能进入会话并送达 read_image。fail-safe：压缩
    // 不可用/失败时保持原样（由放宽后的 limits 放行）。
    const att = ctx.get('attachments');
    if (att !== void 0) {
      const rawAtt = att[ORIGINAL] ?? att;
      if (rawAtt.saveImage !== void 0 && rawAtt[ATTACHMENTS_KEY] === void 0) {
        const origSave = rawAtt.saveImage.bind(rawAtt);
        const origValidate = rawAtt.validateImage !== void 0 ? rawAtt.validateImage.bind(rawAtt) : null;
        // validateImage：字节/像素超限放行（大图由 saveImage 压缩处理），
        // 其余校验（格式、魔数）保留。
        if (origValidate !== null) {
          rawAtt.validateImage = async (input: any) => {
            try {
              await origValidate(input);
            } catch (error) {
              const err = error as any;
              if (!(err && (err.code === 'IMAGE_TOO_LARGE' || err.code === 'IMAGE_TOO_MANY_PIXELS'))) throw error;
              // 只对“可安全压缩”的大图绕过原始限制；超过绝对硬上限或无法
              // 可靠读取像素数时保留原始错误（fail closed）。
              if (err.code === 'IMAGE_TOO_LARGE') {
                if (input.data.byteLength > HARD_MAX_SOURCE_IMAGE_BYTES) throw error;
                return;
              }
              const overHardPixelLimit = await exceedsMaxPixels(input.data, HARD_MAX_SOURCE_IMAGE_PIXELS, true);
              if (overHardPixelLimit) throw error;
              return;
            }
          };
        }
        // saveImage：字节超阈值或解码像素超限的图先压缩再保存。
        rawAtt.saveImage = async (input: any) => {
          try {
            if (input && input.data) {
              const current = state.cfg;
              // 超过绝对硬上限时不进入 sharp，交给原始 saveImage 按服务限制失败。
              if (input.data.byteLength <= HARD_MAX_SOURCE_IMAGE_BYTES) {
                const overHardPixels = await exceedsMaxPixels(input.data, HARD_MAX_SOURCE_IMAGE_PIXELS, false);
                if (!overHardPixels) {
                  const overBytes = input.data.byteLength > current.compressImageBytes;
                  let overPixels = false;
                  if (!overBytes) {
                    overPixels = await exceedsMaxPixels(input.data, rawAtt.imageLimits?.maxImagePixels);
                  }
                  if (overBytes || overPixels) {
                    const compressed = await compressImage(Buffer.from(input.data), input.mediaType, current);
                    if (compressed !== null) {
                      input = { ...input, data: compressed.data, mediaType: compressed.mediaType };
                    }
                  }
                }
              }
            }
          } catch (error) {
            try { ctx.logger.warn(`vision-router: pre-save compression skipped: ${(error as Error)?.message ?? String(error)}`); } catch {}
          }
          return origSave(input);
        };
        rawAtt[ATTACHMENTS_KEY] = true;
        state.disposers.push(() => {
          if (rawAtt.saveImage !== void 0 && rawAtt.saveImage !== origSave) rawAtt.saveImage = origSave;
          if (origValidate !== null && rawAtt.validateImage !== void 0 && rawAtt.validateImage !== origValidate) rawAtt.validateImage = origValidate;
          try { delete rawAtt[ATTACHMENTS_KEY]; } catch {}
        });
      }
    }

    if (state.resolveWrapped) {
      ctx.logger.debug('vision-router: already active on this llm instance; config refreshed');
      return;
    }

    // ── 包装 resolveModelInfo：为纯文本模型补充 image 模态 ──────────────
    // 本插件保证图片可由 read_image 读取，因此把"未声明 image"的模型一律补上
    // image 模态（含 inputModalities 未声明的模型），让会话入口与 read_image
    // 门禁放行；模型是否真正读图由其自行决定（调用 read_image）。
    state.origResolveModelInfo = raw.resolveModelInfo.bind(raw);
    const orig = state.origResolveModelInfo;
    const installed = async (provider: any, model: any, signal: any) => {
      try {
        const info = await orig(provider, model, signal);
        if (info) {
          const modalities = Array.isArray(info.inputModalities) ? info.inputModalities : [];
          if (!modalities.includes('image')) {
            return { ...info, inputModalities: [...modalities, 'image'] };
          }
        }
        return info;
      } catch (error) {
        // fail-safe：解析失败时原样抛出，不吞错误
        throw error;
      }
    };
    state.installedResolveModelInfo = installed;
    llm.resolveModelInfo = installed;
    state.resolveWrapped = true;
    state.disposers.push(() => {
      // 所有权判断：只有当前值仍是本插件安装的包装时才还原（避免覆盖后装者的包装）。
      if (llm.resolveModelInfo === state.installedResolveModelInfo) llm.resolveModelInfo = state.origResolveModelInfo;
      state.installedResolveModelInfo = null;
    });
  } catch (error) {
    try { ctx.logger.error(`vision-router: init failed (harness continues without capability injection): ${(error as Error)?.message ?? String(error)}`); } catch {}
  }
}
