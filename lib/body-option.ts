/** Match the server's default body: a nonempty Draft body, then the first saved option. */
export function canonicalBodyOption<T extends { label: string; bodyHtml: string }>(options: readonly T[]): T | undefined {
  return options.find((option) => /^draft body$/i.test(option.label) && option.bodyHtml.trim())
    || options.find((option) => option.bodyHtml.trim());
}
