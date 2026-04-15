import { NextRequest, NextResponse } from "next/server";
import { generateWithAI, AIProvider } from "@/lib/ai";
import { GitHubData } from "@/lib/github";
import { SlackData } from "@/lib/slack";
import { GitLabData } from "@/lib/gitlab";
import { JiraData } from "@/lib/jira";
import { TeamsData } from "@/lib/teams";

// ─── Date helpers ────────────────────────────────────────────────────────────

function isoDay(iso: string) {
  // Returns "YYYY-MM-DD" from any ISO string
  return new Date(iso).toISOString().slice(0, 10);
}

function slackDay(ts: string) {
  return new Date(parseFloat(ts) * 1000).toISOString().slice(0, 10);
}

function fmt(iso: string) {
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-US", { weekday: "long" });
  const date = d.toISOString().slice(0, 10);
  return `${day} (${date})`;
}

// ─── Per-source context formatters ───────────────────────────────────────────

type TimestampedItem = { date: string; source: string; text: string; url?: string };

function ghItems(gh: GitHubData): TimestampedItem[] {
  const items: TimestampedItem[] = [];

  for (const pr of gh.prs.slice(0, 40)) {
    const date = isoDay(pr.merged_at || pr.updated_at);
    const status = pr.state === "merged" ? "Merged PR" : pr.state === "open" ? "Opened PR" : "Closed PR";
    const draft = pr.draft ? " [Draft]" : "";
    items.push({
      date,
      source: "GitHub",
      text: `${status}${draft}: [${pr.repo}#${pr.number}](${pr.url}) — ${pr.title}`,
      url: pr.url,
    });
  }

  for (const r of gh.reviews.slice(0, 20)) {
    const date = isoDay(r.submitted_at);
    items.push({
      date,
      source: "GitHub",
      text: `Reviewed PR: [${r.pr_title}](${r.pr_url}) in ${r.repo}`,
      url: r.pr_url,
    });
  }

  for (const issue of gh.issues.slice(0, 20)) {
    const date = isoDay(issue.updated_at);
    const status = issue.state === "closed" ? "Closed issue" : "Worked on issue";
    items.push({
      date,
      source: "GitHub",
      text: `${status}: [${issue.repo}#${issue.number}](${issue.url}) — ${issue.title}`,
      url: issue.url,
    });
  }

  for (const c of gh.commits.slice(0, 20)) {
    const date = isoDay(c.date);
    items.push({
      date,
      source: "GitHub",
      text: `Committed to ${c.repo}: [${c.sha}](${c.url}) — ${c.message}`,
      url: c.url,
    });
  }

  return items;
}

function slItems(sl: SlackData): TimestampedItem[] {
  return sl.messages.slice(0, 60).map((m) => ({
    date: slackDay(m.ts),
    source: "Slack",
    text: `#${m.channel_name || m.channel_id}: ${m.text.slice(0, 300)}`,
    url: m.permalink || undefined,
  }));
}

function glItems(gl: GitLabData): TimestampedItem[] {
  const items: TimestampedItem[] = [];

  for (const mr of gl.mrs.slice(0, 30)) {
    const date = isoDay(mr.merged_at || mr.updated_at);
    const action = mr.role === "reviewer" ? "Reviewed MR" : mr.state === "merged" ? "Merged MR" : "Opened MR";
    items.push({ date, source: "GitLab", text: `${action}: [${mr.repo}!${mr.iid}](${mr.url}) — ${mr.title}`, url: mr.url });
  }

  for (const issue of gl.issues.slice(0, 15)) {
    const date = isoDay(issue.updated_at);
    const status = issue.state === "closed" ? "Closed issue" : "Worked on issue";
    items.push({ date, source: "GitLab", text: `${status}: [${issue.repo}#${issue.iid}](${issue.url}) — ${issue.title}`, url: issue.url });
  }

  for (const c of gl.commits.slice(0, 15)) {
    const date = isoDay(c.created_at);
    items.push({ date, source: "GitLab", text: `Committed: [${c.short_id}](${c.url}) — ${c.title}`, url: c.url });
  }

  return items;
}

function jiraItems(jira: JiraData): TimestampedItem[] {
  const items: TimestampedItem[] = [];

  for (const issue of jira.issues.slice(0, 30)) {
    const date = isoDay(issue.updated);
    const action = issue.statusCategory === "done" ? "Completed" : issue.statusCategory === "in-progress" ? "In progress on" : "Triaged";
    items.push({ date, source: "Jira", text: `${action}: [${issue.key}](${issue.url}) — ${issue.summary} [${issue.status}]`, url: issue.url });
  }

  for (const wl of jira.worklogs.slice(0, 10)) {
    const date = isoDay(wl.started);
    items.push({ date, source: "Jira", text: `Logged ${wl.timeSpent} on [${wl.issueKey}](${wl.issueUrl}) — ${wl.issueSummary}${wl.comment ? `: ${wl.comment}` : ""}`, url: wl.issueUrl });
  }

  return items;
}

function teamsItems(teams: TeamsData): TimestampedItem[] {
  return teams.messages.slice(0, 60).map((m) => ({
    date: isoDay(m.createdAt),
    source: "MS Teams",
    text: `${m.chatOrChannel}: ${m.body.slice(0, 300)}`,
    url: m.webUrl || undefined,
  }));
}

function buildContext(allItems: TimestampedItem[], dateFrom: string, dateTo: string): string {
  // Group by date, sorted chronologically
  const byDay: Record<string, TimestampedItem[]> = {};
  for (const item of allItems) {
    if (item.date < dateFrom || item.date > dateTo) continue;
    if (!byDay[item.date]) byDay[item.date] = [];
    byDay[item.date].push(item);
  }

  const sortedDays = Object.keys(byDay).sort();
  const lines: string[] = [];
  lines.push(`Activity period: ${dateFrom} to ${dateTo}`);
  lines.push("");

  for (const day of sortedDays) {
    lines.push(`=== ${fmt(day)} ===`);
    for (const item of byDay[day]) {
      lines.push(`[${item.source}] ${item.text}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ─── System prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(dateFrom: string, dateTo: string): string {
  return `You are a professional engineering standup writer. Synthesize the provided activity into a concise, professional scrum standup update.

REQUIRED OUTPUT FORMAT — follow this exactly:

Scrum Updates (${dateFrom} to ${dateTo})

## [Day of week] ([YYYY-MM-DD])
- Bullet point of work accomplished on that day, with markdown links where available
- Another bullet if there was more work that day

(Repeat for each day that had meaningful activity, in chronological order. Skip days with no activity.)

## In Progress
- Active work items that are still ongoing

## Blockers
- Impediments, things waiting on others, or external dependencies
- If none: None at this time.

## Next Steps
- Concrete, actionable items planned next

RULES:
- Only include days that have actual activity. Do not invent or pad entries.
- Group related activity on the same day into a single bullet when it makes sense.
- Use markdown links [label](url) for every PR, MR, issue, commit, or message that has a URL.
- For GitHub/GitLab: format as [repo#number](url) e.g. [myrepo#42](https://github.com/...)
- For Jira: format as [PROJ-123](url)
- Be concise — each bullet should be one clear sentence.
- Ignore noise: bot messages, trivial reactions, automated notifications.
- Infer blockers from Slack/Teams conversations (e.g. "waiting on X", "blocked by Y").
- Keep In Progress, Blockers, Next Steps to 3–5 bullets max each.
- Do not add any preamble, explanation, or closing remarks — output only the standup.`;
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      aiProvider,
      aiKey,
      aiModel,
      github,
      slack,
      gitlab,
      jira,
      teams,
      days,
      dateFrom,
      dateTo,
    } = body;

    if (!aiKey) return NextResponse.json({ error: "AI API key is required" }, { status: 400 });

    // Determine effective date range
    const today = new Date().toISOString().slice(0, 10);
    const effectiveTo = dateTo || today;
    const effectiveFrom =
      dateFrom ||
      (() => {
        const d = new Date();
        d.setDate(d.getDate() - (days ?? 14));
        return d.toISOString().slice(0, 10);
      })();

    // Collect all timestamped items
    const allItems: TimestampedItem[] = [];
    if (github) allItems.push(...ghItems(github as GitHubData));
    if (slack) allItems.push(...slItems(slack as SlackData));
    if (gitlab) allItems.push(...glItems(gitlab as GitLabData));
    if (jira) allItems.push(...jiraItems(jira as JiraData));
    if (teams) allItems.push(...teamsItems(teams as TeamsData));

    if (allItems.length === 0) {
      const sources: string[] = [];
      if (github) sources.push("GitHub (0 PRs, issues, or commits found — check token scopes and that the PAT covers the right repositories)");
      if (slack) sources.push("Slack (0 messages found)");
      if (gitlab) sources.push("GitLab (0 MRs, issues, or commits found)");
      if (jira) sources.push("Jira (0 issues found)");
      if (teams) sources.push("MS Teams (0 messages found)");
      const detail = sources.length > 0 ? `\n\n${sources.join("\n")}` : "";
      return NextResponse.json(
        { error: `No activity found in the selected date range.${detail}` },
        { status: 400 }
      );
    }

    const context = buildContext(allItems, effectiveFrom, effectiveTo);
    const systemPrompt = buildSystemPrompt(effectiveFrom, effectiveTo);
    const userMessage = `Here is my activity across all connected tools from ${effectiveFrom} to ${effectiveTo}. Please write my standup update.\n\n${context}`;

    const standup = await generateWithAI(
      { provider: (aiProvider || "anthropic") as AIProvider, apiKey: aiKey, model: aiModel },
      systemPrompt,
      userMessage
    );

    return NextResponse.json({ standup });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
