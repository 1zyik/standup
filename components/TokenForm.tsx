"use client";

import { useState, useCallback } from "react";
import { AIProvider, MODEL_OPTIONS, DEFAULT_MODELS } from "@/lib/ai";
import TokenDocs from "./TokenDocs";

// ─── Types ────────────────────────────────────────────────────────────────────

export type Integration = "github" | "slack" | "gitlab" | "jira" | "teams";

export type FormData = {
  aiProvider: AIProvider;
  aiKey: string;
  aiModel: string;
  integrations: {
    github?: string;
    slack?: { token: string; cookie?: string; workspace?: string };
    gitlab?: { token: string; url: string };
    jira?: { url: string; email: string; token: string };
    teams?: string;
  };
  days: number;
  dateFrom?: string;
  dateTo?: string;
};

type Props = { onSubmit: (data: FormData) => void };

// ─── Config ───────────────────────────────────────────────────────────────────

const AI_PROVIDERS: { id: AIProvider; label: string; icon: string; color: string; placeholder: string }[] = [
  { id: "anthropic", label: "Anthropic", icon: "◆", color: "#cc785c", placeholder: "sk-ant-api03-…" },
  { id: "openai",    label: "OpenAI",    icon: "⬟", color: "#10a37f", placeholder: "sk-proj-…" },
  { id: "deepseek",  label: "DeepSeek",  icon: "◈", color: "#4d9fff", placeholder: "sk-…" },
];

type IntegrationDef = {
  id: Integration;
  label: string;
  icon: string;
  color: string;
  fields: FieldDef[];
  docsTab: string;
};

type FieldDef = {
  key: string;
  label: string;
  placeholder: string;
  type?: "text" | "password" | "url" | "email";
  hint?: string;
};

const INTEGRATIONS: IntegrationDef[] = [
  {
    id: "github", label: "GitHub", icon: "⬡", color: "#c8c8c8",
    docsTab: "github",
    fields: [{ key: "token", label: "Personal Access Token", placeholder: "ghp_… or github_pat_…", type: "password", hint: "repo, read:user scopes" }],
  },
  {
    id: "slack", label: "Slack", icon: "#", color: "#e01e5a",
    docsTab: "slack",
    fields: [
      { key: "token", label: "User Token", placeholder: "xoxp-… or xoxc-…", type: "password", hint: "xoxp- (User OAuth) or xoxc- (browser session)" },
      { key: "cookie", label: "Cookie 'd' value (xoxc- only)", placeholder: "xoxd-…", type: "password", hint: "Required for xoxc- tokens. Copy the 'd' cookie from slack.com in your browser." },
      { key: "workspace", label: "Workspace subdomain (xoxc- only)", placeholder: "myteam", type: "text", hint: "The bit before .slack.com in your workspace URL." },
    ],
  },
  {
    id: "gitlab", label: "GitLab", icon: "⬠", color: "#fc6d26",
    docsTab: "gitlab",
    fields: [
      { key: "token", label: "Personal Access Token", placeholder: "glpat-…", type: "password", hint: "api, read_user scopes" },
      { key: "url",   label: "GitLab URL (optional)", placeholder: "https://gitlab.com", type: "url", hint: "Leave blank for gitlab.com" },
    ],
  },
  {
    id: "jira", label: "Jira", icon: "◉", color: "#0052cc",
    docsTab: "jira",
    fields: [
      { key: "url",   label: "Jira Base URL",  placeholder: "https://yourorg.atlassian.net", type: "url" },
      { key: "email", label: "Account Email",  placeholder: "you@example.com", type: "email" },
      { key: "token", label: "API Token",      placeholder: "ATATT3x…", type: "password", hint: "Generated at id.atlassian.com" },
    ],
  },
  {
    id: "teams", label: "MS Teams", icon: "⬕", color: "#5059c9",
    docsTab: "teams",
    fields: [{ key: "token", label: "Graph API Access Token", placeholder: "eyJ0eXAiOiJKV1Q…", type: "password", hint: "Bearer token from Graph Explorer or Azure CLI" }],
  },
];

const PRESET_DAYS = [3, 7, 14, 21];
const MAX_CUSTOM_DAYS = 14;

function toDateStr(d: Date) { return d.toISOString().slice(0, 10); }
function daysBetween(a: string, b: string) {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 10 }}>
      {children}
    </p>
  );
}

function Divider() {
  return <div style={{ height: 1, background: "var(--border-subtle)", margin: "20px 0" }} />;
}

function PasswordInput({
  value, onChange, placeholder, fieldType = "password",
}: { value: string; onChange: (v: string) => void; placeholder: string; fieldType?: string }) {
  const [show, setShow] = useState(false);
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center", background: "var(--surface-3)", border: `1px solid ${focused ? "var(--accent-border)" : "var(--border)"}`, borderRadius: 8, transition: "border-color 0.15s" }}>
      <input
        type={show || fieldType !== "password" ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "var(--text-primary)", fontSize: 12, padding: fieldType === "password" ? "9px 44px 9px 12px" : "9px 12px", fontFamily: fieldType === "password" ? "monospace" : "inherit", width: "100%" }}
      />
      {fieldType === "password" && (
        <button type="button" onClick={() => setShow((p) => !p)}
          style={{ position: "absolute", right: 8, background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", padding: "4px 4px" }}>
          {show ? "HIDE" : "SHOW"}
        </button>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function TokenForm({ onSubmit }: Props) {
  const [aiProvider, setAiProvider] = useState<AIProvider>("anthropic");
  const [aiKey, setAiKey] = useState("");
  const [aiModel, setAiModel] = useState(DEFAULT_MODELS.anthropic);
  const [showAiKey, setShowAiKey] = useState(false);
  const [aiFocused, setAiFocused] = useState(false);

  const [enabled, setEnabled] = useState<Set<Integration>>(new Set(["github", "slack"]));
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});

  const [presetDays, setPresetDays] = useState<number | null>(14);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [rangeError, setRangeError] = useState("");

  const [docsOpen, setDocsOpen] = useState(false);
  const [docsTab, setDocsTab] = useState("github");

  // AI provider change
  const switchProvider = (p: AIProvider) => {
    setAiProvider(p);
    setAiModel(DEFAULT_MODELS[p]);
    setAiKey("");
  };

  // Integration toggle
  const toggleIntegration = (id: Integration) => {
    setEnabled((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const setField = (integration: Integration, key: string, value: string) => {
    setFieldValues((prev) => ({ ...prev, [`${integration}_${key}`]: value }));
  };
  const getField = (integration: Integration, key: string) =>
    fieldValues[`${integration}_${key}`] ?? "";

  // Date range
  const selectPreset = (d: number) => { setPresetDays(d); setCustomFrom(""); setCustomTo(""); setRangeError(""); };

  const validateRange = useCallback((from: string, to: string) => {
    if (!from || !to) return true;
    const span = daysBetween(from, to);
    if (span < 1) { setRangeError("End date must be after start date."); return false; }
    if (span > MAX_CUSTOM_DAYS) { setRangeError(`Range cannot exceed ${MAX_CUSTOM_DAYS} days (selected: ${span}d).`); return false; }
    setRangeError(""); return true;
  }, []);

  const handleCustomFrom = (v: string) => { setCustomFrom(v); setPresetDays(null); setRangeError(""); if (v && customTo) validateRange(v, customTo); };
  const handleCustomTo   = (v: string) => { setCustomTo(v);   setPresetDays(null); setRangeError(""); if (customFrom && v) validateRange(customFrom, v); };

  const effectiveDays = presetDays !== null ? presetDays : (customFrom && customTo && !rangeError ? daysBetween(customFrom, customTo) : null);
  const today = toDateStr(new Date());

  // Validation
  const integrationValid = enabled.size > 0 && [...enabled].every((id) => {
    const def = INTEGRATIONS.find((i) => i.id === id)!;
    return def.fields.every((f) => {
      const v = getField(id, f.key).trim();
      if (f.key === "url" && id === "gitlab") return true; // optional
      if (id === "slack" && (f.key === "cookie" || f.key === "workspace")) {
        // Only required when the token is an xoxc- browser-session token.
        const token = getField("slack", "token").trim();
        if (!token.startsWith("xoxc-") && !token.startsWith("xoxs-")) return true;
      }
      return v.length > 0;
    });
  });
  const valid = aiKey.trim() && integrationValid && effectiveDays !== null && !rangeError;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;

    const integrations: FormData["integrations"] = {};
    if (enabled.has("github")) integrations.github = getField("github", "token");
    if (enabled.has("slack"))  {
      const slackToken = getField("slack", "token");
      const slackCookie = getField("slack", "cookie").trim();
      const slackWorkspace = getField("slack", "workspace").trim().replace(/^https?:\/\//, "").replace(/\.slack\.com.*$/, "");
      integrations.slack = {
        token: slackToken,
        cookie: slackCookie || undefined,
        workspace: slackWorkspace || undefined,
      };
    }
    if (enabled.has("gitlab")) integrations.gitlab = { token: getField("gitlab", "token"), url: getField("gitlab", "url") || "https://gitlab.com" };
    if (enabled.has("jira"))   integrations.jira   = { url: getField("jira", "url"), email: getField("jira", "email"), token: getField("jira", "token") };
    if (enabled.has("teams"))  integrations.teams  = getField("teams",  "token");

    onSubmit({
      aiProvider, aiKey, aiModel,
      integrations,
      days: effectiveDays!,
      dateFrom: presetDays === null ? customFrom : undefined,
      dateTo:   presetDays === null ? customTo   : undefined,
    });
  };

  const openDocs = (tab: string) => { setDocsTab(tab); setDocsOpen(true); };

  const activeProv = AI_PROVIDERS.find((p) => p.id === aiProvider)!;

  return (
    <>
      <TokenDocs open={docsOpen} onClose={() => setDocsOpen(false)} defaultTab={docsTab} />

      <form onSubmit={handleSubmit}>
        <div style={{ background: "var(--surface)", border: "1px solid var(--border-subtle)", borderRadius: 16, overflow: "hidden" }}>

          {/* ── AI Provider ── */}
          <div style={{ padding: "20px 24px 0" }}>
            <SectionLabel>AI Provider</SectionLabel>

            {/* Provider toggle row */}
            <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
              {AI_PROVIDERS.map((p) => (
                <button key={p.id} type="button" onClick={() => switchProvider(p.id)}
                  style={{
                    flex: 1, padding: "7px 0", borderRadius: 8,
                    border: `1px solid ${aiProvider === p.id ? "var(--accent-border)" : "var(--border)"}`,
                    background: aiProvider === p.id ? "var(--accent-dim)" : "var(--surface-2)",
                    color: aiProvider === p.id ? "var(--accent)" : "var(--text-secondary)",
                    fontSize: 12, fontWeight: aiProvider === p.id ? 600 : 400,
                    cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 5, transition: "all 0.15s",
                  }}>
                  <span style={{ color: p.color, fontWeight: 700 }}>{p.icon}</span>
                  {p.label}
                </button>
              ))}
            </div>

            {/* API Key + Model row */}
            <div style={{ display: "flex", gap: 8, marginBottom: 4 }}>
              <div style={{ flex: 1, position: "relative" }}>
                <div style={{ position: "relative", display: "flex", alignItems: "center", background: "var(--surface-2)", border: `1px solid ${aiFocused ? "var(--accent-border)" : "var(--border)"}`, borderRadius: 8, transition: "border-color 0.15s" }}>
                  <span style={{ position: "absolute", left: 12, color: activeProv.color, fontWeight: 700, fontSize: 12, pointerEvents: "none", opacity: 0.75 }}>{activeProv.icon}</span>
                  <input
                    type={showAiKey ? "text" : "password"}
                    value={aiKey}
                    onChange={(e) => setAiKey(e.target.value)}
                    onFocus={() => setAiFocused(true)}
                    onBlur={() => setAiFocused(false)}
                    placeholder={activeProv.placeholder}
                    autoComplete="off" spellCheck={false}
                    style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "var(--text-primary)", fontSize: 12, padding: "9px 44px 9px 30px", fontFamily: "monospace", width: "100%" }}
                  />
                  <button type="button" onClick={() => setShowAiKey((p) => !p)}
                    style={{ position: "absolute", right: 8, background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 10, fontWeight: 700, letterSpacing: "0.06em" }}>
                    {showAiKey ? "HIDE" : "SHOW"}
                  </button>
                </div>
              </div>
              <select
                value={aiModel}
                onChange={(e) => setAiModel(e.target.value)}
                style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text-primary)", fontSize: 12, padding: "0 10px", cursor: "pointer", outline: "none", minWidth: 150 }}>
                {MODEL_OPTIONS[aiProvider].map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <p style={{ fontSize: 11, color: "var(--text-muted)" }}>API key for generating the standup summary</p>
              <button type="button" onClick={() => openDocs(aiProvider === "anthropic" ? "anthropic" : aiProvider === "openai" ? "openai" : "deepseek")}
                style={{ background: "none", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text-muted)", padding: "2px 8px", fontSize: 10, fontWeight: 500, cursor: "pointer" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--accent)"; (e.currentTarget as HTMLElement).style.borderColor = "var(--accent-border)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"; (e.currentTarget as HTMLElement).style.borderColor = "var(--border)"; }}>
                ? How to get this
              </button>
            </div>
          </div>

          <Divider />

          {/* ── Integrations ── */}
          <div style={{ padding: "0 24px" }}>
            <SectionLabel>Integrations — select all that apply</SectionLabel>

            {/* Toggle card grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6, marginBottom: 16 }}>
              {INTEGRATIONS.map((intg) => {
                const on = enabled.has(intg.id);
                return (
                  <button key={intg.id} type="button" onClick={() => toggleIntegration(intg.id)}
                    style={{
                      padding: "10px 4px", borderRadius: 9,
                      border: `1px solid ${on ? "var(--accent-border)" : "var(--border)"}`,
                      background: on ? "var(--accent-dim)" : "var(--surface-2)",
                      color: on ? "var(--accent)" : "var(--text-secondary)",
                      cursor: "pointer", transition: "all 0.15s",
                      display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
                    }}>
                    <span style={{ fontSize: 16, color: on ? intg.color : "var(--text-muted)", fontWeight: 700, lineHeight: 1 }}>{intg.icon}</span>
                    <span style={{ fontSize: 10, fontWeight: on ? 600 : 400, lineHeight: 1 }}>{intg.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Expanded fields for each enabled integration */}
            {INTEGRATIONS.filter((intg) => enabled.has(intg.id)).map((intg, idx, arr) => (
              <div key={intg.id} style={{ marginBottom: idx < arr.length - 1 ? 16 : 0 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ color: intg.color, fontWeight: 700, fontSize: 14 }}>{intg.icon}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>{intg.label}</span>
                  </div>
                  <button type="button" onClick={() => openDocs(intg.docsTab)}
                    style={{ background: "none", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text-muted)", padding: "2px 8px", fontSize: 10, fontWeight: 500, cursor: "pointer" }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--accent)"; (e.currentTarget as HTMLElement).style.borderColor = "var(--accent-border)"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"; (e.currentTarget as HTMLElement).style.borderColor = "var(--border)"; }}>
                    ? How to get token
                  </button>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingLeft: 20, borderLeft: `2px solid ${intg.color}30` }}>
                  {intg.fields.filter((field) => {
                    if (intg.id !== "slack") return true;
                    if (field.key === "cookie" || field.key === "workspace") {
                      const t = getField("slack", "token").trim();
                      return t.startsWith("xoxc-") || t.startsWith("xoxs-");
                    }
                    return true;
                  }).map((field) => (
                    <div key={field.key}>
                      <p style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4, fontWeight: 500 }}>{field.label}</p>
                      <PasswordInput
                        value={getField(intg.id, field.key)}
                        onChange={(v) => setField(intg.id, field.key, v)}
                        placeholder={field.placeholder}
                        fieldType={field.type || "password"}
                      />
                      {field.hint && <p style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 3 }}>{field.hint}</p>}
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {enabled.size === 0 && (
              <p style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "center", padding: "12px 0" }}>Enable at least one integration above</p>
            )}
          </div>

          <Divider />

          {/* ── Lookback Period ── */}
          <div style={{ padding: "0 24px 20px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <SectionLabel>Lookback Period</SectionLabel>
              {effectiveDays !== null && (
                <span style={{ fontSize: 10, color: "var(--text-muted)", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 4, padding: "2px 7px", fontWeight: 600 }}>
                  {effectiveDays}d selected
                </span>
              )}
            </div>

            <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
              {PRESET_DAYS.map((d) => (
                <button key={d} type="button" onClick={() => selectPreset(d)}
                  style={{
                    flex: 1, padding: "7px 0", borderRadius: 7,
                    border: `1px solid ${presetDays === d ? "var(--accent-border)" : "var(--border)"}`,
                    background: presetDays === d ? "var(--accent-dim)" : "var(--surface-2)",
                    color: presetDays === d ? "var(--accent)" : "var(--text-secondary)",
                    fontSize: 12, fontWeight: presetDays === d ? 600 : 400, cursor: "pointer", transition: "all 0.15s",
                  }}>
                  {d}d
                </button>
              ))}
            </div>

            {/* Custom date range */}
            <div style={{ background: "var(--surface-2)", border: `1px solid ${rangeError ? "rgba(248,113,113,0.4)" : (presetDays === null && customFrom && customTo && !rangeError) ? "var(--accent-border)" : "var(--border)"}`, borderRadius: 8, padding: "12px 14px", transition: "border-color 0.15s" }}>
              <p style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>
                Custom range <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>(max {MAX_CUSTOM_DAYS} days)</span>
              </p>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 3, fontWeight: 500 }}>From</p>
                  <input type="date" value={customFrom} max={customTo || today} onChange={(e) => handleCustomFrom(e.target.value)}
                    style={{ width: "100%", background: "var(--surface-3)", border: "1px solid var(--border)", borderRadius: 6, color: customFrom ? "var(--text-primary)" : "var(--text-muted)", fontSize: 12, padding: "6px 8px", outline: "none", colorScheme: "dark" }} />
                </div>
                <span style={{ color: "var(--text-muted)", paddingTop: 16 }}>→</span>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 3, fontWeight: 500 }}>To</p>
                  <input type="date" value={customTo} min={customFrom || undefined} max={today} onChange={(e) => handleCustomTo(e.target.value)}
                    style={{ width: "100%", background: "var(--surface-3)", border: "1px solid var(--border)", borderRadius: 6, color: customTo ? "var(--text-primary)" : "var(--text-muted)", fontSize: 12, padding: "6px 8px", outline: "none", colorScheme: "dark" }} />
                </div>
              </div>
              {rangeError && (
                <p style={{ fontSize: 11, color: "var(--red)", marginTop: 6, display: "flex", alignItems: "center", gap: 5 }}>
                  <span>⚠</span> {rangeError}
                </p>
              )}
              {!rangeError && presetDays === null && customFrom && customTo && (
                <p style={{ fontSize: 11, color: "var(--green)", marginTop: 6, display: "flex", alignItems: "center", gap: 5 }}>
                  <span>✓</span>
                  {new Date(customFrom).toLocaleDateString("en-US", { month: "short", day: "numeric" })} – {new Date(customTo).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} · {daysBetween(customFrom, customTo)} days
                </p>
              )}
            </div>
          </div>

          {/* ── Submit ── */}
          <div style={{ padding: "16px 24px", borderTop: "1px solid var(--border-subtle)", background: "var(--surface-2)" }}>
            <button type="submit" disabled={!valid}
              style={{
                width: "100%", padding: "11px 0", borderRadius: 9, border: "none",
                background: valid ? "var(--accent)" : "var(--surface-3)",
                color: valid ? "#fff" : "var(--text-muted)",
                fontSize: 14, fontWeight: 600, cursor: valid ? "pointer" : "not-allowed", transition: "background 0.15s", letterSpacing: "-0.01em",
              }}
              onMouseEnter={(e) => { if (valid) (e.currentTarget as HTMLElement).style.background = "var(--accent-hover)"; }}
              onMouseLeave={(e) => { if (valid) (e.currentTarget as HTMLElement).style.background = "var(--accent)"; }}>
              Generate Standup
              {effectiveDays !== null && <span style={{ opacity: 0.7, fontWeight: 400, marginLeft: 8, fontSize: 12 }}>· last {effectiveDays}d</span>}
            </button>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginTop: 10 }}>
              <p style={{ fontSize: 11, color: "var(--text-muted)" }}>Tokens are never stored — session only</p>
              <span style={{ color: "var(--border)" }}>·</span>
              <button type="button" onClick={() => setDocsOpen(true)}
                style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: 11, cursor: "pointer", padding: 0, textDecoration: "underline", textDecorationStyle: "dotted", textUnderlineOffset: "3px" }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = "var(--accent)")}
                onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = "var(--text-muted)")}>
                Setup guide
              </button>
            </div>
          </div>
        </div>
      </form>
    </>
  );
}
