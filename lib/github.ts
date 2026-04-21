export type ThreadComment = {
  author: string;
  body: string;
  created_at: string;
  isOwn?: boolean; // true if the authenticated user wrote this comment
};

export type GitHubPR = {
  id: number;
  number: number;
  title: string;
  url: string;
  state: "open" | "closed" | "merged";
  repo: string;
  created_at: string;
  updated_at: string;
  merged_at: string | null;
  body: string | null;
  draft: boolean;
  labels: string[];
  comments?: ThreadComment[];
  reviewComments?: ThreadComment[];
  linkedRefs?: string[]; // e.g. ["owner/repo#42", "#17"] extracted from body
  userCommentCount?: number; // user's own comments on the PR thread (reply participation)
};

// How the authenticated user is involved in a given issue. Drives standup phrasing.
// We only record issues the user actually contributed to — mere mentions/tags
// are excluded upstream so they never reach the standup prompt.
//   "author"    — user opened the issue
//   "commenter" — user posted at least one comment
//   "actor"     — user performed a stage-change event (closed, reopened, labeled, etc.)
//                 without opening or commenting on it
export type IssueViewerRole = "author" | "commenter" | "actor";

export type GitHubIssue = {
  id: number;
  number: number;
  title: string;
  url: string;
  state: "open" | "closed";
  repo: string;
  created_at: string;
  updated_at: string;
  body: string | null;
  labels: string[];
  assignee: boolean;
  author: boolean; // user opened the issue
  viewerRole: IssueViewerRole;
  comments?: ThreadComment[];
  userCommentCount?: number;
  linkedRefs?: string[];
  // Stage-change events the user performed on this issue within the window.
  // Populated when the user isn't the author/commenter but acted on the issue.
  stageActions?: string[];
};

export type GitHubReview = {
  pr_title: string;
  pr_url: string;
  repo: string;
  state: string;
  submitted_at: string;
  body: string | null;
};

export type GitHubComment = {
  type: "pr" | "issue" | "commit";
  url: string;
  body: string;
  created_at: string;
  repo: string;
  context: string;
};

export type GitHubCommit = {
  sha: string;
  message: string;
  url: string;
  repo: string;
  date: string;
};

export type GitHubData = {
  user: { login: string; name: string; avatar_url: string };
  prs: GitHubPR[];
  issues: GitHubIssue[];
  reviews: GitHubReview[];
  comments: GitHubComment[];
  commits: GitHubCommit[];
  ssoWarnings?: string[];
  summary: {
    prs: number;
    issues: number;
    reviews: number;
    commits: number;
    comments: number;
  };
};

// Classic PATs against SSO-protected orgs return 403 with a `x-github-sso`
// header pointing to the authorization URL. We surface that as a clear error
// so the user knows to click "Configure SSO" on their PAT page.
function ssoErrorFromHeader(res: Response): string | null {
  const sso = res.headers.get("x-github-sso");
  if (!sso) return null;
  // Header looks like: `required; url=https://github.com/orgs/<org>/sso?...`
  // or a comma-separated list of `partial-results; organizations=<id>,<id>`
  const urlMatch = sso.match(/url=([^,;\s]+)/);
  const orgsMatch = sso.match(/organizations=([^,;\s]+)/);
  if (urlMatch) {
    return `This token needs SSO authorization. Visit ${urlMatch[1]} to authorize it, or open github.com/settings/tokens and click "Configure SSO" next to the token.`;
  }
  if (orgsMatch) {
    return `Token has only partial SSO access (orgs: ${orgsMatch[1]}). Open github.com/settings/tokens, click "Configure SSO" next to the token, and authorize each organization you want included.`;
  }
  return `SSO authorization required: ${sso}`;
}

// Collected during a single fetchGitHubData call so we can surface SSO
// partial-results warnings if the user ends up with zero activity.
const ssoWarnings = new Set<string>();

async function ghRequest(url: string, token: string) {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) {
    const ssoMsg = ssoErrorFromHeader(res);
    if (ssoMsg) throw new Error(ssoMsg);
    const body = await res.text();
    throw new Error(`GitHub API error ${res.status}: ${body.slice(0, 200)}`);
  }
  const partial = ssoErrorFromHeader(res);
  if (partial) ssoWarnings.add(partial);
  return res.json();
}

async function ghFetch(path: string, token: string) {
  return ghRequest(`https://api.github.com${path}`, token);
}

async function ghSearch(query: string, token: string, perPage = 100) {
  const encoded = encodeURIComponent(query);
  return ghRequest(
    `https://api.github.com/search/issues?q=${encoded}&per_page=${perPage}&sort=updated&order=desc`,
    token
  );
}

function repoFromUrl(url: string) {
  const m = url.match(/repos\/([^/]+\/[^/]+)/);
  return m ? m[1] : url;
}

function sinceDate(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

export async function fetchGitHubData(
  token: string,
  days: number,
  dateFrom?: string,
  dateTo?: string
): Promise<GitHubData> {
  // If explicit date range provided, use it; otherwise derive from days
  const since = dateFrom ? new Date(dateFrom).toISOString() : sinceDate(days);
  const sinceDate2 = since.slice(0, 10);

  ssoWarnings.clear();

  // Get authenticated user
  const user = await ghFetch("/user", token);

  // Parallel: PRs authored + PRs reviewed + three targeted issue searches.
  // We deliberately avoid `involves:` for issues because it surfaces
  // issues the user was only @-mentioned on — which generates hallucinated
  // "I worked on X" entries. Instead we pull the three ways you can
  // directly contribute (author, commenter, assignee) and later verify
  // that assignee-only matches include at least one user-actioned stage
  // change before keeping them.
  const [prSearch, reviewSearch, authorIssueSearch, commenterIssueSearch, assigneeIssueSearch] = await Promise.all([
    ghSearch(`type:pr author:${user.login} updated:>=${sinceDate2}`, token, 100),
    ghSearch(`type:pr reviewed-by:${user.login} updated:>=${sinceDate2}`, token, 50),
    ghSearch(`type:issue author:${user.login} updated:>=${sinceDate2}`, token, 60),
    ghSearch(`type:issue commenter:${user.login} updated:>=${sinceDate2}`, token, 60),
    ghSearch(`type:issue assignee:${user.login} updated:>=${sinceDate2}`, token, 60),
  ]);

  // Process PRs
  const prs: GitHubPR[] = prSearch.items.map((item: Record<string, unknown>) => ({
    id: item.id as number,
    number: item.number as number,
    title: item.title as string,
    url: item.html_url as string,
    state: (item.pull_request as Record<string, unknown>)?.merged_at
      ? "merged"
      : (item.state as string),
    repo: repoFromUrl(item.repository_url as string),
    created_at: item.created_at as string,
    updated_at: item.updated_at as string,
    merged_at: ((item.pull_request as Record<string, unknown>)?.merged_at as string | null) ?? null,
    body: (item.body as string | null)?.slice(0, 500) ?? null,
    draft: (item.draft as boolean) ?? false,
    labels: ((item.labels as Array<Record<string, unknown>>) ?? []).map((l) => l.name as string),
  }));

  // Merge the three issue searches, tracking which one(s) surfaced each issue.
  // Author/commenter matches imply direct contribution. Assignee-only matches
  // are provisional — they get dropped below unless events show the user also
  // did something actionable.
  type IssueSource = "author" | "commenter" | "assignee";
  const issueDraft = new Map<
    string,
    { item: Record<string, unknown>; sources: Set<IssueSource> }
  >();
  function mergeIssueSearch(
    items: Array<Record<string, unknown>>,
    source: IssueSource
  ) {
    for (const item of items) {
      if (item.pull_request) continue; // skip PRs that also match issue searches
      const key = item.html_url as string;
      const existing = issueDraft.get(key);
      if (existing) existing.sources.add(source);
      else issueDraft.set(key, { item, sources: new Set([source]) });
    }
  }
  mergeIssueSearch(authorIssueSearch.items, "author");
  mergeIssueSearch(commenterIssueSearch.items, "commenter");
  mergeIssueSearch(assigneeIssueSearch.items, "assignee");

  const issues: GitHubIssue[] = [...issueDraft.values()].map(({ item, sources }) => {
    const isAuthor = sources.has("author");
    const isCommenter = sources.has("commenter");
    const isAssignee = sources.has("assignee");
    // Provisional role. Assignee-only rows are kept for now and filtered
    // after event enrichment (see below). Author/commenter locked in here.
    const viewerRole: IssueViewerRole = isAuthor
      ? "author"
      : isCommenter
        ? "commenter"
        : "actor"; // placeholder — confirmed or dropped after events check
    return {
      id: item.id as number,
      number: item.number as number,
      title: item.title as string,
      url: item.html_url as string,
      state: item.state as "open" | "closed",
      repo: repoFromUrl(item.repository_url as string),
      created_at: item.created_at as string,
      updated_at: item.updated_at as string,
      body: (item.body as string | null)?.slice(0, 300) ?? null,
      labels: ((item.labels as Array<Record<string, unknown>>) ?? []).map((l) => l.name as string),
      assignee: isAssignee,
      author: isAuthor,
      viewerRole,
    };
  });

  // ── Enrichment: fetch comments + linked refs for recently active PRs/issues ──
  // Bounded to keep latency reasonable: top N by updated_at, ≤8 comments each.
  const MAX_ENRICH_PRS = 8;
  const MAX_ENRICH_ISSUES = 8;
  const MAX_COMMENTS = 8;

  function extractLinkedRefs(text: string | null, selfRepo: string): string[] {
    if (!text) return [];
    const refs = new Set<string>();
    // Cross-repo refs: owner/repo#123
    for (const m of text.matchAll(/([\w.-]+\/[\w.-]+)#(\d+)/g)) {
      refs.add(`${m[1]}#${m[2]}`);
    }
    // Same-repo refs: #123 (but not preceded by a slash, handled above)
    for (const m of text.matchAll(/(?<![\w/])#(\d+)/g)) {
      refs.add(`${selfRepo}#${m[1]}`);
    }
    // Full GitHub URLs to issues/PRs
    for (const m of text.matchAll(/https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/(?:issues|pull)\/(\d+)/g)) {
      refs.add(`${m[1]}#${m[2]}`);
    }
    return [...refs].slice(0, 8);
  }

  function trimComment(body: string): string {
    // Collapse whitespace and truncate to keep LLM context manageable.
    return body.replace(/\s+/g, " ").trim().slice(0, 400);
  }

  async function fetchComments(repo: string, number: number): Promise<ThreadComment[]> {
    try {
      const data = await ghFetch(`/repos/${repo}/issues/${number}/comments?per_page=${MAX_COMMENTS}&sort=created&direction=desc`, token);
      if (!Array.isArray(data)) return [];
      return data
        .map((c: Record<string, unknown>) => {
          const author = ((c.user as Record<string, unknown>)?.login as string) || "unknown";
          return {
            author,
            body: trimComment((c.body as string) || ""),
            created_at: c.created_at as string,
            isOwn: author === user.login,
          };
        })
        .filter((c) => c.body.length > 0)
        .slice(0, MAX_COMMENTS);
    } catch { return []; }
  }

  async function fetchReviewComments(repo: string, number: number): Promise<ThreadComment[]> {
    try {
      const data = await ghFetch(`/repos/${repo}/pulls/${number}/comments?per_page=${MAX_COMMENTS}&sort=created&direction=desc`, token);
      if (!Array.isArray(data)) return [];
      return data
        .map((c: Record<string, unknown>) => {
          const author = ((c.user as Record<string, unknown>)?.login as string) || "unknown";
          return {
            author,
            body: trimComment((c.body as string) || ""),
            created_at: c.created_at as string,
            isOwn: author === user.login,
          };
        })
        .filter((c) => c.body.length > 0)
        .slice(0, MAX_COMMENTS);
    } catch { return []; }
  }

  // Issue timeline events that we treat as "moving the issue between stages".
  // Simple assignment/unassignment and renames are excluded — they don't
  // represent workflow progress on their own.
  const STAGE_EVENTS = new Set([
    "closed",
    "reopened",
    "labeled",
    "unlabeled",
    "milestoned",
    "demilestoned",
    "moved_columns_in_project",
    "converted_to_discussion",
    "transferred",
  ]);
  const sinceMsIssues = new Date(since).getTime();
  async function fetchUserStageEvents(repo: string, number: number): Promise<string[]> {
    try {
      const data = await ghFetch(
        `/repos/${repo}/issues/${number}/events?per_page=50`,
        token
      );
      if (!Array.isArray(data)) return [];
      const actions: string[] = [];
      for (const e of data as Array<Record<string, unknown>>) {
        const eventType = e.event as string;
        const actor = ((e.actor as Record<string, unknown>)?.login as string) || "";
        const at = new Date((e.created_at as string) || 0).getTime();
        if (
          actor === user.login &&
          at >= sinceMsIssues &&
          STAGE_EVENTS.has(eventType)
        ) {
          actions.push(eventType);
        }
      }
      return actions;
    } catch {
      return [];
    }
  }

  // Sort PRs and issues by most recently updated, enrich the top N in parallel.
  const prsByRecency = [...prs].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const issuesByRecency = [...issues].sort((a, b) => b.updated_at.localeCompare(a.updated_at));

  // Assignee-only issues (provisional role "actor") still need event
  // verification before we know whether to keep them at all.
  const assigneeOnlyIssues = issuesByRecency.filter((i) => i.viewerRole === "actor");

  await Promise.all([
    ...prsByRecency.slice(0, MAX_ENRICH_PRS).map(async (pr) => {
      const [cs, rcs] = await Promise.all([
        fetchComments(pr.repo, pr.number),
        fetchReviewComments(pr.repo, pr.number),
      ]);
      pr.comments = cs;
      pr.reviewComments = rcs;
      pr.userCommentCount =
        cs.filter((c) => c.isOwn).length + rcs.filter((c) => c.isOwn).length;
      pr.linkedRefs = extractLinkedRefs(pr.body, pr.repo);
    }),
    ...issuesByRecency.slice(0, MAX_ENRICH_ISSUES).map(async (issue) => {
      const cs = await fetchComments(issue.repo, issue.number);
      issue.comments = cs;
      issue.userCommentCount = cs.filter((c) => c.isOwn).length;
      issue.linkedRefs = extractLinkedRefs(issue.body, issue.repo);
    }),
    // Event check for assignee-only matches. We bound this separately so it
    // doesn't eat into the MAX_ENRICH_ISSUES budget reserved for comments.
    ...assigneeOnlyIssues.slice(0, 10).map(async (issue) => {
      const actions = await fetchUserStageEvents(issue.repo, issue.number);
      if (actions.length > 0) issue.stageActions = actions;
    }),
  ]);

  // Final filter: drop assignee-only rows that didn't turn out to carry any
  // direct user contribution (no comments and no stage actions). Anything
  // that survives has the user as author, commenter, or stage-actor.
  const filteredIssues: GitHubIssue[] = [];
  for (const issue of issues) {
    if (issue.viewerRole === "author") {
      filteredIssues.push(issue);
      continue;
    }
    const hasComments = (issue.userCommentCount ?? 0) > 0;
    const hasStageActions = (issue.stageActions?.length ?? 0) > 0;
    if (issue.viewerRole === "commenter" && hasComments) {
      filteredIssues.push(issue);
      continue;
    }
    if (issue.viewerRole === "commenter" && !hasComments) {
      // Commenter search matched but our bounded enrichment didn't find the
      // user's comment (e.g. they commented on issue 20 and we only pulled
      // top 8 by recency). Trust the search qualifier — keep it.
      filteredIssues.push(issue);
      continue;
    }
    // Provisional "actor" (assignee-only). Keep only if events confirm.
    if (hasStageActions) {
      filteredIssues.push(issue);
      continue;
    }
    // Fallback: if we ran out of enrichment budget on an assignee-only row
    // beyond the top 10, we can't verify — drop it rather than risk claiming
    // work the user didn't do.
  }
  issues.length = 0;
  issues.push(...filteredIssues);

  // Process reviews
  const reviews: GitHubReview[] = reviewSearch.items
    .filter((item: Record<string, unknown>) => (item.user as Record<string, unknown>)?.login !== user.login)
    .map((item: Record<string, unknown>) => ({
      pr_title: item.title as string,
      pr_url: item.html_url as string,
      repo: repoFromUrl(item.repository_url as string),
      state: "reviewed",
      submitted_at: item.updated_at as string,
      body: null,
    }));

  // Fetch recent commits — try multiple strategies since fine-grained PATs
  // don't support /user/events and /users/{login}/events is public-only.
  let commits: GitHubCommit[] = [];
  const sinceMs = new Date(since).getTime();

  function parsePushEvents(events: Record<string, unknown>[]): GitHubCommit[] {
    return events
      .filter(
        (e) =>
          e.type === "PushEvent" &&
          new Date(e.created_at as string).getTime() > sinceMs
      )
      .flatMap((e) => {
        const repo = (e.repo as Record<string, unknown>).name as string;
        return ((e.payload as Record<string, unknown>).commits as Array<Record<string, unknown>> ?? []).map(
          (c) => ({
            sha: (c.sha as string).slice(0, 7),
            message: (c.message as string).split("\n")[0].slice(0, 100),
            url: `https://github.com/${repo}/commit/${c.sha as string}`,
            repo,
            date: e.created_at as string,
          })
        );
      });
  }

  try {
    // Strategy 1: authenticated user events (works for classic PATs, 404 for fine-grained)
    const eventsRes = await fetch(`https://api.github.com/user/events?per_page=100`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    });
    if (eventsRes.ok) {
      const events = await eventsRes.json();
      if (Array.isArray(events)) commits = parsePushEvents(events).slice(0, 50);
    }
  } catch { /* continue */ }

  if (commits.length === 0) {
    try {
      // Strategy 2: per-repo commits from repos accessible to this token
      const reposRes = await fetch(
        `https://api.github.com/user/repos?sort=updated&per_page=50&affiliation=owner,collaborator,organization_member`,
        { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } }
      );
      if (reposRes.ok) {
        const repos: Array<Record<string, unknown>> = await reposRes.json();
        if (Array.isArray(repos) && repos.length > 0) {
          const repoCommits = await Promise.all(
            repos.slice(0, 10).map(async (repo) => {
              try {
                const r = await fetch(
                  `https://api.github.com/repos/${repo.full_name}/commits?author=${user.login}&since=${since}&per_page=20`,
                  { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } }
                );
                if (!r.ok) return [];
                const cs: Array<Record<string, unknown>> = await r.json();
                if (!Array.isArray(cs)) return [];
                return cs.map((c) => {
                  const commit = c.commit as Record<string, unknown>;
                  const author = commit.author as Record<string, unknown>;
                  return {
                    sha: (c.sha as string).slice(0, 7),
                    message: (commit.message as string).split("\n")[0].slice(0, 100),
                    url: c.html_url as string,
                    repo: repo.full_name as string,
                    date: author.date as string,
                  };
                });
              } catch { return []; }
            })
          );
          commits = repoCommits.flat().slice(0, 50);
        }
      }
    } catch { /* continue */ }
  }

  if (commits.length === 0) {
    try {
      // Strategy 3: public events fallback
      const pubRes = await fetch(
        `https://api.github.com/users/${user.login}/events?per_page=100`,
        { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } }
      );
      if (pubRes.ok) {
        const events = await pubRes.json();
        if (Array.isArray(events)) commits = parsePushEvents(events).slice(0, 50);
      }
    } catch { /* commits are best-effort */ }
  }

  const totalActivity = prs.length + issues.length + reviews.length + commits.length;
  if (totalActivity === 0 && ssoWarnings.size > 0) {
    throw new Error(
      `No activity found, and one or more organizations are restricting access via SSO. ${[...ssoWarnings].join(" ")}`
    );
  }

  return {
    user: { login: user.login, name: user.name || user.login, avatar_url: user.avatar_url },
    prs,
    issues,
    reviews,
    comments: [],
    commits,
    ssoWarnings: ssoWarnings.size > 0 ? [...ssoWarnings] : undefined,
    summary: {
      prs: prs.length,
      issues: issues.length,
      reviews: reviews.length,
      commits: commits.length,
      comments: 0,
    },
  };
}
