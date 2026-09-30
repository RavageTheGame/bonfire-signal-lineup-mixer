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

type NotionBlock = {
  id: string;
  type: string;
  has_children?: boolean;
  [key: string]: unknown;
};

const META_HEADINGS = new Set([
  "provenance",
  "sources notes",
  "source notes",
  "confidentiality",
  "notes to deb",
  "notes",
  "sources (for partner review)",
  "sources (from idea)",
  "confidentiality notes",
]);

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

function blockPlain(block: NotionBlock): string {
  const type = block.type;
  const data = block[type] as { rich_text?: RichText[] } | undefined;
  return (data?.rich_text || []).map((r) => r.plain_text || "").join("").trim();
}

function isMetaHeading(label: string): boolean {
  const norm = label.trim().toLowerCase();
  if (/^(option\s+[\da-z]+|draft body)$/i.test(norm)) return false;
  if (META_HEADINGS.has(norm)) return true;
  if (norm.startsWith("provenance")) return true;
  if (norm.includes("confidentiality")) return true;
  if (norm.includes("sources notes") || norm.includes("source notes")) return true;
  if (norm.startsWith("sources (")) return true;
  return false;
}

export function blocksToBodyHtml(blocks: NotionBlock[]): {
  bodyHtml: string;
  options: string[];
} {
  const options: string[] = [];
  const htmlParts: string[] = [];
  let skipUntilNextHeading = false;
  let inDraft = false;

  for (const block of blocks) {
    const type = block.type;
    const plain = blockPlain(block);

    if (type === "heading_1" || type === "heading_2" || type === "heading_3") {
      if (isMetaHeading(plain)) {
        skipUntilNextHeading = true;
        inDraft = false;
        continue;
      }
      skipUntilNextHeading = false;
      if (/^(option\s+[\da-z]+|draft body)$/i.test(plain)) {
        options.push(plain);
        inDraft = true;
        continue;
      }
      // Treat other headings as section breaks inside draft
      if (htmlParts.length) {
        // keep flowing as body content via bold line
        htmlParts.push(`<p><strong>${escapeHtml(plain)}</strong></p>`);
      }
      inDraft = true;
      continue;
    }

    if (skipUntilNextHeading && !inDraft) continue;

    // Before any draft heading, still capture top-level paragraphs as body
    // (some pieces put copy above Option headings)
    if (!inDraft && !htmlParts.length && type !== "paragraph" && type !== "quote") {
      continue;
    }

    const data = block[type] as { rich_text?: RichText[] } | undefined;
    const inner = richTextToHtml(data?.rich_text);

    if (!inner.trim() && type !== "divider") continue;

    switch (type) {
      case "paragraph":
        htmlParts.push(`<p>${inner}</p>`);
        break;
      case "quote":
        htmlParts.push(`<blockquote>${inner}</blockquote>`);
        break;
      case "bulleted_list_item":
        htmlParts.push(`<p>• ${inner}</p>`);
        break;
      case "numbered_list_item":
        htmlParts.push(`<p>${inner}</p>`);
        break;
      case "divider":
        break;
      default:
        if (inner.trim()) htmlParts.push(`<p>${inner}</p>`);
    }
  }

  return {
    bodyHtml: htmlParts.join("\n"),
    options,
  };
}
