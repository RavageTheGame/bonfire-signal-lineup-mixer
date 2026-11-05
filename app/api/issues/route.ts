import { NextResponse } from "next/server";
import { EditorAccessError, requireEditorAccess } from "@/lib/editor-access";
import { listPastIssues } from "@/lib/issue-history";
import { ensureNotionClient, SIGNAL_ISSUES_DB } from "@/lib/notion-pieces";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    requireEditorAccess(request);
    const notion = await ensureNotionClient();
    if (!notion) return NextResponse.json({ error: "Connect Notion to load past issues." }, { status: 503, headers });
    return NextResponse.json({ issues: await listPastIssues(notion, SIGNAL_ISSUES_DB) }, { headers });
  } catch (error) {
    const status = error instanceof EditorAccessError ? error.status : 503;
    const message = error instanceof EditorAccessError ? error.message : "Could not load past issues from Notion.";
    return NextResponse.json({ error: message }, { status, headers });
  }
}
