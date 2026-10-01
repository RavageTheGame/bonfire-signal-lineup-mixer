import { NextResponse } from "next/server";
import {
  buildAuthorizeUrl,
  createOAuthState,
  hashState,
  oauthConfigured,
  oauthRedirectUri,
} from "@/lib/notion-oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!oauthConfigured()) {
    return NextResponse.json(
      {
        error:
          "Notion OAuth is not configured. Set NOTION_OAUTH_CLIENT_ID and NOTION_OAUTH_CLIENT_SECRET.",
      },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
  // Allow overriding redirect for the registered blackopsonly.com URI.
  const redirectUri = url.searchParams.get("redirect_uri") || oauthRedirectUri();
  const state = createOAuthState();
  const authorizeUrl = buildAuthorizeUrl(state, redirectUri);

  const response = NextResponse.redirect(authorizeUrl, { status: 302 });
  // HttpOnly cookie so the callback can validate state.
  response.cookies.set("notion_oauth_state", hashState(state), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 20,
  });
  response.cookies.set("notion_oauth_redirect", redirectUri, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 20,
  });
  return response;
}
