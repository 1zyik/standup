export type SlackThreadReply = {
  user: string;
  real_name?: string;
  text: string;
  ts: string;
};

export type SlackMessage = {
  channel_id: string;
  channel_name: string;
  text: string;
  ts: string;
  permalink: string | null;
  thread_ts: string | null;
  reply_count?: number;
  thread?: SlackThreadReply[];
};

export type SlackChannel = {
  id: string;
  name: string;
  is_member: boolean;
};

export type SlackData = {
  user: { id: string; name: string; real_name: string };
  messages: SlackMessage[];
  channels: SlackChannel[];
  summary: {
    messages: number;
    channels: number;
  };
};

export type SlackAuth = {
  token: string;
  // For browser-extracted xoxc- tokens we also need the matching `d` cookie
  // (xoxd-…) and the workspace subdomain (e.g. "myteam" from
  // myteam.slack.com). xoxp-/xoxb- tokens ignore both.
  cookie?: string;
  workspace?: string;
};

function isBrowserToken(token: string) {
  return token.startsWith("xoxc-") || token.startsWith("xoxs-");
}

async function slackFetch(method: string, auth: SlackAuth, params: Record<string, string> = {}) {
  const browserToken = isBrowserToken(auth.token);

  if (browserToken) {
    if (!auth.cookie) {
      throw new Error(
        `xoxc-/xoxs- tokens require the matching 'd' cookie (xoxd-…). Open Slack in a browser, copy the value of the 'd' cookie under slack.com, and paste it into the Cookie field.`
      );
    }
    if (!auth.workspace) {
      throw new Error(
        `xoxc-/xoxs- tokens require the workspace subdomain (e.g. 'myteam' from myteam.slack.com). Add it to the Workspace field.`
      );
    }
    const body = new URLSearchParams({ token: auth.token, ...params }).toString();
    const res = await fetch(`https://${auth.workspace}.slack.com/api/${method}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
        Cookie: `d=${auth.cookie}`,
      },
      body,
    });
    const data = await res.json();
    if (!data.ok) throw new Error(`Slack API error (${method}): ${data.error}`);
    return data;
  }

  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`https://slack.com/api/${method}?${qs}`, {
    headers: {
      Authorization: `Bearer ${auth.token}`,
      "Content-Type": "application/json",
    },
  });
  const data = await res.json();
  if (!data.ok) {
    throw new Error(`Slack API error (${method}): ${data.error}`);
  }
  return data;
}

function sinceTs(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return Math.floor(d.getTime() / 1000).toString();
}

export async function fetchSlackData(
  auth: SlackAuth,
  days: number,
  dateFrom?: string,
  dateTo?: string
): Promise<SlackData> {
  const oldest = dateFrom
    ? Math.floor(new Date(dateFrom).getTime() / 1000).toString()
    : sinceTs(days);

  // Get current user
  const authRes = await slackFetch("auth.test", auth);
  const userId = authRes.user_id as string;
  const userName = authRes.user as string;

  // Get user profile for real name
  let realName = userName;
  try {
    const profileRes = await slackFetch("users.info", auth, { user: userId });
    realName = profileRes.user?.profile?.real_name || userName;
  } catch {
    // profile is best-effort
  }

  // Search for messages sent by the user
  const searchRes = await slackFetch("search.messages", auth, {
    query: `from:${userName}`,
    count: "100",
    sort: "timestamp",
    sort_dir: "desc",
  });

  const rawMessages: SlackMessage[] = [];
  const channelSet = new Map<string, string>();

  const matches = searchRes.messages?.matches ?? [];
  for (const match of matches) {
    const ts = parseFloat(match.ts as string);
    const oldestNum = parseFloat(oldest);
    if (ts < oldestNum) continue;

    const channelId = match.channel?.id as string;
    const channelName = match.channel?.name as string;

    if (channelId) channelSet.set(channelId, channelName);

    rawMessages.push({
      channel_id: channelId,
      channel_name: channelName || channelId,
      text: (match.text as string)?.slice(0, 500) ?? "",
      ts: match.ts as string,
      permalink: match.permalink as string | null,
      thread_ts: match.thread_ts as string | null,
      reply_count: match.reply_count as number | undefined,
    });
  }

  // Also try to fetch history from joined channels if we have fewer than 20 messages
  if (rawMessages.length < 20) {
    try {
      const channelsRes = await slackFetch("conversations.list", auth, {
        types: "public_channel,private_channel",
        limit: "200",
        exclude_archived: "true",
      });

      const joinedChannels: SlackChannel[] = (channelsRes.channels ?? [])
        .filter((c: Record<string, unknown>) => c.is_member)
        .slice(0, 30);

      for (const ch of joinedChannels) {
        channelSet.set(ch.id, ch.name);
        try {
          const histRes = await slackFetch("conversations.history", auth, {
            channel: ch.id,
            oldest,
            limit: "100",
          });
          for (const msg of histRes.messages ?? []) {
            if ((msg.user as string) === userId && msg.text && msg.subtype !== "bot_message") {
              rawMessages.push({
                channel_id: ch.id,
                channel_name: ch.name,
                text: (msg.text as string).slice(0, 500),
                ts: msg.ts as string,
                permalink: null,
                thread_ts: msg.thread_ts as string | null,
                reply_count: msg.reply_count as number | undefined,
              });
            }
          }
        } catch {
          // skip channels we can't read
        }
      }
    } catch {
      // conversations.list is best-effort
    }
  }

  // Deduplicate by ts
  const seen = new Set<string>();
  const messages = rawMessages.filter((m) => {
    const key = `${m.channel_id}:${m.ts}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Sort by ts desc
  messages.sort((a, b) => parseFloat(b.ts) - parseFloat(a.ts));

  // ── Enrichment: fetch thread replies for messages the user participated in ──
  // Bounded: top 15 threaded messages, ≤10 replies each, ≤200 chars per reply.
  const userNameCache = new Map<string, string>();
  async function resolveUserName(id: string): Promise<string> {
    if (!id) return "unknown";
    if (userNameCache.has(id)) return userNameCache.get(id)!;
    try {
      const res = await slackFetch("users.info", auth, { user: id });
      const name = (res.user?.profile?.real_name as string) || (res.user?.name as string) || id;
      userNameCache.set(id, name);
      return name;
    } catch {
      userNameCache.set(id, id);
      return id;
    }
  }

  const threadedCandidates = messages
    .filter((m) => (m.reply_count ?? 0) > 0 || m.thread_ts)
    .slice(0, 15);

  await Promise.all(
    threadedCandidates.map(async (m) => {
      const parentTs = m.thread_ts || m.ts;
      try {
        const res = await slackFetch("conversations.replies", auth, {
          channel: m.channel_id,
          ts: parentTs,
          limit: "12",
        });
        const replies: SlackThreadReply[] = [];
        for (const r of (res.messages as Array<Record<string, unknown>> | undefined) ?? []) {
          if ((r.ts as string) === parentTs) continue; // skip parent
          const text = ((r.text as string) || "").slice(0, 300);
          if (!text) continue;
          const uid = (r.user as string) || "";
          const real_name = uid ? await resolveUserName(uid) : undefined;
          replies.push({ user: uid, real_name, text, ts: r.ts as string });
          if (replies.length >= 10) break;
        }
        if (replies.length > 0) m.thread = replies;
      } catch {
        // best-effort — skip threads we can't read
      }
    })
  );

  const channels: SlackChannel[] = Array.from(channelSet.entries()).map(([id, name]) => ({
    id,
    name,
    is_member: true,
  }));

  return {
    user: { id: userId, name: userName, real_name: realName },
    messages: messages.slice(0, 200),
    channels,
    summary: {
      messages: messages.length,
      channels: channelSet.size,
    },
  };
}
