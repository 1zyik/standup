"use client";

import { useState } from "react";

// ─── Tab definitions ──────────────────────────────────────────────────────────

type TabId = "github" | "slack" | "gitlab" | "jira" | "teams" | "anthropic" | "openai" | "deepseek";

const TABS: { id: TabId; label: string; icon: string; color: string; group: "integrations" | "ai" }[] = [
  { id: "github",    label: "GitHub",     icon: "⬡", color: "#c8c8c8", group: "integrations" },
  { id: "slack",     label: "Slack",      icon: "#", color: "#e01e5a", group: "integrations" },
  { id: "gitlab",    label: "GitLab",     icon: "⬠", color: "#fc6d26", group: "integrations" },
  { id: "jira",      label: "Jira",       icon: "◉", color: "#0052cc", group: "integrations" },
  { id: "teams",     label: "MS Teams",   icon: "⬕", color: "#5059c9", group: "integrations" },
  { id: "anthropic", label: "Anthropic",  icon: "◆", color: "#cc785c", group: "ai" },
  { id: "openai",    label: "OpenAI",     icon: "⬟", color: "#10a37f", group: "ai" },
  { id: "deepseek",  label: "DeepSeek",   icon: "◈", color: "#4d9fff", group: "ai" },
];

// ─── Documentation content ────────────────────────────────────────────────────

type Step = { title: string; detail?: string; code?: string; warning?: string; tip?: string };
type Doc = { heading: string; intro: string; steps: Step[]; scopes?: string[]; links: { label: string; href: string }[] };

const DOCS: Record<TabId, Doc> = {
  github: {
    heading: "GitHub Personal Access Token",
    intro: "A Personal Access Token (PAT) lets the app read your GitHub activity — PRs, issues, commits, and reviews — without storing your password. Fine-grained tokens are recommended.",
    scopes: [
      "Contents → Read-only (read commits)",
      "Issues → Read-only (read issues)",
      "Pull requests → Read-only (read PRs and reviews)",
      "Metadata → Read-only (automatically included)",
    ],
    steps: [
      { title: "Open GitHub → Settings → Developer settings", detail: "Go to github.com, click your profile photo → Settings, then scroll to Developer settings in the left sidebar." },
      { title: "Create a Fine-grained token", detail: "Select Personal access tokens → Fine-grained tokens → Generate new token. Give it a name like Standup Generator and set an expiration (90 days recommended).", tip: "Fine-grained tokens are scoped per-repo. Classic tokens (ghp_…) also work with repo + read:user scopes." },
      { title: "Set resource owner and repository access", detail: "Under Resource owner, select yourself or your org. Under Repository access, choose All repositories or specific repos you want standup coverage for." },
      { title: "Grant the required permissions", detail: "Under Repository permissions enable the four permissions listed in the scopes box above. No account or organisation permissions are needed." },
      { title: "Generate and copy immediately", detail: "Click Generate token. Copy the token — GitHub shows it only once. It will start with github_pat_…", warning: "You cannot view the token again after leaving this page. Store it securely." },
    ],
    links: [
      { label: "Fine-grained Personal Access Tokens", href: "https://github.com/settings/tokens?type=beta" },
      { label: "Classic Personal Access Tokens", href: "https://github.com/settings/tokens" },
      { label: "GitHub PAT Documentation", href: "https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens" },
    ],
  },

  slack: {
    heading: "Slack User OAuth Token",
    intro: "A User OAuth Token (xoxp-…) lets the app read messages you sent in channels, DMs, and threads. It reads as you — not a bot — so it captures your actual communication.",
    scopes: [
      "channels:history — Read messages from public channels",
      "channels:read — List public channels",
      "groups:history — Read messages from private channels",
      "im:history — Read your direct messages",
      "mpim:history — Read your group DMs",
      "search:read — Search messages across your workspace",
      "users:read — Resolve user profiles",
    ],
    steps: [
      { title: "Go to api.slack.com/apps", detail: "Open api.slack.com/apps in your browser. Log in with your Slack account if prompted." },
      { title: "Create a new app from scratch", detail: "Click Create New App → From scratch. Name it Standup Generator and select your workspace." },
      { title: "Open OAuth & Permissions", detail: "In the left sidebar of your app, click OAuth & Permissions. Scroll down to Scopes." },
      { title: "Add User Token Scopes — not Bot Scopes", detail: "Under User Token Scopes (the second scopes section), add all scopes listed in the permissions box above.", warning: "Add scopes under User Token Scopes, not Bot Token Scopes. Bot tokens (xoxb-…) cannot read your personal messages." },
      { title: "Install the app to your workspace", detail: "Scroll back to the top and click Install to Workspace. Review and authorise the permissions." },
      { title: "Copy the User OAuth Token", detail: "After installing, the token appears at the top of the OAuth & Permissions page. It starts with xoxp-…", warning: "Copy only the User OAuth Token (xoxp-…). The Bot User OAuth Token (xoxb-…) will not work for reading your messages." },
    ],
    links: [
      { label: "Slack API Dashboard — Your Apps", href: "https://api.slack.com/apps" },
      { label: "Slack Token Types", href: "https://api.slack.com/authentication/token-types#user" },
      { label: "Full Slack Scopes Reference", href: "https://api.slack.com/scopes" },
    ],
  },

  gitlab: {
    heading: "GitLab Personal Access Token",
    intro: "A GitLab Personal Access Token lets the app read your merge requests, issues, and commits from GitLab.com or a self-hosted instance.",
    scopes: [
      "api — Full API access (required for MR, issue, and event data)",
      "read_user — Read your profile information",
      "read_repository — Read repository contents and commits",
    ],
    steps: [
      { title: "Open GitLab → User Settings → Access Tokens", detail: "Go to gitlab.com (or your instance), click your avatar → Edit profile → Access Tokens in the left sidebar." },
      { title: "Create a new personal access token", detail: "Click Add new token. Give it a name like Standup Generator and set an expiration date." },
      { title: "Select the required scopes", detail: "Tick api, read_user, and read_repository from the scopes list above." },
      { title: "Create and copy the token", detail: "Click Create personal access token. Copy the token immediately — it starts with glpat-…", warning: "The token is shown only once. Store it before navigating away." },
      { title: "Self-hosted GitLab", detail: "If you use a self-hosted instance, enter its base URL (e.g. https://gitlab.mycompany.com) in the optional GitLab URL field.", tip: "Leave the URL field blank to default to gitlab.com." },
    ],
    links: [
      { label: "GitLab.com — Personal Access Tokens", href: "https://gitlab.com/-/user_settings/personal_access_tokens" },
      { label: "GitLab PAT Documentation", href: "https://docs.gitlab.com/ee/user/profile/personal_access_tokens.html" },
    ],
  },

  jira: {
    heading: "Jira API Token",
    intro: "A Jira API token authenticates the app to your Atlassian account using your email + token instead of your password. This works for Jira Cloud (atlassian.net).",
    scopes: ["No explicit scopes — the token grants the same access as your Atlassian account to all projects you can see."],
    steps: [
      { title: "Go to id.atlassian.com → Security → API tokens", detail: "Sign in at id.atlassian.com, click Security in the left sidebar, then API tokens." },
      { title: "Create a new API token", detail: "Click Create API token. Give it a label like Standup Generator." },
      { title: "Copy the token", detail: "Copy the token immediately — Atlassian shows it only once. It starts with ATATT3x…", warning: "This token has the same access level as your Atlassian account. Do not share it." },
      { title: "Find your Jira base URL", detail: "Your base URL is the part of your Jira URL before /jira or /browse, e.g. https://yourorg.atlassian.net. Enter this exactly in the Jira Base URL field." },
      { title: "Enter your account email", detail: "Use the email address you log in to Atlassian with. This is used for Basic Auth together with the API token." },
    ],
    links: [
      { label: "Atlassian — Manage API Tokens", href: "https://id.atlassian.com/manage-profile/security/api-tokens" },
      { label: "Jira REST API v3 Documentation", href: "https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/" },
    ],
  },

  teams: {
    heading: "Microsoft Teams — Graph API Access Token",
    intro: "The app uses the Microsoft Graph API to read your Teams messages. You need a delegated access token that represents your identity. The easiest way to get one is via Graph Explorer or the Azure CLI.",
    scopes: [
      "Chat.Read — Read your 1:1 and group chat messages",
      "ChannelMessage.Read.All — Read messages in Teams channels",
      "Team.ReadBasic.All — List Teams you belong to",
      "User.Read — Read your profile",
    ],
    steps: [
      { title: "Option A — Microsoft Graph Explorer (easiest)", detail: "Go to developer.microsoft.com/en-us/graph/graph-explorer and sign in with your Microsoft account." },
      { title: "Grant consent in Graph Explorer", detail: "Click Modify permissions, search for Chat.Read, ChannelMessage.Read.All, and Team.ReadBasic.All, and grant consent for each.", tip: "Your org may require admin consent for ChannelMessage.Read.All. If so, ask your IT admin or use personal/developer tenants." },
      { title: "Copy the access token from Graph Explorer", detail: "Click Access token in the Graph Explorer header. Copy the full eyJ0… token. It expires in about 1 hour so generate it just before running the standup." },
      { title: "Option B — Azure CLI", detail: "If you have the Azure CLI installed, run:", code: "az login\naz account get-access-token --resource https://graph.microsoft.com --query accessToken -o tsv" },
      { title: "Paste the token", detail: "Paste the access token into the MS Teams token field. Because these tokens expire, you will need to refresh it each time you generate a standup.", warning: "Access tokens expire after ~60–90 minutes. If you see a 401 error, fetch a new token using the steps above." },
      { title: "Option C — App Registration (long-lived)", detail: "For a more permanent solution, register an app in the Azure Portal, configure delegated permissions, and implement the OAuth2 auth code flow. See the Microsoft Graph documentation for details.", tip: "For personal use, Graph Explorer tokens are simpler. App registration is better for repeated automated use." },
    ],
    links: [
      { label: "Microsoft Graph Explorer", href: "https://developer.microsoft.com/en-us/graph/graph-explorer" },
      { label: "Azure Portal — App Registrations", href: "https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade" },
      { label: "Graph API — Chat Messages", href: "https://learn.microsoft.com/en-us/graph/api/chat-list-messages" },
      { label: "Graph API — Channel Messages", href: "https://learn.microsoft.com/en-us/graph/api/channel-list-messages" },
    ],
  },

  anthropic: {
    heading: "Anthropic API Key",
    intro: "The Anthropic API key is used to call Claude, which reads your activity data and writes the standup. Data is sent to Anthropic's API for this request only and is not retained.",
    steps: [
      { title: "Open console.anthropic.com", detail: "Go to console.anthropic.com and sign in or create an account." },
      { title: "Navigate to API Keys", detail: "In the left sidebar, click API Keys." },
      { title: "Create a new key", detail: "Click Create Key. Name it Standup Generator." },
      { title: "Copy the key immediately", detail: "Copy it — it starts with sk-ant-api03-… Anthropic shows it only once.", warning: "Store this key safely. If lost, create a new one." },
      { title: "Check credits / usage limits", detail: "Each standup uses ~2,000–4,000 tokens (~$0.01–0.03). Set a usage limit in Console → Limits if needed.", tip: "Claude Sonnet is the best balance of speed and quality for standup generation." },
    ],
    links: [
      { label: "Anthropic Console — API Keys", href: "https://console.anthropic.com/settings/keys" },
      { label: "Anthropic Pricing", href: "https://anthropic.com/pricing" },
      { label: "API Getting Started", href: "https://docs.anthropic.com/en/api/getting-started" },
    ],
  },

  openai: {
    heading: "OpenAI API Key",
    intro: "OpenAI's GPT models can generate your standup summary. GPT-4o is recommended for best results. The key is only used for the generation request.",
    steps: [
      { title: "Open platform.openai.com", detail: "Go to platform.openai.com and sign in or create an account." },
      { title: "Navigate to API Keys", detail: "Click your profile icon → API keys in the left sidebar, or go to platform.openai.com/api-keys." },
      { title: "Create a new secret key", detail: "Click Create new secret key. Give it a name like Standup Generator and optionally restrict it to a project." },
      { title: "Copy the key", detail: "Copy the key immediately — it starts with sk-proj-… or sk-… OpenAI shows it only once.", warning: "Never commit this key to source control. It grants access to your OpenAI account and billing." },
      { title: "Add billing credits", detail: "Usage is billed per-token. A standup costs ~$0.01–0.05 with GPT-4o. Add credits at platform.openai.com/settings/billing.", tip: "GPT-4o-mini is significantly cheaper and still produces good standups for most activity volumes." },
    ],
    links: [
      { label: "OpenAI Platform — API Keys", href: "https://platform.openai.com/api-keys" },
      { label: "OpenAI Billing", href: "https://platform.openai.com/settings/billing/overview" },
      { label: "OpenAI Models Overview", href: "https://platform.openai.com/docs/models" },
    ],
  },

  deepseek: {
    heading: "DeepSeek API Key",
    intro: "DeepSeek provides highly capable, cost-effective models with an OpenAI-compatible API. DeepSeek Chat (V3) and DeepSeek Reasoner (R1) are both supported.",
    steps: [
      { title: "Open platform.deepseek.com", detail: "Go to platform.deepseek.com and create an account or sign in." },
      { title: "Navigate to API Keys", detail: "In the left sidebar, click API Keys." },
      { title: "Create a new API key", detail: "Click Create API Key. Give it a name like Standup Generator." },
      { title: "Copy the key", detail: "Copy the key immediately — it starts with sk-… DeepSeek shows it only once.", warning: "Store the key safely. It cannot be retrieved after the creation dialog closes." },
      { title: "Add account balance", detail: "DeepSeek uses a credit system. Top up at platform.deepseek.com/top-up. Standup generation costs roughly $0.001–0.005 per run.", tip: "DeepSeek Chat is an excellent choice for standup generation — it is fast, capable, and very affordable compared to other frontier models." },
    ],
    links: [
      { label: "DeepSeek Platform", href: "https://platform.deepseek.com" },
      { label: "DeepSeek API Keys", href: "https://platform.deepseek.com/api_keys" },
      { label: "DeepSeek Model Docs", href: "https://api-docs.deepseek.com/quick_start/pricing" },
    ],
  },
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function StepItem({ step, index }: { step: Step; index: number }) {
  return (
    <div style={{ display: "flex", gap: 12, marginBottom: 18 }}>
      <div style={{ width: 22, height: 22, borderRadius: 5, background: "var(--surface-3)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "var(--text-muted)", flexShrink: 0, marginTop: 1 }}>
        {index + 1}
      </div>
      <div style={{ flex: 1 }}>
        <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 4 }}>{step.title}</p>
        {step.detail && <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.65 }}>{step.detail}</p>}
        {step.code && (
          <pre style={{ marginTop: 8, padding: "8px 12px", background: "var(--surface-3)", border: "1px solid var(--border)", borderRadius: 7, fontSize: 11, color: "var(--accent)", fontFamily: "monospace", whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{step.code}</pre>
        )}
        {step.warning && (
          <div style={{ marginTop: 8, padding: "8px 12px", background: "var(--yellow-dim)", border: "1px solid rgba(251,191,36,0.2)", borderRadius: 7, fontSize: 12, color: "var(--yellow)", lineHeight: 1.55, display: "flex", gap: 7 }}>
            <span style={{ flexShrink: 0 }}>⚠</span><span>{step.warning}</span>
          </div>
        )}
        {step.tip && (
          <div style={{ marginTop: 8, padding: "8px 12px", background: "var(--accent-dim)", border: "1px solid var(--accent-border)", borderRadius: 7, fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.55, display: "flex", gap: 7 }}>
            <span style={{ flexShrink: 0, color: "var(--accent)" }}>💡</span><span>{step.tip}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function QuickLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--accent)", textDecoration: "none", padding: "4px 0" }}
      onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = "var(--accent-hover)")}
      onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = "var(--accent)")}>
      <span style={{ fontSize: 10, opacity: 0.7 }}>↗</span>{label}
    </a>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

type Props = { open: boolean; onClose: () => void; defaultTab?: string };

export default function TokenDocs({ open, onClose, defaultTab = "github" }: Props) {
  const [tab, setTab] = useState<TabId>(defaultTab as TabId);

  // Sync when prop changes (e.g. clicking "? How to get this" on a specific field)
  const [prevDefault, setPrevDefault] = useState(defaultTab);
  if (defaultTab !== prevDefault) {
    setPrevDefault(defaultTab);
    setTab(defaultTab as TabId);
  }

  if (!open) return null;

  const doc = DOCS[tab];
  const tabConfig = TABS.find((t) => t.id === tab)!;
  const integrationTabs = TABS.filter((t) => t.group === "integrations");
  const aiTabs = TABS.filter((t) => t.group === "ai");

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)", zIndex: 50 }} />

      <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", zIndex: 51, width: "min(700px, 95vw)", maxHeight: "88vh", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {/* Header */}
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border-subtle)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <div>
            <p style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 3 }}>Setup Guide</p>
            <h2 style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)", letterSpacing: "-0.02em" }}>How to get your tokens</h2>
          </div>
          <button onClick={onClose} style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 7, color: "var(--text-muted)", width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 15 }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = "var(--text-primary)")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = "var(--text-muted)")}>×</button>
        </div>

        {/* Tab groups */}
        <div style={{ padding: "10px 20px", borderBottom: "1px solid var(--border-subtle)", flexShrink: 0 }}>
          {/* Integrations */}
          <p style={{ fontSize: 9, fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6 }}>Integrations</p>
          <div style={{ display: "flex", gap: 4, marginBottom: 10, flexWrap: "wrap" }}>
            {integrationTabs.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)}
                style={{ padding: "5px 11px", borderRadius: 6, border: `1px solid ${tab === t.id ? "var(--accent-border)" : "var(--border)"}`, background: tab === t.id ? "var(--accent-dim)" : "var(--surface-2)", color: tab === t.id ? "var(--accent)" : "var(--text-secondary)", fontSize: 12, fontWeight: tab === t.id ? 600 : 400, cursor: "pointer", display: "flex", alignItems: "center", gap: 5, transition: "all 0.15s" }}>
                <span style={{ color: tab === t.id ? "var(--accent)" : t.color, fontWeight: 700 }}>{t.icon}</span>{t.label}
              </button>
            ))}
          </div>
          {/* AI Providers */}
          <p style={{ fontSize: 9, fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6 }}>AI Providers</p>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {aiTabs.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)}
                style={{ padding: "5px 11px", borderRadius: 6, border: `1px solid ${tab === t.id ? "var(--accent-border)" : "var(--border)"}`, background: tab === t.id ? "var(--accent-dim)" : "var(--surface-2)", color: tab === t.id ? "var(--accent)" : "var(--text-secondary)", fontSize: 12, fontWeight: tab === t.id ? 600 : 400, cursor: "pointer", display: "flex", alignItems: "center", gap: 5, transition: "all 0.15s" }}>
                <span style={{ color: tab === t.id ? "var(--accent)" : t.color, fontWeight: 700 }}>{t.icon}</span>{t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Scrollable content */}
        <div style={{ overflowY: "auto", flex: 1, padding: "20px" }}>
          {/* Section heading */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ width: 26, height: 26, borderRadius: 6, background: "var(--surface-3)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: tabConfig.color, fontWeight: 700, flexShrink: 0 }}>{tabConfig.icon}</span>
              <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>{doc.heading}</h3>
            </div>
            <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.65, paddingLeft: 34 }}>{doc.intro}</p>
          </div>

          {/* Scopes */}
          {doc.scopes && (
            <div style={{ marginBottom: 20, padding: "12px 14px", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 9 }}>
              <p style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>Required Permissions / Scopes</p>
              {doc.scopes.map((scope, i) => (
                <div key={i} style={{ display: "flex", gap: 7, alignItems: "flex-start", marginBottom: 5 }}>
                  <span style={{ color: "var(--green)", fontSize: 10, marginTop: 3, flexShrink: 0 }}>✓</span>
                  <span style={{ fontSize: 12, color: "var(--text-secondary)", fontFamily: scope.includes("—") ? "inherit" : "monospace" }}>{scope}</span>
                </div>
              ))}
            </div>
          )}

          {/* Steps */}
          <p style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 14 }}>Step-by-step</p>
          {doc.steps.map((step, i) => <StepItem key={i} step={step} index={i} />)}

          {/* Quick links */}
          <div style={{ marginTop: 8, padding: "12px 14px", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 9 }}>
            <p style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>Quick Links</p>
            {doc.links.map((link, i) => <QuickLink key={i} href={link.href} label={link.label} />)}
          </div>
        </div>
      </div>
    </>
  );
}
