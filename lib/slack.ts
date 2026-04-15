export type SlackMessage = {
  channel_id: string;
  channel_name: string;
  text: string;
  ts: string;
  permalink: string | null;
  thread_ts: string | null;
  reply_count?: number;
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

async function slackFetch(method: string, token: string, params: Record<string, string> = {}) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`https://slack.com/api/${method}?${qs}`, {
    headers: {
      Authorization: `Bearer ${token}`,
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
  token: string,
  days: number,
  dateFrom?: string,
  dateTo?: string
): Promise<SlackData> {
  const oldest = dateFrom
    ? Math.floor(new Date(dateFrom).getTime() / 1000).toString()
    : sinceTs(days);

  // Get current user
  const authRes = await slackFetch("auth.test", token);
  const userId = authRes.user_id as string;
  const userName = authRes.user as string;

  // Get user profile for real name
  let realName = userName;
  try {
    const profileRes = await slackFetch("users.info", token, { user: userId });
    realName = profileRes.user?.profile?.real_name || userName;
  } catch {
    // profile is best-effort
  }

  // Search for messages sent by the user
  const searchRes = await slackFetch("search.messages", token, {
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
      const channelsRes = await slackFetch("conversations.list", token, {
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
          const histRes = await slackFetch("conversations.history", token, {
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
