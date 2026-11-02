import { createHash } from "node:crypto";
import type { Client } from "@notionhq/client";
import { blocksToBodyHtml, type NotionBlock } from "./blocks-to-html";
import { htmlToNotionBlocks, type NotionRichText } from "./html-notion";
import { stripLeadingByline } from "./byline";
import { isAvailableCandidate } from "./editorial-decision";
import { peopleNameToPartnerKey, PIECE_PROPS } from "./piece-schema";
import { readPullQuoteProperty, withPullQuote } from "./pull-quote";

export const DRAFT_LINEUP_PROPERTY = "Draft lineup";
export const DRAFT_HEADING = "Newsletter draft";
export const NOTES_HEADING = "Editorial notes";

export type CompleteDraftLineup = {
  bigIdeaId: string;
  teamTakeIds: string[];
  fieldNoteId: string;
};

export class IssueDraftError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "IssueDraftError";
    this.status = status;
  }
}

type NotionClient = Pick<Client, "pages" | "databases" | "blocks">;
type IssuePage = { id: string; properties: Record<string, any>; [key: string]: any };
type DraftBlock = { object: "block"; type: string; [key: string]: any };
export type DraftPiece = {
  id: string;
  title: string;
  partner: string;
  type: string;
  bodyHtml: string;
  pullQuote: string;
  optionCount: number;
  sectionLabel: string;
};

const ID = /^(?:[\da-f]{32}|[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12})$/i;
const idKey = (value: string) => value.replace(/-/g, "").toLowerCase();
const sameId = (a: string, b: string) => idKey(a) === idKey(b);

function validId(value: unknown): value is string {
  return typeof value === "string" && ID.test(value);
}

function plain(items: any[] | undefined): string {
  return (items || []).map((item) => item.plain_text ?? item.text?.content ?? "").join("");
}

function blockPlain(block: NotionBlock): string {
  return plain((block[block.type] as any)?.rich_text).trim();
}

function select(property: any): string {
  return property?.type === "select" ? property.select?.name || ""
    : property?.type === "status" ? property.status?.name || "" : "";
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

/** Write input deliberately rejects partial lineups and unrecognized fields. */
export function parseIssueDraftPayload(payload: unknown): { lineup: CompleteDraftLineup; revision: string } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)
    || !exactKeys(payload as Record<string, unknown>, ["lineup", "revision"])) {
    throw new IssueDraftError("Provide only lineup and revision");
  }
  const { lineup, revision } = payload as Record<string, unknown>;
  if (typeof revision !== "string" || !/^[a-f0-9]{64}$/.test(revision)) {
    throw new IssueDraftError("Refresh the issue before saving its draft", 409);
  }
  if (!lineup || typeof lineup !== "object" || Array.isArray(lineup)
    || !exactKeys(lineup as Record<string, unknown>, ["bigIdeaId", "teamTakeIds", "fieldNoteId"])) {
    throw new IssueDraftError("Provide one View, four Team takes and one Field Note");
  }
  const value = lineup as Record<string, unknown>;
  if (!validId(value.bigIdeaId) || !validId(value.fieldNoteId)
    || !Array.isArray(value.teamTakeIds) || value.teamTakeIds.length !== 4
    || !value.teamTakeIds.every(validId)) {
    throw new IssueDraftError("Select exactly six Pieces: one View, four Team takes and one Field Note");
  }
  const ids = [value.bigIdeaId, ...value.teamTakeIds, value.fieldNoteId] as string[];
  if (new Set(ids.map(idKey)).size !== 6) throw new IssueDraftError("Each draft slot must use a different Piece");
  return { lineup: { bigIdeaId: value.bigIdeaId, teamTakeIds: [...value.teamTakeIds], fieldNoteId: value.fieldNoteId }, revision };
}

async function fetchTree(notion: NotionClient, rootId: string, budget = { count: 0 }, depth = 0): Promise<NotionBlock[]> {
  if (depth > 10) throw new IssueDraftError("This page has an unexpectedly deep block tree", 409);
  const blocks: NotionBlock[] = [];
  let cursor: string | undefined;
  do {
    const result = await notion.blocks.children.list({ block_id: rootId, page_size: 100, start_cursor: cursor });
    for (const raw of result.results) {
      if (!("type" in raw)) throw new IssueDraftError("Could not read the complete page body", 409);
      const block = { ...raw } as unknown as NotionBlock;
      if (++budget.count > 1500) throw new IssueDraftError("This page is too large to save safely from the mixer", 409);
      // A child page/database or synced source is never part of the managed draft.
      if (block.has_children && !["child_page", "child_database", "synced_block"].includes(block.type)) {
        block.children = await fetchTree(notion, block.id, budget, depth + 1);
      }
      blocks.push(block);
    }
    cursor = result.has_more ? result.next_cursor || undefined : undefined;
    if (result.has_more && !cursor) throw new IssueDraftError("Could not read the complete page body", 409);
  } while (cursor);
  return blocks;
}

export function locateIssueDraftRegion(blocks: NotionBlock[]): { marker: NotionBlock; content: NotionBlock[]; boundary: NotionBlock } {
  const markers = blocks.flatMap((block, index) => block.type === "heading_1" && blockPlain(block) === DRAFT_HEADING ? [index] : []);
  if (markers.length !== 1) throw new IssueDraftError("The issue needs exactly one Newsletter draft section", 409);
  const start = markers[0];
  const end = blocks.findIndex((block, index) => index > start && block.type === "heading_1");
  if (end < 0 || blockPlain(blocks[end]) !== NOTES_HEADING) {
    throw new IssueDraftError("Newsletter draft must end at the Editorial notes heading", 409);
  }
  const content = blocks.slice(start + 1, end);
  // The mixer owns flat, visible newsletter copy only, never embedded databases or human containers.
  const supported = new Set(["paragraph", "heading_2", "heading_3", "quote", "bulleted_list_item", "numbered_list_item", "divider"]);
  for (const block of content) {
    if (!supported.has(block.type) || block.has_children || block.children?.length) {
      throw new IssueDraftError("Newsletter draft contains a container the mixer cannot replace safely", 409);
    }
  }
  if (blocks[start].has_children || blocks[start].children?.length) {
    throw new IssueDraftError("Newsletter draft must be a visible, flat section", 409);
  }
  return { marker: blocks[start], content, boundary: blocks[end] };
}

function canonicalBlock(block: NotionBlock): unknown {
  return { id: block.id, type: block.type, data: block[block.type], children: block.children?.map(canonicalBlock) || [] };
}

/** Ignore timestamps; native text/format/order edits and saved mapping changes all invalidate the token. */
export function issueDraftRevision(blocks: NotionBlock[], properties: Record<string, any>): string {
  return createHash("sha256").update(JSON.stringify({
    blocks: blocks.map(canonicalBlock),
    lineup: plain(properties[DRAFT_LINEUP_PROPERTY]?.rich_text),
  })).digest("hex");
}

export async function readIssueDraftSnapshot(notion: NotionClient, issuePage: IssuePage): Promise<{ revision: string; blocks: NotionBlock[] }> {
  const blocks = await fetchTree(notion, issuePage.id);
  locateIssueDraftRegion(blocks);
  if (issuePage.properties[DRAFT_LINEUP_PROPERTY]?.type !== "rich_text") {
    throw new IssueDraftError("Signal Issues needs its Draft lineup rich text property", 503);
  }
  return { revision: issueDraftRevision(blocks, issuePage.properties), blocks };
}

function text(content: string, link?: string): NotionRichText[] {
  const result: NotionRichText[] = [];
  for (let start = 0; start < content.length; start += 2000) {
    result.push({ type: "text", text: { content: content.slice(start, start + 2000), ...(link ? { link: { url: link } } : {}) } });
  }
  return result;
}

function paragraph(content: string, link?: string): DraftBlock {
  return { object: "block", type: "paragraph", paragraph: { rich_text: text(content, link) } };
}

function heading(content: string, level: 2 | 3 = 2): DraftBlock {
  const type = `heading_${level}`;
  return { object: "block", type, [type]: { rich_text: text(content), is_toggleable: false } };
}

const BYLINES: Record<string, [string, string]> = {
  Brett: ["Brett Queener", "Partner"], Tyler: ["Tyler Churchill", "Partner"],
  Jim: ["Jim Andelman", "Partner"], Mark: ["Mark Mullen", "Partner"],
  Jen: ["Jen Richard", "Principal"], Jason: ["Jason Tahir", "VP"],
  Dominique: ["Dominique", ""], Loren: ["Loren", ""], Brian: ["Brian", ""], Deb: ["Deb Goldstein", ""],
};

function name(piece: DraftPiece, title = false): string {
  const [full, role] = BYLINES[piece.partner] || [piece.partner, ""];
  return title && role ? `${full}, ${role}` : full;
}

/** Pure factory used by the save route and the one-time issue assembly. No client prose enters this output. */
export function renderIssueDraftBlocks(issueTitle: string, pieces: DraftPiece[]): DraftBlock[] {
  if (pieces.length !== 6 || pieces[0].type !== "Big Idea" || pieces[5].type !== "Field Notes"
    || pieces.slice(1, 5).some((piece) => piece.type !== "Team take")) {
    throw new IssueDraftError("Draft renderer needs the ordered six-Piece lineup");
  }
  const [view, ...rest] = pieces;
  const team = rest.slice(0, 4);
  const field = pieces[5];
  const body = (piece: DraftPiece) => {
    const prose = piece.type === "Big Idea" ? stripLeadingByline(piece.bodyHtml, name(piece, true)) : piece.bodyHtml;
    const rendered = piece.type === "Team take" ? prose
      : withPullQuote(prose, piece.pullQuote, piece.sectionLabel, piece.optionCount);
    return htmlToNotionBlocks(rendered) as DraftBlock[];
  };
  const contributors = [...new Set([view, ...team].map((piece) => name(piece)))];
  return [
    paragraph(issueTitle),
    heading("Early-stage B2B from the inside."),
    paragraph("Bonfire Ventures leads seed rounds for AI-native B2B companies, which means we spend our days in the rooms where they get built. Signal is our monthly take on the patterns we're seeing and the questions we think are worth asking next."),
    heading("01 The Bonfire View"),
    heading(view.title, 3), paragraph(name(view, true)), ...body(view),
    heading("02 From the Bonfire Team"),
    ...team.flatMap((piece) => [paragraph(piece.partner.toUpperCase()), heading(piece.title, 3), ...body(piece)]),
    heading("03 Field Notes from the Portfolio"),
    heading(field.title, 3), ...body(field),
    heading("Building an AI-native B2B company?"),
    paragraph("We lead seed rounds and invest $2 to $6 million. If that sounds like you, tell us what you're building."),
    paragraph("Share your company", "https://bonfireventures.fillout.com/t/oDd8NpWYHhus"),
    heading("In this issue"), paragraph(contributors.join(" · ")),
    paragraph("Bonfire Ventures · 11611 San Vicente Boulevard #650 · Los Angeles, CA 90049"),
  ];
}

function assertPage(page: any, databaseId: string, label: string): asserts page is IssuePage {
  if (page.object !== "page" || page.parent?.type !== "database_id" || !sameId(page.parent.database_id, databaseId)
    || page.archived || page.in_trash) throw new IssueDraftError(`${label} not found in its Signal database`, 404);
}

function assertIssueIdle(page: IssuePage): void {
  const status = select(page.properties["Generation status"]);
  if (["Queued", "Drafting"].includes(status)) throw new IssueDraftError("Bonnie is working on this issue. Wait for generation to finish before saving its draft.", 409);
  if (!["Idle", "Needs attention", "Ready"].includes(status)) throw new IssueDraftError("The issue needs a supported Generation status before saving", 409);
  if (page.properties[DRAFT_LINEUP_PROPERTY]?.type !== "rich_text") throw new IssueDraftError("Signal Issues needs its Draft lineup rich text property", 503);
}

async function activeIssue(notion: NotionClient, issueId: string, issuesDatabaseId: string): Promise<IssuePage> {
  const active = await notion.databases.query({ database_id: issuesDatabaseId, filter: { property: "Active issue", checkbox: { equals: true } }, page_size: 2 });
  if (active.results.length !== 1 || !sameId(active.results[0].id, issueId)) {
    throw new IssueDraftError("Refresh the mixer: this is no longer the single active issue", 409);
  }
  const page = await notion.pages.retrieve({ page_id: issueId });
  assertPage(page, issuesDatabaseId, "Issue");
  if (page.properties["Active issue"]?.type !== "checkbox" || !page.properties["Active issue"].checkbox) {
    throw new IssueDraftError("This issue is no longer active", 409);
  }
  assertIssueIdle(page);
  return page;
}

async function loadPiece(notion: NotionClient, id: string, expectedType: string, issueId: string, piecesDatabaseId: string): Promise<DraftPiece> {
  const page = await notion.pages.retrieve({ page_id: id });
  assertPage(page, piecesDatabaseId, "Piece");
  const props = page.properties as Record<string, any>;
  if (select(props[PIECE_PROPS.type]) !== expectedType) throw new IssueDraftError(`The selected Piece is not a ${expectedType}`, 409);
  if (!isAvailableCandidate({ status: select(props[PIECE_PROPS.status]), editorialDecision: select(props[PIECE_PROPS.editorialDecision]) })) {
    throw new IssueDraftError("A selected Piece is Archived, Banked or Ruled out. Choose an available Piece.", 409);
  }
  if (!PIECE_PROPS.relatedIssue.some((key) => props[key]?.type === "relation"
    && props[key].relation?.some((relation: { id: string }) => sameId(relation.id, issueId)))) {
    throw new IssueDraftError("Every selected Piece must belong to the active issue", 409);
  }
  const title = plain(props[PIECE_PROPS.title]?.title).trim();
  if (!title) throw new IssueDraftError("A selected Piece has no title", 409);
  const names = props[PIECE_PROPS.people]?.type === "people" ? props[PIECE_PROPS.people].people || [] : [];
  const personName = names.map((person: { name?: string }) => person.name?.trim()).find(Boolean);
  const partner = expectedType === "Field Notes" ? "Anonymous" : peopleNameToPartnerKey(personName || select(props[PIECE_PROPS.partnerLegacy]));
  if (expectedType !== "Field Notes" && (!partner || ["TBD", "Anonymous"].includes(partner))) throw new IssueDraftError("A selected contributor needs a named voice", 409);
  const extracted = blocksToBodyHtml(await fetchTree(notion, page.id), { title });
  if (!extracted.bodyHtml.trim()) throw new IssueDraftError("Every selected Piece needs a saved draft body", 409);
  const selected = extracted.optionBodies.find((option) => /^draft body$/i.test(option.label) && option.bodyHtml.trim())
    || extracted.optionBodies.find((option) => option.bodyHtml.trim());
  return { id: page.id, title, partner, type: expectedType, bodyHtml: extracted.bodyHtml,
    pullQuote: readPullQuoteProperty(props, PIECE_PROPS.pullQuote), optionCount: extracted.optionBodies.length, sectionLabel: selected?.label || "Draft" };
}

async function parallelEach<T>(items: T[], fn: (value: T) => Promise<void>): Promise<void> {
  let next = 0;
  const failures: unknown[] = [];
  await Promise.all(Array.from({ length: Math.min(3, items.length) }, async () => {
    while (next < items.length) {
      const value = items[next++];
      try { await fn(value); } catch (error) { failures.push(error); }
    }
  }));
  if (failures.length) throw failures[0];
}

async function appendAfter(notion: NotionClient, issueId: string, afterId: string, blocks: DraftBlock[], createdBlocks: NotionBlock[]): Promise<void> {
  let after = afterId;
  for (let start = 0; start < blocks.length; start += 100) {
    const result = await notion.blocks.children.append({ block_id: issueId, after, children: blocks.slice(start, start + 100) as any });
    const ids = result.results.map((block) => block.id);
    createdBlocks.push(...result.results as NotionBlock[]);
    if (ids.length !== Math.min(100, blocks.length - start)) throw new IssueDraftError("Notion did not confirm every new draft block", 503);
    after = ids[ids.length - 1];
  }
}

const savingIssues = new Set<string>();

/** Replace only the explicit draft region; all content outside the two markers stays in place. */
export async function saveIssueDraft(
  notion: NotionClient,
  issueId: string,
  input: { lineup: CompleteDraftLineup; revision: string },
  config: { piecesDatabaseId: string; issuesDatabaseId: string },
): Promise<{ issueId: string; lineup: CompleteDraftLineup; revision: string; savedAt: string }> {
  if (!validId(issueId)) throw new IssueDraftError("Invalid issue id");
  // Also validate direct service callers, not just HTTP callers.
  const { lineup, revision } = parseIssueDraftPayload(input);
  const key = idKey(issueId);
  if (savingIssues.has(key)) throw new IssueDraftError("This issue is already being saved. Wait and refresh.", 409);
  savingIssues.add(key);
  const stagedBlocks: NotionBlock[] = [];
  let oldIds: string[] = [];
  let archivesStarted = false;
  let committed = false;
  let commitUncertain = false;
  try {
    const issue = await activeIssue(notion, issueId, config.issuesDatabaseId);
    const before = await readIssueDraftSnapshot(notion, issue);
    if (before.revision !== revision) throw new IssueDraftError("The issue changed in Notion. Refresh and review before saving.", 409);
    const specs = [[lineup.bigIdeaId, "Big Idea"], ...lineup.teamTakeIds.map((id) => [id, "Team take"]), [lineup.fieldNoteId, "Field Notes"]];
    const pieces: DraftPiece[] = [];
    // Keep Notion requests modest and retain selection order.
    for (const [id, type] of specs) pieces.push(await loadPiece(notion, id, type, issueId, config.piecesDatabaseId));
    if (new Set(pieces.slice(1, 5).map((piece) => piece.partner)).size !== 4) throw new IssueDraftError("Team takes must come from four different contributors", 409);
    const titleProperty = Object.values(issue.properties).find((property: any) => property.type === "title") as any;
    const blocks = renderIssueDraftBlocks(plain(titleProperty?.title).trim() || "The Bonfire Signal", pieces);
    const currentIssue = await activeIssue(notion, issueId, config.issuesDatabaseId);
    const current = await readIssueDraftSnapshot(notion, currentIssue);
    if (current.revision !== revision) throw new IssueDraftError("The issue changed in Notion. Refresh and review before saving.", 409);
    const region = locateIssueDraftRegion(current.blocks);
    oldIds = region.content.map((block) => block.id);
    await appendAfter(notion, issueId, oldIds[oldIds.length - 1] || region.marker.id, blocks, stagedBlocks);
    // A collaborator may edit or bank a Piece while the request is reading the other five.
    // Verify the same server copy is still current before removing any existing issue copy.
    for (let index = 0; index < specs.length; index++) {
      const [id, type] = specs[index];
      const latest = await loadPiece(notion, id, type, issueId, config.piecesDatabaseId);
      if (JSON.stringify(latest) !== JSON.stringify(pieces[index])) {
        throw new IssueDraftError("A selected Piece changed in Notion. Refresh and review its current draft before saving.", 409);
      }
    }
    const guardedIssue = await activeIssue(notion, issueId, config.issuesDatabaseId);
    const guardedBlocks = await fetchTree(notion, issueId);
    const stagedSet = new Set(stagedBlocks.map((block) => block.id));
    if (issueDraftRevision(guardedBlocks.filter((block) => !stagedSet.has(block.id)), guardedIssue.properties) !== revision) {
      throw new IssueDraftError("The issue changed while the draft was being saved. Refresh and review before saving.", 409);
    }
    if (JSON.stringify(guardedBlocks.filter((block) => stagedSet.has(block.id)).map(canonicalBlock)) !== JSON.stringify(stagedBlocks.map(canonicalBlock))) {
      throw new IssueDraftError("The new draft was edited while saving. Review the issue before retrying.", 409);
    }
    archivesStarted = true;
    await parallelEach(oldIds, async (id) => { await notion.blocks.delete({ block_id: id }); });
    const oldSet = new Set(oldIds);
    const expectedFinalRevision = issueDraftRevision(guardedBlocks.filter((block) => !oldSet.has(block.id)), guardedIssue.properties);
    const precommitIssue = await activeIssue(notion, issueId, config.issuesDatabaseId);
    const precommit = await fetchTree(notion, issueId);
    if (issueDraftRevision(precommit, precommitIssue.properties) !== expectedFinalRevision) {
      throw new IssueDraftError("The issue changed before its draft could be committed. Refresh and review before saving.", 409);
    }
    const canonical: CompleteDraftLineup = { bigIdeaId: pieces[0].id, teamTakeIds: pieces.slice(1, 5).map((piece) => piece.id), fieldNoteId: pieces[5].id };
    const serialized = JSON.stringify(canonical);
    try {
      await notion.pages.update({ page_id: issueId, properties: { [DRAFT_LINEUP_PROPERTY]: { rich_text: text(serialized) } } });
      committed = true;
    } catch (error) {
      // A timed-out response can still have committed. Never roll back confirmed saved metadata.
      const readback = await notion.pages.retrieve({ page_id: issueId }).catch(() => null);
      if (readback && "properties" in readback && plain((readback.properties[DRAFT_LINEUP_PROPERTY] as any)?.rich_text) === serialized) committed = true;
      else if (!readback || !("properties" in readback)) {
        commitUncertain = true;
        throw new IssueDraftError("Notion did not confirm the final mapping. The assembled draft was retained; refresh and review the issue before retrying.", 503);
      } else throw error;
    }
    const finalIssue = await notion.pages.retrieve({ page_id: issueId });
    if (!("properties" in finalIssue)) throw new IssueDraftError("Draft saved. Refresh the mixer to load its current version.", 503);
    const saved = await readIssueDraftSnapshot(notion, finalIssue as IssuePage);
    return { issueId, lineup: canonical, revision: saved.revision, savedAt: new Date().toISOString() };
  } catch (error) {
    if (!committed && !commitUncertain && stagedBlocks.length) {
      let restored = true;
      if (archivesStarted) {
        try { await parallelEach(oldIds, async (id) => { await notion.blocks.update({ block_id: id, archived: false }); }); }
        catch { restored = false; }
      }
      // Keep human edits made to the new copy, even if another guard caused this save to abort.
      let stagedUnchanged = false;
      try {
        const latestBlocks = await fetchTree(notion, issueId);
        const stagedSet = new Set(stagedBlocks.map((block) => block.id));
        stagedUnchanged = JSON.stringify(latestBlocks.filter((block) => stagedSet.has(block.id)).map(canonicalBlock)) === JSON.stringify(stagedBlocks.map(canonicalBlock));
      } catch { /* An unreadable recovery copy must not be discarded. */ }
      if (!stagedUnchanged) throw new IssueDraftError("The new draft changed during saving. Both copies were retained for review; refresh the issue before retrying.", 503);
      // Keep the new draft as recovery copy if Notion cannot restore every old block.
      if (restored) {
        try { await parallelEach(stagedBlocks, async (block) => { await notion.blocks.delete({ block_id: block.id }); }); }
        catch { throw new IssueDraftError("Notion interrupted the save cleanup. Review the Newsletter draft section before retrying.", 503); }
      } else throw new IssueDraftError("Notion interrupted the save. Both draft copies were retained for recovery; review the issue before retrying.", 503);
    }
    throw error;
  } finally {
    savingIssues.delete(key);
  }
}
