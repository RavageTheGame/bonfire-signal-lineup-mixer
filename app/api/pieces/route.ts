import { NextRequest, NextResponse } from "next/server";
import { loadPiecesLive } from "@/lib/notion-pieces";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
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
