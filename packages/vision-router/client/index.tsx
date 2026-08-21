import * as React from "react";
import type { TypertRemoteContribution } from "@deepseek-ai/dsh-typert-protocol";


    // ── 样式（注入 style 标签，模仿官方卡片外观）──────────────────────────
    var css = ".vr_card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:10px;min-width:0;overflow:hidden}.vr_card[data-open=true]{border-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-shadow-lv1)}.vr_header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:10px;align-items:center;gap:12px;padding:12px 14px;display:flex}.vr_header:hover,.vr_card[data-open=true]>.vr_header{background:var(--dsw-alias-interactive-bg-hover)}.vr_title{flex:1;min-width:0;font-size:14px;font-weight:600;line-height:20px}.vr_badge{white-space:nowrap;background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 10%,transparent);color:var(--dsw-alias-state-success-primary);border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;line-height:16px}.vr_body{border-top:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-platform);padding:10px 14px 12px}.vr_field{flex-direction:column;gap:4px;padding:8px 0;display:flex}.vr_label{font-size:12px;font-weight:500;line-height:18px}.vr_input{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);height:32px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:6px;padding:0 10px;font-size:13px;line-height:20px}.vr_textarea{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);font:inherit;color:var(--dsw-alias-label-primary);border-radius:6px;padding:6px 10px;font-size:12px;line-height:18px;resize:vertical;min-height:60px}.vr_hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:11px;line-height:16px}.vr_footer{border-top:1px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;padding:8px 0 2px;display:flex}.vr_save{font:inherit;cursor:pointer;border:1px solid transparent;border-radius:6px;padding:4px 14px;font-size:12px;line-height:18px;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}.vr_save:disabled{opacity:.4;cursor:default}.vr_discard{font:inherit;cursor:pointer;border:1px solid var(--dsw-alias-border-l1);background:0 0;color:var(--dsw-alias-label-secondary,#666);border-radius:6px;padding:4px 14px;font-size:12px;line-height:18px}.vr_discard:disabled{opacity:.4;cursor:default}.vr_status{flex:1;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}.vr_error{color:var(--dsw-alias-state-error-primary)}";
    var tagId = "@chaoset/vision-router/client.css";
    if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=\"" + tagId + "\"]") === null) {
      var tag = document.createElement("style");
      tag.dataset.plugin = "@chaoset/vision-router";
      tag.dataset.pluginCss = tagId;
      tag.textContent = css;
      document.head.appendChild(tag);
    }

    // ── 字典 ─────────────────────────────────────────────────────────────
    const NS = "settings.plugins.visionRouter";
    const zh = {
      title: "图片能力（vision-router）",
      hint: "为纯文本模型开启图片能力（read_image 可用），读图由模型自行决定。",
      unsaved: "有未保存的修改",
      discard: "放弃修改",
      saving: "保存中…",
      save: "保存",
      saveFailed: "保存失败",
      saved: "已保存，下次请求生效",
      loadFailed: "读取配置失败",
      invalidPositiveInt: "请输入正整数",
      compressImageBytes: "压缩触发字节数",
      compressMaxDimension: "压缩最大边长（px）",
      compressTargetBytes: "压缩目标字节数",
      compressFallbackDimension: "回退压缩边长（px）"
    };
    const en = {
      title: "Image capability (vision-router)",
      hint: "Enables image capability for text-only models (read_image available); the model decides when to read.",
      unsaved: "Unsaved changes",
      discard: "Discard",
      saving: "Saving…",
      save: "Save",
      saveFailed: "Save failed",
      saved: "Saved; takes effect on the next request",
      loadFailed: "Failed to load config",
      invalidPositiveInt: "Enter a positive integer",
      compressImageBytes: "Compress trigger bytes",
      compressMaxDimension: "Compress max dimension (px)",
      compressTargetBytes: "Compress target bytes",
      compressFallbackDimension: "Fallback compress dimension (px)"
    };

    // ── 粘贴图片增强 ────────────────────────────────────────────────────
    // DSH 自带输入框在部分版本/场景（如新会话 hero）不会把剪贴板图片加入草稿。
    // 这里在现有会话的输入区挂一个不可见节点，用捕获阶段处理 paste，主动把
    // 剪贴板图片转为 DSH 草稿附件；成功时阻止默认/冒泡，避免重复添加。
    function PasteImageEnhancer(props: any) {
      const rootRef = React.useRef<any>(null);
      React.useEffect(() => {
        const root = rootRef.current;
        if (root === null) return;
        const card = root.closest("[data-composer-card]");
        const textarea = card === null ? null : card.querySelector("textarea");
        if (textarea === null) return;
        const conversation = props.conversation;
        const sessionId = props.session && props.session.sessionId;
        if (conversation === void 0 || sessionId === void 0) return;
        const onPaste = (event: any) => {
          const items = Array.from(event.clipboardData && event.clipboardData.items ? event.clipboardData.items : []);
          const files = items
            .filter((item: any) => item.kind === "file")
            .map((item: any) => item.getAsFile())
            .filter((file: any) => file !== null);
          if (files.length === 0) return;
          // 如果剪贴板同时带有文本，交给 DSH 原生逻辑一并处理，避免吞掉文字。
          const text = event.clipboardData && typeof event.clipboardData.getData === "function" ? event.clipboardData.getData("text/plain") : "";
          if (text !== "") return;
          try {
            const images = conversation.createDraftImages(files);
            const shell = conversation.input.shell(sessionId);
            if (!shell.addImages(images.map((image: any) => image.id))) {
              conversation.releaseDraftImages(images);
              return;
            }
            event.preventDefault();
            event.stopPropagation();
          } catch (error) {
            // 交给 DSH 自带逻辑处理/提示，这里不吞掉用户体验。
          }
        };
        textarea.addEventListener("paste", onPaste, true);
        return () => textarea.removeEventListener("paste", onPaste, true);
      }, [props.conversation, props.session]);
      return React.createElement("span", { ref: rootRef, style: { display: "none" } });
    }

    // ── 表单字段 ─────────────────────────────────────────────────────────
    function Field(props: any) {
      return React.createElement(
        "label",
        { className: "vr_field" },
        React.createElement("span", { className: "vr_label" }, props.label),
        props.children,
        props.hint !== void 0 ? React.createElement("p", { className: "vr_hint" }, props.hint) : null
      );
    }
    function NumField(props: any) {
      const [text, setText] = React.useState(props.value === null || props.value === void 0 ? "" : String(props.value));
      React.useEffect(() => {
        setText(props.value === null || props.value === void 0 ? "" : String(props.value));
      }, [props.value]);
      const invalid = text.trim() === "" || !Number.isInteger(Number(text)) || Number(text) <= 0;
      return React.createElement(Field, {
        label: props.label,
        hint: invalid ? `${props.t("invalidPositiveInt")}${props.hint !== void 0 ? ` — ${props.hint}` : ""}` : props.hint
      },
        React.createElement("input", {
          className: "vr_input",
          type: "number",
          min: "1",
          step: "1",
          value: text,
          onChange: (e: any) => {
            const next = e.target.value;
            setText(next);
            const nextInvalid = next.trim() === "" || !Number.isInteger(Number(next)) || Number(next) <= 0;
            props.onChange(nextInvalid ? null : Number(next));
          },
          disabled: props.disabled === true
        })
      );
    }

    // ── 配置卡片 ─────────────────────────────────────────────────────────
    function VisionRouterCard(props: any) {
      const t = props.t;
      const [open, setOpen] = React.useState(false);
      const [cfg, setCfg] = React.useState<any>(null);
      const [draft, setDraft] = React.useState<any>(null);
      const [saving, setSaving] = React.useState(false);
      const [status, setStatus] = React.useState<any>(null);

      React.useEffect(() => {
        let cancelled = false;
        props.getConfig().then((value: any) => {
          if (cancelled) return;
          setCfg(value);
          setDraft(value);
        }).catch((error: any) => {
          if (!cancelled) setStatus({ kind: "error", text: `${t("loadFailed")}: ${error && error.message || error}` });
        });
        return () => { cancelled = true; };
      }, []);

      const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(cfg);
      const invalid = draft !== null && ["compressImageBytes", "compressMaxDimension", "compressTargetBytes", "compressFallbackDimension"]
        .some((key) => !Number.isInteger(draft[key]) || draft[key] <= 0);
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
        }).catch((error: any) => {
          setStatus({ kind: "error", text: `${t("saveFailed")}: ${error && error.message || error}` });
        }).finally(() => setSaving(false));
      };

      return React.createElement(
        "li",
        { className: "vr_card", "data-open": open },
        React.createElement(
          "button",
          {
            className: "vr_header",
            type: "button",
            onClick: () => setOpen(!open),
            "aria-expanded": open
          },
          React.createElement("span", { className: "vr_title" }, t("title")),
          dirty ? React.createElement("span", { className: "vr_badge" }, t("unsaved")) : null,
          React.createElement("span", null, open ? "▲" : "▼")
        ),
        open ? React.createElement(
          "div",
          { className: "vr_body" },
          React.createElement("p", { className: "vr_hint" }, t("hint")),
          React.createElement(NumField, {
            t,
            label: t("compressImageBytes"),
            value: draft === null ? null : draft.compressImageBytes,
            disabled: draft === null,
            onChange: (v: any) => setDraft({ ...draft, compressImageBytes: v })
          }),
          React.createElement(NumField, {
            t,
            label: t("compressMaxDimension"),
            value: draft === null ? null : draft.compressMaxDimension,
            disabled: draft === null,
            onChange: (v: any) => setDraft({ ...draft, compressMaxDimension: v })
          }),
          React.createElement(NumField, {
            t,
            label: t("compressTargetBytes"),
            value: draft === null ? null : draft.compressTargetBytes,
            disabled: draft === null,
            onChange: (v: any) => setDraft({ ...draft, compressTargetBytes: v })
          }),
          React.createElement(NumField, {
            t,
            label: t("compressFallbackDimension"),
            value: draft === null ? null : draft.compressFallbackDimension,
            disabled: draft === null,
            onChange: (v: any) => setDraft({ ...draft, compressFallbackDimension: v })
          }),
          React.createElement(
            "div",
            { className: "vr_footer" },
            React.createElement(
              "span",
              { className: "vr_status" + (status !== null && status.kind === "error" ? " vr_error" : ""), role: "status" },
              status !== null ? status.text : ""
            ),
            React.createElement(
              "button",
              { className: "vr_discard", type: "button", disabled: saving || draft === null || !dirty, onClick: discard },
              t("discard")
            ),
            React.createElement(
              "button",
              { className: "vr_save", type: "button", disabled: saving || draft === null || invalid || !dirty, onClick: save },
              saving ? t("saving") : t("save")
            )
          )
        ) : null
      );
    }

    // ── 插件 apply ───────────────────────────────────────────────────────
    // DSH 客户端的 remote.<ns> 服务不会自动生成：必须由客户端代码用
    // ctx.remote.$mount(contribution) 显式挂载（官方 dsh-api-remotes 即如此）。
    // 若只把 remote.visionRouterConfig 写进 inject 而不挂载，命名空间永远
    // 不存在，客户端插件会一直 pending，web boot 报 "did not activate"。
    // 因此本插件先挂载自己的命名空间，再注册设置卡片。
    const inject = ["slots", "locale", "remote"];
    const passthroughSchema = { parse: (value: any) => value };
    const REMOTE_CONTRIBUTION: TypertRemoteContribution = {
      package: "@chaoset/vision-router",
      descriptors: [
        {
          id: "@chaoset/vision-router#visionRouterConfig/get",
          service: "visionRouterConfig",
          namespace: "visionRouterConfig",
          method: "get",
          invocation: { kind: "direct" },
          parameters: [],
          result: { mode: "strict", typeSymbol: "visionRouterConfig/get:result", schema: passthroughSchema }
        },
        {
          id: "@chaoset/vision-router#visionRouterConfig/set",
          service: "visionRouterConfig",
          namespace: "visionRouterConfig",
          method: "set",
          invocation: { kind: "direct" },
          parameters: [{
            name: "partial",
            wire: "partial",
            source: "json",
            codec: { mode: "strict", typeSymbol: "visionRouterConfig/set:partial", schema: passthroughSchema }
          }],
          result: { mode: "strict", typeSymbol: "visionRouterConfig/set:result", schema: passthroughSchema }
        }
      ]
    };
    async function apply(ctx: any) {
      const t = ctx.locale.bind(NS);
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), "vision-router: dictionaries");
      // 先挂载命名空间，再用 ctx.get 取回服务：cordis 的属性访问（ctx.remote.X）
      // 要求 X 出现在 inject 里，而本插件的命名空间由自己挂载，若写进 inject
      // 会和自己等待的服务形成死锁，因此用 ctx.get（对未声明的服务合法）。
      await ctx.remote.$mount(REMOTE_CONTRIBUTION);
      const configService = ctx.get("remote.visionRouterConfig");
      if (configService === void 0) throw new Error("vision-router: remote.visionRouterConfig did not materialize after mount");
      const getConfig = () => configService.get().then((result: any) => {
        if (!result.ok) throw new Error(`visionRouterConfig.get failed: ${result.error.code}: ${result.error.message}`);
        return result.value.config;
      });
      const setConfig = (partial: any) => configService.set(partial).then((result: any) => {
        if (!result.ok) throw new Error(`visionRouterConfig.set failed: ${result.error.code}: ${result.error.message}`);
        return result.value;
      });
      ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({
        name: "settings.plugin.item",
        // keyed slot：key 为卡片编辑的设置 namespace（与 host 侧 serviceKey 一致），
        // 设置页按 key 与宿主服务的 namespace 配对 dispatch。
        key: "visionRouterConfig",
        id: "vision-router",
        order: 30,
        locale: NS,
        inject: () => ({ getConfig, setConfig })
      }, VisionRouterCard));
      // 让剪贴板图片能进入会话草稿（对 DSH 自带 paste 未覆盖的场景做补充）。
      ctx.slots.inject("conversation.input.right", () => ctx.slots.register({
        name: "conversation.input.right",
        id: "vision-router-paste",
        order: 100,
        locale: NS,
        inject: () => ({ conversation: ctx.get("conversation") })
      }, PasteImageEnhancer));
    }

export { apply, inject };
