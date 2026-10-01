import { Client } from "@notionhq/client";
import { blocksToBodyHtml } from "./blocks-to-html";
import { resolveNotionToken } from "./notion-oauth";
import type { Piece, PiecesPayload } from "./types";
import fallback from "../public/pieces.json";

export const SIGNAL_PIECES_DB =
  process.env.NOTION_PIECES_DATABASE_ID ||
  "7b8dc4d7-c313-4bda-923d-0ecaa0b4b610";

const CACHE_TTL_MS = Number(process.env.PIECES_CACHE_TTL_MS || 20_000);

type CacheEntry = {
  at: number;
  payload: PiecesPayload;
};

let cache: CacheEntry | null = null;

export function invalidatePiecesCache(): void {
  cache = null;
}

function notionClient(): Client | null {
  const token = resolveNotionToken();
  if (!token) return null;
  return new Client({ auth: token });
}

function propSelect(props: Record<string, any>, name: string): string {
  const p = props[name];
  if (!p) return "";
  if (p.type === "select") return p.select?.name || "";
  if (p.type === "status") return p.status?.name || "";
  return "";
}

function propTitle(props: Record<string, any>, name = "Name"): string {
  const p = props[name];
  if (!p || p.type !== "title") return "Untitled";
  return (p.title || []).map((t: { plain_text?: string }) => t.plain_text || "").join("").trim() || "Untitled";
}

function propRelationIds(props: Record<string, any>, name: string): string[] {
  const p = props[name];
  if (!p || p.type !== "relation") return [];
  return (p.relation || []).map((r: { id: string }) => r.id);
}

async function listAllPages(notion: Client) {
  const pages: any[] = [];
  let cursor: string | undefined;
  do {
    const res = await notion.databases.query({
      database_id: SIGNAL_PIECES_DB,
      start_cursor: cursor,
      page_size: 100,
      sorts: [{ timestamp: "last_edited_time", direction: "descending" }],
    });
    pages.push(...res.results);
    cursor = res.has_more ? res.next_cursor || undefined : undefined;
  } while (cursor);
  return pages;
}

async function fetchAllBlocks(notion: Client, pageId: string) {
  const blocks: any[] = [];
  let cursor: string | undefined;
  do {
    const res = await notion.blocks.children.list({
      block_id: pageId,
      start_cursor: cursor,
      page_size: 100,
    });
    blocks.push(...res.results);
    cursor = res.has_more ? res.next_cursor || undefined : undefined;
  } while (cursor);
  return blocks;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

async function resolveIssueTitle(
  notion: Client,
  issueId: string | null,
  cacheMap: Map<string, string>,
): Promise<string | null> {
  if (!issueId) return null;
  if (cacheMap.has(issueId)) return cacheMap.get(issueId)!;
  try {
    const page = await notion.pages.retrieve({ page_id: issueId });
    const props = (page as any).properties || {};
    const titleKey = Object.keys(props).find((k) => props[k]?.type === "title") || "Name";
    const title = propTitle(props, titleKey);
    cacheMap.set(issueId, title);
    return title;
  } catch {
    cacheMap.set(issueId, "");
    return null;
  }
}

export async function loadPiecesLive(opts?: { force?: boolean }): Promise<PiecesPayload> {
  if (opts?.force) invalidatePiecesCache();

  if (!opts?.force && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return { ...cache.payload, staleSeconds: Math.round((Date.now() - cache.at) / 1000) };
  }

  const notion = notionClient();
  if (!notion) {
    // Snapshot data, but stamp refreshedAt so "Refresh now" is visibly alive.
    const payload: PiecesPayload = {
      syncedAt: (fallback as any).syncedAt || new Date().toISOString(),
      refreshedAt: new Date().toISOString(),
      source: "fallback-json",
      pieces: (fallback as any).pieces || [],
    };
    cache = { at: Date.now(), payload };
    return payload;
  }

  const pages = await listAllPages(notion);
  const issueCache = new Map<string, string>();

  const pieces = await mapWithConcurrency(pages, 6, async (page) => {
    const props = page.properties || {};
    const type = propSelect(props, "Type");
    if (!["Big Idea", "Team take", "Field Notes"].includes(type)) {
      return null;
    }
    const issueIds = [
      ...propRelationIds(props, "Related Issue"),
      ...propRelationIds(props, "Related Issue 1"),
    ];
    const issueId = issueIds[0] || null;
    const issue = await resolveIssueTitle(notion, issueId, issueCache);

    let bodyHtml = "";
    let options: string[] = [];
    try {
      const blocks = await fetchAllBlocks(notion, page.id);
      const extracted = blocksToBodyHtml(blocks);
      bodyHtml = extracted.bodyHtml;
      options = extracted.options;
    } catch {
      bodyHtml = "";
    }

    const piece: Piece = {
      id: page.id,
      title: propTitle(props, "Name"),
      partner: propSelect(props, "Partner") || "TBD",
      type,
      status: propSelect(props, "Status") || "Draft",
      issue,
      issueId,
      url: page.url || `https://www.notion.so/${page.id.replace(/-/g, "")}`,
      hasBody: Boolean(bodyHtml.trim()),
      bodyHtml,
      options,
      lastEditedTime: page.last_edited_time,
    };
    return piece;
  });

  const now = new Date().toISOString();
  const payload: PiecesPayload = {
    syncedAt: now,
    refreshedAt: now,
    source: "notion-live",
    pieces: pieces.filter(Boolean) as Piece[],
  };
  cache = { at: Date.now(), payload };
  return payload;
}
