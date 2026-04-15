export type TeamsMessage = {
  id: string;
  chatOrChannel: string;
  chatOrChannelType: "chat" | "channel" | "groupchat";
  body: string;
  createdAt: string;
  webUrl: string | null;
};

export type TeamsData = {
  user: { id: string; displayName: string; email: string };
  messages: TeamsMessage[];
  summary: { messages: number; chats: number; channels: number };
};

async function graphFetch(path: string, token: string) {
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Microsoft Graph API error ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

function sinceDate(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .trim();
}

export async function fetchTeamsData(
  token: string,
  days: number,
  dateFrom?: string
): Promise<TeamsData> {
  const since = dateFrom ? new Date(dateFrom).toISOString() : sinceDate(days);
  const sinceMs = new Date(since).getTime();

  // Get current user
  const me = await graphFetch("/me?$select=id,displayName,mail,userPrincipalName", token);
  const userId = me.id as string;

  const messages: TeamsMessage[] = [];
  let chatCount = 0;
  let channelCount = 0;

  // Fetch chats (1-on-1 and group chats)
  try {
    const chatsRes = await graphFetch(
      "/me/chats?$select=id,chatType,topic&$top=50",
      token
    );
    const chats = (chatsRes.value ?? []) as Array<Record<string, unknown>>;
    chatCount = chats.length;

    await Promise.allSettled(
      chats.slice(0, 20).map(async (chat) => {
        try {
          const chatId = chat.id as string;
          const chatType = chat.chatType as string;
          const chatName = (chat.topic as string) || (chatType === "oneOnOne" ? "Direct Message" : "Group Chat");

          const msgsRes = await graphFetch(
            `/me/chats/${chatId}/messages?$top=50&$orderby=createdDateTime desc`,
            token
          );

          for (const msg of msgsRes.value ?? []) {
            const createdAt = msg.createdDateTime as string;
            if (new Date(createdAt).getTime() < sinceMs) continue;
            const fromId = (msg.from?.user?.id as string) || (msg.from?.application?.id as string);
            if (fromId !== userId) continue;
            const bodyContent = msg.body?.content as string ?? "";
            const text = msg.body?.contentType === "html" ? stripHtml(bodyContent) : bodyContent;
            if (!text || text.trim().length < 3) continue;

            messages.push({
              id: msg.id as string,
              chatOrChannel: chatName,
              chatOrChannelType: chatType === "oneOnOne" ? "chat" : "groupchat",
              body: text.slice(0, 500),
              createdAt,
              webUrl: null,
            });
          }
        } catch {
          // skip inaccessible chats
        }
      })
    );
  } catch {
    // chats are best-effort
  }

  // Fetch joined Teams channels
  try {
    const teamsRes = await graphFetch("/me/joinedTeams?$select=id,displayName", token);
    const teams = (teamsRes.value ?? []) as Array<Record<string, unknown>>;

    await Promise.allSettled(
      teams.slice(0, 10).map(async (team) => {
        try {
          const teamId = team.id as string;
          const teamName = team.displayName as string;
          const channelsRes = await graphFetch(
            `/teams/${teamId}/channels?$select=id,displayName`,
            token
          );
          const channels = (channelsRes.value ?? []) as Array<Record<string, unknown>>;
          channelCount += channels.length;

          await Promise.allSettled(
            channels.slice(0, 5).map(async (channel) => {
              try {
                const channelId = channel.id as string;
                const channelName = channel.displayName as string;
                const msgsRes = await graphFetch(
                  `/teams/${teamId}/channels/${channelId}/messages?$top=30`,
                  token
                );
                for (const msg of msgsRes.value ?? []) {
                  const createdAt = msg.createdDateTime as string;
                  if (new Date(createdAt).getTime() < sinceMs) continue;
                  const fromId = (msg.from?.user?.id as string);
                  if (fromId !== userId) continue;
                  const bodyContent = msg.body?.content as string ?? "";
                  const text = msg.body?.contentType === "html" ? stripHtml(bodyContent) : bodyContent;
                  if (!text || text.trim().length < 3) continue;

                  messages.push({
                    id: msg.id as string,
                    chatOrChannel: `${teamName} > ${channelName}`,
                    chatOrChannelType: "channel",
                    body: text.slice(0, 500),
                    createdAt,
                    webUrl: msg.webUrl as string | null,
                  });
                }
              } catch {
                // skip
              }
            })
          );
        } catch {
          // skip
        }
      })
    );
  } catch {
    // teams are best-effort
  }

  // Sort by date desc and deduplicate
  const seen = new Set<string>();
  const unique = messages.filter((m) => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });
  unique.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return {
    user: {
      id: userId,
      displayName: me.displayName as string,
      email: (me.mail || me.userPrincipalName) as string,
    },
    messages: unique.slice(0, 150),
    summary: { messages: unique.length, chats: chatCount, channels: channelCount },
  };
}
