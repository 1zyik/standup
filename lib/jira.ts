export type JiraIssue = {
  key: string;
  summary: string;
  url: string;
  status: string;
  statusCategory: "todo" | "in-progress" | "done";
  priority: string;
  type: string;
  project: string;
  updated: string;
  created: string;
  assignedToMe: boolean;
  reportedByMe: boolean;
  labels: string[];
  comment_count: number;
};

export type JiraWorklog = {
  issueKey: string;
  issueSummary: string;
  issueUrl: string;
  timeSpent: string;
  started: string;
  comment: string | null;
};

export type JiraData = {
  user: { accountId: string; displayName: string; email: string };
  issues: JiraIssue[];
  worklogs: JiraWorklog[];
  summary: { issues: number; worklogs: number; inProgress: number; done: number };
};

async function jiraFetch(
  path: string,
  email: string,
  token: string,
  baseUrl: string,
  method = "GET",
  body?: unknown
) {
  const credentials = Buffer.from(`${email}:${token}`).toString("base64");
  const url = `${baseUrl.replace(/\/$/, "")}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jira API error ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

function sinceDate(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  // Jira date format: YYYY-MM-DD
  return d.toISOString().slice(0, 10);
}

function statusCategory(sc: string): JiraIssue["statusCategory"] {
  const l = sc.toLowerCase();
  if (l.includes("done") || l.includes("complete")) return "done";
  if (l.includes("progress") || l.includes("review")) return "in-progress";
  return "todo";
}

export async function fetchJiraData(
  baseUrl: string,
  email: string,
  token: string,
  days: number,
  dateFrom?: string
): Promise<JiraData> {
  const since = dateFrom ? dateFrom : sinceDate(days);

  // Get current user
  const myself = await jiraFetch("/rest/api/3/myself", email, token, baseUrl);

  // JQL: issues I'm involved with
  const jql = `(assignee = currentUser() OR reporter = currentUser() OR comment ~ currentUser()) AND updated >= "${since}" ORDER BY updated DESC`;

  const searchResult = await jiraFetch(
    `/rest/api/3/search?jql=${encodeURIComponent(jql)}&maxResults=100&fields=summary,status,priority,issuetype,project,updated,created,assignee,reporter,labels,comment`,
    email,
    token,
    baseUrl
  );

  const issues: JiraIssue[] = (searchResult.issues ?? []).map(
    (issue: Record<string, unknown>) => {
      const fields = issue.fields as Record<string, unknown>;
      const status = fields.status as Record<string, unknown>;
      const sc = (status?.statusCategory as Record<string, unknown>)?.key as string ?? "";
      return {
        key: issue.key as string,
        summary: fields.summary as string,
        url: `${baseUrl.replace(/\/$/, "")}/browse/${issue.key}`,
        status: (status?.name as string) ?? "Unknown",
        statusCategory: statusCategory(sc),
        priority: ((fields.priority as Record<string, unknown>)?.name as string) ?? "Medium",
        type: ((fields.issuetype as Record<string, unknown>)?.name as string) ?? "Task",
        project: ((fields.project as Record<string, unknown>)?.name as string) ?? "",
        updated: fields.updated as string,
        created: fields.created as string,
        assignedToMe: (fields.assignee as Record<string, unknown>)?.accountId === myself.accountId,
        reportedByMe: (fields.reporter as Record<string, unknown>)?.accountId === myself.accountId,
        labels: (fields.labels as string[]) ?? [],
        comment_count: ((fields.comment as Record<string, unknown>)?.total as number) ?? 0,
      };
    }
  );

  // Try fetching worklogs for in-progress / recently done issues
  const worklogs: JiraWorklog[] = [];
  const issuesForWorklogs = issues.filter(
    (i) => i.assignedToMe && (i.statusCategory === "in-progress" || i.statusCategory === "done")
  ).slice(0, 10);

  await Promise.allSettled(
    issuesForWorklogs.map(async (issue) => {
      try {
        const wlRes = await jiraFetch(
          `/rest/api/3/issue/${issue.key}/worklog`,
          email,
          token,
          baseUrl
        );
        const sinceMs = new Date(since).getTime();
        for (const wl of wlRes.worklogs ?? []) {
          const wlAuthor = (wl.author as Record<string, unknown>)?.accountId;
          const wlDate = new Date(wl.started as string).getTime();
          if (wlAuthor === myself.accountId && wlDate >= sinceMs) {
            let commentText: string | null = null;
            const body = wl.comment?.content?.[0]?.content?.[0]?.text;
            if (body) commentText = body;
            worklogs.push({
              issueKey: issue.key,
              issueSummary: issue.summary,
              issueUrl: issue.url,
              timeSpent: wl.timeSpent as string,
              started: wl.started as string,
              comment: commentText,
            });
          }
        }
      } catch {
        // worklogs are best-effort
      }
    })
  );

  const inProgress = issues.filter((i) => i.statusCategory === "in-progress").length;
  const done = issues.filter((i) => i.statusCategory === "done").length;

  return {
    user: {
      accountId: myself.accountId,
      displayName: myself.displayName,
      email: myself.emailAddress ?? email,
    },
    issues,
    worklogs,
    summary: { issues: issues.length, worklogs: worklogs.length, inProgress, done },
  };
}
