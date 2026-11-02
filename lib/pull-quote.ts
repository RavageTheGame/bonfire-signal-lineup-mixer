/** Plain text stored separately from the editable draft body in Notion. */
export function readPullQuoteProperty(
  props: Record<string, any>,
  propertyName: string,
): string {
  const property = props[propertyName];
  if (property?.type !== "rich_text" || !Array.isArray(property.rich_text)) return "";
  return property.rich_text
    .map((part: { plain_text?: string }) => part.plain_text || "")
    .join("")
    .trim();
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const TEXT_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  ensp: " ", emsp: " ", thinsp: " ", ndash: "–", mdash: "—",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", hellip: "…",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, key: string) => {
    if (key.startsWith("#")) {
      const hexadecimal = key[1]?.toLowerCase() === "x";
      const point = Number.parseInt(key.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
      return point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
    }
    return TEXT_ENTITIES[key.toLowerCase()] ?? entity;
  });
}

function normalizedText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Match current prose, allowing inline formatting but never joining distinct blocks. */
function containsExcerpt(bodyHtml: string, quote: string): boolean {
  const excerpt = normalizedText(quote);
  return bodyHtml
    .replace(/<!--[\s\S]*?-->/g, "")
    .split(/<\/?(?:p|div|blockquote|li|h[1-6]|hr)\b[^>]*>/gi)
    .some((block) => {
      const text = block.replace(/<br\b[^>]*>/gi, " ").replace(/<[^>]*>/g, "");
      return normalizedText(decodeEntities(text)).includes(excerpt);
    });
}

/** Presentation only. Never use this HTML to seed the editor or save a body. */
export function withPullQuote(
  bodyHtml: string,
  pullQuote: string | undefined,
  sectionLabel: string,
  optionCount: number,
): string {
  const quote = pullQuote?.trim();
  if (!quote || !bodyHtml.trim()) return bodyHtml;
  // A Piece-level quote belongs to the canonical draft, not an alternate option.
  if (optionCount > 1 && !/^draft body$/i.test(sectionLabel.trim())) return bodyHtml;
  // Human edits can retire an excerpt. Preserve metadata, but hide stale display copy.
  if (!containsExcerpt(bodyHtml, quote)) return bodyHtml;

  const quoteHtml = `<blockquote class="pull-quote">${escapeHtml(quote)}</blockquote>`;
  const paragraphEnds = [...bodyHtml.matchAll(/<\/p>/gi)];
  if (!paragraphEnds.length) return bodyHtml;
  const anchor = paragraphEnds[Math.min(1, paragraphEnds.length - 1)];
  const insertAt = (anchor.index ?? 0) + anchor[0].length;
  return `${bodyHtml.slice(0, insertAt)}\n${quoteHtml}${bodyHtml.slice(insertAt)}`;
}
