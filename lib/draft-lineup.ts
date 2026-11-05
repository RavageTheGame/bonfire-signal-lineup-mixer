import type { PickerSelection } from "./picker-state";

export type DraftLineupDefinition = {
  bigIdeaId: string | null;
  teamTakeIds: string[];
  fieldNoteId: string | null;
};

const PIECE_ID = /^(?:[\da-f]{32}|[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12})$/i;

function isId(value: unknown): value is string {
  return typeof value === "string" && PIECE_ID.test(value);
}

function idKey(value: string): string {
  return value.replace(/-/g, "").toLowerCase();
}

/** The saved Issue mapping is explicit metadata, never inferred from article prose. */
export function parseDraftLineup(text: unknown): DraftLineupDefinition | null {
  if (typeof text !== "string" || !text.trim()) return null;
  try {
    const data: unknown = JSON.parse(text);
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    const value = data as Record<string, unknown>;
    if (Object.keys(value).sort().join(",") !== "bigIdeaId,fieldNoteId,teamTakeIds") return null;
    if (value.bigIdeaId !== null && !isId(value.bigIdeaId)) return null;
    if (value.fieldNoteId !== null && !isId(value.fieldNoteId)) return null;
    if (!Array.isArray(value.teamTakeIds) || value.teamTakeIds.length > 4 || !value.teamTakeIds.every(isId)) return null;
    return {
      bigIdeaId: value.bigIdeaId as string | null,
      teamTakeIds: [...value.teamTakeIds],
      fieldNoteId: value.fieldNoteId as string | null,
    };
  } catch {
    return null;
  }
}

export function readDraftLineupProperty(props: Record<string, any>, name: string): DraftLineupDefinition | null {
  const property = props[name];
  if (property?.type !== "rich_text" || !Array.isArray(property.rich_text)) return null;
  return parseDraftLineup(property.rich_text.map((part: { plain_text?: string }) => part.plain_text || "").join(""));
}

/** Resolve only against the current issue's actual Piece inventory. Invalid slots stay open. */
export function resolveDraftLineup<T extends { id: string; type: string; partner: string; hasBody?: boolean }>(
  definition: DraftLineupDefinition | null,
  currentPieces: T[],
  isAvailable: (piece: T) => boolean,
): PickerSelection | null {
  if (!definition) return null;
  const pieces = new Map(currentPieces.filter((piece) => isAvailable(piece) && piece.hasBody !== false)
    .map((piece) => [idKey(piece.id), piece]));
  const find = (id: string | null, type: string) => {
    const piece = id ? pieces.get(idKey(id)) : undefined;
    return piece?.type === type ? piece : null;
  };
  const voices = new Set<string>();
  const team: string[] = [];
  for (const id of definition.teamTakeIds) {
    const piece = find(id, "Team take");
    if (!piece || !piece.partner || ["TBD", "Anonymous"].includes(piece.partner) || voices.has(piece.partner)) continue;
    voices.add(piece.partner);
    team.push(piece.id);
  }
  return {
    view: find(definition.bigIdeaId, "Big Idea")?.id || null,
    team,
    field: find(definition.fieldNoteId, "Field Notes")?.id || null,
  };
}
