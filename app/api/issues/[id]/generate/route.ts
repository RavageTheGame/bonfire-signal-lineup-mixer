import { NextRequest, NextResponse } from "next/server";
import { EditorAccessError, requireEditorAccess } from "@/lib/editor-access";
import { isSameOriginRequest } from "@/lib/editorial-decision";
import { IssueGenerationError, parseIssueGenerationPayload, queueIssueGeneration } from "@/lib/issue-generation";
import { ensureNotionClient, invalidatePiecesCache, SIGNAL_ISSUES_DB } from "@/lib/notion-pieces";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const headers = { "Cache-Control": "no-store" };

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const origin = request.headers.get("origin");
  if (!origin || !isSameOriginRequest(origin, request.url)) {
    return NextResponse.json({ error: "Generation requests must come from this mixer" }, { status: 403, headers });
  }
  try {
    requireEditorAccess(request);
    const { id } = await context.params;
    let payload: unknown;
    try { payload = await request.json(); } catch { throw new IssueGenerationError("Invalid JSON body"); }
    const mode = parseIssueGenerationPayload(payload);
    const notion = await ensureNotionClient();
    if (!notion) throw new IssueGenerationError("Connect Notion before requesting a draft", 503);
    const status = await queueIssueGeneration(notion, id, mode, SIGNAL_ISSUES_DB);
    invalidatePiecesCache();
    return NextResponse.json({ status }, { status: 202, headers });
  } catch (error) {
    if (error instanceof EditorAccessError || error instanceof IssueGenerationError) {
      return NextResponse.json({ error: error.message }, { status: error.status, headers });
    }
    // Notion may have applied the queue change even if its response failed.
    invalidatePiecesCache();
    return NextResponse.json({ error: "Notion did not confirm the request. Refresh the issue before trying again." }, { status: 502, headers });
  }
}
