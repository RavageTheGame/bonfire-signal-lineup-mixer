import type { Piece, SignalIssue } from "./types";

export const MIXER_SLOTS = [
  { key: "view", name: "Bonfire View", title: "The Bonfire View", type: "Big Idea" },
  { key: "team1", name: "Team take 1", title: "Team take 1", type: "Team take" },
  { key: "team2", name: "Team take 2", title: "Team take 2", type: "Team take" },
  { key: "team3", name: "Team take 3", title: "Team take 3", type: "Team take" },
  { key: "team4", name: "Team take 4", title: "Team take 4", type: "Team take" },
  { key: "field", name: "Field Notes", title: "Field Notes from the Portfolio", type: "Field Notes" },
] as const;

export type SlotKey = (typeof MIXER_SLOTS)[number]["key"];
export type LineupState = Record<SlotKey, string | null>;

export function emptyLineup(): LineupState {
  return { view: null, team1: null, team2: null, team3: null, team4: null, field: null };
}

export function slotForPiece(piece: Pick<Piece, "mixerSlot" | "type">) {
  return MIXER_SLOTS.find((slot) => slot.name === piece.mixerSlot && slot.type === piece.type);
}

function dateKey(value: string | null | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value)) return null;
  const key = value.slice(0, 10);
  const parsed = new Date(`${key}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === key ? key : null;
}

export function validSourceWindow(issue: SignalIssue): boolean {
  const start = dateKey(issue.sourceStart);
  const end = dateKey(issue.sourceEnd);
  return Boolean(start && end && start <= end);
}

export function eligibleForIssue(piece: Piece, issue: SignalIssue): boolean {
  if (!validSourceWindow(issue)) return false;
  if (!piece.issueId || piece.issueId.replace(/-/g, "") !== issue.id.replace(/-/g, "")) return false;
  const source = dateKey(piece.sourceDate);
  if (!source || source < dateKey(issue.sourceStart)! || source > dateKey(issue.sourceEnd)!) return false;
  if (!slotForPiece(piece)) return false;
  if (!Number.isInteger(piece.candidateRank) || piece.candidateRank! < 1 || piece.candidateRank! > 3) return false;
  if (/^(archived|sent|published|ruled out|rejected|parked)$/i.test(piece.status)) return false;
  return piece.hasBody;
}

export function compareCandidates(a: Piece, b: Piece): number {
  return (a.candidateRank ?? 99) - (b.candidateRank ?? 99)
    || Number(Boolean(b.recommended)) - Number(Boolean(a.recommended))
    || a.title.localeCompare(b.title)
    || a.id.localeCompare(b.id);
}

/** Limit alternatives per slot, never by created/edited time or a stale issue label. */
export function currentCandidates(pieces: Piece[], issue: SignalIssue | null): Piece[] {
  if (!issue) return [];
  const eligible = pieces.filter((piece) => eligibleForIssue(piece, issue)).sort(compareCandidates);
  return MIXER_SLOTS.flatMap((slot) => {
    const seen = new Set<string>();
    return eligible.filter((piece) => {
      if (slotForPiece(piece)?.key !== slot.key || seen.has(piece.id)) return false;
      seen.add(piece.id);
      return true;
    }).slice(0, 3);
  });
}

/** A partial draft stays partial if a slot or a fourth distinct team voice is missing. */
export function recommendedLineup(pieces: Piece[]): LineupState {
  const lineup = emptyLineup();
  const voices = new Set<string>();
  for (const slot of MIXER_SLOTS) {
    const options = pieces.filter((piece) => slotForPiece(piece)?.key === slot.key).sort(compareCandidates);
    const selected = options.find((piece) => slot.type !== "Team take"
      || (piece.partner !== "TBD" && piece.partner !== "Anonymous" && !voices.has(piece.partner)));
    if (!selected) continue;
    lineup[slot.key] = selected.id;
    if (slot.type === "Team take") voices.add(selected.partner);
  }
  return lineup;
}

export function cleanLineup(saved: unknown, pieces: Piece[]): LineupState {
  const lineup = emptyLineup();
  if (!saved || typeof saved !== "object") return lineup;
  const voices = new Set<string>();
  for (const slot of MIXER_SLOTS) {
    const id = (saved as Record<string, unknown>)[slot.key];
    const piece = pieces.find((item) => item.id === id && slotForPiece(item)?.key === slot.key);
    if (!piece) continue;
    if (slot.type === "Team take") {
      if (piece.partner === "TBD" || piece.partner === "Anonymous" || voices.has(piece.partner)) continue;
      voices.add(piece.partner);
    }
    lineup[slot.key] = piece.id;
  }
  return lineup;
}
