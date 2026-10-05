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

export type OptionBody = {
  label: string;
  bodyHtml: string;
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
  if (plain === want) return true;
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
      return null;
    case "divider":
      return null;
    case "toggle":
      return null;
    default:
      if (isHeading(type)) return null;
      return inner.trim() ? `<p>${inner}</p>` : null;
  }
}

function preferDefaultOption(options: OptionBody[]): OptionBody | null {
  if (!options.length) return null;
  const draft = options.find((o) => /^draft body$/i.test(o.label));
  if (draft?.bodyHtml.trim()) return draft;
  const withCopy = options.find((o) => o.bodyHtml.trim());
  return withCopy || options[0];
}

/**
 * Convert a Notion block tree into email-preview HTML.
 * Prefers Draft body / Option N sections; drops Sources / Confidentiality / etc.
 * When multiple Option / Draft body sections exist, each is kept separately so
 * the mixer can toggle between them.
 */
export function blocksToBodyHtml(
  blocks: NotionBlock[],
  opts: BodyExtractOptions = {},
): {
  bodyHtml: string;
  options: string[];
  optionBodies: OptionBody[];
} {
  const optionBodies: OptionBody[] = [];
  const legacyParts: string[] = [];
  let skipMeta = false;
  let sawBodySectionLabel = false;
  let activeOption: { label: string; parts: string[]; titleEchoPending: boolean } | null = null;

  const pushTo = (
    target: { parts: string[]; titleEchoPending: boolean },
    html: string | null,
  ) => {
    if (!html?.trim()) return;
    if (target.titleEchoPending && isTitleEcho(html, opts.title)) {
      target.titleEchoPending = false;
      return;
    }
    target.titleEchoPending = false;
    target.parts.push(html);
  };

  const flushActive = () => {
    if (!activeOption) return;
    optionBodies.push({
      label: activeOption.label,
      bodyHtml: activeOption.parts.join("\n"),
    });
    activeOption = null;
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
          flushActive();
          skipMeta = true;
          continue;
        }

        if (label && isBodySection(label)) {
          flushActive();
          skipMeta = false;
          sawBodySectionLabel = true;
          activeOption = {
            label,
            parts: [],
            titleEchoPending: Boolean(opts.title?.trim()),
          };
          if (children.length) walk(children, depth + 1);
          // End this section after walking its children (toggle/heading children)
          // Sibling content after a non-toggle heading is handled while activeOption stays set
          // until the next body/stop heading — but for toggleables we already consumed kids.
          if (children.length && (type === "toggle" || data.is_toggleable || block.has_children)) {
            flushActive();
          }
          continue;
        }

        if (skipMeta) continue;

        if (activeOption && label) {
          pushTo(activeOption, `<p><strong>${escapeHtml(label)}</strong></p>`);
          if (children.length) walk(children, depth + 1);
          continue;
        }

        if (type === "toggle" || toggleableHeading) {
          if (children.length) walk(children, depth + 1);
          continue;
        }

        continue;
      }

      if (skipMeta && !activeOption) continue;

      if (!activeOption && sawBodySectionLabel) continue;

      if (!activeOption && !sawBodySectionLabel) {
        if (
          type !== "paragraph" &&
          type !== "quote" &&
          type !== "bulleted_list_item" &&
          type !== "numbered_list_item"
        ) {
          if (children.length) walk(children, depth + 1);
          continue;
        }
        const leaf = renderLeaf(block);
        if (leaf?.trim()) {
          // Title echo strip for legacy top-level
          if (opts.title && isTitleEcho(leaf, opts.title) && !legacyParts.length) {
            // skip
          } else {
            legacyParts.push(leaf);
          }
        }
        if (children.length) walk(children, depth + 1);
        continue;
      }

      if (activeOption) {
        pushTo(activeOption, renderLeaf(block));
        if (children.length) walk(children, depth + 1);
      }
    }
  };

  walk(blocks, 0);
  flushActive();

  if (!optionBodies.length && legacyParts.length) {
    optionBodies.push({ label: "Draft", bodyHtml: legacyParts.join("\n") });
  }

  const preferred = preferDefaultOption(optionBodies);
  return {
    bodyHtml: preferred?.bodyHtml || "",
    options: optionBodies.map((o) => o.label),
    optionBodies,
  };
}
