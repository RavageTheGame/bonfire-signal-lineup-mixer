/**
 * Locate the Draft body / Option section on a Piece page and replace its
 * children with mixer-edited HTML — Sources / Confidentiality stay untouched.
 */

import type { Client } from "@notionhq/client";
import type { NotionBlock } from "./blocks-to-html";
import { htmlToNotionBlocks, type NotionAppendBlock } from "./html-notion";
import { isBodySection, isStopSection } from "./piece-schema";

export type BodyWriteTarget = {
  /** Block (or page) id that should own the draft paragraphs. */
  parentId: string;
  /** Existing body blocks to archive before appending the new draft. */
  replaceIds: string[];
  sectionLabel: string | null;
  /** True when we had to create a new Draft body toggle heading. */
  createdSection?: boolean;
};

function blockPlain(block: NotionBlock): string {
  const type = block.type;
  const data = (block[type] as { rich_text?: { plain_text?: string }[] }) || {};
  return (data.rich_text || [])
    .map((r) => r.plain_text || "")
    .join("")
    .trim();
}

function isHeading(type: string): boolean {
  return type === "heading_1" || type === "heading_2" || type === "heading_3";
}

function collectContentIds(blocks: NotionBlock[]): string[] {
  const ids: string[] = [];
  const walk = (list: NotionBlock[]) => {
    for (const block of list) {
      const type = block.type;
      if (type === "paragraph" || type === "quote" || type === "bulleted_list_item" || type === "numbered_list_item") {
        ids.push(block.id);
      } else if (isHeading(type) || type === "toggle") {
        const label = blockPlain(block);
        // Nested body/stop labels are structural — keep them, only replace leaf copy under current section
        if (label && (isBodySection(label) || isStopSection(label))) continue;
        // Non-section heading used as a bold line in the draft — replace it too
        ids.push(block.id);
      }
      if (Array.isArray(block.children) && block.children.length) walk(block.children);
    }
  };
  walk(blocks);
  return ids;
}

function preferSectionLabel(options: string[], preferred?: string | null): string | null {
  if (preferred && options.some((o) => o.toLowerCase() === preferred.toLowerCase())) {
    return options.find((o) => o.toLowerCase() === preferred.toLowerCase()) || preferred;
  }
  const draft = options.find((o) => /^draft body$/i.test(o));
  if (draft) return draft;
  return options[0] || null;
}

/**
 * Find where mixer edits should land. Prefers Draft body, then Option N,
 * then legacy top-level paragraphs before the first stop section.
 */
export function locateBodyWriteTarget(
  blocks: NotionBlock[],
  pageId: string,
  preferredLabel?: string | null,
): BodyWriteTarget | null {
  const sectionHits: { label: string; block: NotionBlock }[] = [];

  const scan = (list: NotionBlock[]) => {
    for (const block of list) {
      const type = block.type;
      if (isHeading(type) || type === "toggle") {
        const label = blockPlain(block);
        if (label && isBodySection(label)) {
          sectionHits.push({ label, block });
        }
      }
      if (Array.isArray(block.children) && block.children.length) scan(block.children);
    }
  };
  scan(blocks);

  const labels = sectionHits.map((h) => h.label);
  const chosenLabel = preferSectionLabel(labels, preferredLabel);
  if (chosenLabel) {
    const hit = sectionHits.find((h) => h.label === chosenLabel)!;
    const children = Array.isArray(hit.block.children) ? hit.block.children : [];
    return {
      parentId: hit.block.id,
      replaceIds: collectContentIds(children),
      sectionLabel: hit.label,
    };
  }

  // Legacy: top-level paragraphs until a stop/body heading
  const replaceIds: string[] = [];
  for (const block of blocks) {
    const type = block.type;
    const plain = blockPlain(block);
    if ((isHeading(type) || type === "toggle") && plain && (isStopSection(plain) || isBodySection(plain))) {
      break;
    }
    if (type === "paragraph" || type === "quote" || type === "bulleted_list_item" || type === "numbered_list_item") {
      replaceIds.push(block.id);
    }
  }

  if (!replaceIds.length) return null;

  return {
    parentId: pageId,
    replaceIds,
    sectionLabel: null,
  };
}

async function archiveBlocks(notion: Client, ids: string[]): Promise<void> {
  // Notion archives one block at a time; keep concurrency modest.
  const queue = [...ids];
  const workers = Array.from({ length: Math.min(4, queue.length || 1) }, async () => {
    while (queue.length) {
      const id = queue.shift();
      if (!id) return;
      try {
        await notion.blocks.delete({ block_id: id });
      } catch {
        // Block may already be gone / no permission — continue
      }
    }
  });
  await Promise.all(workers);
}

async function appendBlocks(notion: Client, parentId: string, children: NotionAppendBlock[]): Promise<void> {
  // Notion allows max 100 children per append
  for (let i = 0; i < children.length; i += 100) {
    const chunk = children.slice(i, i + 100);
    await notion.blocks.children.append({
      block_id: parentId,
      children: chunk as any,
    });
  }
}

async function ensureDraftBodySection(
  notion: Client,
  pageId: string,
): Promise<BodyWriteTarget> {
  const created = await notion.blocks.children.append({
    block_id: pageId,
    children: [
      {
        object: "block",
        type: "heading_2",
        heading_2: {
          rich_text: [{ type: "text", text: { content: "Draft body" } }],
          is_toggleable: true,
          color: "default",
        },
      },
    ] as any,
  });
  const section = created.results[0] as { id: string };
  return {
    parentId: section.id,
    replaceIds: [],
    sectionLabel: "Draft body",
    createdSection: true,
  };
}

export type UpdatePieceBodyResult = {
  bodyHtml: string;
  sectionLabel: string | null;
  createdSection: boolean;
  replacedCount: number;
  optionBodies: { label: string; bodyHtml: string }[];
};

/**
 * Replace the Piece's draft body in Notion with mixer HTML.
 * Leaves Sources / Confidentiality / Provenance alone.
 */
export async function updatePieceBodyInNotion(
  notion: Client,
  pageId: string,
  bodyHtml: string,
  opts?: {
    preferredSection?: string | null;
    /** Pre-fetched block tree (with children expanded). */
    blocks?: NotionBlock[];
    fetchBlockTree: (rootId: string) => Promise<NotionBlock[]>;
    blocksToBodyHtml: (
      blocks: NotionBlock[],
      opts?: { title?: string },
    ) => {
      bodyHtml: string;
      options: string[];
      optionBodies: { label: string; bodyHtml: string }[];
    };
    title?: string;
  },
): Promise<UpdatePieceBodyResult> {
  const blocks = opts?.blocks || (await opts!.fetchBlockTree(pageId));
  let target = locateBodyWriteTarget(blocks, pageId, opts?.preferredSection);
  let createdSection = false;

  if (!target) {
    target = await ensureDraftBodySection(notion, pageId);
    createdSection = true;
  }

  const notionBlocks = htmlToNotionBlocks(bodyHtml);
  if (!notionBlocks.length) {
    await archiveBlocks(notion, target.replaceIds);
  } else {
    await archiveBlocks(notion, target.replaceIds);
    await appendBlocks(notion, target.parentId, notionBlocks);
  }

  const refreshed = await opts!.fetchBlockTree(pageId);
  const extracted = opts!.blocksToBodyHtml(refreshed, { title: opts?.title });
  const savedLabel = target.sectionLabel;
  const savedBody =
    (savedLabel &&
      extracted.optionBodies.find((o) => o.label.toLowerCase() === savedLabel.toLowerCase())
        ?.bodyHtml) ||
    bodyHtml;

  return {
    bodyHtml: savedBody,
    sectionLabel: savedLabel,
    createdSection: createdSection || Boolean(target.createdSection),
    replacedCount: target.replaceIds.length,
    optionBodies: extracted.optionBodies,
  };
}
