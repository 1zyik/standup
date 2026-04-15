"use client";

import { useState, useRef } from "react";
import TokenForm, { FormData } from "@/components/TokenForm";
import StandupDisplay from "@/components/StandupDisplay";
import ScanProgress from "@/components/ScanProgress";

export type AppState = "input" | "scanning" | "done" | "error";

export type ScanLog = {
  id: string;
  type: "github" | "slack" | "gitlab" | "jira" | "teams" | "ai" | "info";
  message: string;
  detail?: string;
  status: "pending" | "running" | "done" | "error";
};

export type StandupResult = {
  markdown: string;
  rawData: Record<string, unknown>;
};

const SERVICE_LABELS: Record<string, { message: string; detail: (d: Record<string, unknown>) => string }> = {
  github: {
    message: "Fetching GitHub activity…",
    detail: (d) => `${(d.summary as Record<string, number>).prs} PRs · ${(d.summary as Record<string, number>).issues} issues · ${(d.summary as Record<string, number>).commits} commits`,
  },
  slack: {
    message: "Fetching Slack activity…",
    detail: (d) => `${(d.summary as Record<string, number>).messages} messages across ${(d.summary as Record<string, number>).channels} channels`,
  },
  gitlab: {
    message: "Fetching GitLab activity…",
    detail: (d) => `${(d.summary as Record<string, number>).mrs} MRs · ${(d.summary as Record<string, number>).issues} issues · ${(d.summary as Record<string, number>).commits} commits`,
  },
  jira: {
    message: "Fetching Jira activity…",
    detail: (d) => `${(d.summary as Record<string, number>).issues} issues · ${(d.summary as Record<string, number>).inProgress} in progress · ${(d.summary as Record<string, number>).done} done`,
  },
  teams: {
    message: "Fetching MS Teams activity…",
    detail: (d) => `${(d.summary as Record<string, number>).messages} messages across ${(d.summary as Record<string, number>).channels} channels`,
  },
};

export default function Home() {
  const [state, setState] = useState<AppState>("input");
  const [logs, setLogs] = useState<ScanLog[]>([]);
  const [result, setResult] = useState<StandupResult | null>(null);
  const [error, setError] = useState<string>("");
  const abortRef = useRef<AbortController | null>(null);

  const addLog = (log: ScanLog) => setLogs((prev) => [...prev, log]);
  const updateLog = (id: string, patch: Partial<ScanLog>) =>
    setLogs((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const handleGenerate = async (form: FormData) => {
    setState("scanning");
    setLogs([]);
    setResult(null);
    setError("");

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const collectedData: Record<string, unknown> = {};

      // ── Integration scans ──
      const { integrations, days, dateFrom, dateTo } = form;

      if (integrations.github) {
        const id = crypto.randomUUID();
        addLog({ id, type: "github", message: SERVICE_LABELS.github.message, status: "running" });
        const res = await fetch("/api/github", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: integrations.github, days, dateFrom, dateTo }),
          signal: ctrl.signal,
        });
        if (!res.ok) { const e = await res.json(); throw new Error(e.error || "GitHub fetch failed"); }
        const data = await res.json();
        collectedData.github = data;
        updateLog(id, { status: "done", message: "GitHub fetched", detail: SERVICE_LABELS.github.detail(data) });
      }

      if (integrations.slack) {
        const id = crypto.randomUUID();
        addLog({ id, type: "slack", message: SERVICE_LABELS.slack.message, status: "running" });
        const res = await fetch("/api/slack", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: integrations.slack, days, dateFrom, dateTo }),
          signal: ctrl.signal,
        });
        if (!res.ok) { const e = await res.json(); throw new Error(e.error || "Slack fetch failed"); }
        const data = await res.json();
        collectedData.slack = data;
        updateLog(id, { status: "done", message: "Slack fetched", detail: SERVICE_LABELS.slack.detail(data) });
      }

      if (integrations.gitlab) {
        const id = crypto.randomUUID();
        addLog({ id, type: "gitlab", message: SERVICE_LABELS.gitlab.message, status: "running" });
        const res = await fetch("/api/gitlab", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: integrations.gitlab.token, baseUrl: integrations.gitlab.url, days, dateFrom }),
          signal: ctrl.signal,
        });
        if (!res.ok) { const e = await res.json(); throw new Error(e.error || "GitLab fetch failed"); }
        const data = await res.json();
        collectedData.gitlab = data;
        updateLog(id, { status: "done", message: "GitLab fetched", detail: SERVICE_LABELS.gitlab.detail(data) });
      }

      if (integrations.jira) {
        const id = crypto.randomUUID();
        addLog({ id, type: "jira", message: SERVICE_LABELS.jira.message, status: "running" });
        const res = await fetch("/api/jira", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ baseUrl: integrations.jira.url, email: integrations.jira.email, token: integrations.jira.token, days, dateFrom }),
          signal: ctrl.signal,
        });
        if (!res.ok) { const e = await res.json(); throw new Error(e.error || "Jira fetch failed"); }
        const data = await res.json();
        collectedData.jira = data;
        updateLog(id, { status: "done", message: "Jira fetched", detail: SERVICE_LABELS.jira.detail(data) });
      }

      if (integrations.teams) {
        const id = crypto.randomUUID();
        addLog({ id, type: "teams", message: SERVICE_LABELS.teams.message, status: "running" });
        const res = await fetch("/api/teams", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: integrations.teams, days, dateFrom }),
          signal: ctrl.signal,
        });
        if (!res.ok) { const e = await res.json(); throw new Error(e.error || "Teams fetch failed"); }
        const data = await res.json();
        collectedData.teams = data;
        updateLog(id, { status: "done", message: "MS Teams fetched", detail: SERVICE_LABELS.teams.detail(data) });
      }

      // ── AI Generation ──
      const aiId = crypto.randomUUID();
      addLog({ id: aiId, type: "ai", message: "Generating standup with AI…", status: "running" });

      const genRes = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          aiProvider: form.aiProvider,
          aiKey: form.aiKey,
          aiModel: form.aiModel,
          days,
          dateFrom,
          dateTo,
          ...collectedData,
        }),
        signal: ctrl.signal,
      });
      if (!genRes.ok) { const e = await genRes.json(); throw new Error(e.error || "Generation failed"); }
      const genData = await genRes.json();
      updateLog(aiId, { status: "done", message: "Standup generated" });

      setResult({ markdown: genData.standup, rawData: collectedData });
      setState("done");
    } catch (err: unknown) {
      if ((err as Error).name === "AbortError") return;
      setError((err as Error).message);
      setState("error");
    }
  };

  const handleReset = () => {
    abortRef.current?.abort();
    setState("input");
    setLogs([]);
    setResult(null);
    setError("");
  };

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--background)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: state === "input" ? "center" : "flex-start",
        padding: state === "done" ? "40px 20px" : "60px 20px",
      }}
    >
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: state === "input" ? "48px" : "28px", maxWidth: 640, width: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 14 }}>
          <div style={{ width: 28, height: 28, borderRadius: 7, background: "var(--accent-dim)", border: "1px solid var(--accent-border)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>
            ⚡
          </div>
          <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", letterSpacing: "0.1em", textTransform: "uppercase" }}>
            Standup Generator
          </span>
        </div>
        <h1 style={{ fontSize: state === "input" ? 30 : 22, fontWeight: 600, color: "var(--text-primary)", letterSpacing: "-0.025em", lineHeight: 1.25, marginBottom: 10 }}>
          {state === "input" ? "Generate your standup"
            : state === "scanning" ? "Scanning your activity…"
            : state === "done" ? "Your standup is ready"
            : "Something went wrong"}
        </h1>
        {state === "input" && (
          <p style={{ color: "var(--text-secondary)", fontSize: 14, maxWidth: 460, margin: "0 auto", lineHeight: 1.65 }}>
            Connect GitHub, Slack, GitLab, Jira, or MS Teams — then let AI write a concise day-by-day standup from your recent activity.
          </p>
        )}
      </div>

      {/* Content */}
      <div style={{ width: "100%", maxWidth: state === "done" ? 800 : 580 }}>
        {state === "input"    && <TokenForm onSubmit={handleGenerate} />}
        {state === "scanning" && <ScanProgress logs={logs} />}
        {state === "done" && result && <StandupDisplay result={result} onReset={handleReset} />}
        {state === "error"    && (
          <div style={{ background: "var(--red-dim)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 12, padding: "24px", textAlign: "center" }}>
            <div style={{ fontSize: 20, marginBottom: 10 }}>⚠</div>
            <p style={{ color: "var(--red)", marginBottom: 20, fontSize: 14, lineHeight: 1.65 }}>{error}</p>
            <button onClick={handleReset}
              style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text-primary)", padding: "8px 20px", fontSize: 13, cursor: "pointer", fontWeight: 500 }}>
              Try again
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
