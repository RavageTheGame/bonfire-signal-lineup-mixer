/**
 * Adaptable Signal Pieces mapping for the lineup mixer.
 *
 * When Notion property names or page-body section labels change, update this
 * file first — extraction and People → byline mapping read from here.
 */

/** Database property names (case-sensitive Notion names). */
export const PIECE_PROPS = {
  title: "Name",
  type: "Type",
  status: "Status",
  /** Current person property (replaces legacy Partner select). */
  people: "People",
  /** Legacy fallback if a workspace still has the select. */
  partnerLegacy: "Partner",
  relatedIssue: ["Related Issue", "Related Issue 1"],
} as const;

/**
 * Body copy lives in the page editor under these section labels
 * (heading or toggle heading). Not a database property — richer formatting,
 * and section renames only need a regex tweak here.
 */
export const BODY_SECTION_RE = /^(option\s+[\da-z]+|draft body)$/i;

/**
 * Stop collecting body when these headings/toggles appear.
 * Keep in sync with editorial templates (Sources, Confidentiality, etc.).
 */
export const STOP_SECTION_LABELS = [
  "provenance",
  "sources",
  "sources notes",
  "source notes",
  "confidentiality",
  "confidentiality notes",
  "notes to deb",
  "notes",
  "sources (for partner review)",
  "sources (from idea)",
] as const;

export function isStopSection(label: string): boolean {
  const norm = label.trim().toLowerCase().replace(/[:：]\s*$/, "");
  if ((STOP_SECTION_LABELS as readonly string[]).includes(norm)) return true;
  if (norm.startsWith("provenance")) return true;
  if (norm.includes("confidentiality")) return true;
  if (norm.includes("sources notes") || norm.includes("source notes")) return true;
  if (norm === "sources" || norm.startsWith("sources (")) return true;
  return false;
}

export function isBodySection(label: string): boolean {
  return BODY_SECTION_RE.test(label.trim());
}

/**
 * Map Notion People display names → short keys used by the mixer byline table.
 * Prefer firm identities when duplicates exist (e.g. Brett personal vs work).
 */
const PEOPLE_NAME_TO_KEY: Record<string, string> = {
  "brett queener": "Brett",
  "tyler churchill": "Tyler",
  "jim andelman": "Jim",
  "mark mullen": "Mark",
  "jennifer richard": "Jen",
  "jen richard": "Jen",
  "jason tahir": "Jason",
  "dominique yadegar": "Dominique",
  "dominique": "Dominique",
  "loren shepard": "Loren",
  "loren": "Loren",
  "brian macinnes": "Brian",
  "brian": "Brian",
  "deb": "Deb",
  "deb goldstein": "Deb",
};

/** First-name aliases when only the given name is present. */
const FIRST_NAME_ALIASES: Record<string, string> = {
  jennifer: "Jen",
  jen: "Jen",
  brett: "Brett",
  tyler: "Tyler",
  jim: "Jim",
  mark: "Mark",
  jason: "Jason",
  dominique: "Dominique",
  loren: "Loren",
  brian: "Brian",
  deb: "Deb",
};

export function peopleNameToPartnerKey(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (!trimmed) return "TBD";
  const lower = trimmed.toLowerCase();
  if (PEOPLE_NAME_TO_KEY[lower]) return PEOPLE_NAME_TO_KEY[lower];
  const first = lower.split(" ")[0] || "";
  if (FIRST_NAME_ALIASES[first]) return FIRST_NAME_ALIASES[first];
  // Title-case first token as a soft fallback (new teammates)
  const rawFirst = trimmed.split(/\s+/)[0] || "TBD";
  return rawFirst.charAt(0).toUpperCase() + rawFirst.slice(1);
}
