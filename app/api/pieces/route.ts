import { NextResponse } from "next/server";
import { loadPiecesLive } from "@/lib/notion-pieces";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const payload = await loadPiecesLive();
    return NextResponse.json(payload, {
      headers: {
        // Short browser/CDN cache; client also refreshes on focus.
        "Cache-Control": "private, max-age=15, stale-while-revalidate=30",
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
