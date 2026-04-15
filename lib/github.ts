export type ThreadComment = {
  author: string;
  body: string;
  created_at: string;
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
};

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
  comments?: ThreadComment[];
  linkedRefs?: string[];
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

  // Parallel: PRs authored + PRs reviewed + issues
  const [prSearch, reviewSearch, issueSearch] = await Promise.all([
    ghSearch(`type:pr author:${user.login} updated:>=${sinceDate2}`, token, 100),
    ghSearch(`type:pr reviewed-by:${user.login} updated:>=${sinceDate2}`, token, 50),
    ghSearch(`type:issue involves:${user.login} updated:>=${sinceDate2}`, token, 100),
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

  // Process issues (filter out PRs that appear as issues)
  const issues: GitHubIssue[] = issueSearch.items
    .filter((item: Record<string, unknown>) => !item.pull_request)
    .map((item: Record<string, unknown>) => ({
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
      assignee: !!(item.assignees as unknown[])?.some?.(
        (a) => (a as Record<string, unknown>).login === user.login
      ),
    }));

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
        .map((c: Record<string, unknown>) => ({
          author: ((c.user as Record<string, unknown>)?.login as string) || "unknown",
          body: trimComment((c.body as string) || ""),
          created_at: c.created_at as string,
        }))
        .filter((c) => c.body.length > 0)
        .slice(0, MAX_COMMENTS);
    } catch { return []; }
  }

  async function fetchReviewComments(repo: string, number: number): Promise<ThreadComment[]> {
    try {
      const data = await ghFetch(`/repos/${repo}/pulls/${number}/comments?per_page=${MAX_COMMENTS}&sort=created&direction=desc`, token);
      if (!Array.isArray(data)) return [];
      return data
        .map((c: Record<string, unknown>) => ({
          author: ((c.user as Record<string, unknown>)?.login as string) || "unknown",
          body: trimComment((c.body as string) || ""),
          created_at: c.created_at as string,
        }))
        .filter((c) => c.body.length > 0)
        .slice(0, MAX_COMMENTS);
    } catch { return []; }
  }

  // Sort PRs and issues by most recently updated, enrich the top N in parallel.
  const prsByRecency = [...prs].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const issuesByRecency = [...issues].sort((a, b) => b.updated_at.localeCompare(a.updated_at));

  await Promise.all([
    ...prsByRecency.slice(0, MAX_ENRICH_PRS).map(async (pr) => {
      const [cs, rcs] = await Promise.all([
        fetchComments(pr.repo, pr.number),
        fetchReviewComments(pr.repo, pr.number),
      ]);
      pr.comments = cs;
      pr.reviewComments = rcs;
      pr.linkedRefs = extractLinkedRefs(pr.body, pr.repo);
    }),
    ...issuesByRecency.slice(0, MAX_ENRICH_ISSUES).map(async (issue) => {
      issue.comments = await fetchComments(issue.repo, issue.number);
      issue.linkedRefs = extractLinkedRefs(issue.body, issue.repo);
    }),
  ]);

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
