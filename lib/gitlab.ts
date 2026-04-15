export type GitLabMR = {
  id: number;
  iid: number;
  title: string;
  url: string;
  state: "opened" | "merged" | "closed";
  repo: string;
  created_at: string;
  updated_at: string;
  merged_at: string | null;
  description: string | null;
  draft: boolean;
  labels: string[];
  role: "author" | "reviewer";
};

export type GitLabIssue = {
  id: number;
  iid: number;
  title: string;
  url: string;
  state: "opened" | "closed";
  repo: string;
  created_at: string;
  updated_at: string;
  labels: string[];
  assignee: boolean;
};

export type GitLabCommit = {
  id: string;
  short_id: string;
  title: string;
  url: string;
  repo: string;
  created_at: string;
};

export type GitLabData = {
  user: { id: number; username: string; name: string; avatar_url: string };
  mrs: GitLabMR[];
  issues: GitLabIssue[];
  commits: GitLabCommit[];
  summary: { mrs: number; issues: number; commits: number };
};

async function glFetch(path: string, token: string, baseUrl: string) {
  const url = `${baseUrl.replace(/\/$/, "")}/api/v4${path}`;
  const res = await fetch(url, {
    headers: { "PRIVATE-TOKEN": token, Accept: "application/json" },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitLab API error ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

function sinceDate(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

export async function fetchGitLabData(
  token: string,
  days: number,
  baseUrl = "https://gitlab.com",
  dateFrom?: string
): Promise<GitLabData> {
  const since = dateFrom ? new Date(dateFrom).toISOString() : sinceDate(days);
  const afterParam = encodeURIComponent(since.slice(0, 10));

  const user = await glFetch("/user", token, baseUrl);

  const [authoredMRs, reviewerMRs, issues, events] = await Promise.all([
    glFetch(
      `/merge_requests?author_id=${user.id}&created_after=${afterParam}&state=all&per_page=100&order_by=updated_at`,
      token,
      baseUrl
    ).catch(() => []),
    glFetch(
      `/merge_requests?reviewer_id=${user.id}&updated_after=${afterParam}&state=all&per_page=100&order_by=updated_at`,
      token,
      baseUrl
    ).catch(() => []),
    glFetch(
      `/issues?author_id=${user.id}&created_after=${afterParam}&state=all&per_page=100&order_by=updated_at`,
      token,
      baseUrl
    ).catch(() => []),
    glFetch(
      `/users/${user.id}/events?action=pushed&after=${afterParam}&per_page=100`,
      token,
      baseUrl
    ).catch(() => []),
  ]);

  const mrs: GitLabMR[] = [
    ...(Array.isArray(authoredMRs) ? authoredMRs : []).map((mr: Record<string, unknown>) => ({
      id: mr.id as number,
      iid: mr.iid as number,
      title: mr.title as string,
      url: mr.web_url as string,
      state: mr.state as GitLabMR["state"],
      repo: (mr.references as Record<string, string>)?.full?.split("!")[0] || (mr.web_url as string),
      created_at: mr.created_at as string,
      updated_at: mr.updated_at as string,
      merged_at: mr.merged_at as string | null,
      description: (mr.description as string | null)?.slice(0, 300) ?? null,
      draft: !!(mr.draft || (mr.title as string)?.startsWith("Draft:")),
      labels: ((mr.labels as string[]) ?? []),
      role: "author" as const,
    })),
    ...(Array.isArray(reviewerMRs) ? reviewerMRs : [])
      .filter((mr: Record<string, unknown>) => (mr as Record<string, unknown> & { author: { id: number } }).author?.id !== user.id)
      .map((mr: Record<string, unknown>) => ({
        id: mr.id as number,
        iid: mr.iid as number,
        title: mr.title as string,
        url: mr.web_url as string,
        state: mr.state as GitLabMR["state"],
        repo: (mr.references as Record<string, string>)?.full?.split("!")[0] || (mr.web_url as string),
        created_at: mr.created_at as string,
        updated_at: mr.updated_at as string,
        merged_at: mr.merged_at as string | null,
        description: null,
        draft: false,
        labels: [],
        role: "reviewer" as const,
      })),
  ];

  const seen = new Set<number>();
  const uniqueMRs = mrs.filter((mr) => {
    if (seen.has(mr.id)) return false;
    seen.add(mr.id);
    return true;
  });

  const issueList: GitLabIssue[] = (Array.isArray(issues) ? issues : []).map(
    (issue: Record<string, unknown>) => ({
      id: issue.id as number,
      iid: issue.iid as number,
      title: issue.title as string,
      url: issue.web_url as string,
      state: issue.state as GitLabIssue["state"],
      repo: (issue.references as Record<string, string>)?.full?.split("#")[0] || (issue.web_url as string),
      created_at: issue.created_at as string,
      updated_at: issue.updated_at as string,
      labels: ((issue.labels as string[]) ?? []),
      assignee: !!(issue.assignees as unknown[])?.some?.(
        (a) => (a as Record<string, unknown>).id === user.id
      ),
    })
  );

  const commits: GitLabCommit[] = (Array.isArray(events) ? events : [])
    .filter((e: Record<string, unknown>) => e.push_data)
    .flatMap((e: Record<string, unknown>) => {
      const pd = e.push_data as Record<string, unknown>;
      const projectId = e.project_id as number;
      if (!pd.commit_title) return [];
      return [{
        id: pd.commit_to as string,
        short_id: (pd.commit_to as string)?.slice(0, 8),
        title: pd.commit_title as string,
        url: `${baseUrl}/-/commit/${pd.commit_to}`,
        repo: `project:${projectId}`,
        created_at: e.created_at as string,
      }];
    })
    .slice(0, 50);

  return {
    user: {
      id: user.id,
      username: user.username,
      name: user.name,
      avatar_url: user.avatar_url,
    },
    mrs: uniqueMRs,
    issues: issueList,
    commits,
    summary: { mrs: uniqueMRs.length, issues: issueList.length, commits: commits.length },
  };
}
