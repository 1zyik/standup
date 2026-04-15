import Anthropic from "@anthropic-ai/sdk";

export type AIProvider = "anthropic" | "openai" | "deepseek";

export type AIConfig = {
  provider: AIProvider;
  apiKey: string;
  model: string;
};

const PROVIDER_BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  deepseek: "https://api.deepseek.com",
};

export async function generateWithAI(
  config: AIConfig,
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  const { provider, apiKey, model } = config;

  if (provider === "anthropic") {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model,
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });
    if (response.content[0].type !== "text") throw new Error("Unexpected response type from Anthropic");
    return response.content[0].text;
  }

  // OpenAI-compatible (openai, deepseek)
  const baseUrl = PROVIDER_BASE_URLS[provider];
  if (!baseUrl) throw new Error(`Unknown AI provider: ${provider}`);

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 2000,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${provider} API error ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error(`No content in ${provider} response`);
  return text;
}

// Default models per provider
export const DEFAULT_MODELS: Record<AIProvider, string> = {
  anthropic: "claude-sonnet-4-5",
  openai: "gpt-4o",
  deepseek: "deepseek-chat",
};

export const MODEL_OPTIONS: Record<AIProvider, { value: string; label: string }[]> = {
  anthropic: [
    { value: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
    { value: "claude-opus-4-5", label: "Claude Opus 4.5" },
    { value: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
  ],
  openai: [
    { value: "gpt-4o", label: "GPT-4o" },
    { value: "gpt-4o-mini", label: "GPT-4o Mini" },
    { value: "gpt-4-turbo", label: "GPT-4 Turbo" },
    { value: "o3-mini", label: "o3-mini" },
  ],
  deepseek: [
    { value: "deepseek-chat", label: "DeepSeek Chat (V3)" },
    { value: "deepseek-reasoner", label: "DeepSeek Reasoner (R1)" },
  ],
};
