/**
 * vision-router — 图片自动降级路由插件（@dsh-plugins/vision-router）
 *
 * 当会话模型（如 deepseek-v4-flash 等纯文本模型）收到包含图片的请求时，
 * 自动把图片交给配置的视觉模型（默认 zai-open / glm-4v-flash，智谱官方
 * 免费视觉模型）转述为文本描述，再把描述文本交给原模型继续处理。用户和
 * agent 都无需手动切换模型。
 *
 * 实现（都在 dsh-llm 的 service 实例上，幂等、可卸载）：
 *   1. 能力声明：包装 resolveModelInfo，为纯文本模型补充 image 输入
 *      模态声明——会话入口（prompt 检查、模型切换检查）与 read_image
 *      工具都以此判断"模型能否处理图片"，本插件保证图片会被转述，因此
 *      入口放行。
 *   2. 请求转述：包装 streamWithRegistration（llm.stream 与 agent loop
 *      prepareCall().stream() 两条路径的汇聚点）。请求含图片且目标模型
 *      原生不支持图片时，把每条含图消息交给视觉模型转述，将 image block
 *      替换为文本描述块后再向下游分发；否则原样透传。目标模型的原生能力
 *      通过 listModels 读取（不受 resolveModelInfo 包装影响）。
 *
 * 配置：cordis.patch.yml 的 config（安装默认）与
 *       ~/.dsh/plugins/vision-router/config.json（设置页 UI，权威）合并。
 *
 * 本文件不依赖任何 dsh 内部包（纯 ESM + ctx.llm），可独立安装。
 */

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createConfigStore } from './config-store.mjs';

// remote 服务（设置页 UI 的配置读写）可选：typert-protocol 不可用时
// 动态 import 失败，核心功能（转述/压缩）照常工作。
let PluginConfigGateway = null;
try {
  ({ PluginConfigGateway } = await import('./remote.mjs'));
} catch (error) {
  console.warn('vision-router: settings gateway unavailable: ' + (error && error.message || error));
}

export const name = 'vision-router';

/** attachments 为可选服务（apply 内 ctx.get 获取），不参与 inject，避免组合缺服务时启动失败。 */
export const inject = ['llm', 'sessions'];

/** 默认配置。apply 时与 YAML 传入的 config 合并（cordis 不合并小写 config 导出）。 */
const DEFAULT_CONFIG = {
  /** 视觉模型路由；留空且 autoDiscover 开启时自动发现。 */
  visionProvider: 'zai-open',
  visionModel: 'glm-4v-flash',
  /** 配置的视觉模型不可用时，自动从已注册模型里找第一个支持图片的。 */
  autoDiscover: true,
  /** 转述请求的最大输出 token。 */
  maxVisionTokens: 2048,
  /** 转述提示词；{count} 替换为图片数量。 */
  prompt: '用户发来了一张图片。请先直接回答用户针对图片提出的问题（若有），再简要描述图片内容（主要物体、颜色、文字、布局等）。请用中文回答。',
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
 * 写入错误类型后在转述路径上抛 TypeError。非法字段回退默认值。 */
function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function normalizeVisionConfig(source) {
  const raw = source !== null && typeof source === 'object' && !Array.isArray(source) ? source : {};
  const merged = { ...DEFAULT_CONFIG, ...raw };
  return {
    ...merged,
    visionProvider: typeof merged.visionProvider === 'string' ? merged.visionProvider.trim() : '',
    visionModel: typeof merged.visionModel === 'string' ? merged.visionModel.trim() : '',
    autoDiscover: typeof merged.autoDiscover === 'boolean' ? merged.autoDiscover : DEFAULT_CONFIG.autoDiscover,
    maxVisionTokens: positiveInteger(merged.maxVisionTokens, DEFAULT_CONFIG.maxVisionTokens),
    prompt: typeof merged.prompt === 'string' && merged.prompt.trim().length > 0 ? merged.prompt : DEFAULT_CONFIG.prompt,
    compressImageBytes: positiveInteger(merged.compressImageBytes, DEFAULT_CONFIG.compressImageBytes),
    compressMaxDimension: positiveInteger(merged.compressMaxDimension, DEFAULT_CONFIG.compressMaxDimension),
    compressTargetBytes: positiveInteger(merged.compressTargetBytes, DEFAULT_CONFIG.compressTargetBytes),
    compressFallbackDimension: positiveInteger(merged.compressFallbackDimension, DEFAULT_CONFIG.compressFallbackDimension),
  };
}

/** remote.set 的严格校验：非法值直接拒绝并返回错误，而不是静默写坏文件。 */
function validateVisionConfig(partial) {
  if (partial === null || typeof partial !== 'object' || Array.isArray(partial)) {
    throw new TypeError('vision-router config must be a plain object');
  }
  const stringFields = ['visionProvider', 'visionModel', 'prompt'];
  for (const key of stringFields) {
    if (partial[key] !== void 0 && (typeof partial[key] !== 'string' || (key === 'prompt' ? partial[key].trim().length === 0 : false))) {
      throw new TypeError(`vision-router config field "${key}" must be a non-empty string`);
    }
  }
  if (partial.autoDiscover !== void 0 && typeof partial.autoDiscover !== 'boolean') {
    throw new TypeError('vision-router config field "autoDiscover" must be a boolean');
  }
  const intFields = ['maxVisionTokens', 'compressImageBytes', 'compressMaxDimension', 'compressTargetBytes', 'compressFallbackDimension'];
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

/** 递归判断内容里是否含图片（含嵌套在 tool-result 里的）。 */
function hasImage(content) {
  if (!Array.isArray(content)) return false;
  return content.some((block) => {
    if (block === null || typeof block !== 'object') return false;
    if (block.type === 'image') return true;
    if (block.type === 'tool-result') return hasImage(block.content);
    return false;
  });
}

/** 判断请求消息列表（message.content 数组）里是否含图片。 */
function messagesHaveImage(messages) {
  return Array.isArray(messages) && messages.some((message) => message !== null && typeof message === 'object' && hasImage(message.content));
}

/** 递归收集图片块，返回该条消息的文本（只取顶层 text 块拼接）。 */
function collectImages(content, out) {
  if (!Array.isArray(content)) return '';
  let text = '';
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue;
    if (block.type === 'image') out.push(block);
    else if (block.type === 'text') text += block.text;
    else if (block.type === 'tool-result') collectImages(block.content, out);
  }
  return text;
}

/** 把图片块替换为一段转述文本；未替换的消息保持原引用。 */
function replaceImages(content, caption) {
  let changed = false;
  const out = [];
  for (const block of content) {
    if (block === null || typeof block !== 'object') {
      out.push(block);
      continue;
    }
    if (block.type === 'image') {
      if (!changed) out.push({ type: 'text', text: caption });
      changed = true;
      continue;
    }
    if (block.type === 'tool-result' && hasImage(block.content)) {
      out.push({ ...block, content: replaceImages(block.content, caption) });
      changed = true;
      continue;
    }
    out.push(block);
  }
  return changed ? out : content;
}

/** 消费一个 chunk 流，拼接文本；error/aborted finish 时抛错（带 signal 时以信号为准）。 */
async function collectText(iterable, signal) {
  let text = '';
  let finished = false;
  for await (const chunk of iterable) {
    if (chunk.type === 'text-delta') {
      text += chunk.text;
      continue;
    }
    if (chunk.type !== 'finish' || chunk.reason === void 0) continue;
    finished = true;
    if (chunk.reason.kind === 'aborted') {
      if (signal !== void 0 && signal.aborted) signal.throwIfAborted();
      throw new Error('vision transcription aborted');
    }
    if (chunk.reason.kind === 'error') {
      const failure = chunk.reason.failure;
      throw new Error(`vision transcription failed: ${failure?.message || 'unknown error'} (${failure?.code || 'UNKNOWN'})`);
    }
  }
  if (!finished) throw new Error('vision transcription stream ended without a terminal finish chunk');
  return text;
}

/** 终态失败 chunk，与 dsh-llm 的 adapterFailureChunk 形状一致。 */
function failChunk(error, signal) {
  const aborted = signal?.aborted === true || error?.code === 'ABORTED' || error?.name === 'AbortError';
  const failure = {
    message: error?.message || String(error),
    code: aborted ? 'ABORTED' : 'VISION_ROUTER_FAILED',
  };
  return {
    type: 'finish',
    reason: aborted ? { kind: 'aborted', failure } : { kind: 'error', failure },
  };
}

/** 加载 sharp：优先包内 optionalDependencies，失败回退 harness 依赖树。 */
let sharpModule = null;
function loadSharp() {
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
export function detectMediaType(buffer) {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg';
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png';
  if (buffer.length >= 12 && buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) return 'image/webp';
  if (buffer.length >= 6 && buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) return 'image/gif';
  return null;
}

/** 用 sharp 压缩图片：先降像素，仍超字节目标则转 JPEG 再降质量。失败返回 null。
 * 返回的 mediaType 按输出字节实际检测（与源文件类型无关）。 */
export async function compressImage(buffer, mediaType, cfg) {
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
    try { console.error(`vision-router: compress failed: ${error && error.message || error}`); } catch {}
    return null;
  }
}

/** 解码像素数是否超过上限（sharp 只读头部元数据，代价低）。
 * 解析失败时返回 fallback：常规路径 fail-safe 用 false；硬上限检查用 true（拒绝）。 */
export async function exceedsMaxPixels(buffer, maxPixels, fallback = false) {
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

/** 向会话消息流追加一条可见的进度提示（assistant/chunk，不进入模型历史，
 * 最终被主模型输出覆盖）。返回是否成功（无会话或找不到 step 时静默跳过）。 */
function progressChunk(ctx, sessionId, text) {
  try {
    if (sessionId === void 0) return false;
    const session = ctx.sessions.get(sessionId);
    if (session === void 0) return false;
    let turn = void 0;
    let step = void 0;
    const events = session.log ?? session.events ?? [];
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const event = events[i];
      if (event && event.type === 'step/start' && event.data !== void 0) {
        turn = event.data.turn;
        step = event.data.step;
        break;
      }
    }
    if (turn === void 0 || step === void 0) return false;
    session.append('assistant/chunk', {
      turn,
      step,
      chunk: { type: 'text-delta', index: 0, text },
    });
    return true;
  } catch {
    return false;
  }
}

/** 判断目标模型原生是否支持图片输入。
 * 不用 resolveModelInfo（它可能被本插件或历史挂载的包装增强过，导致误判），
 * 而是直接读模型目录 listModels —— adapter 的目录数据未被增强。
 * 无法确认时视为不支持（保守转述）。 */
async function targetSupportsImage(ctx, state, options) {
  const cacheKey = `${options.provider}\u0000${options.model}`;
  const cached = state.targetImageCache.get(cacheKey);
  if (cached !== void 0) return cached;
  let supported = false;
  try {
    const models = await ctx.llm.listModels(options.provider);
    const model = models.find((entry) => entry.id === options.model);
    supported = model !== void 0 && model.inputModalities !== void 0 && model.inputModalities.includes('image');
  } catch {
    supported = false;
  }
  state.targetImageCache.set(cacheKey, supported);
  return supported;
}

/** 解析视觉模型路由：配置优先，失败时按配置决定自动发现。
 * 校验必须基于未被包装的模型目录（listModels）——本插件的 resolveModelInfo
 * 包装会给"声明了模态数组但不含 image"的模型补上 image，若用它校验，
 * 配置成纯文本模型会被误判为可用，转述请求必然失败且 autoDiscover 不触发。 */
async function resolveVisionModel(ctx, state) {
  const cfg = state.cfg;
  if (cfg.visionProvider && cfg.visionModel) {
    try {
      const models = await ctx.llm.listModels(cfg.visionProvider);
      const entry = models.find((model) => model.id === cfg.visionModel);
      if (entry !== void 0 && entry.inputModalities !== void 0 && entry.inputModalities.includes('image')) {
        return { provider: cfg.visionProvider, model: cfg.visionModel, name: entry.name || cfg.visionModel };
      }
      throw new Error(`configured vision model ${cfg.visionProvider}/${cfg.visionModel} does not declare image input`);
    } catch (error) {
      if (!cfg.autoDiscover) throw error;
      ctx.logger.warn(`vision-router: configured vision model unavailable (${error.message}); auto-discovering`);
    }
  }
  if (!cfg.autoDiscover) throw new Error('vision-router: no vision model configured (set visionProvider/visionModel or enable autoDiscover)');
  // autoDiscover 结果缓存：避免每个含图请求都遍历所有 provider 的模型目录；
  // 配置变化（热更新）时缓存键不匹配自动失效。
  const cached = state.visionModelCache;
  if (cached !== null && cached.cfgProvider === cfg.visionProvider && cached.cfgModel === cfg.visionModel) {
    return cached.route;
  }
  for (const provider of await ctx.llm.listProviders()) {
    let models;
    try { models = await ctx.llm.listModels(provider.id); } catch { continue; }
    for (const model of models) {
      if (model.inputModalities !== void 0 && model.inputModalities.includes('image')) {
        const route = { provider: provider.id, model: model.id, name: model.name || model.id };
        state.visionModelCache = { cfgProvider: cfg.visionProvider, cfgModel: cfg.visionModel, route };
        return route;
      }
    }
  }
  throw new Error('vision-router: no image-capable model found; add one to the model catalog (e.g. zai-open / glm-4v-flash) or set visionProvider/visionModel');
}

/** 基于一次路由决策的异步生成器：转述含图消息后调用 down(新 options)。 */
async function* routeOnce(ctx, state, options, down) {
  let supportsImage;
  try {
    supportsImage = await targetSupportsImage(ctx, state, options);
  } catch {
    supportsImage = false;
  }
  if (supportsImage) {
    yield* down(options);
    return;
  }
  let vision;
  try {
    vision = await resolveVisionModel(ctx, state);
  } catch (error) {
    ctx.logger.error(`vision-router: ${error.message}`);
    yield failChunk(error, options.signal);
    return;
  }
  const messages = [];
  let changed = false;
  for (const message of options.messages) {
    if (message === null || typeof message !== 'object' || !hasImage(message.content)) {
      messages.push(message);
      continue;
    }
    changed = true;
    try {
      // 进度提示在 transcribeMessage 内部、仅在真正发起转述时显示：
      // 缓存命中的历史图片不打扰用户（普通文本请求不会再弹提示）。
      messages.push(await transcribeMessage(ctx, state, vision, message, options.sessionId, options.signal));
    } catch (error) {
      ctx.logger.error(`vision-router: transcription failed for ${vision.provider}/${vision.model}: ${error.message}`);
      yield failChunk(error, options.signal);
      return;
    }
  }
  if (!changed) {
    yield* down(options);
    return;
  }
  const routed = { ...options, messages };
  ctx.logger.info(`vision-router: routed ${changed} image message(s) to ${vision.provider}/${vision.model} for ${options.provider}/${options.model}`);
  yield* down(routed);
}

/** 转述一条含图消息，返回图片被替换为文本后的新消息。 */
async function transcribeMessage(ctx, state, vision, message, sessionId, signal) {
  const cfg = state.cfg;
  const images = [];
  const ownText = collectImages(message.content, images);
  if (images.length === 0) return message;

  const cache = state.captionCache;
  // 缓存键不能只由图片决定：同一张图配不同用户问题/提示词会得到不同转述，
  // 只按图片 ID 缓存会让第二个问题错误复用第一个问题的回答。这里把视觉模型
  // 路由、提示词与消息文本一起纳入摘要。
  const userText = ownText.trim();
  const cacheMaterial = JSON.stringify({
    provider: vision.provider,
    model: vision.model,
    prompt: cfg.prompt,
    userText,
    imageIds: images.map((img) => img.attachment.attachmentId),
  });
  const cacheKey = `${sessionId ?? 'anon'}:${createHash('sha256').update(cacheMaterial).digest('hex')}`;
  const cached = cache.get(cacheKey);
  let caption;
  if (cached !== void 0) {
    caption = cached;
  } else {
    // 仅在实际发起转述时显示进度（含失败原因），避免普通文本请求被历史图片打扰。
    progressChunk(ctx, sessionId, '🖼️ 已收到图片，正在分析…');
    const prompt = cfg.prompt.replace('{count}', String(images.length));
    const parts = [{ type: 'text', text: userText.length > 0 ? `${prompt}

用户针对这些图片的说明：${userText}` : prompt }, ...images];
    const visionOptions = {
      provider: vision.provider,
      model: vision.model,
      messages: [{ role: 'user', content: parts }],
      maxTokens: cfg.maxVisionTokens,
      ...(sessionId === void 0 ? {} : { sessionId }),
      ...(signal === void 0 ? {} : { signal }),
    };
    state.transcribing.add(visionOptions);
    try {
      caption = (await collectText(ctx.llm.stream(visionOptions), signal)).trim();
    } catch (error) {
      progressChunk(ctx, sessionId, `⚠️ 图片分析失败：${error && error.message || error}`);
      throw error;
    } finally {
      state.transcribing.delete(visionOptions);
    }
    if (caption.length === 0) caption = '（视觉模型未返回描述）';
    if (cache.size >= 300) {
      const oldest = cache.keys().next().value;
      if (oldest !== void 0) cache.delete(oldest);
    }
    cache.set(cacheKey, caption);
  }

  const replaced = replaceImages(message.content, caption);
  return replaced === message.content ? message : { ...message, content: replaced };
}

export function apply(ctx, config) {
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
      origStreamWithRegistration: null,
      installedStreamWithRegistration: null,
      resolveWrapped: false,
      streamWrapped: false,
      /** 转述中的请求（防递归）。 */
      transcribing: new WeakSet(),
      /** 转述缓存：sessionId:hash -> caption，避免同一会话/同一问题重复转述。 */
      captionCache: new Map(),
      /** autoDiscover 路由缓存（配置键变化自动失效）。 */
      visionModelCache: null,
      /** 目标模型图片能力缓存（provider/model -> boolean）。 */
      targetImageCache: new Map(),
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
        for (const fn of state.disposers) {
          try { fn(); } catch {}
        }
        state.disposers = [];
        state.resolveWrapped = false;
        state.streamWrapped = false;
        state.installedResolveModelInfo = null;
        state.installedStreamWithRegistration = null;
        state.visionModelCache = null;
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
        state.visionModelCache = null; // 视觉路由可能变化，失效缓存
      },
    });
    state.cfg = normalizeVisionConfig(store.effective());

    // 模型目录可能随时注册/注销（HMR、provider 配置变更）。autoDiscover
    // 缓存的是 provider/model 路由，目录变化后必须失效，否则会一直使用
    // 已下线的视觉模型。监听器随本插件 fiber 自动销毁。
    ctx.on?.('llm/adapters-updated', () => {
      state.visionModelCache = null;
      state.targetImageCache.clear();
    });

    // 远程配置服务（设置页 UI 读写；typert 不可用时跳过）
    if (PluginConfigGateway !== null) {
      ctx.plugin(PluginConfigGateway, { store, serviceKey: 'visionRouterConfig' });
    }

    // ── 0) 包装 attachments.saveImage：大图/超像素图自动压缩 ──────────────────
    // 与 llm 包装相互独立：每次 apply 都尝试（attachments 后挂载也能补装），
    // 已包装（ATTACHMENTS_KEY 标记）则跳过。图片先在浏览器端按 limits 检查、
    // 在服务端 saveImage 校验。本插件把超过阈值（字节或解码像素）的图片压缩
    // 后再保存（sharp），让大图也能进入会话并送达视觉模型。fail-safe：压缩
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
          rawAtt.validateImage = async (input) => {
            try {
              await origValidate(input);
            } catch (error) {
              if (!(error && (error.code === 'IMAGE_TOO_LARGE' || error.code === 'IMAGE_TOO_MANY_PIXELS'))) throw error;
              // 只对“可安全压缩”的大图绕过原始限制；超过绝对硬上限或无法
              // 可靠读取像素数时保留原始错误（fail closed）。
              if (error.code === 'IMAGE_TOO_LARGE') {
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
        rawAtt.saveImage = async (input) => {
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
            try { ctx.logger.warn(`vision-router: pre-save compression skipped: ${error && error.message || error}`); } catch {}
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

    if (state.resolveWrapped && state.streamWrapped) {
      ctx.logger.debug('vision-router: already active on this llm instance; config refreshed');
      return;
    }

    // ── 1) 包装 resolveModelInfo：为纯文本模型补充 image 模态声明 ──────────────
    if (!state.resolveWrapped) {
      // 用底层实例绑定：traceable 代理的方法 proxy 无法携带正确的 this（其
      // 内部依赖 this.ctx），bind 在 raw 上才能让原方法拿到 llm 实例自身。
      state.origResolveModelInfo = raw.resolveModelInfo.bind(raw);
      const orig = state.origResolveModelInfo;
      const installed = async (provider, model, signal) => {
        try {
          const info = await orig(provider, model, signal);
          if (info) {
            // 本插件保证含图请求会被转述，因此把"未声明 image"的模型一律补上
            // image 模态（含 inputModalities 未声明的模型），让会话入口与
            // read_image 门禁放行；请求路径仍按 listModels 保守判定并转述。
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
    }

    // ── 2) 包装 streamWithRegistration：含图且目标模型原生不支持时转述 ────────
    if (!state.streamWrapped) {
      state.origStreamWithRegistration = raw.streamWithRegistration.bind(raw);
      const origSWR = state.origStreamWithRegistration;
      const installed = function (options, prepared) {
        try {
          if (state.transcribing.has(options)) return origSWR(options, prepared);
          if (options.messages === void 0 || !messagesHaveImage(options.messages)) return origSWR(options, prepared);
          return routeOnce(ctx, state, options, (routed) => origSWR(routed, prepared));
        } catch (error) {
          // fail-safe：路由出错时原样转发，不让模型请求失败
          try { ctx.logger.error(`vision-router: routing error (passthrough): ${error && error.message || error}`); } catch {}
          return origSWR(options, prepared);
        }
      };
      state.installedStreamWithRegistration = installed;
      llm.streamWithRegistration = installed;
      state.streamWrapped = true;
      state.disposers.push(() => {
        if (llm.streamWithRegistration === state.installedStreamWithRegistration) llm.streamWithRegistration = state.origStreamWithRegistration;
        state.installedStreamWithRegistration = null;
      });
    }
  } catch (error) {
    try { ctx.logger.error(`vision-router: init failed (harness continues without image routing): ${error && error.message || error}`); } catch {}
  }
}
