window.__ModuleLoader__.load({
  id: "@dsh-plugins/vision-router",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    let react = require("react");
    let slots = require("@deepseek-ai/dsh-client-ui-slots");

    // ── 样式（注入 style 标签，模仿官方卡片外观）──────────────────────────
    var css = ".vr_card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:10px;min-width:0;overflow:hidden}.vr_card[data-open=true]{border-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-shadow-lv1)}.vr_header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:10px;align-items:center;gap:12px;padding:12px 14px;display:flex}.vr_header:hover,.vr_card[data-open=true]>.vr_header{background:var(--dsw-alias-interactive-bg-hover)}.vr_title{flex:1;min-width:0;font-size:14px;font-weight:600;line-height:20px}.vr_badge{white-space:nowrap;background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 10%,transparent);color:var(--dsw-alias-state-success-primary);border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;line-height:16px}.vr_body{border-top:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-platform);padding:10px 14px 12px}.vr_field{flex-direction:column;gap:4px;padding:8px 0;display:flex}.vr_label{font-size:12px;font-weight:500;line-height:18px}.vr_input{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);height:32px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:6px;padding:0 10px;font-size:13px;line-height:20px}.vr_textarea{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);font:inherit;color:var(--dsw-alias-label-primary);border-radius:6px;padding:6px 10px;font-size:12px;line-height:18px;resize:vertical;min-height:60px}.vr_hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:11px;line-height:16px}.vr_footer{border-top:1px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;padding:8px 0 2px;display:flex}.vr_save{font:inherit;cursor:pointer;border:1px solid transparent;border-radius:6px;padding:4px 14px;font-size:12px;line-height:18px;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}.vr_save:disabled{opacity:.4;cursor:default}.vr_status{flex:1;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}.vr_error{color:var(--dsw-alias-state-error-primary)}";
    var tagId = "@dsh-plugins/vision-router/client.css";
    if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=\"" + tagId + "\"]") === null) {
      var tag = document.createElement("style");
      tag.dataset.plugin = "@dsh-plugins/vision-router";
      tag.dataset.pluginCss = tagId;
      tag.textContent = css;
      document.head.appendChild(tag);
    }

    // ── 字典 ─────────────────────────────────────────────────────────────
    const NS = "settings.plugins.visionRouter";
    const zh = {
      title: "识图降级（vision-router）",
      hint: "纯文本模型收到图片时自动调用视觉模型转述。",
      unsaved: "有未保存的修改",
      saving: "保存中…",
      save: "保存",
      saveFailed: "保存失败",
      saved: "已保存，下次请求生效",
      loadFailed: "读取配置失败",
      visionProvider: "视觉模型提供方",
      visionModel: "视觉模型",
      autoDiscover: "自动发现（配置的模型不可用时）",
      maxVisionTokens: "转述输出上限（token）",
      compressImageBytes: "压缩触发字节数",
      compressMaxDimension: "压缩最大边长（px）",
      compressTargetBytes: "压缩目标字节数",
      compressFallbackDimension: "回退压缩边长（px）",
      prompt: "转述提示词",
      fieldVisionProvider: "视觉模型所在 provider（如 zai-open）",
      fieldVisionModel: "必须真实支持图片输入（如 glm-4v-flash）"
    };
    const en = {
      title: "Image routing (vision-router)",
      hint: "Transcribe images via a vision model when the session model is text-only.",
      unsaved: "Unsaved changes",
      saving: "Saving…",
      save: "Save",
      saveFailed: "Save failed",
      saved: "Saved; takes effect on the next request",
      loadFailed: "Failed to load config",
      visionProvider: "Vision provider",
      visionModel: "Vision model",
      autoDiscover: "Auto-discover (when configured model is unavailable)",
      maxVisionTokens: "Max transcription tokens",
      compressImageBytes: "Compress trigger bytes",
      compressMaxDimension: "Compress max dimension (px)",
      compressTargetBytes: "Compress target bytes",
      compressFallbackDimension: "Fallback compress dimension (px)",
      prompt: "Transcription prompt",
      fieldVisionProvider: "Provider that hosts the vision model (e.g. zai-open)",
      fieldVisionModel: "Must declare image input (e.g. glm-4v-flash)"
    };

    // ── 表单字段 ─────────────────────────────────────────────────────────
    function Field(props) {
      return react.createElement(
        "label",
        { className: "vr_field" },
        react.createElement("span", { className: "vr_label" }, props.label),
        props.children,
        props.hint !== void 0 ? react.createElement("p", { className: "vr_hint" }, props.hint) : null
      );
    }
    function TextField(props) {
      return react.createElement(Field, { label: props.label, hint: props.hint },
        react.createElement("input", {
          className: "vr_input",
          value: props.value,
          onChange: (e) => props.onChange(e.target.value),
          disabled: props.disabled === true
        })
      );
    }
    function NumField(props) {
      return react.createElement(Field, { label: props.label, hint: props.hint },
        react.createElement("input", {
          className: "vr_input",
          type: "number",
          value: String(props.value),
          onChange: (e) => props.onChange(Number(e.target.value)),
          disabled: props.disabled === true
        })
      );
    }
    function BoolField(props) {
      return react.createElement(Field, { label: props.label, hint: props.hint },
        react.createElement("input", {
          type: "checkbox",
          checked: props.value === true,
          onChange: (e) => props.onChange(e.target.checked),
          disabled: props.disabled === true
        })
      );
    }

    // ── 配置卡片 ─────────────────────────────────────────────────────────
    function VisionRouterCard(props) {
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
        }).catch(() => {
          if (!cancelled) setStatus({ kind: "error", text: t("loadFailed") });
        });
        return () => { cancelled = true; };
      }, []);

      const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(cfg);
      const save = () => {
        setSaving(true);
        setStatus(null);
        props.setConfig(draft).then(() => {
          setCfg(draft);
          setStatus({ kind: "ok", text: t("saved") });
        }).catch(() => {
          setStatus({ kind: "error", text: t("saveFailed") });
        }).finally(() => setSaving(false));
      };

      return react.createElement(
        "li",
        { className: "vr_card", "data-open": open },
        react.createElement(
          "button",
          {
            className: "vr_header",
            onClick: () => setOpen(!open),
            "aria-expanded": open
          },
          react.createElement("span", { className: "vr_title" }, t("title")),
          dirty ? react.createElement("span", { className: "vr_badge" }, t("unsaved")) : null,
          react.createElement("span", null, open ? "▲" : "▼")
        ),
        open ? react.createElement(
          "div",
          { className: "vr_body" },
          react.createElement("p", { className: "vr_hint" }, t("hint")),
          react.createElement(TextField, {
            label: t("visionProvider"),
            hint: t("fieldVisionProvider"),
            value: draft === null ? "" : draft.visionProvider,
            disabled: draft === null,
            onChange: (v) => setDraft({ ...draft, visionProvider: v })
          }),
          react.createElement(TextField, {
            label: t("visionModel"),
            hint: t("fieldVisionModel"),
            value: draft === null ? "" : draft.visionModel,
            disabled: draft === null,
            onChange: (v) => setDraft({ ...draft, visionModel: v })
          }),
          react.createElement(BoolField, {
            label: t("autoDiscover"),
            value: draft === null ? false : draft.autoDiscover,
            disabled: draft === null,
            onChange: (v) => setDraft({ ...draft, autoDiscover: v })
          }),
          react.createElement(NumField, {
            label: t("maxVisionTokens"),
            value: draft === null ? 0 : draft.maxVisionTokens,
            disabled: draft === null,
            onChange: (v) => setDraft({ ...draft, maxVisionTokens: v })
          }),
          react.createElement(NumField, {
            label: t("compressImageBytes"),
            value: draft === null ? 0 : draft.compressImageBytes,
            disabled: draft === null,
            onChange: (v) => setDraft({ ...draft, compressImageBytes: v })
          }),
          react.createElement(NumField, {
            label: t("compressMaxDimension"),
            value: draft === null ? 0 : draft.compressMaxDimension,
            disabled: draft === null,
            onChange: (v) => setDraft({ ...draft, compressMaxDimension: v })
          }),
          react.createElement(NumField, {
            label: t("compressTargetBytes"),
            value: draft === null ? 0 : draft.compressTargetBytes,
            disabled: draft === null,
            onChange: (v) => setDraft({ ...draft, compressTargetBytes: v })
          }),
          react.createElement(NumField, {
            label: t("compressFallbackDimension"),
            value: draft === null ? 0 : draft.compressFallbackDimension,
            disabled: draft === null,
            onChange: (v) => setDraft({ ...draft, compressFallbackDimension: v })
          }),
          react.createElement(Field, { label: t("prompt") },
            react.createElement("textarea", {
              className: "vr_textarea",
              value: draft === null ? "" : draft.prompt,
              disabled: draft === null,
              onChange: (e) => setDraft({ ...draft, prompt: e.target.value })
            })
          ),
          react.createElement(
            "div",
            { className: "vr_footer" },
            react.createElement(
              "span",
              { className: "vr_status" + (status !== null && status.kind === "error" ? " vr_error" : "") },
              status !== null ? status.text : ""
            ),
            react.createElement(
              "button",
              { className: "vr_save", disabled: saving || draft === null || !dirty, onClick: save },
              saving ? t("saving") : t("save")
            )
          )
        ) : null
      );
    }

    // ── 插件 apply ───────────────────────────────────────────────────────
    const inject = ["slots", "locale", "remote", "remote.visionRouterConfig"];
    function apply(ctx) {
      const t = ctx.locale.bind(NS);
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), "vision-router: dictionaries");
      const getConfig = () => ctx.remote.visionRouterConfig.get().then((result) => {
        if (!result.ok) throw new Error(`visionRouterConfig.get failed: ${result.error.code}: ${result.error.message}`);
        return result.value.config;
      });
      const setConfig = (partial) => ctx.remote.visionRouterConfig.set(partial).then((result) => {
        if (!result.ok) throw new Error(`visionRouterConfig.set failed: ${result.error.code}: ${result.error.message}`);
        return result.value;
      });
      ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({
        name: "settings.plugin.item",
        id: "vision-router",
        order: 30,
        locale: NS,
        inject: () => ({ getConfig, setConfig })
      }, VisionRouterCard));
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
