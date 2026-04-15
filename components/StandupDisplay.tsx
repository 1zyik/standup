"use client";

import { useState } from "react";
import { StandupResult } from "@/app/page";

type Props = { result: StandupResult; onReset: () => void };

// ─── Parser ───────────────────────────────────────────────────────────────────

type ParsedSection = {
  title: string;
  items: string[];
  isDay: boolean;
  dayDate?: string;   // YYYY-MM-DD
  dayName?: string;   // Monday, Tuesday …
};

const DAY_HEADER_RE = /^##\s+(\w+)\s+\((\d{4}-\d{2}-\d{2})\)\s*$/;
const SECTION_HEADER_RE = /^#+\s+(.+)$/;
const STANDUP_HEADER_RE = /^Scrum Updates\s*\((.+)\)\s*$/i;

function parseStandup(md: string): { header: string | null; sections: ParsedSection[] } {
  const lines = md.split("\n");
  let header: string | null = null;
  const sections: ParsedSection[] = [];
  let current: ParsedSection | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    // Top-level header line "Scrum Updates (…)"
    if (STANDUP_HEADER_RE.test(line) && !current) {
      header = line;
      continue;
    }

    // Day heading: ## Monday (2026-04-14)
    const dayMatch = line.match(DAY_HEADER_RE);
    if (dayMatch) {
      if (current) sections.push(current);
      current = { title: `${dayMatch[1]} (${dayMatch[2]})`, items: [], isDay: true, dayDate: dayMatch[2], dayName: dayMatch[1] };
      continue;
    }

    // Generic heading: ## In Progress
    const secMatch = line.match(SECTION_HEADER_RE);
    if (secMatch) {
      if (current) sections.push(current);
      current = { title: secMatch[1].trim(), items: [], isDay: false };
      continue;
    }

    // Bullet
    if ((line.startsWith("- ") || line.startsWith("• ") || line.startsWith("* ")) && current) {
      current.items.push(line.replace(/^[-•*]\s+/, ""));
      continue;
    }

    // Plain text inside a section
    if (current && line.length > 1) current.items.push(line);
  }

  if (current) sections.push(current);
  return { header, sections };
}

// ─── Inline markdown renderer ─────────────────────────────────────────────────

function renderInline(text: string): React.ReactNode[] {
  const mdLink = /\[([^\]]+)\]\(([^)]+)\)/g;
  const mdBold = /\*\*([^*]+)\*\*/g;

  // Split on both links and bold
  const parts: React.ReactNode[] = [];
  let last = 0;
  const combined = /\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*/g;
  let m: RegExpExecArray | null;

  while ((m = combined.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[1] !== undefined) {
      parts.push(
        <a key={m.index} href={m[2]} target="_blank" rel="noopener noreferrer"
          style={{ color: "var(--accent)", textDecoration: "none", borderBottom: "1px solid var(--accent-border)", paddingBottom: 1 }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = "var(--accent-hover)")}
          onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = "var(--accent)")}>
          {m[1]}
        </a>
      );
    } else {
      parts.push(<strong key={m.index} style={{ color: "var(--text-primary)", fontWeight: 600 }}>{m[3]}</strong>);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

// ─── Section metadata ─────────────────────────────────────────────────────────

const SECTION_META: Record<string, { icon: string; color: string }> = {
  "in progress":  { icon: "◎", color: "var(--accent)" },
  "in-progress":  { icon: "◎", color: "var(--accent)" },
  "blockers":     { icon: "⚠", color: "var(--yellow)" },
  "blocked":      { icon: "⚠", color: "var(--yellow)" },
  "impediments":  { icon: "⚠", color: "var(--yellow)" },
  "next steps":   { icon: "→", color: "var(--green)" },
  "next":         { icon: "→", color: "var(--green)" },
  "upcoming":     { icon: "→", color: "var(--green)" },
  "planned":      { icon: "→", color: "var(--green)" },
};

function getSectionMeta(title: string) {
  const lower = title.toLowerCase();
  for (const [key, meta] of Object.entries(SECTION_META)) {
    if (lower.includes(key)) return meta;
  }
  return { icon: "·", color: "var(--text-muted)" };
}

// ─── Day badge ────────────────────────────────────────────────────────────────

function DayBadge({ dayName, dayDate }: { dayName: string; dayDate: string }) {
  const d = new Date(dayDate + "T12:00:00"); // noon avoids timezone shifts
  const formatted = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
      <div style={{ background: "var(--accent-dim)", border: "1px solid var(--accent-border)", borderRadius: 7, padding: "4px 10px", display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
        <span style={{ fontSize: 9, fontWeight: 700, color: "var(--accent)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
          {dayName.slice(0, 3).toUpperCase()}
        </span>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)", lineHeight: 1.2 }}>
          {d.getDate()}
        </span>
      </div>
      <div>
        <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", lineHeight: 1.2 }}>{dayName}</p>
        <p style={{ fontSize: 11, color: "var(--text-muted)" }}>{formatted}</p>
      </div>
    </div>
  );
}

// ─── Copy helpers ─────────────────────────────────────────────────────────────

function useCopy(text: string, delay = 2000) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), delay);
  };
  return { copied, copy };
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function StandupDisplay({ result, onReset }: Props) {
  const { header, sections } = parseStandup(result.markdown);

  const plainText = result.markdown
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*/g, "")
    .replace(/^#+\s*/gm, "")
    .trim();

  const { copied: copiedPlain, copy: copyPlain } = useCopy(plainText);
  const { copied: copiedMd, copy: copyMd } = useCopy(result.markdown);

  const daySections = sections.filter((s) => s.isDay);
  const trailingSections = sections.filter((s) => !s.isDay);

  return (
    <div>
      {/* Action bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, gap: 8 }}>
        <button onClick={onReset}
          style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text-secondary)", padding: "7px 13px", fontSize: 12, cursor: "pointer", fontWeight: 500 }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = "var(--text-primary)")}
          onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = "var(--text-secondary)")}>
          ← New standup
        </button>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={copyMd}
            style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, color: copiedMd ? "var(--green)" : "var(--text-secondary)", padding: "7px 13px", fontSize: 12, cursor: "pointer", fontWeight: 500 }}
            onMouseEnter={(e) => { if (!copiedMd) (e.currentTarget as HTMLElement).style.color = "var(--text-primary)"; }}
            onMouseLeave={(e) => { if (!copiedMd) (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)"; }}>
            {copiedMd ? "✓ Copied" : "Copy Markdown"}
          </button>
          <button onClick={copyPlain}
            style={{ background: copiedPlain ? "var(--green-dim)" : "var(--accent)", border: `1px solid ${copiedPlain ? "rgba(52,211,153,0.3)" : "transparent"}`, borderRadius: 8, color: copiedPlain ? "var(--green)" : "#fff", padding: "7px 15px", fontSize: 12, cursor: "pointer", fontWeight: 600, transition: "all 0.15s" }}
            onMouseEnter={(e) => { if (!copiedPlain) (e.currentTarget as HTMLElement).style.background = "var(--accent-hover)"; }}
            onMouseLeave={(e) => { if (!copiedPlain) (e.currentTarget as HTMLElement).style.background = "var(--accent)"; }}>
            {copiedPlain ? "✓ Copied!" : "Copy Plain Text"}
          </button>
        </div>
      </div>

      {/* Main card */}
      <div style={{ background: "var(--surface)", border: "1px solid var(--border-subtle)", borderRadius: 16, overflow: "hidden" }}>

        {/* Card header */}
        <div style={{ padding: "14px 22px", borderBottom: "1px solid var(--border-subtle)", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--green)", boxShadow: "0 0 8px var(--green)", flexShrink: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)", flex: 1 }}>
            {header || `Scrum Update — ${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}`}
          </span>
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Standup Report</span>
        </div>

        <div style={{ padding: "22px" }}>

          {/* Day-by-day accomplished work */}
          {daySections.length > 0 && (
            <div style={{ marginBottom: trailingSections.length > 0 ? 24 : 0 }}>
              {daySections.map((section, idx) => (
                <div key={idx} style={{ marginBottom: idx < daySections.length - 1 ? 22 : 0 }}>
                  <DayBadge dayName={section.dayName!} dayDate={section.dayDate!} />
                  <div style={{ display: "flex", flexDirection: "column", gap: 7, paddingLeft: 20, borderLeft: "2px solid var(--accent-border)" }}>
                    {section.items.map((item, iIdx) => (
                      <div key={iIdx} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                        <span style={{ color: "var(--green)", fontSize: 11, marginTop: 3, flexShrink: 0 }}>✓</span>
                        <span style={{ fontSize: 14, color: "var(--text-primary)", lineHeight: 1.65 }}>
                          {renderInline(item)}
                        </span>
                      </div>
                    ))}
                    {section.items.length === 0 && (
                      <p style={{ fontSize: 13, color: "var(--text-muted)", fontStyle: "italic" }}>No items recorded.</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Fallback: no day sections — render everything as flat sections */}
          {daySections.length === 0 && sections.length > 0 && (
            <div style={{ marginBottom: 0 }}>
              {sections.map((section, idx) => {
                const { icon, color } = getSectionMeta(section.title);
                return (
                  <div key={idx} style={{ marginBottom: idx < sections.length - 1 ? 22 : 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
                      <span style={{ width: 20, height: 20, borderRadius: 4, background: `${color}18`, border: `1px solid ${color}30`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color, flexShrink: 0 }}>{icon}</span>
                      <h3 style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", letterSpacing: "0.06em", textTransform: "uppercase" }}>{section.title}</h3>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 7, paddingLeft: 27 }}>
                      {section.items.map((item, iIdx) => (
                        <div key={iIdx} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                          <span style={{ color, fontSize: 10, marginTop: 4, flexShrink: 0, opacity: 0.6 }}>{icon}</span>
                          <span style={{ fontSize: 14, color: "var(--text-primary)", lineHeight: 1.65 }}>{renderInline(item)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Trailing sections: In Progress, Blockers, Next Steps */}
          {trailingSections.length > 0 && (
            <>
              {daySections.length > 0 && <div style={{ height: 1, background: "var(--border-subtle)", margin: "22px 0" }} />}
              {trailingSections.map((section, idx) => {
                const { icon, color } = getSectionMeta(section.title);
                return (
                  <div key={idx} style={{ marginBottom: idx < trailingSections.length - 1 ? 20 : 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
                      <span style={{ width: 20, height: 20, borderRadius: 4, background: `${color}18`, border: `1px solid ${color}30`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color, flexShrink: 0 }}>{icon}</span>
                      <h3 style={{ fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", letterSpacing: "0.06em", textTransform: "uppercase" }}>{section.title}</h3>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 7, paddingLeft: 27 }}>
                      {section.items.length > 0
                        ? section.items.map((item, iIdx) => (
                          <div key={iIdx} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                            <span style={{ color, fontSize: 10, marginTop: 4, flexShrink: 0, opacity: 0.65 }}>{icon}</span>
                            <span style={{ fontSize: 14, color: "var(--text-primary)", lineHeight: 1.65 }}>{renderInline(item)}</span>
                          </div>
                        ))
                        : <p style={{ fontSize: 13, color: "var(--text-muted)", fontStyle: "italic", paddingLeft: 0 }}>None at this time.</p>
                      }
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>

      {/* Raw markdown */}
      <details style={{ marginTop: 10 }}>
        <summary style={{ fontSize: 12, color: "var(--text-muted)", cursor: "pointer", padding: "6px 4px", listStyle: "none", display: "flex", alignItems: "center", gap: 5 }}>
          <span>▸</span> View raw markdown
        </summary>
        <pre style={{ marginTop: 6, padding: 14, background: "var(--surface)", border: "1px solid var(--border-subtle)", borderRadius: 10, fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.65, whiteSpace: "pre-wrap", overflowX: "auto", fontFamily: "monospace" }}>
          {result.markdown}
        </pre>
      </details>
    </div>
  );
}
