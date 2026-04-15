"use client";

import { ScanLog } from "@/app/page";

type Props = { logs: ScanLog[] };

const TYPE_CONFIG: Record<string, { icon: string; label: string; color: string }> = {
  github:  { icon: "⬡", label: "GitHub",     color: "#c8c8c8" },
  slack:   { icon: "#",  label: "Slack",      color: "#e01e5a" },
  gitlab:  { icon: "⬠", label: "GitLab",     color: "#fc6d26" },
  jira:    { icon: "◉", label: "Jira",       color: "#0052cc" },
  teams:   { icon: "⬕", label: "MS Teams",   color: "#5059c9" },
  ai:      { icon: "◆", label: "AI",         color: "#cc785c" },
  info:    { icon: "·",  label: "Info",       color: "var(--text-muted)" },
};

function Spinner() {
  return (
    <>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <span style={{ display: "inline-block", width: 13, height: 13, border: "2px solid var(--border)", borderTopColor: "var(--accent)", borderRadius: "50%", animation: "spin 0.7s linear infinite", flexShrink: 0 }} />
    </>
  );
}

function PulseLabel() {
  return (
    <>
      <style>{`@keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:0.35 } }`}</style>
      <span style={{ fontSize: 9, fontWeight: 700, color: "var(--accent)", letterSpacing: "0.08em", textTransform: "uppercase", animation: "pulse 1.2s ease-in-out infinite" }}>
        running
      </span>
    </>
  );
}

export default function ScanProgress({ logs }: Props) {
  // Determine overall expected steps from log types that appeared
  const seenTypes = new Set(logs.map((l) => l.type));

  // Ordered display: integrations first, then AI last
  const orderedTypes = ["github", "slack", "gitlab", "jira", "teams", "ai"].filter(
    (t) => seenTypes.has(t as ScanLog["type"])
  );

  // If no logs yet, show a waiting state
  if (logs.length === 0) {
    return (
      <div style={{ background: "var(--surface)", border: "1px solid var(--border-subtle)", borderRadius: 14, padding: "28px 24px", textAlign: "center" }}>
        <Spinner />
        <p style={{ marginTop: 14, fontSize: 13, color: "var(--text-muted)" }}>Connecting to services…</p>
      </div>
    );
  }

  return (
    <div>
      <div style={{ background: "var(--surface)", border: "1px solid var(--border-subtle)", borderRadius: 14, padding: "20px 22px", marginBottom: 14 }}>
        {orderedTypes.map((type, idx) => {
          const log = logs.find((l) => l.type === type);
          const cfg = TYPE_CONFIG[type] ?? TYPE_CONFIG.info;
          const status = log?.status ?? "pending";
          const isLast = idx === orderedTypes.length - 1;

          return (
            <div key={type}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "10px 0" }}>
                {/* Status icon */}
                <div style={{
                  width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                  background: status === "done" ? "var(--green-dim)" : status === "running" ? "var(--accent-dim)" : "var(--surface-2)",
                  border: `1px solid ${status === "done" ? "rgba(52,211,153,0.25)" : status === "running" ? "var(--accent-border)" : "var(--border)"}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  transition: "all 0.2s",
                }}>
                  {status === "running" ? <Spinner />
                    : status === "done"  ? <span style={{ color: "var(--green)",   fontSize: 13 }}>✓</span>
                    : status === "error" ? <span style={{ color: "var(--red)",     fontSize: 13 }}>✕</span>
                    : <span style={{ color: cfg.color, fontSize: 12, fontWeight: 700, opacity: 0.4 }}>{cfg.icon}</span>}
                </div>

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0, paddingTop: 3 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                    <span style={{ fontSize: 13, fontWeight: 500, color: status === "pending" ? "var(--text-muted)" : "var(--text-primary)" }}>
                      {log?.message || cfg.label}
                    </span>
                    {status === "running" && <PulseLabel />}
                    {status === "done" && (
                      <span style={{ fontSize: 10, fontWeight: 600, color: "var(--green)", letterSpacing: "0.06em", textTransform: "uppercase" }}>done</span>
                    )}
                  </div>
                  {log?.detail && (
                    <p style={{ fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.5 }}>{log.detail}</p>
                  )}
                </div>

                {/* Source badge */}
                <span style={{
                  fontSize: 10, fontWeight: 700, color: cfg.color, opacity: status === "pending" ? 0.3 : 0.7,
                  letterSpacing: "0.04em", flexShrink: 0, paddingTop: 5,
                }}>
                  {cfg.label.toUpperCase()}
                </span>
              </div>

              {!isLast && <div style={{ height: 1, background: "var(--border-subtle)", marginLeft: 42 }} />}
            </div>
          );
        })}
      </div>

      <p style={{ textAlign: "center", fontSize: 12, color: "var(--text-muted)" }}>
        This may take a few seconds depending on your activity volume…
      </p>
    </div>
  );
}
