import { NextRequest, NextResponse } from "next/server";
import { invalidatePiecesCache } from "@/lib/notion-pieces";
import {
  exchangeCodeForToken,
  hashState,
  oauthConfigured,
  oauthRedirectUri,
  setRuntimeNotionToken,
} from "@/lib/notion-oauth";
import { persistNotionTokenToVercel } from "@/lib/persist-notion-token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function htmlPage(title: string, body: string) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    body { font-family: Georgia, "Times New Roman", serif; background: #E6E9E8; color: #132540; margin: 0; padding: 40px 20px; }
    main { max-width: 560px; margin: 0 auto; background: #fff; border: 1px solid #C8D2D2; border-radius: 12px; padding: 28px; box-shadow: 0 16px 40px rgba(19,37,64,.08); }
    h1 { margin: 0 0 12px; font-size: 28px; }
    p { line-height: 1.5; color: #3E4A5A; }
    a.btn { display: inline-block; margin-top: 18px; padding: 10px 14px; background: #132540; color: #fff; text-decoration: none; font-family: Helvetica, Arial, sans-serif; font-size: 13px; font-weight: 700; border-radius: 999px; }
    .ok { color: #3f7f5a; font-weight: 700; }
    .bad { color: #b1782f; font-weight: 700; }
    code { font-family: ui-monospace, monospace; font-size: 12px; background: #F2F5F4; padding: 2px 6px; border-radius: 4px; }
  </style>
</head>
<body><main>${body}</main></body>
</html>`;
}

export async function GET(request: NextRequest) {
  if (!oauthConfigured()) {
    return new NextResponse(
      htmlPage(
        "Notion OAuth not configured",
        `<h1>Notion OAuth not configured</h1><p class="bad">Set <code>NOTION_OAUTH_CLIENT_ID</code> and <code>NOTION_OAUTH_CLIENT_SECRET</code> on Vercel, then try again.</p><a class="btn" href="/">Back to mixer</a>`,
      ),
      { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const error = request.nextUrl.searchParams.get("error");

  if (error) {
    return new NextResponse(
      htmlPage(
        "Notion authorization denied",
        `<h1>Authorization denied</h1><p class="bad">${error}</p><a class="btn" href="/connect">Try again</a>`,
      ),
      { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }

  if (!code) {
    return new NextResponse(
      htmlPage(
        "Missing code",
        `<h1>Missing authorization code</h1><p>Notion did not return a <code>code</code>. Start again from the connect page.</p><a class="btn" href="/connect">Connect Notion</a>`,
      ),
      { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }

  const expectedHash = request.cookies.get("notion_oauth_state")?.value;
  if (state && expectedHash && hashState(state) !== expectedHash) {
    return new NextResponse(
      htmlPage(
        "Invalid state",
        `<h1>Invalid OAuth state</h1><p class="bad">The login session did not match. Close this tab and start again.</p><a class="btn" href="/connect">Connect Notion</a>`,
      ),
      { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }

  const redirectUri =
    request.cookies.get("notion_oauth_redirect")?.value || oauthRedirectUri();

  try {
    const token = await exchangeCodeForToken(code, redirectUri);
    setRuntimeNotionToken(token.access_token);
    invalidatePiecesCache();

    let persistNote = "Token is active for this instance.";
    try {
      const persisted = await persistNotionTokenToVercel(token.access_token);
      if (persisted.blobSaved && persisted.envUpserted) {
        persistNote = persisted.redeployId
          ? `Saved durably (Blob + Vercel env). Redeploying (<code>${persisted.redeployId}</code>).`
          : "Saved durably (Blob + Vercel env). Open the mixer and Refresh now.";
      } else if (persisted.blobSaved) {
        persistNote =
          "Saved durably to private storage. Open the mixer and hit <strong>Refresh now</strong> — live Pieces should stick across redeploys.";
      } else if (persisted.envUpserted) {
        persistNote = persisted.redeployId
          ? `Saved to Vercel and redeploying (<code>${persisted.redeployId}</code>). Live Notion will be on in about a minute.`
          : "Saved to Vercel as <code>NOTION_TOKEN</code>. Redeploy the app to activate everywhere.";
      } else {
        persistNote =
          "Token active in this instance only. Ask ops to confirm Blob storage or <code>VERCEL_TOKEN</code> so Connect survives redeploys.";
      }
    } catch (persistError) {
      const message = persistError instanceof Error ? persistError.message : "persist failed";
      persistNote = `Token active in this instance. Auto-save skipped: ${message}`;
    }

    const workspace = token.workspace_name || token.workspace_id || "Notion workspace";
    const response = new NextResponse(
      htmlPage(
        "Notion connected",
        `<h1>Notion connected</h1>
         <p class="ok">Linked to <strong>${workspace}</strong>.</p>
         <p>${persistNote}</p>
         <p>Share the Signal Pieces database with this integration if Notion asks, then open the mixer and hit <strong>Refresh now</strong>.</p>
         <a class="btn" href="/">Open mixer</a>`,
      ),
      { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
    response.cookies.delete("notion_oauth_state");
    response.cookies.delete("notion_oauth_redirect");
    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new NextResponse(
      htmlPage(
        "Notion connect failed",
        `<h1>Connect failed</h1><p class="bad">${message}</p>
         <p>If Notion redirected you to <code>blackopsonly.com</code>, copy the <code>code</code> from that URL and paste it on the connect page.</p>
         <a class="btn" href="/connect">Back to connect</a>`,
      ),
      { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }
}
