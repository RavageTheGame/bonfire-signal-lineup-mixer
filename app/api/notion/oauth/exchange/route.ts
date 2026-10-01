import { NextRequest, NextResponse } from "next/server";
import { invalidatePiecesCache } from "@/lib/notion-pieces";
import {
  exchangeCodeForToken,
  oauthConfigured,
  setRuntimeNotionToken,
} from "@/lib/notion-oauth";
import { persistNotionTokenToVercel } from "@/lib/persist-notion-token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Manual code exchange for when Notion redirects to the registered
 * https://blackopsonly.com URI and the operator pastes the code here.
 */
export async function POST(request: NextRequest) {
  if (!oauthConfigured()) {
    return NextResponse.json({ error: "Notion OAuth is not configured" }, { status: 503 });
  }

  let body: { code?: string; redirectUri?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON body" }, { status: 400 });
  }

  const code = body.code?.trim();
  if (!code) {
    return NextResponse.json({ error: "Missing code" }, { status: 400 });
  }

  const redirectUri = (body.redirectUri || "https://blackopsonly.com").trim();

  try {
    const token = await exchangeCodeForToken(code, redirectUri);
    setRuntimeNotionToken(token.access_token);
    invalidatePiecesCache();

    let envUpserted = false;
    let redeployId: string | null = null;
    try {
      const persisted = await persistNotionTokenToVercel(token.access_token);
      envUpserted = persisted.envUpserted;
      redeployId = persisted.redeployId || null;
    } catch {
      /* optional */
    }

    return NextResponse.json({
      ok: true,
      workspaceName: token.workspace_name || null,
      workspaceId: token.workspace_id || null,
      persisted: envUpserted,
      redeployId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Exchange failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
