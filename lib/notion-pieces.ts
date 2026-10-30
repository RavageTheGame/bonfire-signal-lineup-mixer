import { Client } from "@notionhq/client";
import { blocksToBodyHtml, type NotionBlock } from "./blocks-to-html";
import { ensureNotionToken } from "./notion-token-store";
import { PIECE_PROPS, peopleNameToPartnerKey } from "./piece-schema";
import type { Piece, PiecesPayload, SignalIssue } from "./types";
import { currentCandidates, validSourceWindow } from "./issue-workflow";

export const SIGNAL_PIECES_DB =
  process.env.NOTION_PIECES_DATABASE_ID ||
  "7b8dc4d7-c313-4bda-923d-0ecaa0b4b610";
const SIGNAL_ISSUES_DB = process.env.NOTION_ISSUES_DATABASE_ID || "eecbb144-5f06-4827-a647-031e9b9cdad8";

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

function propDate(props: Record<string, any>, name: string): string | null {
  return props[name]?.date?.start || null;
}

function propText(props: Record<string, any>, name: string): string {
  return (props[name]?.rich_text || []).map((item: { plain_text?: string }) => item.plain_text || "").join("");
}

async function activeIssue(notion: Client): Promise<{ issue: SignalIssue | null; issueError?: string }> {
  const result = await notion.databases.query({
    database_id: SIGNAL_ISSUES_DB,
    filter: { property: "Active issue", checkbox: { equals: true } },
    page_size: 2,
  });
  if (result.results.length !== 1) {
    return { issue: null, issueError: result.results.length
      ? "More than one issue is active. Choose one active issue in Notion."
      : "Choose the current issue in Signal Command before generating a draft." };
  }
  const page = result.results[0] as any;
  const props = page.properties || {};
  const issue: SignalIssue = {
    id: page.id,
    title: propTitle(props),
    url: page.url,
    sourceStart: propDate(props, "Source start"),
    sourceEnd: propDate(props, "Source end"),
    targetSend: propDate(props, "Target send"),
    generationStatus: propSelect(props, "Generation status") || "Not started",
    generationNote: propText(props, "Generation note"),
    generatedAt: propDate(props, "Generated at"),
  };
  if (/^(sent|repurposing|archived)$/i.test(propSelect(props, "Status"))) {
    return { issue: null, issueError: "The active issue has already shipped. Activate the next issue in Signal Command." };
  }
  if (!validSourceWindow(issue)) {
    return { issue, issueError: "Set a valid source start and end date on this issue before generating content." };
  }
  return { issue };
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

async function listAllPages(notion: Client, issueId: string) {
  const pages: any[] = [];
  let cursor: string | undefined;
  do {
    const res = await notion.databases.query({
      database_id: SIGNAL_PIECES_DB,
      filter: { property: PIECE_PROPS.relatedIssue[0], relation: { contains: issueId } },
      start_cursor: cursor,
      page_size: 100,
      sorts: [{ timestamp: "last_edited_time", direction: "descending" }],
    });
    pages.push(...res.results);
    cursor = res.has_more ? res.next_cursor || undefined : undefined;
  } while (cursor);
  return pages;
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
    const titleKey = Object.keys(props).find((k) => props[k]?.type === "title") || PIECE_PROPS.title;
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

  const notion = await notionClient();
  if (!notion) {
    // Never substitute a prior issue's static snapshot into the current issue.
    const payload: PiecesPayload = {
      syncedAt: new Date().toISOString(),
      refreshedAt: new Date().toISOString(),
      source: "fallback-json",
      pieces: [],
      issue: null,
      issueError: "Connect Notion to load the active issue. Historical snapshots are hidden.",
    };
    cache = { at: Date.now(), payload };
    return payload;
  }

  const selection = await activeIssue(notion);
  if (!selection.issue || selection.issueError) {
    const now = new Date().toISOString();
    const payload: PiecesPayload = { syncedAt: now, refreshedAt: now, source: "notion-live", pieces: [], ...selection };
    cache = { at: Date.now(), payload };
    return payload;
  }
  const pages = await listAllPages(notion, selection.issue.id);
  const issueCache = new Map<string, string>();
  issueCache.set(selection.issue.id, selection.issue.title);

  const pieces = await mapWithConcurrency(pages, 4, async (page) => {
    const props = page.properties || {};
    const type = propSelect(props, PIECE_PROPS.type);
    if (!["Big Idea", "Team take", "Field Notes"].includes(type)) {
      return null;
    }
    const issueIds = PIECE_PROPS.relatedIssue.flatMap((name) => propRelationIds(props, name));
    const issueId = issueIds[0] || null;
    const issue = await resolveIssueTitle(notion, issueId, issueCache);
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
      issue,
      issueId,
      url: page.url || `https://www.notion.so/${page.id.replace(/-/g, "")}`,
      hasBody,
      bodyHtml,
      options,
      optionBodies,
      lastEditedTime: page.last_edited_time,
      mixerSlot: propSelect(props, "Mixer slot") || null,
      candidateRank: props["Candidate rank"]?.number ?? null,
      rankingReason: propText(props, "Ranking reason"),
      recommended: props.Recommended?.checkbox === true,
      sourceDate: propDate(props, "Source date"),
    };
    return piece;
  });

  const now = new Date().toISOString();
  const eligible = currentCandidates(pieces.filter(Boolean) as Piece[], selection.issue);
  const payload: PiecesPayload = {
    syncedAt: now,
    refreshedAt: now,
    source: "notion-live",
    pieces: eligible,
    issue: selection.issue,
    excludedCount: pieces.filter(Boolean).length - eligible.length,
  };
  cache = { at: Date.now(), payload };
  return payload;
}
