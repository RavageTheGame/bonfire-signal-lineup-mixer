import { createHash, randomBytes } from "crypto";

export type NotionOAuthToken = {
  access_token: string;
  token_type?: string;
  bot_id?: string;
  workspace_id?: string;
  workspace_name?: string | null;
  workspace_icon?: string | null;
  duplicated_template_id?: string | null;
  owner?: unknown;
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

export function oauthConfigured(): boolean {
  return Boolean(
    process.env.NOTION_OAUTH_CLIENT_ID?.trim() &&
      process.env.NOTION_OAUTH_CLIENT_SECRET?.trim(),
  );
}

export function oauthRedirectUri(): string {
  return (
    process.env.NOTION_OAUTH_REDIRECT_URI?.trim() ||
    "https://bonfire-signal-lineup-mixer.vercel.app/api/notion/oauth/callback"
  );
}

export function createOAuthState(): string {
  return randomBytes(24).toString("hex");
}

export function hashState(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

export function buildAuthorizeUrl(state: string, redirectUri = oauthRedirectUri()): string {
  const clientId = requiredEnv("NOTION_OAUTH_CLIENT_ID");
  const url = new URL("https://api.notion.com/v1/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("owner", "user");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeCodeForToken(
  code: string,
  redirectUri = oauthRedirectUri(),
): Promise<NotionOAuthToken> {
  const clientId = requiredEnv("NOTION_OAUTH_CLIENT_ID");
  const clientSecret = requiredEnv("NOTION_OAUTH_CLIENT_SECRET");
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const res = await fetch("https://api.notion.com/v1/oauth/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });

  const payload = (await res.json().catch(() => ({}))) as NotionOAuthToken & {
    error?: string;
    error_description?: string;
  };

  if (!res.ok || !payload.access_token) {
    const detail = payload.error_description || payload.error || `HTTP ${res.status}`;
    throw new Error(`Notion OAuth token exchange failed: ${detail}`);
  }

  return payload;
}

/** Prefer env token; fall back to runtime token set after OAuth in this process. */
let runtimeAccessToken: string | null = null;

export function setRuntimeNotionToken(token: string | null) {
  runtimeAccessToken = token?.trim() || null;
}

export function resolveNotionToken(): string | null {
  const fromEnv = process.env.NOTION_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  return runtimeAccessToken;
}
