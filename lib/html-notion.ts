/**
 * Convert mixer body HTML ↔ Notion paragraph blocks.
 * Supports the subset we emit from blocks-to-html: p, strong/em/u/s, a, blockquote, bullets.
 */

export type NotionRichText = {
  type: "text";
  text: { content: string; link?: { url: string } | null };
  annotations?: {
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    strikethrough?: boolean;
    code?: boolean;
  };
};

export type NotionAppendBlock =
  | {
      object: "block";
      type: "paragraph";
      paragraph: { rich_text: NotionRichText[] };
    }
  | {
      object: "block";
      type: "quote";
      quote: { rich_text: NotionRichText[] };
    }
  | {
      object: "block";
      type: "bulleted_list_item";
      bulleted_list_item: { rich_text: NotionRichText[] };
    };

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function pushText(
  out: NotionRichText[],
  content: string,
  annotations: NotionRichText["annotations"] = {},
  href?: string | null,
) {
  const cleaned = decodeEntities(content);
  if (!cleaned) return;
  // Notion caps a single rich_text item at 2000 chars
  let remaining = cleaned;
  while (remaining.length) {
    const chunk = remaining.slice(0, 2000);
    remaining = remaining.slice(2000);
    out.push({
      type: "text",
      text: href ? { content: chunk, link: { url: href } } : { content: chunk },
      annotations: {
        bold: Boolean(annotations.bold),
        italic: Boolean(annotations.italic),
        underline: Boolean(annotations.underline),
        strikethrough: Boolean(annotations.strikethrough),
        code: Boolean(annotations.code),
      },
    });
  }
}

type ParseState = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  code?: boolean;
  href?: string | null;
};

function htmlFragmentToRichText(html: string): NotionRichText[] {
  const out: NotionRichText[] = [];
  const tagRe = /<\/?([a-z0-9]+)(\s[^>]*)?>/gi;
  let last = 0;
  const stack: ParseState[] = [{}];

  const current = () => stack[stack.length - 1] || {};

  const flushText = (end: number) => {
    if (end <= last) return;
    const text = html.slice(last, end);
    if (!text) return;
    // Drop pure whitespace-only runs that are just indentation between tags,
    // but keep intentional spaces inside copy.
    pushText(out, text, current(), current().href);
  };

  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(html))) {
    flushText(match.index);
    const raw = match[0];
    const name = (match[1] || "").toLowerCase();
    const closing = raw.startsWith("</");
    const selfClosing = /\/\s*>$/.test(raw) || name === "br";

    if (name === "br") {
      pushText(out, "\n", current(), current().href);
      last = match.index + raw.length;
      continue;
    }

    if (closing) {
      if (stack.length > 1) stack.pop();
      last = match.index + raw.length;
      continue;
    }

    if (selfClosing) {
      last = match.index + raw.length;
      continue;
    }

    const next: ParseState = { ...current() };
    if (name === "strong" || name === "b") next.bold = true;
    if (name === "em" || name === "i") next.italic = true;
    if (name === "u") next.underline = true;
    if (name === "s" || name === "strike" || name === "del") next.strikethrough = true;
    if (name === "code") next.code = true;
    if (name === "a") {
      const hrefMatch = raw.match(/\bhref\s*=\s*"([^"]*)"/i) || raw.match(/\bhref\s*=\s*'([^']*)'/i);
      next.href = hrefMatch?.[1] || null;
    }
    stack.push(next);
    last = match.index + raw.length;
  }
  flushText(html.length);

  // Notion rejects empty rich_text arrays on some block types — keep at least one empty text if needed by caller.
  return out.filter((item) => item.text.content.length > 0);
}

function splitTopLevelBlocks(html: string): { kind: "p" | "quote" | "bullet"; inner: string }[] {
  const trimmed = html.trim();
  if (!trimmed) return [];

  const blocks: { kind: "p" | "quote" | "bullet"; inner: string }[] = [];
  const re = /<(p|blockquote|li)(\s[^>]*)?>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;
  let found = false;
  while ((match = re.exec(trimmed))) {
    found = true;
    const tag = match[1].toLowerCase();
    const inner = match[3] || "";
    if (tag === "blockquote") blocks.push({ kind: "quote", inner });
    else if (tag === "li") blocks.push({ kind: "bullet", inner });
    else blocks.push({ kind: "p", inner });
  }

  if (!found) {
    // Plain text / contentEditable may yield text without wrappers
    const parts = trimmed
      .replace(/<div(\s[^>]*)?>/gi, "\n")
      .replace(/<\/div>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .split(/\n{2,}/)
      .map((p) => p.replace(/\n/g, " ").trim())
      .filter(Boolean);
    for (const part of parts) {
      blocks.push({ kind: "p", inner: part });
    }
  }

  return blocks;
}

/** Turn mixer body HTML into Notion appendable blocks. */
export function htmlToNotionBlocks(html: string): NotionAppendBlock[] {
  const parts = splitTopLevelBlocks(html);
  const blocks: NotionAppendBlock[] = [];

  for (const part of parts) {
    let kind = part.kind;
    let inner = part.inner;

    // Our email renderer emits bullets as `<p>• …</p>` — round-trip those.
    if (kind === "p") {
      const plain = inner.replace(/<[^>]+>/g, "").trim();
      if (/^•\s+/.test(plain) || /^•\s+/.test(inner.trim())) {
        kind = "bullet";
        inner = inner.replace(/^\s*•\s+/, "").replace(/(>)\s*•\s+/, "$1");
      }
    }

    let rich = htmlFragmentToRichText(inner);
    // Bullets often start with "• " from our renderer — strip when round-tripping
    if (kind === "bullet" && rich[0]?.text.content.startsWith("• ")) {
      rich = [
        { ...rich[0], text: { ...rich[0].text, content: rich[0].text.content.slice(2) } },
        ...rich.slice(1),
      ];
    }
    if (!rich.length) {
      rich = [{ type: "text", text: { content: "" } }];
    }

    if (kind === "quote") {
      blocks.push({ object: "block", type: "quote", quote: { rich_text: rich } });
    } else if (kind === "bullet") {
      blocks.push({
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: rich },
      });
    } else {
      blocks.push({ object: "block", type: "paragraph", paragraph: { rich_text: rich } });
    }
  }

  return blocks;
}

/** Normalize contentEditable HTML into the same `<p>…</p>` shape we render. */
export function normalizeEditorHtml(raw: string): string {
  const trimmed = (raw || "").trim();
  if (!trimmed) return "";

  // contentEditable in Chrome often uses <div> lines
  if (!/<(p|blockquote|li)\b/i.test(trimmed)) {
    const lines = trimmed
      .replace(/<\/div>/gi, "\n")
      .replace(/<div(\s[^>]*)?>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);
    return lines.map((line) => `<p>${line}</p>`).join("\n");
  }

  return splitTopLevelBlocks(trimmed)
    .map((part) => {
      if (part.kind === "quote") return `<blockquote>${part.inner}</blockquote>`;
      if (part.kind === "bullet") {
        const inner = part.inner.replace(/^•\s*/, "");
        return `<p>• ${inner}</p>`;
      }
      return `<p>${part.inner}</p>`;
    })
    .join("\n");
}
