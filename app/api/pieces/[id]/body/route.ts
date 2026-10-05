import { NextRequest, NextResponse } from "next/server";
import { blocksToBodyHtml, type NotionBlock } from "@/lib/blocks-to-html";
import { updatePieceBodyInNotion } from "@/lib/body-writeback";
import { normalizeEditorHtml } from "@/lib/html-notion";
import {
  ensureNotionClient,
  fetchPieceBlockTree,
  invalidatePiecesCache,
  loadPieceTitle,
} from "@/lib/notion-pieces";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id: pageId } = await context.params;
  if (!pageId?.trim()) {
    return NextResponse.json({ error: "Missing piece id" }, { status: 400 });
  }

  const notion = await ensureNotionClient();
  if (!notion) {
    return NextResponse.json(
      {
        error:
          "Notion is not connected. Open /connect, authorize, then try saving again.",
        code: "notion_disconnected",
      },
      { status: 503 },
    );
  }

  let payload: { bodyHtml?: string; sectionLabel?: string | null };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const bodyHtml = normalizeEditorHtml(String(payload.bodyHtml || ""));
  const preferredSection = payload.sectionLabel ? String(payload.sectionLabel) : null;

  try {
    const title = await loadPieceTitle(notion, pageId);
    const result = await updatePieceBodyInNotion(notion, pageId, bodyHtml, {
      preferredSection,
      fetchBlockTree: (rootId) => fetchPieceBlockTree(notion, rootId),
      blocksToBodyHtml: (blocks: NotionBlock[], opts) => blocksToBodyHtml(blocks, opts),
      title: title || undefined,
    });

    invalidatePiecesCache();

    return NextResponse.json({
      ok: true,
      id: pageId,
      bodyHtml: result.bodyHtml,
      hasBody: Boolean(result.bodyHtml.trim()),
      sectionLabel: result.sectionLabel,
      createdSection: result.createdSection,
      replacedCount: result.replacedCount,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save body to Notion";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
