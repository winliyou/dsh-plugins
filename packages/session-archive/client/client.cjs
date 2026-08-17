window.__ModuleLoader__.load({
  id: "@chaoset/session-archive",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    let react = require("react");

    // ── 样式（注入 style 标签，复用 DSH 设计变量）────────────────────────
    var css = [
      ".sa_badge{width:100%;height:49px;color:var(--dsw-alias-label-primary);cursor:pointer;background:0 0;border:none;border-radius:12px;align-items:center;gap:8px;padding:0 8px 0 6px;font-family:inherit;font-size:14px;display:inline-flex;overflow:hidden}",
      ".sa_badge:hover{background:var(--dsw-alias-interactive-bg-hover)}",
      ".sa_badgeIcon{flex:none;font-size:15px;line-height:20px}",
      ".sa_badgeLabel{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}",
      ".sa_badgeCount{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;flex:none;margin-left:auto;font-size:12px;line-height:16px}",
      ".sa_panel{z-index:30;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);width:440px;max-width:calc(100vw - 24px);max-height:62vh;box-shadow:var(--dsw-shadow-lv2);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);border-radius:12px;flex-direction:column;display:flex;position:fixed;bottom:128px;left:12px;overflow:hidden}",
      ".sa_header{box-sizing:border-box;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);flex:none;justify-content:space-between;align-items:center;min-height:44px;padding:8px 12px;display:flex}",
      ".sa_title{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:20px}",
      ".sa_iconBtn{font:inherit;cursor:pointer;border:0;border-radius:8px;width:36px;height:36px;color:var(--dsw-alias-label-secondary,#666);background:0 0;display:inline-flex;align-items:center;justify-content:center;font-size:18px}",
      ".sa_refresh{font:inherit;cursor:pointer;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;min-height:36px;padding:5px 14px;font-size:13px;line-height:20px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);display:inline-flex;align-items:center;gap:5px}",
      ".sa_refresh:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}",
      ".sa_refresh:disabled{opacity:.4;cursor:default}",
      ".sa_iconBtn:hover{background:var(--dsw-alias-interactive-bg-hover)}",
      ".sa_iconBtn:disabled{opacity:.4;cursor:default}",
      ".sa_toolbar{flex:none;border-bottom:1px solid var(--dsw-alias-border-l2);align-items:center;gap:8px;padding:8px 12px;display:flex;flex-wrap:wrap}",
      ".sa_check{accent-color:var(--dsw-alias-label-primary);width:14px;height:14px;flex:none;cursor:pointer}",
      ".sa_check:disabled{cursor:default;opacity:.45}",
      ".sa_toolLabel{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;user-select:none;cursor:pointer;display:inline-flex;align-items:center;gap:6px}",
      ".sa_count{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;flex:1}",
      ".sa_action{font:inherit;cursor:pointer;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:3px 10px;font-size:12px;line-height:18px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}",
      ".sa_action:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}",
      ".sa_action:disabled{opacity:.4;cursor:default}",
      ".sa_actionDanger{border-color:transparent;background:var(--dsw-alias-state-error-primary);color:#fff}",
      ".sa_actionDanger:hover:not(:disabled){background:var(--dsw-alias-state-error-primary)}",
      ".sa_actionDanger:disabled{opacity:.4}",
      ".sa_confirm{color:var(--dsw-alias-state-error-primary);border:1px solid var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent)}",
      ".sa_body{flex:1;min-height:0;padding:4px 12px 12px;overflow-y:auto}",
      ".sa_empty{color:var(--dsw-alias-label-tertiary);margin:24px 0;text-align:center;font-size:12px;line-height:18px}",
      ".sa_error{color:var(--dsw-alias-state-error-primary);margin:8px 0;font-size:12px;line-height:18px}",
      ".sa_rows{flex-direction:column;gap:8px;margin:0;padding:0;list-style:none;display:flex}",
      ".sa_row{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);border-radius:12px;flex-direction:column;gap:6px;padding:8px 10px;display:flex}",
      ".sa_rowHead{align-items:center;gap:8px;display:flex}",
      ".sa_rowTitle{min-width:0;color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap;flex:1;font-size:13px;font-weight:500;line-height:20px;overflow:hidden;cursor:pointer}",
      ".sa_rowTitle:hover{text-decoration:underline}",
      ".sa_live{background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-state-warn-label);height:18px;border-radius:9px;flex:none;align-items:center;padding:0 6px;font-size:11px;line-height:18px;display:inline-flex}",
      ".sa_rowMeta{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;overflow-wrap:anywhere}",
      ".sa_rowMeta code{font-family:var(--dsh-font-mono,monospace)}",
      ".sa_rowFoot{justify-content:space-between;align-items:center;gap:8px;display:flex}",
      ".sa_rowActions{flex:none;align-items:center;gap:8px;display:flex}",
      ".sa_detail{border-top:1px dashed var(--dsw-alias-border-l2);padding-top:8px;flex-direction:column;gap:6px;display:flex;max-height:260px;overflow-y:auto}",
      ".sa_msg{flex-direction:column;gap:2px;display:flex}",
      ".sa_msgRole{color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:14px;text-transform:uppercase;letter-spacing:.04em}",
      ".sa_msgText{color:var(--dsw-alias-label-primary);white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;line-height:18px}",
      ".sa_msgTextUser{color:var(--dsw-alias-label-secondary)}",
      ".sa_busy{opacity:.55;pointer-events:none}"
    ].join("");
    var tagId = "@chaoset/session-archive/client.css";
    if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=\"" + tagId + "\"]") === null) {
      var tag = document.createElement("style");
      tag.dataset.plugin = "@chaoset/session-archive";
      tag.dataset.pluginCss = tagId;
      tag.textContent = css;
      document.head.appendChild(tag);
    }

    // ── 字典 ─────────────────────────────────────────────────────────────
    const NS = "sidebar.sessionArchive";
    const zh = {
      badge: "归档",
      panelTitle: "归档会话",
      refresh: "刷新",
      close: "关闭",
      empty: "暂无归档会话。在会话列表的更多菜单中归档会话后会出现在这里。",
      loadFailed: "加载归档列表失败",
      selectAll: "全选",
      selected: "已选 {n} 项",
      restore: "恢复所选",
      restoreDone: "已恢复 {n} 个会话",
      restoreFailed: "恢复失败",
      delete: "删除所选",
      deleteConfirm: "再次点击确认删除",
      deleteDone: "已删除 {n} 个会话",
      deleteFailed: "部分删除失败：{n} 个",
      confirmAll: "确认删除全部 {n} 个？",
      noSelection: "请先勾选会话",
      view: "查看",
      collapse: "收起",
      live: "运行中",
      detailLoadFailed: "读取会话内容失败",
      noneTitle: "（无标题）",
      user: "用户",
      assistant: "助手",
      messages: "共 {n} 条消息",
      noMessages: "（无文本消息）",
      sizeBytes: "{n} B",
      sizeKB: "{n} KB",
      sizeMB: "{n} MB",
      runningHint: "运行中的会话不能删除，请先停止"
    };
    const en = {
      badge: "Archive",
      panelTitle: "Archived sessions",
      refresh: "Refresh",
      close: "Close",
      empty: "No archived sessions. Archive a session from its menu in the session list and it will show up here.",
      loadFailed: "Failed to load archive list",
      selectAll: "Select all",
      selected: "{n} selected",
      restore: "Restore",
      restoreDone: "Restored {n} sessions",
      restoreFailed: "Restore failed",
      delete: "Delete",
      deleteConfirm: "Click again to confirm delete",
      deleteDone: "Deleted {n} sessions",
      deleteFailed: "Some deletions failed: {n}",
      confirmAll: "Delete all {n}?",
      noSelection: "Select sessions first",
      view: "View",
      collapse: "Collapse",
      live: "Running",
      detailLoadFailed: "Failed to read session content",
      noneTitle: "(no title)",
      user: "User",
      assistant: "Assistant",
      messages: "{n} messages",
      noMessages: "(no text messages)",
      sizeBytes: "{n} B",
      sizeKB: "{n} KB",
      sizeMB: "{n} MB",
      runningHint: "Running sessions cannot be deleted; stop them first"
    };

    // ── 工具函数 ─────────────────────────────────────────────────────────
    function formatBytes(bytes, t) {
      if (bytes < 1024) return t("sizeBytes").replace("{n}", String(bytes));
      if (bytes < 1024 * 1024) return t("sizeKB").replace("{n}", (bytes / 1024).toFixed(1));
      return t("sizeMB").replace("{n}", (bytes / (1024 * 1024)).toFixed(1));
    }
    function formatTime(ms) {
      try { return new Date(ms).toLocaleString(); } catch { return String(ms); }
    }
    function shortId(id) {
      return id.length > 12 ? id.slice(0, 12) + "…" : id;
    }

    // ── 归档面板 ─────────────────────────────────────────────────────────
    function ArchivePanel(props) {
      const t = props.t;
      const call = props.call;
      const rootRef = react.useRef(null);
      const [open, setOpen] = react.useState(false);
      const [items, setItems] = react.useState([]);
      const [loading, setLoading] = react.useState(false);
      const [error, setError] = react.useState(null);
      const [selected, setSelected] = react.useState(new Set());
      const [expanded, setExpanded] = react.useState(null);
      const [details, setDetails] = react.useState(new Map());
      const [detailLoading, setDetailLoading] = react.useState(new Set());
      const [busy, setBusy] = react.useState(false);
      const [confirmingDelete, setConfirmingDelete] = react.useState(false);
      const [notice, setNotice] = react.useState(null);

      const load = react.useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
          const result = await call("list");
          setItems(Array.isArray(result.items) ? result.items : []);
        } catch (loadError) {
          setError(t("loadFailed") + ": " + (loadError && loadError.message || loadError));
        } finally {
          setLoading(false);
        }
      }, [call, t]);

      react.useEffect(() => {
        if (open) load();
      }, [open, load]);

      react.useEffect(() => {
        if (!open) return;
        const onPointerDown = (event) => {
          if (rootRef.current !== null && !rootRef.current.contains(event.target)) {
            setOpen(false);
          }
        };
        document.addEventListener("pointerdown", onPointerDown);
        return () => document.removeEventListener("pointerdown", onPointerDown);
      }, [open]);

      const selectable = items.filter((item) => !item.live);
      const allSelected = selectable.length > 0 && selectable.every((item) => selected.has(item.sessionId));

      const toggleAll = (checked) => {
        if (checked) {
          setSelected(new Set(selectable.map((item) => item.sessionId)));
        } else {
          setSelected(new Set());
        }
      };
      const toggleOne = (sessionId, checked) => {
        setSelected((current) => {
          const next = new Set(current);
          if (checked) next.add(sessionId); else next.delete(sessionId);
          return next;
        });
      };

      const toggleDetail = (item) => {
        if (expanded === item.sessionId) {
          setExpanded(null);
          return;
        }
        setExpanded(item.sessionId);
        if (!details.has(item.sessionId)) {
          setDetailLoading((current) => new Set(current).add(item.sessionId));
          call("detail", item.sessionId).then((detail) => {
            setDetails((current) => new Map(current).set(item.sessionId, detail));
          }).catch((detailError) => {
            setDetails((current) => new Map(current).set(item.sessionId, {
              error: t("detailLoadFailed") + ": " + (detailError && detailError.message || detailError)
            }));
          }).finally(() => {
            setDetailLoading((current) => {
              const next = new Set(current);
              next.delete(item.sessionId);
              return next;
            });
          });
        }
      };

      const runBatch = async (action, doneKey, failKey) => {
        const ids = [...selected];
        if (ids.length === 0) {
          setNotice({ kind: "warn", text: t("noSelection") });
          return;
        }
        setBusy(true);
        setNotice(null);
        try {
          const result = await call(action, ids);
          const doneIds = result.deleted || result.restored || [];
          const n = doneIds.length;
          if (result.failed && result.failed.length > 0) {
            setNotice({ kind: "error", text: t(failKey).replace("{n}", String(result.failed.length)) });
          } else {
            setNotice({ kind: "ok", text: t(doneKey).replace("{n}", String(n)) });
          }
          if (doneIds.length > 0) {
            const done = new Set(doneIds);
            setItems((current) => current.filter((item) => !done.has(item.sessionId)));
          }
          setSelected(new Set());
          setConfirmingDelete(false);
          await load();
        } catch (actionError) {
          setNotice({ kind: "error", text: t(failKey).replace("{n}", "?") + ": " + (actionError && actionError.message || actionError) });
        } finally {
          setBusy(false);
        }
      };
      const restoreSelected = () => runBatch("unarchive", "restoreDone", "restoreFailed");
      const deleteSelected = () => {
        if (!confirmingDelete) {
          setConfirmingDelete(true);
          window.setTimeout(() => setConfirmingDelete(false), 4000);
          return;
        }
        runBatch("delete", "deleteDone", "deleteFailed");
      };

      const hasSelection = selected.size > 0;

      return react.createElement(
        "div",
        { className: "sa_root", ref: rootRef },
        react.createElement(
          "button",
          {
            className: "sa_badge",
            type: "button",
            onClick: () => setOpen(!open),
            "aria-expanded": open,
            title: t("badge")
          },
          react.createElement("span", { className: "sa_badgeIcon", "aria-hidden": true }, "🗂"),
          react.createElement("span", { className: "sa_badgeLabel" }, t("badge")),
          react.createElement("span", { className: "sa_badgeCount" }, String(items.length))
        ),
        open ? react.createElement(
          "div",
          { className: "sa_panel" },
          react.createElement(
            "div",
            { className: "sa_header" },
            react.createElement("span", { className: "sa_title" }, t("panelTitle")),
            react.createElement(
              "span",
              { style: { display: "inline-flex", gap: "6px", alignItems: "center" } },
              react.createElement("button", { className: "sa_refresh", type: "button", title: t("refresh"), disabled: busy || loading, onClick: load }, t("refresh")),
              react.createElement("button", { className: "sa_iconBtn", type: "button", title: t("close"), disabled: busy, onClick: () => setOpen(false) }, "✕")
            )
          ),
          react.createElement(
            "div",
            { className: "sa_toolbar" },
            react.createElement("label", { className: "sa_toolLabel" },
              react.createElement("input", {
                className: "sa_check",
                type: "checkbox",
                checked: allSelected,
                disabled: busy || selectable.length === 0,
                onChange: (e) => toggleAll(e.target.checked)
              }),
              t("selectAll")
            ),
            react.createElement("span", { className: "sa_count" }, t("selected").replace("{n}", String(selected.size))),
            react.createElement("button", {
              className: "sa_action",
              type: "button",
              disabled: busy || !hasSelection,
              onClick: restoreSelected
            }, t("restore")),
            react.createElement("button", {
              className: "sa_action " + (confirmingDelete ? "sa_actionDanger sa_confirm" : "sa_actionDanger"),
              type: "button",
              disabled: busy || !hasSelection,
              onClick: deleteSelected
            }, confirmingDelete ? t("deleteConfirm") : t("delete"))
          ),
          react.createElement(
            "div",
            { className: "sa_body" },
            notice !== null ? react.createElement("p", { className: "sa_error" + (notice.kind === "ok" ? "" : ""), role: "status" }, notice.text) : null,
            error !== null ? react.createElement("p", { className: "sa_error", role: "alert" }, error) : null,
            loading && items.length === 0 ? react.createElement("p", { className: "sa_empty" }, "…") : null,
            !loading && items.length === 0 && error === null ? react.createElement("p", { className: "sa_empty" }, t("empty")) : null,
            items.length > 0 ? react.createElement(
              "ul",
              { className: "sa_rows" },
              items.map((item) => {
                const isExpanded = expanded === item.sessionId;
                const detail = details.get(item.sessionId);
                const detailPending = detailLoading.has(item.sessionId);
                return react.createElement(
                  "li",
                  { className: "sa_row" + (busy ? " sa_busy" : ""), key: item.sessionId },
                  react.createElement(
                    "div",
                    { className: "sa_rowHead" },
                    react.createElement("input", {
                      className: "sa_check",
                      type: "checkbox",
                      checked: selected.has(item.sessionId),
                      disabled: busy || item.live,
                      title: item.live ? t("runningHint") : void 0,
                      onChange: (e) => toggleOne(item.sessionId, e.target.checked)
                    }),
                    react.createElement(
                      "span",
                      { className: "sa_rowTitle", onClick: () => toggleDetail(item), title: t("view") },
                      item.title !== null && item.title !== void 0 && item.title !== "" ? item.title : t("noneTitle")
                    ),
                    item.live ? react.createElement("span", { className: "sa_live" }, t("live")) : null
                  ),
                  react.createElement("div", { className: "sa_rowMeta" },
                    react.createElement("span", null, formatTime(item.updatedAt)),
                    item.cwd !== null && item.cwd !== void 0 ? react.createElement("span", null, " · ", react.createElement("code", null, item.cwd)) : null,
                    react.createElement("span", null, " · ", formatBytes(item.size, t))
                  ),
                  react.createElement(
                    "div",
                    { className: "sa_rowFoot" },
                    react.createElement("span", { className: "sa_rowMeta" },
                      react.createElement("code", null, shortId(item.sessionId)),
                      detail !== void 0 && !detail.error && detail.messageCount !== void 0
                        ? " · " + t("messages").replace("{n}", String(detail.messageCount))
                        : null
                    ),
                    react.createElement(
                      "div",
                      { className: "sa_rowActions" },
                      react.createElement("button", {
                        className: "sa_action",
                        type: "button",
                        disabled: busy || detailPending,
                        onClick: () => toggleDetail(item)
                      }, isExpanded ? t("collapse") : t("view"))
                    )
                  ),
                  isExpanded ? react.createElement(
                    "div",
                    { className: "sa_detail" },
                    detailPending ? react.createElement("p", { className: "sa_empty" }, "…") : null,
                    detail === void 0 ? null :
                      detail.error !== void 0 ? react.createElement("p", { className: "sa_error" }, detail.error) :
                      detail.messages.length === 0 ? react.createElement("p", { className: "sa_empty" }, t("noMessages")) :
                      detail.messages.map((message, index) => react.createElement(
                        "div",
                        { className: "sa_msg", key: index },
                        react.createElement("span", { className: "sa_msgRole" }, message.role === "user" ? t("user") : t("assistant") + " · " + formatTime(message.time)),
                        react.createElement("span", { className: "sa_msgText" + (message.role === "user" ? " sa_msgTextUser" : "") }, message.text)
                      ))
                  ) : null
                );
              })
            ) : null
          )
        ) : null
      );
    }

    // ── 插件 apply ───────────────────────────────────────────────────────
    // DSH 客户端的 remote.<ns> 服务不会自动生成：必须由客户端代码用
    // ctx.remote.$mount(contribution) 显式挂载（官方 dsh-api-remotes 即如此）。
    const inject = ["slots", "locale", "remote"];
    const passthroughSchema = { parse: (value) => value };
    const REMOTE_CONTRIBUTION = {
      package: "@chaoset/session-archive",
      descriptors: [
        { id: "@chaoset/session-archive#sessionArchive/list", service: "sessionArchive", namespace: "sessionArchive", method: "list", invocation: { kind: "direct" }, parameters: [], result: { mode: "strict", typeSymbol: "sessionArchive/list:result", schema: passthroughSchema } },
        { id: "@chaoset/session-archive#sessionArchive/detail", service: "sessionArchive", namespace: "sessionArchive", method: "detail", invocation: { kind: "direct" }, parameters: [{ name: "sessionId", wire: "sessionId", source: "json", codec: { mode: "strict", typeSymbol: "sessionArchive/detail:sessionId", schema: passthroughSchema } }], result: { mode: "strict", typeSymbol: "sessionArchive/detail:result", schema: passthroughSchema } },
        { id: "@chaoset/session-archive#sessionArchive/delete", service: "sessionArchive", namespace: "sessionArchive", method: "delete", invocation: { kind: "direct" }, parameters: [{ name: "sessionIds", wire: "sessionIds", source: "json", codec: { mode: "strict", typeSymbol: "sessionArchive/delete:sessionIds", schema: passthroughSchema } }], result: { mode: "strict", typeSymbol: "sessionArchive/delete:result", schema: passthroughSchema } },
        { id: "@chaoset/session-archive#sessionArchive/unarchive", service: "sessionArchive", namespace: "sessionArchive", method: "unarchive", invocation: { kind: "direct" }, parameters: [{ name: "sessionIds", wire: "sessionIds", source: "json", codec: { mode: "strict", typeSymbol: "sessionArchive/unarchive:sessionIds", schema: passthroughSchema } }], result: { mode: "strict", typeSymbol: "sessionArchive/unarchive:result", schema: passthroughSchema } }
      ]
    };
    async function apply(ctx) {
      const t = ctx.locale.bind(NS);
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), "session-archive: dictionaries");
      await ctx.remote.$mount(REMOTE_CONTRIBUTION);
      const archiveService = ctx.get("remote.sessionArchive");
      if (archiveService === void 0) throw new Error("session-archive: remote.sessionArchive did not materialize after mount");
      const call = (method, ...args) => archiveService[method](...args).then((result) => {
        if (!result.ok) throw new Error(method + " failed: " + result.error.code + ": " + result.error.message);
        return result.value;
      });
      ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
        name: "sidebar.footer.action",
        id: "session-archive",
        order: 20,
        locale: NS,
        inject: () => ({ call })
      }, ArchivePanel));
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
