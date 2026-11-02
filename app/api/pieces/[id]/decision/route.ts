import { NextRequest, NextResponse } from "next/server";
import {
  EditorialDecisionError,
  isSameOriginRequest,
  parseDecisionPayload,
  updateEditorialDecision,
  validatePieceId,
} from "@/lib/editorial-decision";
import {
  ensureNotionClient,
  invalidatePiecesCache,
  SIGNAL_ISSUES_DB,
  SIGNAL_PIECES_DB,
} from "@/lib/notion-pieces";
import { PIECE_PROPS } from "@/lib/piece-schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  if (!isSameOriginRequest(request.headers.get("origin"), request.url)) {
    return NextResponse.json({ error: "Cross-origin decision updates are not allowed" }, { status: 403 });
  }

  try {
    const { id } = await context.params;
    validatePieceId(id);
    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      throw new EditorialDecisionError("Invalid JSON body");
    }
    const decision = parseDecisionPayload(payload);
    const notion = await ensureNotionClient();
    if (!notion) throw new EditorialDecisionError("Connect Notion to save editorial decisions", 503);

    const saved = await updateEditorialDecision(notion, id, decision, {
      piecesDatabaseId: SIGNAL_PIECES_DB,
      issuesDatabaseId: SIGNAL_ISSUES_DB,
      props: {
        decision: PIECE_PROPS.editorialDecision,
        status: PIECE_PROPS.status,
        type: PIECE_PROPS.type,
        relatedIssue: PIECE_PROPS.relatedIssue,
      },
    });
    invalidatePiecesCache();
    return NextResponse.json({ ok: true, id, decision: saved });
  } catch (error) {
    if (error instanceof EditorialDecisionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Could not save the editorial decision. Please try again." }, { status: 500 });
  }
}
