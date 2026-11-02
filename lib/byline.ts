function comparableByline(value: string): string {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;|&#0*160;|&#x0*a0;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/^\s*by\s+/i, "")
    .replace(/[,\s]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** The preview supplies the byline; omit an exact leading echo from draft copy. */
export function stripLeadingByline(html: string, byline: string): string {
  if (!byline.trim()) return html;
  const first = /^\s*<p\b[^>]*>([\s\S]*?)<\/p>\s*/i.exec(html);
  if (!first || comparableByline(first[1]) !== comparableByline(byline)) return html;
  return html.slice(first[0].length);
}
