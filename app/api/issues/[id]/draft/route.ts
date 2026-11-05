import { NextRequest, NextResponse } from "next/server";
import { isSameOriginRequest } from "@/lib/editorial-decision";
import { IssueDraftError, parseIssueDraftPayload, saveIssueDraft } from "@/lib/issue-draft-writeback";
import { ensureNotionClient, invalidatePiecesCache, SIGNAL_ISSUES_DB, SIGNAL_PIECES_DB } from "@/lib/notion-pieces";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 180;

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isSameOriginRequest(request.headers.get("origin"), request.url)) {
    return NextResponse.json({ error: "Draft saves must come from this mixer" }, { status: 403 });
  }
  try {
    const { id } = await context.params;
    let raw: unknown;
    try { raw = await request.json(); } catch { throw new IssueDraftError("Invalid JSON body"); }
    const input = parseIssueDraftPayload(raw);
    const notion = await ensureNotionClient();
    if (!notion) throw new IssueDraftError("Connect Notion before saving an issue draft", 503);
    const result = await saveIssueDraft(notion, id, input, { piecesDatabaseId: SIGNAL_PIECES_DB, issuesDatabaseId: SIGNAL_ISSUES_DB });
    invalidatePiecesCache();
    return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    // A failed Notion transaction can still have changed blocks or require recovery.
    invalidatePiecesCache();
    if (error instanceof IssueDraftError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Notion could not finish saving the issue draft. Refresh and review the issue before retrying." }, { status: 500 });
  }
}
