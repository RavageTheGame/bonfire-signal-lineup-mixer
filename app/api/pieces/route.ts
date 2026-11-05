import { NextRequest, NextResponse } from "next/server";
import { ensureNotionClient, loadPiecesLive, SIGNAL_ISSUES_DB } from "@/lib/notion-pieces";
import { EditorAccessError, requireEditorAccess } from "@/lib/editor-access";
import { loadPastIssue } from "@/lib/issue-history";
import { IssueDraftError } from "@/lib/issue-draft-writeback";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const issueId = request.nextUrl.searchParams.get("issueId");
  if (issueId !== null) {
    const headers = { "Cache-Control": "private, no-store" };
    try {
      requireEditorAccess(request);
      if (!/^(?:[\da-f]{32}|[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12})$/i.test(issueId)) {
        return NextResponse.json({ error: "Invalid issue ID." }, { status: 400, headers });
      }
      const notion = await ensureNotionClient();
      if (!notion) return NextResponse.json({ error: "Connect Notion to load past issues." }, { status: 503, headers });
      return NextResponse.json(await loadPastIssue(notion, issueId, SIGNAL_ISSUES_DB), { headers });
    } catch (error) {
      const expected = error instanceof EditorAccessError || error instanceof IssueDraftError;
      const status = expected ? error.status
        : typeof error === "object" && error && "code" in error && error.code === "object_not_found" ? 404 : 503;
      const message = expected ? error.message
        : status === 404 ? "This past issue is unavailable." : "Could not load this past issue from Notion.";
      return NextResponse.json({ error: message }, { status, headers });
    }
  }
  try {
    const force = request.nextUrl.searchParams.has("force");
    const payload = await loadPiecesLive({ force });
    return NextResponse.json(payload, {
      headers: {
        // Manual refresh uses ?force=1 and cache: no-store on the client.
        "Cache-Control": force
          ? "private, no-store"
          : "private, max-age=15, stale-while-revalidate=30",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load pieces";
    return NextResponse.json(
      { error: message, syncedAt: new Date().toISOString(), source: "error", pieces: [] },
      { status: 500 },
    );
  }
}
