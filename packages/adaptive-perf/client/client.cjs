window.__ModuleLoader__.load({
  id: "@chaoset/adaptive-perf",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    let react = require("react");

    // ── 样式（注入 style 标签，模仿官方卡片外观）──────────────────────────
    var css = ".ap_card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:10px;min-width:0;overflow:hidden}.ap_card[data-open=true]{border-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-shadow-lv1)}.ap_header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:10px;align-items:center;gap:12px;padding:12px 14px;display:flex}.ap_header:hover,.ap_card[data-open=true]>.ap_header{background:var(--dsw-alias-interactive-bg-hover)}.ap_title{flex:1;min-width:0;font-size:14px;font-weight:600;line-height:20px}.ap_badge{white-space:nowrap;background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 10%,transparent);color:var(--dsw-alias-state-success-primary);border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;line-height:16px}.ap_body{border-top:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-platform);padding:10px 14px 12px}.ap_field{flex-direction:column;gap:4px;padding:8px 0;display:flex}.ap_label{font-size:12px;font-weight:500;line-height:18px}.ap_input{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);height:32px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:6px;padding:0 10px;font-size:13px;line-height:20px}.ap_textarea{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);font:inherit;color:var(--dsw-alias-label-primary);border-radius:6px;padding:6px 10px;font-size:12px;line-height:18px;resize:vertical;min-height:120px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}.ap_hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:11px;line-height:16px}.ap_footer{border-top:1px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;padding:8px 0 2px;display:flex}.ap_save{font:inherit;cursor:pointer;border:1px solid transparent;border-radius:6px;padding:4px 14px;font-size:12px;line-height:18px;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}.ap_discard{font:inherit;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:4px 14px;font-size:12px;line-height:18px;background:0 0;color:inherit}.ap_status{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);flex:1}.ap_status.ap_error{color:var(--dsw-alias-state-danger-primary)}";
    var tagId = "@chaoset/adaptive-perf/client.css";
    if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=\"" + tagId + "\"]") === null) {
      var tag = document.createElement("style");
      tag.dataset.plugin = "@chaoset/adaptive-perf";
      tag.dataset.pluginCss = tagId;
      tag.textContent = css;
      document.head.appendChild(tag);
    }

    // ── 字典 ─────────────────────────────────────────────────────────────
    const NS = "settings.plugins.adaptivePerf";
    const zh = {
      title: "极简性能自适应（adaptive-perf）",
      hint: "让标准模式 / PTC 模式达到极简模式级别的高性能：抑制运行时上下文快照，启动即精简工具目录，按需求信号自动放行工具族。",
      unsaved: "有未保存的修改",
      discard: "放弃修改",
      saving: "保存中…",
      save: "保存",
      saveFailed: "保存失败",
      saved: "已保存，热生效（新会话立即生效）",
      loadFailed: "读取配置失败",
      invalidFamilies: "families 必须是合法 JSON 对象",
      enabled: "启用插件",
      presets: "目标 preset",
      fieldPresets: "逗号分隔的 preset id（如 standard, code）",
      suppressRuntimeContext: "抑制运行时上下文快照",
      fieldSuppressRuntimeContext: "等同极简模式的 includeRuntimeContext: false，每次请求省掉快照文本（零功能损失）",
      leanByDefault: "启动即精简工具目录",
      fieldLeanByDefault: "默认隐藏编排类工具族（子代理/工作流/ralph/goal），核心编码工具保留",
      escalateOnKeyword: "关键词自动放行",
      fieldEscalateOnKeyword: "用户消息命中工具族触发词（如“子代理”）时，该会话放行对应工具族",
      escalateOnUnknownTool: "失败自动放行",
      fieldEscalateOnUnknownTool: "PTC 程序调用被隐藏工具报 UNKNOWN_TOOL 时自动放行对应族",
      suppressInjectedContext: "常驻抑制注入上下文",
      fieldSuppressInjectedContext: "整个会话剥离技能目录提醒（skill-catalog）与 AGENTS.md 摘要（agent-instructions），不再在晋升后恢复——替代品是 skill_search/skill_load 按需发现与一次性 instruction-hint（参照 dsh-anchored-standard：注入在场即使后置也扰动轨迹）",
      skillDiscovery: "技能按需发现",
      fieldSkillDiscovery: "晋升后常驻 skill_search / skill_load 两个小工具，替代 ~9KB 的 <available_skills> 目录注入",
      instructionHint: "指令文件一次性提示",
      fieldInstructionHint: "晋升后注入一次“指令文件存在，需要时自读”的短提示（探测项目链 AGENTS.md/CLAUDE.md 与 $DSH_HOME/AGENTS.md），替代全文摘要",
      families: "工具族（高级）",
      fieldFamilies: "JSON：{ 族名: { enabled, tools: [工具名], keywords: [触发词] } }。保存后热生效。",
      coreTools: "核心工具（永不隐藏）",
      fieldCoreTools: "展示用：这些工具不进入任何限制族。未列入任何族的工具也默认保留。",
      bootstrapEnabled: "首轮锚定（bootstrap）",
      fieldBootstrapEnabled: "请求 #1 只暴露 Minimal 真实工具对并剥离自动注入上下文，首个持久信号（promoteOn）后恢复——让首轮轨迹锚定极简（参照 dsh-anchored-standard 实测：工具 schema + 注入提醒决定轨迹）",
      bootstrapRealPair: "挂载真实 Minimal 工具对",
      fieldBootstrapRealPair: "把官方 minimal preset 同款插件（持久 PTY bash + str_replace_editor）挂进会话作用域，按名阴影 standard 的 sandboxed bash——schema 与 Minimal 逐字相同才能锚定（issue #11：任何 standard 系 schema 11/11 落入 standard-like）；依赖官方插件包，缺失时自动降级",
      bootstrapTools: "首轮工具",
      fieldBootstrapTools: "请求 #1 可见的工具（真实 Minimal 对：bash, str_replace_editor）。逗号分隔。",
      bootstrapPromoteOn: "晋升触发",
      fieldBootstrapPromoteOn: "either（默认）：首个 tool/call 或 assistant/message 先到者晋升；tool-call / assistant-message 可单独指定",
      bootstrapSuppressed: "剥离的注入上下文",
      fieldBootstrapSuppressed: "请求 #1 剥离的自动注入 source.kind（技能目录提醒 skill-catalog、AGENTS.md 摘要 agent-instructions）；逗号分隔，留空=不剥离",
      bootstrapCompactionTools: "压缩后工作集",
      fieldBootstrapCompactionTools: "compaction/end 之后、再次晋升前额外可用的工具（核心工作集）。逗号分隔。",
      bootstrapDiscoveryTools: "晋升后常驻发现工具",
      fieldBootstrapDiscoveryTools: "晋升后保留在 resident 目录里的按需发现工具（如 dev_tool_search）；逗号分隔。",
      bootstrapMaxTokens: "首轮输出预算封顶（token）",
      fieldBootstrapMaxTokens: "请求 #1 的 maxTokens 封顶，晋升后自动剥离；0 = 不封顶（opt-in）",
      minimalPromptEnabled: "极简提示词层（语域锚定）",
      fieldMinimalPromptEnabled: "把系统提示拉回极简语域：屏蔽全局引导段 + 替换 persona。参考实现的完整锚定条件——仅收窄工具不足以翻转思维链风格（let me → let's/i'll/i need）",
      minimalPromptPersona: "persona 文本",
      fieldMinimalPromptPersona: "按名替换 deployment:persona；默认与极简模式逐字相同。留空 = 不替换（保留原 persona）",
      minimalPromptSuppressSections: "屏蔽全局引导段",
      fieldMinimalPromptSuppressSections: "屏蔽 harness:identity / harness:source / app:web-surface 三个全局段（等同极简 complete persona 的效果；plan-mode 与 PTC 的 SDK 段不受影响）"
    };
    const en = {
      title: "Adaptive performance (adaptive-perf)",
      hint: "Bring standard / PTC presets to minimal-mode-level performance: suppress the runtime-context snapshot, start with a lean tool catalog, and re-enable tool families on demand.",
      unsaved: "Unsaved changes",
      discard: "Discard",
      saving: "Saving…",
      save: "Save",
      saveFailed: "Save failed",
      saved: "Saved; hot-applied (new sessions take effect immediately)",
      loadFailed: "Failed to load config",
      invalidFamilies: "families must be valid JSON object",
      enabled: "Enable plugin",
      presets: "Target presets",
      fieldPresets: "Comma-separated preset ids (e.g. standard, code)",
      suppressRuntimeContext: "Suppress runtime-context snapshot",
      fieldSuppressRuntimeContext: "Same as minimal's includeRuntimeContext: false; drops the snapshot text from every request (zero feature loss)",
      leanByDefault: "Lean tool catalog at session start",
      fieldLeanByDefault: "Hide orchestration families (subagent/workflow/ralph/goal) by default; core coding tools stay",
      escalateOnKeyword: "Keyword escalation",
      fieldEscalateOnKeyword: "A user message matching a family's trigger words re-enables that family for the session",
      escalateOnUnknownTool: "Failure escalation",
      fieldEscalateOnUnknownTool: "A PTC program calling a hidden tool (UNKNOWN_TOOL) re-enables that family",
      suppressInjectedContext: "Always suppress injected context",
      fieldSuppressInjectedContext: "Strip the skill-catalog reminder and the AGENTS.md digest from every request, not just request #1 — replaced by on-demand skill_search/skill_load and a one-shot instruction hint (per dsh-anchored-standard: the injections perturb the trajectory even after promotion)",
      skillDiscovery: "On-demand skill discovery",
      fieldSkillDiscovery: "Keep skill_search / skill_load resident after promotion as the replacement for the ~9KB <available_skills> catalog injection",
      instructionHint: "One-shot instruction hint",
      fieldInstructionHint: "After promotion, inject ONCE a short hint that instruction files exist and should be read when relevant (probes the project chain AGENTS.md/CLAUDE.md and $DSH_HOME/AGENTS.md), instead of dumping their content",
      families: "Tool families (advanced)",
      fieldFamilies: "JSON: { familyId: { enabled, tools: [names], keywords: [triggers] } }. Hot-applied on save.",
      coreTools: "Core tools (never hidden)",
      fieldCoreTools: "Informational: these never enter any restriction family. Tools not listed in any family stay visible too.",
      bootstrapEnabled: "First-request bootstrap",
      fieldBootstrapEnabled: "Request #1 exposes only the real Minimal tool pair and drops auto-injected context; the first durable signal (promoteOn) restores the catalog — anchors the first-request trajectory to minimal (per dsh-anchored-standard measurements)",
      bootstrapRealPair: "Mount the real Minimal tool pair",
      fieldBootstrapRealPair: "Mount the official minimal-preset plugins (persistent PTY bash + str_replace_editor) into the session scope, shadowing the standard sandboxed bash by name — only byte-identical schemas anchor (issue #11: every standard-family schema fell standard-like 11/11); degrades gracefully when the official packages are missing",
      bootstrapTools: "Bootstrap tools",
      fieldBootstrapTools: "Tools visible on request #1 (the real Minimal pair: bash, str_replace_editor). Comma-separated.",
      bootstrapPromoteOn: "Promotion trigger",
      fieldBootstrapPromoteOn: "either (default): first tool/call or assistant/message promotes; tool-call / assistant-message select one",
      bootstrapSuppressed: "Suppressed injected context",
      fieldBootstrapSuppressed: "Auto-injected source.kinds stripped on request #1 (skill-catalog reminder, agent-instructions digest); comma-separated, empty = strip nothing",
      bootstrapCompactionTools: "Post-compaction work set",
      fieldBootstrapCompactionTools: "Extra tools available after compaction/end until a new promotion signal (core work set). Comma-separated.",
      bootstrapDiscoveryTools: "Resident discovery tools",
      fieldBootstrapDiscoveryTools: "On-demand discovery tools kept in the resident catalog after promotion (e.g. dev_tool_search). Comma-separated.",
      bootstrapMaxTokens: "First-request output cap (tokens)",
      fieldBootstrapMaxTokens: "maxTokens cap for request #1, stripped after promotion; 0 = no cap (opt-in)",
      minimalPromptEnabled: "Minimal prompt layer (register anchor)",
      fieldMinimalPromptEnabled: "Pull the system prompt back to the minimal register: suppress the global orientation sections and replace the persona. The reference's full anchoring condition — tool narrowing alone does not flip the thinking style (let me → let's/i'll/i need)",
      minimalPromptPersona: "Persona text",
      fieldMinimalPromptPersona: "Shadows deployment:persona by name; defaults to the exact minimal-mode text. Empty = keep the original persona",
      minimalPromptSuppressSections: "Suppress global orientation sections",
      fieldMinimalPromptSuppressSections: "Shadow harness:identity / harness:source / app:web-surface to empty (same effect as minimal's complete persona; plan-mode and the PTC SDK sections are unaffected)"
    };

    // ── 表单字段 ─────────────────────────────────────────────────────────
    function Field(props) {
      return react.createElement(
        "label",
        { className: "ap_field" },
        react.createElement("span", { className: "ap_label" }, props.label),
        props.children,
        props.hint !== void 0 ? react.createElement("p", { className: "ap_hint" }, props.hint) : null
      );
    }
    function TextField(props) {
      return react.createElement(Field, { label: props.label, hint: props.hint },
        react.createElement("input", {
          className: "ap_input",
          value: props.value,
          onChange: (e) => props.onChange(e.target.value),
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
    function familiesToText(families) {
      return JSON.stringify(families, null, 2);
    }
    function textToFamilies(text) {
      const parsed = JSON.parse(text);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new TypeError("families must be a JSON object");
      }
      for (const [id, fam] of Object.entries(parsed)) {
        if (fam === null || typeof fam !== "object" || Array.isArray(fam)) {
          throw new TypeError("family \"" + id + "\" must be an object");
        }
        if (fam.enabled !== void 0 && typeof fam.enabled !== "boolean") {
          throw new TypeError("family \"" + id + "\".enabled must be a boolean");
        }
        for (const key of ["tools", "keywords"]) {
          if (fam[key] !== void 0 && !(Array.isArray(fam[key]) && fam[key].every((v) => typeof v === "string"))) {
            throw new TypeError("family \"" + id + "\"." + key + " must be an array of strings");
          }
        }
      }
      return parsed;
    }

    // ── 配置卡片 ─────────────────────────────────────────────────────────
    function AdaptivePerfCard(props) {
      const t = props.t;
      const [open, setOpen] = react.useState(false);
      const [cfg, setCfg] = react.useState(null);
      const [draft, setDraft] = react.useState(null);
      const [familiesText, setFamiliesText] = react.useState("");
      const [saving, setSaving] = react.useState(false);
      const [status, setStatus] = react.useState(null);

      react.useEffect(() => {
        let cancelled = false;
        props.getConfig().then((value) => {
          if (cancelled) return;
          setCfg(value);
          setDraft(value);
          setFamiliesText(familiesToText(value.families));
        }).catch((error) => {
          if (!cancelled) setStatus({ kind: "error", text: t("loadFailed") + ": " + (error && error.message || error) });
        });
        return () => { cancelled = true; };
      }, []);

      let familiesInvalid = false;
      let familiesError = null;
      if (draft !== null) {
        try {
          textToFamilies(familiesText);
        } catch (error) {
          familiesInvalid = true;
          familiesError = error && error.message || String(error);
        }
      }
      const dirty = draft !== null && (JSON.stringify(draft) !== JSON.stringify(cfg) || familiesInvalid === false && familiesToText(draft.families) !== familiesText);
      const invalid = draft !== null && familiesInvalid;
      const discard = () => {
        setDraft(cfg);
        setFamiliesText(cfg === null ? "" : familiesToText(cfg.families));
        setStatus(null);
      };
      const save = () => {
        if (draft === null || familiesInvalid) return;
        let next = draft;
        try {
          next = { ...draft, families: textToFamilies(familiesText) };
        } catch (error) {
          setStatus({ kind: "error", text: t("invalidFamilies") + ": " + (error && error.message || error) });
          return;
        }
        setSaving(true);
        setStatus(null);
        props.setConfig(next).then(() => {
          setCfg(next);
          setDraft(next);
          setFamiliesText(familiesToText(next.families));
          setStatus({ kind: "ok", text: t("saved") });
        }).catch((error) => {
          setStatus({ kind: "error", text: t("saveFailed") + ": " + (error && error.message || error) });
        }).finally(() => setSaving(false));
      };

      return react.createElement(
        "li",
        { className: "ap_card", "data-open": open },
        react.createElement(
          "button",
          {
            className: "ap_header",
            type: "button",
            onClick: () => setOpen(!open),
            "aria-expanded": open
          },
          react.createElement("span", { className: "ap_title" }, t("title")),
          dirty ? react.createElement("span", { className: "ap_badge" }, t("unsaved")) : null,
          react.createElement("span", null, open ? "▲" : "▼")
        ),
        open ? react.createElement(
          "div",
          { className: "ap_body" },
          react.createElement("p", { className: "ap_hint" }, t("hint")),
          react.createElement(BoolField, {
            label: t("enabled"),
            value: draft === null ? false : draft.enabled,
            disabled: draft === null,
            onChange: (v) => setDraft({ ...draft, enabled: v })
          }),
          react.createElement(TextField, {
            label: t("presets"),
            hint: t("fieldPresets"),
            value: draft === null ? "" : (draft.presets || []).join(", "),
            disabled: draft === null,
            onChange: (v) => setDraft({ ...draft, presets: v.split(/[,，\s]+/).filter((x) => x.length > 0) })
          }),
          react.createElement(BoolField, {
            label: t("suppressRuntimeContext"),
            hint: t("fieldSuppressRuntimeContext"),
            value: draft === null ? false : draft.suppressRuntimeContext,
            disabled: draft === null,
            onChange: (v) => setDraft({ ...draft, suppressRuntimeContext: v })
          }),
          react.createElement(BoolField, {
            label: t("leanByDefault"),
            hint: t("fieldLeanByDefault"),
            value: draft === null ? false : draft.leanByDefault,
            disabled: draft === null,
            onChange: (v) => setDraft({ ...draft, leanByDefault: v })
          }),
          react.createElement(BoolField, {
            label: t("escalateOnKeyword"),
            hint: t("fieldEscalateOnKeyword"),
            value: draft === null ? false : draft.escalateOnKeyword,
            disabled: draft === null,
            onChange: (v) => setDraft({ ...draft, escalateOnKeyword: v })
          }),
          react.createElement(BoolField, {
            label: t("escalateOnUnknownTool"),
            hint: t("fieldEscalateOnUnknownTool"),
            value: draft === null ? false : draft.escalateOnUnknownTool,
            disabled: draft === null,
            onChange: (v) => setDraft({ ...draft, escalateOnUnknownTool: v })
          }),
          react.createElement(BoolField, {
            label: t("suppressInjectedContext"),
            hint: t("fieldSuppressInjectedContext"),
            value: draft === null ? false : draft.suppressInjectedContext,
            disabled: draft === null,
            onChange: (v) => setDraft({ ...draft, suppressInjectedContext: v })
          }),
          react.createElement(BoolField, {
            label: t("skillDiscovery"),
            hint: t("fieldSkillDiscovery"),
            value: draft === null ? false : draft.skillDiscovery,
            disabled: draft === null,
            onChange: (v) => setDraft({ ...draft, skillDiscovery: v })
          }),
          react.createElement(BoolField, {
            label: t("instructionHint"),
            hint: t("fieldInstructionHint"),
            value: draft === null ? false : draft.instructionHint,
            disabled: draft === null,
            onChange: (v) => setDraft({ ...draft, instructionHint: v })
          }),
          react.createElement(BoolField, {
            label: t("bootstrapEnabled"),
            hint: t("fieldBootstrapEnabled"),
            value: draft === null ? false : !!draft.bootstrap && draft.bootstrap.enabled,
            disabled: draft === null,
            onChange: (v) => setDraft({ ...draft, bootstrap: { ...(draft.bootstrap || {}), enabled: v } })
          }),
          react.createElement(BoolField, {
            label: t("bootstrapRealPair"),
            hint: t("fieldBootstrapRealPair"),
            value: draft === null ? false : !!draft.bootstrap && draft.bootstrap.realPair,
            disabled: draft === null || (draft.bootstrap && draft.bootstrap.enabled === false),
            onChange: (v) => setDraft({ ...draft, bootstrap: { ...(draft.bootstrap || {}), realPair: v } })
          }),
          react.createElement(TextField, {
            label: t("bootstrapTools"),
            hint: t("fieldBootstrapTools"),
            value: draft === null ? "" : ((draft.bootstrap && draft.bootstrap.tools) || []).join(", "),
            disabled: draft === null || (draft.bootstrap && draft.bootstrap.enabled === false),
            onChange: (v) => setDraft({ ...draft, bootstrap: { ...(draft.bootstrap || {}), tools: v.split(/[,，\s]+/).filter((x) => x.length > 0) } })
          }),
          react.createElement(TextField, {
            label: t("bootstrapPromoteOn"),
            hint: t("fieldBootstrapPromoteOn"),
            value: draft === null ? "" : (draft.bootstrap && draft.bootstrap.promoteOn) || "either",
            disabled: draft === null || (draft.bootstrap && draft.bootstrap.enabled === false),
            onChange: (v) => setDraft({ ...draft, bootstrap: { ...(draft.bootstrap || {}), promoteOn: (v.trim() || "either") } })
          }),
          react.createElement(TextField, {
            label: t("bootstrapSuppressed"),
            hint: t("fieldBootstrapSuppressed"),
            value: draft === null ? "" : ((draft.bootstrap && draft.bootstrap.suppressedContextSources) || []).join(", "),
            disabled: draft === null || (draft.bootstrap && draft.bootstrap.enabled === false),
            onChange: (v) => setDraft({ ...draft, bootstrap: { ...(draft.bootstrap || {}), suppressedContextSources: v.split(/[,，\s]+/).filter((x) => x.length > 0) } })
          }),
          react.createElement(TextField, {
            label: t("bootstrapCompactionTools"),
            hint: t("fieldBootstrapCompactionTools"),
            value: draft === null ? "" : ((draft.bootstrap && draft.bootstrap.compactionTools) || []).join(", "),
            disabled: draft === null || (draft.bootstrap && draft.bootstrap.enabled === false),
            onChange: (v) => setDraft({ ...draft, bootstrap: { ...(draft.bootstrap || {}), compactionTools: v.split(/[,，\s]+/).filter((x) => x.length > 0) } })
          }),
          react.createElement(TextField, {
            label: t("bootstrapDiscoveryTools"),
            hint: t("fieldBootstrapDiscoveryTools"),
            value: draft === null ? "" : ((draft.bootstrap && draft.bootstrap.discoveryTools) || []).join(", "),
            disabled: draft === null || (draft.bootstrap && draft.bootstrap.enabled === false),
            onChange: (v) => setDraft({ ...draft, bootstrap: { ...(draft.bootstrap || {}), discoveryTools: v.split(/[,，\s]+/).filter((x) => x.length > 0) } })
          }),
          react.createElement(TextField, {
            label: t("bootstrapMaxTokens"),
            hint: t("fieldBootstrapMaxTokens"),
            value: draft === null ? "" : String((draft.bootstrap && draft.bootstrap.maxTokens) || 0),
            disabled: draft === null || (draft.bootstrap && draft.bootstrap.enabled === false),
            onChange: (v) => {
              const n = Number(v.trim());
              setDraft({ ...draft, bootstrap: { ...(draft.bootstrap || {}), maxTokens: Number.isSafeInteger(n) && n > 0 ? n : 0 } });
            }
          }),
          react.createElement(BoolField, {
            label: t("minimalPromptEnabled"),
            hint: t("fieldMinimalPromptEnabled"),
            value: draft === null ? false : (draft.minimalPrompt && draft.minimalPrompt.enabled === true),
            disabled: draft === null,
            onChange: (v) => setDraft({ ...draft, minimalPrompt: { ...(draft.minimalPrompt || {}), enabled: v } })
          }),
          react.createElement(BoolField, {
            label: t("minimalPromptSuppressSections"),
            hint: t("fieldMinimalPromptSuppressSections"),
            value: draft === null ? false : (draft.minimalPrompt && draft.minimalPrompt.suppressSections === true),
            disabled: draft === null || (draft.minimalPrompt && draft.minimalPrompt.enabled === false),
            onChange: (v) => setDraft({ ...draft, minimalPrompt: { ...(draft.minimalPrompt || {}), suppressSections: v } })
          }),
          react.createElement(TextField, {
            label: t("minimalPromptPersona"),
            hint: t("fieldMinimalPromptPersona"),
            value: draft === null ? "" : ((draft.minimalPrompt && draft.minimalPrompt.persona) || ""),
            disabled: draft === null || (draft.minimalPrompt && draft.minimalPrompt.enabled === false),
            onChange: (v) => setDraft({ ...draft, minimalPrompt: { ...(draft.minimalPrompt || {}), persona: v } })
          }),
          react.createElement(Field, {
            label: t("families"),
            hint: familiesInvalid ? t("invalidFamilies") + (familiesError !== null ? " — " + familiesError : "") : t("fieldFamilies")
          },
            react.createElement("textarea", {
              className: "ap_textarea",
              value: familiesText,
              disabled: draft === null,
              spellCheck: false,
              onChange: (e) => setFamiliesText(e.target.value)
            })
          ),
          react.createElement(Field, {
            label: t("coreTools"),
            hint: t("fieldCoreTools")
          },
            react.createElement("p", { className: "ap_hint" }, draft === null ? "" : (draft.coreTools || []).join(", "))
          ),
          react.createElement(
            "div",
            { className: "ap_footer" },
            react.createElement(
              "span",
              { className: "ap_status" + (status !== null && status.kind === "error" ? " ap_error" : ""), role: "status" },
              status !== null ? status.text : ""
            ),
            react.createElement(
              "button",
              { className: "ap_discard", type: "button", disabled: saving || draft === null || !dirty, onClick: discard },
              t("discard")
            ),
            react.createElement(
              "button",
              { className: "ap_save", type: "button", disabled: saving || draft === null || invalid || !dirty, onClick: save },
              saving ? t("saving") : t("save")
            )
          )
        ) : null
      );
    }

    // ── 插件 apply ───────────────────────────────────────────────────────
    // DSH 客户端的 remote.<ns> 服务不会自动生成：必须由客户端代码用
    // ctx.remote.$mount(contribution) 显式挂载（官方 dsh-api-remotes 即如此）。
    // 若只把 remote.adaptivePerfConfig 写进 inject 而不挂载，命名空间永远
    // 不存在，客户端插件会一直 pending，web boot 报 "did not activate"。
    // 因此本插件先挂载自己的命名空间，再注册设置卡片。
    const inject = ["slots", "locale", "remote"];
    const passthroughSchema = { parse: (value) => value };
    const REMOTE_CONTRIBUTION = {
      package: "@chaoset/adaptive-perf",
      descriptors: [
        {
          id: "@chaoset/adaptive-perf#adaptivePerfConfig/get",
          service: "adaptivePerfConfig",
          namespace: "adaptivePerfConfig",
          method: "get",
          invocation: { kind: "direct" },
          parameters: [],
          result: { mode: "strict", typeSymbol: "adaptivePerfConfig/get:result", schema: passthroughSchema }
        },
        {
          id: "@chaoset/adaptive-perf#adaptivePerfConfig/set",
          service: "adaptivePerfConfig",
          namespace: "adaptivePerfConfig",
          method: "set",
          invocation: { kind: "direct" },
          parameters: [{
            name: "partial",
            wire: "partial",
            source: "json",
            codec: { mode: "strict", typeSymbol: "adaptivePerfConfig/set:partial", schema: passthroughSchema }
          }],
          result: { mode: "strict", typeSymbol: "adaptivePerfConfig/set:result", schema: passthroughSchema }
        }
      ]
    };
    async function apply(ctx) {
      const t = ctx.locale.bind(NS);
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), "adaptive-perf: dictionaries");
      // 先挂载命名空间，再用 ctx.get 取回服务：cordis 的属性访问（ctx.remote.X）
      // 要求 X 出现在 inject 里，而本插件的命名空间由自己挂载，若写进 inject
      // 会和自己等待的服务形成死锁，因此用 ctx.get（对未声明的服务合法）。
      await ctx.remote.$mount(REMOTE_CONTRIBUTION);
      const configService = ctx.get("remote.adaptivePerfConfig");
      if (configService === void 0) throw new Error("adaptive-perf: remote.adaptivePerfConfig did not materialize after mount");
      const getConfig = () => configService.get().then((result) => {
        if (!result.ok) throw new Error("adaptivePerfConfig.get failed: " + result.error.code + ": " + result.error.message);
        return result.value.config;
      });
      const setConfig = (partial) => configService.set(partial).then((result) => {
        if (!result.ok) throw new Error("adaptivePerfConfig.set failed: " + result.error.code + ": " + result.error.message);
        return result.value;
      });
      ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({
        name: "settings.plugin.item",
        // keyed slot：key 为卡片编辑的设置 namespace（与 host 侧 serviceKey 一致），
        // 设置页按 key 与宿主服务的 namespace 配对 dispatch。
        key: "adaptivePerfConfig",
        id: "adaptive-perf",
        order: 40,
        locale: NS,
        inject: () => ({ getConfig, setConfig })
      }, AdaptivePerfCard));
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
