window.__ModuleLoader__.load({
  id: "@chaoset/sandbox-extra-roots",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    let react = require("react");

    var css = ".ser_card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:10px;min-width:0;overflow:hidden}.ser_card[data-open=true]{border-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-shadow-lv1)}.ser_header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:10px;align-items:center;gap:12px;padding:12px 14px;display:flex}.ser_header:hover,.ser_card[data-open=true]>.ser_header{background:var(--dsw-alias-interactive-bg-hover)}.ser_title{flex:1;min-width:0;font-size:14px;font-weight:600;line-height:20px}.ser_badge{white-space:nowrap;background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 10%,transparent);color:var(--dsw-alias-state-success-primary);border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;line-height:16px}.ser_body{border-top:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-platform);padding:10px 14px 12px}.ser_field{flex-direction:column;gap:4px;padding:8px 0;display:flex}.ser_label{font-size:12px;font-weight:500;line-height:18px}.ser_textarea{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);font:inherit;color:var(--dsw-alias-label-primary);border-radius:6px;padding:6px 10px;font-size:12px;line-height:18px;resize:vertical;min-height:120px;font-family:var(--ds-font-family-code,monospace)}.ser_hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:11px;line-height:16px}.ser_footer{border-top:1px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;padding:8px 0 2px;display:flex}.ser_save{font:inherit;cursor:pointer;border:1px solid transparent;border-radius:6px;padding:4px 14px;font-size:12px;line-height:18px;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}.ser_save:disabled{opacity:.4;cursor:default}.ser_discard{font:inherit;cursor:pointer;border:1px solid var(--dsw-alias-border-l1);background:0 0;color:var(--dsw-alias-label-secondary,#666);border-radius:6px;padding:4px 14px;font-size:12px;line-height:18px}.ser_discard:disabled{opacity:.4;cursor:default}.ser_status{flex:1;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}.ser_error{color:var(--dsw-alias-state-error-primary)}";
    var tagId = "@chaoset/sandbox-extra-roots/client.css";
    if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=\"" + tagId + "\"]") === null) {
      var tag = document.createElement("style");
      tag.dataset.plugin = "@chaoset/sandbox-extra-roots";
      tag.dataset.pluginCss = tagId;
      tag.textContent = css;
      document.head.appendChild(tag);
    }

    const NS = "settings.plugins.sandboxExtraRoots";
    const zh = {
      title: "沙盒额外允许目录（sandbox-extra-roots）",
      hint: "workspace-write 模式下，除官方白名单（工作区根 + /tmp + 平台临时目录）外额外允许写入的目录。每行一个绝对路径。",
      unsaved: "有未保存的修改",
      discard: "放弃修改",
      saving: "保存中…",
      save: "保存",
      saveFailed: "保存失败",
      saved: "已保存，下次沙盒调用生效",
      loadFailed: "读取配置失败",
      roots: "额外可写目录（每行一个绝对路径）"
    };
    const en = {
      title: "Extra sandbox roots (sandbox-extra-roots)",
      hint: "Extra writable roots under workspace-write mode, on top of the official allow-list (workspace root + /tmp + platform temp dirs). One absolute path per line.",
      unsaved: "Unsaved changes",
      discard: "Discard",
      saving: "Saving…",
      save: "Save",
      saveFailed: "Save failed",
      saved: "Saved; takes effect on the next sandbox call",
      loadFailed: "Failed to load config",
      roots: "Extra writable roots (one absolute path per line)"
    };

    function SandboxRootsCard(props) {
      const t = props.t;
      const [open, setOpen] = react.useState(false);
      const [cfg, setCfg] = react.useState(null);
      const [draft, setDraft] = react.useState(null);
      const [saving, setSaving] = react.useState(false);
      const [status, setStatus] = react.useState(null);

      react.useEffect(() => {
        let cancelled = false;
        props.getConfig().then((value) => {
          if (cancelled) return;
          setCfg(value);
          setDraft(value);
        }).catch((error) => {
          if (!cancelled) setStatus({ kind: "error", text: `${t("loadFailed")}: ${error && error.message || error}` });
        });
        return () => { cancelled = true; };
      }, []);

      const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(cfg);
      const discard = () => {
        setDraft(cfg);
        setStatus(null);
      };
      const save = () => {
        setSaving(true);
        setStatus(null);
        props.setConfig(draft).then(() => {
          setCfg(draft);
          setStatus({ kind: "ok", text: t("saved") });
        }).catch((error) => {
          setStatus({ kind: "error", text: `${t("saveFailed")}: ${error && error.message || error}` });
        }).finally(() => setSaving(false));
      };

      const draftText = draft === null ? "" : (draft.extraWritableRoots || []).join("\n");
      return react.createElement(
        "li",
        { className: "ser_card", "data-open": open },
        react.createElement(
          "button",
          { className: "ser_header", type: "button", onClick: () => setOpen(!open), "aria-expanded": open },
          react.createElement("span", { className: "ser_title" }, t("title")),
          dirty ? react.createElement("span", { className: "ser_badge" }, t("unsaved")) : null,
          react.createElement("span", null, open ? "▲" : "▼")
        ),
        open ? react.createElement(
          "div",
          { className: "ser_body" },
          react.createElement("p", { className: "ser_hint" }, t("hint")),
          react.createElement(
            "label",
            { className: "ser_field" },
            react.createElement("span", { className: "ser_label" }, t("roots")),
            react.createElement("textarea", {
              className: "ser_textarea",
              value: draftText,
              disabled: draft === null,
              onChange: (e) => {
                const roots = e.target.value.split("\n").map((s) => s.trim()).filter((s) => s.length > 0);
                setDraft({ ...draft, extraWritableRoots: roots });
              }
            })
          ),
          react.createElement(
            "div",
            { className: "ser_footer" },
            react.createElement(
              "span",
              { className: "ser_status" + (status !== null && status.kind === "error" ? " ser_error" : ""), role: "status" },
              status !== null ? status.text : ""
            ),
            react.createElement(
              "button",
              { className: "ser_discard", type: "button", disabled: saving || draft === null || !dirty, onClick: discard },
              t("discard")
            ),
            react.createElement(
              "button",
              { className: "ser_save", type: "button", disabled: saving || draft === null || !dirty, onClick: save },
              saving ? t("saving") : t("save")
            )
          )
        ) : null
      );
    }

    // ── 插件 apply ───────────────────────────────────────────────────────
    // DSH 客户端的 remote.<ns> 服务不会自动生成：必须由客户端代码用
    // ctx.remote.$mount(contribution) 显式挂载（官方 dsh-api-remotes 即如此）。
    // 若只把 remote.sandboxExtraRootsConfig 写进 inject 而不挂载，命名空间
    // 永远不存在，客户端插件会一直 pending，web boot 报 "did not activate"。
    // 因此本插件先挂载自己的命名空间，再注册设置卡片。
    const inject = ["slots", "locale", "remote"];
    const passthroughSchema = { parse: (value) => value };
    const REMOTE_CONTRIBUTION = {
      package: "@chaoset/sandbox-extra-roots",
      descriptors: [
        {
          id: "@chaoset/sandbox-extra-roots#sandboxExtraRootsConfig/get",
          service: "sandboxExtraRootsConfig",
          namespace: "sandboxExtraRootsConfig",
          method: "get",
          invocation: { kind: "direct" },
          parameters: [],
          result: { mode: "strict", typeSymbol: "sandboxExtraRootsConfig/get:result", schema: passthroughSchema }
        },
        {
          id: "@chaoset/sandbox-extra-roots#sandboxExtraRootsConfig/set",
          service: "sandboxExtraRootsConfig",
          namespace: "sandboxExtraRootsConfig",
          method: "set",
          invocation: { kind: "direct" },
          parameters: [{
            name: "partial",
            wire: "partial",
            source: "json",
            codec: { mode: "strict", typeSymbol: "sandboxExtraRootsConfig/set:partial", schema: passthroughSchema }
          }],
          result: { mode: "strict", typeSymbol: "sandboxExtraRootsConfig/set:result", schema: passthroughSchema }
        }
      ]
    };
    async function apply(ctx) {
      const t = ctx.locale.bind(NS);
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), "sandbox-extra-roots: dictionaries");
      // 先挂载命名空间，再用 ctx.get 取回服务：cordis 的属性访问（ctx.remote.X）
      // 要求 X 出现在 inject 里，而本插件的命名空间由自己挂载，若写进 inject
      // 会和自己等待的服务形成死锁，因此用 ctx.get（对未声明的服务合法）。
      await ctx.remote.$mount(REMOTE_CONTRIBUTION);
      const configService = ctx.get("remote.sandboxExtraRootsConfig");
      if (configService === void 0) throw new Error("sandbox-extra-roots: remote.sandboxExtraRootsConfig did not materialize after mount");
      const getConfig = () => configService.get().then((result) => {
        if (!result.ok) throw new Error(`sandboxExtraRootsConfig.get failed: ${result.error.code}: ${result.error.message}`);
        return result.value.config;
      });
      const setConfig = (partial) => configService.set(partial).then((result) => {
        if (!result.ok) throw new Error(`sandboxExtraRootsConfig.set failed: ${result.error.code}: ${result.error.message}`);
        return result.value;
      });
      ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({
        name: "settings.plugin.item",
        id: "sandbox-extra-roots",
        order: 40,
        locale: NS,
        inject: () => ({ getConfig, setConfig })
      }, SandboxRootsCard));
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
