/**
 * session-archive — 归档会话管理插件（@chaoset/session-archive）
 *
 * 补上 DSH 缺失的"归档"后半程：web 侧边栏新增"归档"面板，可查看归档
 * 会话（列表 + 会话内容只读浏览）、一次多选批量恢复归档（unarchive，
 * 会话回到会话树原位置）或彻底删除归档（删除持久化文件与归档记录）。
 *
 * host 端全部逻辑基于官方 service 接口（workspaceRegistry /
 * sessionPersistence / sessions），不依赖 dsh 内部实现：
 *   1. list()       — archivedSessionIds ∩ sessionPersistence.list()，
 *                     每条附带标题（从事件流折叠 session/title）、目录、
 *                     创建时间、最后修改时间（文件 mtime）、体积与
 *                     live 状态（会话仍在内存中运行时禁止删除）。
 *   2. detail(id)   — readFrom(id, 0) 只读取会话事件：标题 + 文本消息
 *                     （user/assistant），供面板"查看"展开。
 *   3. delete(ids)  — 批量彻底删除：live 会话拒绝；逐个删除持久化文件
 *                     （locate() 定位）+ 会话目录。删除后**保留**该会话在
 *                     归档集合中的 ghost id（不调用移除）：宿主的
 *                     archiveSession 只改归档注册表、不停止内存会话，web
 *                     客户端重连还会把旧 tab 恢复进内存——删除时若把 id
 *                     移出归档集合，仍挂在内存里的会话会因"不再归档"而
 *                     立刻重新出现在侧边栏对话列表（效果等同"恢复"）。
 *                     保留 ghost id 后由 list() 的存在性过滤隐藏，归档面板
 *                     与侧边栏都不会再显示该会话。
 *   4. unarchive(ids) — 批量恢复：仅从归档集合移除**仍存在持久化文件**的
 *                     会话 id（文件已删的 ghost id 拒绝恢复，防止已彻底
 *                     删除的会话"复活"回侧边栏）；会话数据不动。
 *
 * 归档集合（workspaceRegistry.archivedSessionIds）的写入没有官方 API，
 * 这里复用 registry 自身的串行化写入通道（enqueueOperation → requireState
 * → setState，与 archiveSession 相同的路径）；若 registry 内部形状变化，
 * 自动降级为"仅删文件"，归档列表会以存在性过滤幽灵 id，功能仍正确。
 *
 * 本文件不依赖任何 dsh 内部包（纯 ESM + ctx.* service），可独立安装。
 */

import { stat, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createConfigStore } from './config-store.mjs';

// remote 服务（侧边栏面板 UI 的读写）可选：typert-protocol 不可用时
// 动态 import 失败，仅面板不可用，host 逻辑不注册（无其他消费者）。
let SessionArchiveGateway = null;
try {
  ({ SessionArchiveGateway } = await import('./remote.mjs'));
} catch (error) {
  console.warn('session-archive: remote gateway unavailable: ' + (error && error.message || error));
}

export const name = 'session-archive';

/** sessions 参与 inject：删除前必须能查询 live 会话（存在即拒绝删除）。 */
export const inject = ['workspaceRegistry', 'sessionPersistence', 'sessions'];

/** 默认配置。apply 时与 YAML 传入的 config 合并（cordis 不合并小写 config 导出）。 */
const DEFAULT_CONFIG = {
  /** detail() 返回的最大消息条数（超出仅计数）。 */
  detailMaxMessages: 200,
  /** 每条消息预览的最大字符数（超出截断加省略号）。 */
  messagePreviewChars: 2000,
  /** list() 时并发读取标题的最大并行数。 */
  titleReadConcurrency: 4,
};

export const config = { ...DEFAULT_CONFIG };

/** 配置校验：只接受正整数数值字段，避免脏配置拖垮并发/截断逻辑。 */
function validateConfig(partial) {
  if (partial === null || typeof partial !== 'object' || Array.isArray(partial)) {
    throw new TypeError('session-archive config must be a plain object');
  }
  for (const key of ['detailMaxMessages', 'messagePreviewChars', 'titleReadConcurrency']) {
    if (partial[key] !== undefined && (!Number.isInteger(partial[key]) || partial[key] <= 0)) {
      throw new TypeError(`session-archive config field "${key}" must be a positive integer`);
    }
  }
}

/** 并发限制器：最多 N 个任务并行，其余排队。 */
function limitedConcurrency(limit, tasks) {
  const results = new Array(tasks.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (cursor < tasks.length) {
      const at = cursor++;
      results[at] = await tasks[at]();
    }
  });
  return Promise.all(workers).then(() => results);
}

/** 从事件流折叠最新会话标题（与 dsh-session-title 相同的折叠规则）。 */
function foldTitle(events) {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event && event.type === 'session/title') {
      const title = event.data && typeof event.data.title === 'string' ? event.data.title.trim() : '';
      return title.length > 0 ? title : null;
    }
  }
  return null;
}

/** 从一条消息（Message 结构）提取纯文本（text 块拼接，忽略图片/工具块）。 */
function messageText(message, maxChars) {
  if (!message || !Array.isArray(message.content)) return '';
  let text = '';
  for (const block of message.content) {
    if (block && block.type === 'text' && typeof block.text === 'string') {
      text += block.text;
      if (text.length > maxChars) break;
    }
  }
  return text.length > maxChars ? text.slice(0, maxChars) + '…' : text;
}

/**
 * 构造归档管理 host 逻辑（绑定 ctx 与配置）。
 * 只读操作失败各自容错：单个会话的标题/详情读取失败不拖垮列表。
 */
export function createArchiveHost(ctx, cfg) {
  const registry = ctx.workspaceRegistry;
  const persistence = ctx.sessionPersistence;

  /** 当前归档集合快照。 */
  const archivedSet = () => new Set(
    typeof registry.archivedSessionIds === 'function'
      ? registry.archivedSessionIds()
      : (Array.isArray(registry.archivedSessionIds) ? registry.archivedSessionIds : []),
  );

  /** 会话是否"活跃"（不能安全删除）。
   * 宿主的 archiveSession 只改归档注册表、不停止内存会话，web 客户端
   * 重连还会把旧 tab 恢复进内存——归档会话因此长期"内存存在"。但归档
   * 会话已从会话列表移除、无法继续对话，不会再写持久化文件，删除安全；
   * 若把内存存在当作 live，归档面板会永远显示"运行中"且无法勾选删除。
   * 因此 live 仅对"内存存在且**未归档**"的会话为真（防将来误用），
   * 归档面板中恒为 false。 */
  const isLive = (sessionId) =>
    ctx.sessions.get(sessionId) !== undefined && !archivedSet().has(sessionId);

  /** 归档瞬间的生成流兜底：会话仍在内存且文件最近有写入（60s 内）时
   * 视为忙碌——删除文件后进行中的请求会把半截日志 append 回来。 */
  const isBusy = (sessionId, file) =>
    file !== null && ctx.sessions.get(sessionId) !== undefined && Date.now() - file.mtimeMs < 60_000;

  /** 从归档集合移除若干 id（恢复用；删除不调用——见 deleteArchived），返回实际移除的 id。 */
  async function removeFromArchiveSet(ids) {
    const set = new Set(ids);
    const canWrite =
      registry !== undefined &&
      typeof registry.enqueueOperation === 'function' &&
      typeof registry.requireState === 'function' &&
      typeof registry.setState === 'function';
    if (!canWrite) return []; // 降级：仅删文件，列表按存在性过滤幽灵 id
    let removedIds = [];
    await registry.enqueueOperation(async () => {
      const state = registry.requireState();
      const current = Array.isArray(state.archivedSessionIds) ? state.archivedSessionIds : [];
      removedIds = current.filter((id) => set.has(id));
      const remaining = current.filter((id) => !set.has(id));
      if (removedIds.length > 0) await registry.setState({ ...state, archivedSessionIds: remaining });
    });
    return removedIds;
  }

  /** 归档会话的文件信息（路径 + stat），会话文件缺失时返回 null。 */
  async function fileInfo(header) {
    try {
      const location = persistence.locate(header);
      if (location === undefined || typeof location.path !== 'string' || location.path.length === 0) return null;
      const info = await stat(location.path);
      return { path: location.path, size: info.size, mtimeMs: info.mtimeMs };
    } catch {
      return null;
    }
  }

  /** 单个归档会话的展示行。标题读取失败回退 null（面板显示目录名）。 */
  async function rowFor(sessionId, header) {
    const file = await fileInfo(header);
    let title = null;
    try {
      const { events } = await persistence.readFrom(sessionId, 0);
      title = foldTitle(events);
    } catch {}
    return {
      sessionId,
      title,
      cwd: header.cwd ?? null,
      createdAt: header.createdAt,
      updatedAt: file !== null ? file.mtimeMs : header.createdAt,
      size: file !== null ? file.size : 0,
      live: isLive(sessionId),
    };
  }

  return {
    /** 列出全部归档会话（存在性过滤：文件已删的幽灵归档记录不显示）。 */
    async list() {
      const archived = [...archivedSet()];
      if (archived.length === 0) return { items: [] };
      const headers = await persistence.list();
      const byId = new Map(headers.map((header) => [header.id, header]));
      const rows = [];
      for (const sessionId of archived) {
        const header = byId.get(sessionId);
        if (header === undefined) continue; // 幽灵 id：会话文件已不存在
        rows.push({ sessionId, header });
      }
      const items = await limitedConcurrency(cfg.titleReadConcurrency, rows.map(({ sessionId, header }) => () => rowFor(sessionId, header)));
      return { items };
    },

    /** 读取一个归档会话的只读详情（标题 + 文本消息）。 */
    async detail(sessionId) {
      const { meta, events } = await persistence.readFrom(sessionId, 0);
      const title = foldTitle(events);
      const messages = [];
      for (const event of events) {
        if (event.type !== 'user/message' && event.type !== 'assistant/message') continue;
        const text = messageText(event.data, cfg.messagePreviewChars);
        if (text.length === 0) continue;
        messages.push({
          role: event.type === 'user/message' ? 'user' : 'assistant',
          text,
          time: event.time,
        });
        if (messages.length >= cfg.detailMaxMessages) break;
      }
      return {
        sessionId,
        header: {
          cwd: meta.cwd ?? null,
          createdAt: meta.createdAt,
          parentSession: meta.parentSession ?? null,
          agentPreset: meta.agentPreset ?? null,
        },
        title,
        messageCount: messages.length,
        messages,
        live: isLive(sessionId),
      };
    },

    /**
     * 批量彻底删除归档会话。live 会话拒绝（先停止再删）；每个会话删除
     * 持久化文件与会话目录。删除后**不**从归档集合移除 id（保留 ghost id）：
     * 归档不停止内存会话，一旦把 id 移出归档集合，侧边栏（以"不在归档
     * 集合中"作为显示条件）会立刻把仍在内存中的会话重新显示出来，等同
     * "恢复"。ghost id 由 list() 的存在性过滤隐藏，面板与侧边栏均不再
     * 显示该会话；`removedFromArchive` 因此恒为 0。
     */
    async deleteArchived(sessionIds) {
      const unique = [...new Set(sessionIds)];
      const deleted = [];
      const failed = [];
      const headers = await persistence.list();
      const headersById = new Map(headers.map((item) => [item.id, item]));
      for (const sessionId of unique) {
        if (isLive(sessionId)) {
          failed.push({ sessionId, reason: 'live' });
          continue;
        }
        const header = headersById.get(sessionId);
        if (header === undefined) {
          // 会话文件已不存在：幂等删除（ghost id 保留在归档集合中）。
          deleted.push(sessionId);
          continue;
        }
        const file = await fileInfo(header);
        if (file === null) {
          deleted.push(sessionId);
          continue;
        }
        if (isBusy(sessionId, file)) {
          failed.push({ sessionId, reason: 'busy' });
          continue;
        }
        try {
          await rm(file.path, { force: true });
          await rm(dirname(file.path), { recursive: true, force: true });
          deleted.push(sessionId);
        } catch (error) {
          failed.push({ sessionId, reason: error && error.message ? String(error.message) : 'delete-failed' });
        }
      }
      return { deleted, failed, removedFromArchive: 0 };
    },

    /**
     * 批量恢复归档会话（仅从归档集合移除，会话数据不动）。只恢复仍存在
     * 持久化文件的会话：文件已删的 ghost id（已彻底删除的会话）拒绝恢复，
     * 避免删除后的会话再次出现在侧边栏对话列表。
     */
    async unarchive(sessionIds) {
      const unique = [...new Set(sessionIds)];
      const headers = await persistence.list();
      const restorable = [];
      for (const sessionId of unique) {
        const header = headers.find((item) => item.id === sessionId);
        if (header === undefined) continue; // 持久化记录已删：拒绝恢复
        const file = await fileInfo(header);
        if (file === null) continue;        // 有记录无文件：拒绝恢复
        restorable.push(sessionId);
      }
      const restored = await removeFromArchiveSet(restorable);
      return { restored, removedFromArchive: restored.length };
    },
  };
}

/** 插件 apply：注册远程服务（面板 UI 读写）。 */
export function apply(ctx, config) {
  const patchConfig = config || {};
  const cfg = { ...DEFAULT_CONFIG, ...patchConfig };
  const store = createConfigStore({
    name,
    defaults: DEFAULT_CONFIG,
    patchConfig,
    validate: validateConfig,
    onUpdate: (merged) => {
      Object.assign(cfg, { ...DEFAULT_CONFIG, ...patchConfig, ...merged });
    },
  });
  // 启动时也以 config.json（若有）为权威，和其余插件保持一致。
  Object.assign(cfg, store.effective());
  ctx.effect(() => store.dispose?.());

  if (SessionArchiveGateway !== null) {
    ctx.plugin(SessionArchiveGateway, { host: createArchiveHost(ctx, cfg), serviceKey: 'sessionArchive' });
  }
  return store;
}
