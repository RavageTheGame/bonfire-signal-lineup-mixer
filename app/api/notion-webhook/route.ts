import { NextRequest, NextResponse } from "next/server";
import { invalidatePiecesCache } from "@/lib/notion-pieces";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Notion page/database webhooks hit this to drop the in-memory cache
 * so the next /api/pieces read is fresh — no cron.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.NOTION_WEBHOOK_SECRET;
  if (secret) {
    const header = req.headers.get("x-notion-signature") || req.headers.get("authorization") || "";
    if (!header.includes(secret)) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }

  try {
    const body = await req.json().catch(() => ({}));
    // Notion verification challenge (if present)
    if (body?.challenge) {
      return NextResponse.json({ challenge: body.challenge });
    }
  } catch {
    // ignore
  }

  invalidatePiecesCache();
  return NextResponse.json({ ok: true, invalidatedAt: new Date().toISOString() });
}
