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

// Thread replies include a mix of the user's own words and other people's.
// We label the user's replies as `@you` so the prompt can cleanly distinguish
// what the user actually said vs. what was said around them — prevents
// hallucinated attribution when the user was only a bystander in a thread.
function formatThread(
  items: {
    author?: string;
    user?: string;
    real_name?: string;
    body?: string;
    text?: string;
    isOwn?: boolean;
  }[]
): string {
  return items
    .map((c) => {
      const rawWho = c.author || c.real_name || c.user || "unknown";
      const who = c.isOwn ? "you" : rawWho;
      const what = (c.body || c.text || "").trim();
      return what ? `    ↳ @${who}: ${what}` : null;
    })
    .filter(Boolean)
    .join("\n");
}

function ghItems(gh: GitHubData): TimestampedItem[] {
  const items: TimestampedItem[] = [];

  for (const pr of gh.prs.slice(0, 40)) {
    const date = isoDay(pr.merged_at || pr.updated_at);
    // All PRs in `gh.prs` are authored by the user (search filters by author).
    const status = pr.state === "merged" ? "Authored, merged PR" : pr.state === "open" ? "Authored, open PR" : "Authored, closed PR";
    const draft = pr.draft ? " [Draft]" : "";
    const labels = pr.labels.length ? ` {labels: ${pr.labels.join(", ")}}` : "";
    const linked = pr.linkedRefs?.length ? `\n    linked: ${pr.linkedRefs.join(", ")}` : "";
    const body = pr.body ? `\n    description: ${pr.body.replace(/\s+/g, " ").slice(0, 400)}` : "";
    const conv = [...(pr.comments ?? []), ...(pr.reviewComments ?? [])];
    const thread = conv.length ? `\n${formatThread(conv)}` : "";
    // Make the author's engagement level explicit so the model can tell
    // "merged, no replies" (shipped cleanly) from "merged, 5 replies"
    // (iterated through review). Both valid, but differently worth narrating.
    const own = pr.userCommentCount ?? 0;
    const engagement = own > 0 ? ` {your_replies: ${own}}` : "";
    items.push({
      date,
      source: "GitHub",
      text: `${status}${draft}${engagement}: [${pr.repo}#${pr.number}](${pr.url}) — ${pr.title}${labels}${body}${linked}${thread}`,
      url: pr.url,
    });
  }

  for (const r of gh.reviews.slice(0, 20)) {
    const date = isoDay(r.submitted_at);
    items.push({
      date,
      source: "GitHub",
      text: `Reviewed PR (you reviewed someone else's PR): [${r.pr_title}](${r.pr_url}) in ${r.repo}`,
      url: r.pr_url,
    });
  }

  for (const issue of gh.issues.slice(0, 20)) {
    const date = isoDay(issue.updated_at);
    // Only issues the user directly contributed to reach this point —
    // author/commenter/actor. Passive mentions are filtered upstream.
    const closed = issue.state === "closed" ? " (issue closed)" : "";
    const rolePrefix =
      issue.viewerRole === "author"
        ? `Opened issue${closed}`
        : issue.viewerRole === "commenter"
          ? `Commented on issue${closed}`
          : `Acted on issue${closed}`;
    const labels = issue.labels.length ? ` {labels: ${issue.labels.join(", ")}}` : "";
    const linked = issue.linkedRefs?.length ? `\n    linked: ${issue.linkedRefs.join(", ")}` : "";
    const body = issue.body ? `\n    description: ${issue.body.replace(/\s+/g, " ").slice(0, 300)}` : "";
    const thread = issue.comments?.length ? `\n${formatThread(issue.comments)}` : "";
    const own = issue.userCommentCount ?? 0;
    const engagement = own > 0 ? ` {your_comments: ${own}}` : "";
    // For the actor role, list the concrete stage events the user performed
    // so the narrative can say "closed", "labeled ready-for-review", etc.
    const actions =
      issue.viewerRole === "actor" && issue.stageActions?.length
        ? ` {your_actions: ${issue.stageActions.join(", ")}}`
        : "";
    items.push({
      date,
      source: "GitHub",
      text: `${rolePrefix}${engagement}${actions}: [${issue.repo}#${issue.number}](${issue.url}) — ${issue.title}${labels}${body}${linked}${thread}`,
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
  // All top-level Slack messages are authored by the user (search is
  // scoped to `from:<user>`). Thread replies are labeled `@you` / `@other`
  // by formatThread using the isOwn flag.
  return sl.messages.slice(0, 60).map((m) => {
    const thread = m.thread?.length ? `\n${formatThread(m.thread)}` : "";
    return {
      date: slackDay(m.ts),
      source: "Slack",
      text: `You posted in #${m.channel_name || m.channel_id}: ${m.text.slice(0, 400)}${thread}`,
      url: m.permalink || undefined,
    };
  });
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
  return `You are a senior engineer writing your own standup. Your audience is other engineers and an engineering manager — they want substance, not a list of links. Synthesize the activity below into a technically credible, professionally-toned standup update.

ATTRIBUTION — THIS IS THE MOST IMPORTANT RULE. Do not claim credit for work you did not do. The pipeline has already filtered out issues you were only mentioned or passively tagged on — every item here represents something you actually did. The prefix tells you what kind of contribution:
- "Authored, merged PR" / "Authored, open PR" / "Authored, closed PR" — you wrote the PR. Report it as your work.
- "Reviewed PR (you reviewed someone else's PR)" — frame as "Reviewed …", never as "Merged …" or "Shipped …".
- "Opened issue" — you filed the issue; describe why you opened it and, if closed, the outcome.
- "Commented on issue" — you engaged in the discussion but did not own the issue. Describe YOUR specific contribution from your own comments (lines labeled \`@you\`), not the issue as if you drove it end-to-end.
- "Acted on issue" — you performed concrete stage changes listed in \`{your_actions: …}\` (e.g. \`closed\`, \`labeled\`, \`milestoned\`). Describe the action literally ("closed [repo#N] once the underlying fix landed", "labeled [repo#N] ready-for-review"). Do not invent a larger narrative about the issue beyond that action.
- Metadata tags \`{your_replies: N}\` / \`{your_comments: N}\` tell you how many lines in the thread are actually yours. \`{your_actions: …}\` lists the verbs you performed. These are ground truth.

In every thread, lines starting with "↳ @you:" are your own words; all other "↳ @handle:" lines are other people. Attribute accordingly:
- If a thread reached a decision and @you didn't post, the DECISION is not yours. At most: "team converged on X" or skip.
- If the unblock/answer came from someone else and @you never responded, don't say you unblocked it.
- Slack top-level messages are yours ("You posted in #channel"). Thread replies from others are theirs.

When in doubt, say less. Silence in the data is a signal, not a gap to fill.

BEFORE YOU WRITE — reason carefully over the raw activity:

1. Read each PR's description, review comments, and issue comments in full. The titles alone are not the story — the *discussion* is. Use comments to understand: what was the actual change, what concerns were raised, what was pushed back on, what was agreed, and what remains unresolved.
2. Follow \`linked:\` references between PRs and issues. If a PR closes or references an issue, tie them together in your write-up (don't list them as two unrelated items).
3. Read Slack thread replies (the \`↳\` lines) to understand whether a discussion concluded in a decision, an unblock, a handoff, or an open question. Quote the *outcome*, not the opening message. Only claim participation for lines marked \`@you\`.
4. Infer status honestly. If a PR is still open with unresolved review comments, it is "in progress" — not "done". If a thread ends with "still blocked on X", that's a real blocker. If someone committed to deliver something by a date, note it as a commitment.
5. Group related activity. A PR + its linked issue + the Slack thread about it = ONE narrative item, not three bullets. Collapse accordingly.
6. Distinguish work you shipped from work you reviewed or discussed. Frame them differently: "Merged …" (your PR), "Reviewed …" (someone else's PR), "Weighed in on …" (you commented on an issue), "Closed / labeled …" (stage actions you performed).

REQUIRED OUTPUT FORMAT — follow exactly:

Scrum Updates (${dateFrom} to ${dateTo})

## [Day of week] ([YYYY-MM-DD])
- Substantive bullet describing what was accomplished and WHY it matters (the problem solved, the mechanism, the impact). Use markdown links for every PR/issue/MR/message with a URL.
- Another bullet if there was distinct work that day.

(Repeat for each day with meaningful activity, chronological. Skip days with nothing real.)

## In Progress
- Active items with a one-line status: what stage it's at, what's pending (e.g. "awaiting review from @X", "iterating on feedback re: caching strategy", "design signed off, implementation ~60% through").

## Blockers
- Concrete impediments with the *thing* being waited on and *who/what* owns the unblock. If none: None at this time.

## Next Steps
- Concrete, near-term actions with enough specificity that a reader can tell what will actually ship.

WRITING RULES:
- Technical and specific. Say "migrated the ingest pipeline to use bulk inserts, cutting write latency ~40%" — not "worked on performance".
- Reference people by @handle when a thread credits them (reviewer, approver, person you unblocked).
- Use markdown links [label](url) for everything linkable. GitHub/GitLab: [repo#number](url). Jira: [PROJ-123](url). Commits: [sha7](url). Slack threads: [#channel](permalink) when relevant.
- Integrate comment/thread insight into bullets — don't quote raw comments. Summarize the takeaway.
- Flag unresolved questions explicitly ("open question: should we gate this behind a feature flag?").
- Ignore noise: bot messages, emoji-only reactions, CI pings, auto-assignments. If a PR has no real discussion and is trivial (typo, bump), it's one line or roll it into a group.
- Keep In Progress / Blockers / Next Steps to 3–6 bullets each. Prefer fewer, meatier bullets over many shallow ones.
- Professional tone — neither breezy nor bureaucratic. Past tense for accomplishments, present for in-progress, future for next steps.
- Never invent activity. If the data is thin for a given day, keep it thin. Never pad.
- Never attribute to yourself what the thread shows someone else doing. If @you never spoke in a thread, you did not agree, align, decide, or unblock — the others did. It is fine and preferable to say "observed" or to omit the item entirely.
- Output ONLY the standup — no preamble, no meta-commentary, no closing.`;
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
