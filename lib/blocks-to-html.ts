import { isBodySection, isStopSection } from "./piece-schema";

type RichText = {
  plain_text?: string;
  href?: string | null;
  annotations?: {
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    strikethrough?: boolean;
    code?: boolean;
  };
};

export type NotionBlock = {
  id: string;
  type: string;
  has_children?: boolean;
  children?: NotionBlock[];
  [key: string]: unknown;
};

export type BodyExtractOptions = {
  /** Piece title — used to drop the bold title echo inside Draft body. */
  title?: string;
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function richTextToHtml(items: RichText[] | undefined): string {
  if (!items?.length) return "";
  return items
    .map((item) => {
      let text = escapeHtml(item.plain_text || "");
      const a = item.annotations || {};
      if (a.code) text = `<code>${text}</code>`;
      if (a.bold) text = `<strong>${text}</strong>`;
      if (a.italic) text = `<em>${text}</em>`;
      if (a.underline) text = `<u>${text}</u>`;
      if (a.strikethrough) text = `<s>${text}</s>`;
      if (item.href) text = `<a href="${escapeHtml(item.href)}">${text}</a>`;
      return text;
    })
    .join("");
}

function blockData(block: NotionBlock): { rich_text?: RichText[]; is_toggleable?: boolean } {
  const type = block.type;
  return (block[type] as { rich_text?: RichText[]; is_toggleable?: boolean }) || {};
}

function blockPlain(block: NotionBlock): string {
  return (blockData(block).rich_text || [])
    .map((r) => r.plain_text || "")
    .join("")
    .trim();
}

function normalizeComparable(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function isTitleEcho(html: string, title: string | undefined): boolean {
  if (!title?.trim()) return false;
  const plain = normalizeComparable(html);
  const want = normalizeComparable(title);
  if (!plain || !want) return false;
  // Exact match, or a single bold wrapper around the title
  if (plain === want) return true;
  // "**Title**" only — no extra sentence
  if (plain.length <= want.length + 4 && plain.includes(want)) {
    const stripped = html.replace(/<\/?strong>/gi, "").replace(/<\/?p>/gi, "").trim();
    return normalizeComparable(stripped) === want;
  }
  return false;
}

function isHeading(type: string): boolean {
  return type === "heading_1" || type === "heading_2" || type === "heading_3";
}

function renderLeaf(block: NotionBlock): string | null {
  const type = block.type;
  const data = blockData(block);
  const inner = richTextToHtml(data.rich_text);

  if (!inner.trim() && type !== "divider") return null;

  switch (type) {
    case "paragraph":
      return `<p>${inner}</p>`;
    case "quote":
      return `<blockquote>${inner}</blockquote>`;
    case "bulleted_list_item":
      return `<p>• ${inner}</p>`;
    case "numbered_list_item":
      return `<p>${inner}</p>`;
    case "callout":
      return null; // editorial chrome, not email body
    case "divider":
      return null;
    case "toggle":
      // Toggle summary is not body; children handled by walker
      return null;
    default:
      if (isHeading(type)) return null;
      return inner.trim() ? `<p>${inner}</p>` : null;
  }
}

/**
 * Convert a Notion block tree into email-preview HTML.
 * Prefers Draft body / Option N sections; drops Sources / Confidentiality / etc.
 */
export function blocksToBodyHtml(
  blocks: NotionBlock[],
  opts: BodyExtractOptions = {},
): {
  bodyHtml: string;
  options: string[];
} {
  const options: string[] = [];
  const htmlParts: string[] = [];
  let skipMeta = false;
  let inBodySection = false;
  let sawBodySectionLabel = false;
  let titleEchoPending = Boolean(opts.title?.trim());

  const pushHtml = (html: string | null) => {
    if (!html?.trim()) return;
    if (titleEchoPending && isTitleEcho(html, opts.title)) {
      titleEchoPending = false;
      return;
    }
    titleEchoPending = false;
    htmlParts.push(html);
  };

  const walk = (list: NotionBlock[], depth: number) => {
    for (const block of list) {
      const type = block.type;
      const plain = blockPlain(block);
      const children = Array.isArray(block.children) ? block.children : [];
      const data = blockData(block);
      const toggleableHeading = isHeading(type) && Boolean(data.is_toggleable || block.has_children);

      if (isHeading(type) || type === "toggle") {
        const label = plain || (type === "toggle" ? blockPlain(block) : "");

        if (label && isStopSection(label)) {
          skipMeta = true;
          inBodySection = false;
          // Do not descend into meta toggles
          continue;
        }

        if (label && isBodySection(label)) {
          skipMeta = false;
          inBodySection = true;
          sawBodySectionLabel = true;
          options.push(label);
          if (children.length) walk(children, depth + 1);
          continue;
        }

        if (skipMeta) {
          // Still allow a later Draft body / Option section
          continue;
        }

        // Non-labeled heading inside an active body section → bold line, then kids
        if (inBodySection && label) {
          pushHtml(`<p><strong>${escapeHtml(label)}</strong></p>`);
          if (children.length) walk(children, depth + 1);
          continue;
        }

        // Toggle without a recognized label: if it has paragraph children and we
        // haven't entered a body section yet, treat as body when it's the only content.
        if (type === "toggle" || toggleableHeading) {
          if (children.length) walk(children, depth + 1);
          continue;
        }

        // Plain heading before any body section — ignore as chrome
        continue;
      }

      if (skipMeta && !inBodySection) continue;

      // Before the first Draft body / Option label, only keep top-level paragraphs
      // when the page has no labeled body section at all (legacy layout).
      if (!inBodySection && sawBodySectionLabel) continue;

      if (!inBodySection && !sawBodySectionLabel) {
        if (type !== "paragraph" && type !== "quote" && type !== "bulleted_list_item" && type !== "numbered_list_item") {
          if (children.length) walk(children, depth + 1);
          continue;
        }
      }

      pushHtml(renderLeaf(block));
      if (children.length) walk(children, depth + 1);
    }
  };

  walk(blocks, 0);

  // Second pass: if we only captured chrome because body was nested and unlabeled,
  // htmlParts may still be empty while options listed sections — already handled
  // by walking children of body sections.

  return {
    bodyHtml: htmlParts.join("\n"),
    options,
  };
}
