import { Client } from "@notionhq/client";
import { blocksToBodyHtml, type NotionBlock } from "./blocks-to-html";
import { ensureNotionToken } from "./notion-token-store";
import { PIECE_PROPS, peopleNameToPartnerKey } from "./piece-schema";
import type { Piece, PiecesPayload } from "./types";
import { belongsToIssue, requireActiveIssue } from "./issue-workflow";

export const SIGNAL_PIECES_DB =
  process.env.NOTION_PIECES_DATABASE_ID ||
  "7b8dc4d7-c313-4bda-923d-0ecaa0b4b610";

export const SIGNAL_ISSUES_DB =
  process.env.NOTION_ISSUES_DATABASE_ID || "eecbb144-5f06-4827-a647-031e9b9cdad8";

const CACHE_TTL_MS = Number(process.env.PIECES_CACHE_TTL_MS || 20_000);

type CacheEntry = {
  at: number;
  payload: PiecesPayload;
};

let cache: CacheEntry | null = null;

export function invalidatePiecesCache(): void {
  cache = null;
}

async function notionClient(): Promise<Client | null> {
  const token = await ensureNotionToken();
  if (!token) return null;
  return new Client({ auth: token });
}

/** Public Notion client for write routes (body save, etc.). */
export async function ensureNotionClient(): Promise<Client | null> {
  return notionClient();
}

/** Expand a Piece page (or block) tree for extract / writeback. */
export async function fetchPieceBlockTree(
  notion: Client,
  rootId: string,
): Promise<NotionBlock[]> {
  return fetchBlockTree(notion, rootId);
}

export async function loadPieceTitle(notion: Client, pageId: string): Promise<string | null> {
  try {
    const page = await notion.pages.retrieve({ page_id: pageId });
    const props = (page as any).properties || {};
    return propTitle(props, PIECE_PROPS.title);
  } catch {
    return null;
  }
}

function propSelect(props: Record<string, any>, name: string): string {
  const p = props[name];
  if (!p) return "";
  if (p.type === "select") return p.select?.name || "";
  if (p.type === "status") return p.status?.name || "";
  return "";
}

function propTitle(props: Record<string, any>, name: string = PIECE_PROPS.title): string {
  const p = props[name];
  if (!p || p.type !== "title") return "Untitled";
  return (p.title || []).map((t: { plain_text?: string }) => t.plain_text || "").join("").trim() || "Untitled";
}

function propRelationIds(props: Record<string, any>, name: string): string[] {
  const p = props[name];
  if (!p || p.type !== "relation") return [];
  return (p.relation || []).map((r: { id: string }) => r.id);
}

/** Read People (person) with legacy Partner select fallback → mixer byline key. */
function propPartnerKey(props: Record<string, any>): string {
  const people = props[PIECE_PROPS.people];
  if (people?.type === "people") {
    const names = (people.people || [])
      .map((u: { name?: string | null }) => (u.name || "").trim())
      .filter(Boolean);
    if (names.length) return peopleNameToPartnerKey(names[0]);
  }
  const legacy = propSelect(props, PIECE_PROPS.partnerLegacy);
  if (legacy) return peopleNameToPartnerKey(legacy);
  return "TBD";
}

async function listIssuePages(notion: Client, issueId: string) {
  const schema = await notion.databases.retrieve({ database_id: SIGNAL_PIECES_DB });
  const relationNames = PIECE_PROPS.relatedIssue.filter(
    (name) => schema.properties[name]?.type === "relation",
  );
  if (!relationNames.length) throw new Error("Signal Pieces needs its Related Issue relation.");
  const pages: any[] = [];
  let cursor: string | undefined;
  do {
    const res = await notion.databases.query({
      database_id: SIGNAL_PIECES_DB,
      filter: {
        or: relationNames.map((property) => ({ property, relation: { contains: issueId } })),
      },
      start_cursor: cursor,
      page_size: 100,
      sorts: [
        ...(schema.properties["Candidate rank"]?.type === "number"
          ? [{ property: "Candidate rank", direction: "ascending" as const }]
          : []),
        { timestamp: "last_edited_time", direction: "descending" },
      ],
    });
    pages.push(...res.results);
    cursor = res.has_more ? res.next_cursor || undefined : undefined;
  } while (cursor);
  return pages;
}

async function loadActiveIssue(notion: Client) {
  const result = await notion.databases.query({
    database_id: SIGNAL_ISSUES_DB,
    filter: { property: "Active issue", checkbox: { equals: true } },
    page_size: 2,
  });
  const page = requireActiveIssue(result.results) as any;
  const props = page.properties || {};
  const titleKey = Object.keys(props).find((key) => props[key]?.type === "title") || "Name";
  return {
    id: page.id as string,
    title: propTitle(props, titleKey),
    url: (page.url || `https://www.notion.so/${page.id.replace(/-/g, "")}`) as string,
  };
}

async function listBlockChildren(notion: Client, blockId: string): Promise<NotionBlock[]> {
  const blocks: NotionBlock[] = [];
  let cursor: string | undefined;
  do {
    const res = await notion.blocks.children.list({
      block_id: blockId,
      start_cursor: cursor,
      page_size: 100,
    });
    blocks.push(...(res.results as NotionBlock[]));
    cursor = res.has_more ? res.next_cursor || undefined : undefined;
  } while (cursor);
  return blocks;
}

/**
 * Fetch page blocks and expand toggle / toggle-heading children so Draft body
 * and Option N content is visible to the extractor.
 */
async function fetchBlockTree(notion: Client, rootId: string, depth = 0): Promise<NotionBlock[]> {
  if (depth > 6) return [];
  const blocks = await listBlockChildren(notion, rootId);
  await mapWithConcurrency(blocks, 4, async (block) => {
    if (!block.has_children) return;
    // Skip synced_block / child_page expansion — not piece draft copy
    if (block.type === "child_page" || block.type === "child_database" || block.type === "synced_block") {
      return;
    }
    block.children = await fetchBlockTree(notion, block.id, depth + 1);
  });
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

export async function loadPiecesLive(opts?: { force?: boolean }): Promise<PiecesPayload> {
  if (opts?.force) invalidatePiecesCache();

  if (!opts?.force && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return { ...cache.payload, staleSeconds: Math.round((Date.now() - cache.at) / 1000) };
  }

  const notion = await notionClient();
  if (!notion) {
    throw new Error("Connect Notion to load Pieces for the active issue.");
  }

  const activeIssue = await loadActiveIssue(notion);
  const pages = await listIssuePages(notion, activeIssue.id);

  const pieces = await mapWithConcurrency(pages, 4, async (page) => {
    const props = page.properties || {};
    const type = propSelect(props, PIECE_PROPS.type);
    if (!["Big Idea", "Team take", "Field Notes"].includes(type)) {
      return null;
    }
    const issueIds = PIECE_PROPS.relatedIssue.flatMap((name) => propRelationIds(props, name));
    if (!belongsToIssue(issueIds, activeIssue.id)) return null;
    const title = propTitle(props, PIECE_PROPS.title);

    let bodyHtml = "";
    let options: string[] = [];
    let optionBodies: Piece["optionBodies"] = [];
    try {
      const blocks = await fetchBlockTree(notion, page.id);
      const extracted = blocksToBodyHtml(blocks, { title });
      bodyHtml = extracted.bodyHtml;
      options = extracted.options;
      optionBodies = extracted.optionBodies;
    } catch {
      bodyHtml = "";
    }

    const hasBody =
      Boolean(bodyHtml.trim()) || optionBodies.some((o) => Boolean(o.bodyHtml.trim()));

    const piece: Piece = {
      id: page.id,
      title,
      partner: propPartnerKey(props),
      type,
      status: propSelect(props, PIECE_PROPS.status) || "Draft",
      issue: activeIssue.title,
      issueId: activeIssue.id,
      url: page.url || `https://www.notion.so/${page.id.replace(/-/g, "")}`,
      hasBody,
      bodyHtml,
      options,
      optionBodies,
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
    issue: activeIssue,
  };
  cache = { at: Date.now(), payload };
  return payload;
}
