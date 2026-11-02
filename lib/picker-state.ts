export type PickerSelection = {
  view: string | null;
  field: string | null;
  team: string[];
};

export type SavedPickerSelection = {
  origin: "draft" | "custom";
  selection: PickerSelection;
};

export function readPickerSelection(value: unknown): PickerSelection | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  if (data.view !== null && typeof data.view !== "string") return null;
  if (data.field !== null && typeof data.field !== "string") return null;
  if (!Array.isArray(data.team) || !data.team.every((id) => typeof id === "string")) return null;
  return { view: data.view as string | null, field: data.field as string | null, team: data.team.slice(0, 4) };
}

export function readSavedPickerSelections(value: unknown): Record<string, SavedPickerSelection> {
  const saved: Record<string, SavedPickerSelection> = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return saved;
  for (const [issueId, record] of Object.entries(value)) {
    if (!/^[\da-f-]+$/i.test(issueId) || !record || typeof record !== "object") continue;
    const origin = (record as Record<string, unknown>).origin;
    const selection = readPickerSelection((record as Record<string, unknown>).selection);
    if ((origin === "draft" || origin === "custom") && selection) saved[issueId] = { origin, selection };
  }
  return saved;
}

const EMPTY_SELECTION: PickerSelection = { view: null, field: null, team: [] };

/** A browser customizes independently of the canonical Notion draft. */
export function chooseIssuePickerSelection<T extends { id: string; partner: string; editorialDecision?: string }>(
  saved: SavedPickerSelection | null,
  legacy: PickerSelection | null,
  draft: PickerSelection | null,
  candidates: T[],
  isAvailable: (piece: T) => boolean,
): SavedPickerSelection {
  if (saved?.origin === "custom") {
    return { origin: "custom", selection: reconcilePickerSelection(saved.selection, candidates, isAvailable) };
  }
  if (!saved && legacy) {
    const selection = reconcilePickerSelection(legacy, candidates, isAvailable);
    if (selection.view || selection.field || selection.team.length) return { origin: "custom", selection };
  }
  if (draft) {
    // Keep retains a candidate; only a local picker interaction customizes this browser's lineup.
    return { origin: "draft", selection: reconcilePickerSelection(draft, candidates, isAvailable) };
  }
  return { origin: "draft", selection: reconcilePickerSelection(saved?.selection || EMPTY_SELECTION, candidates, isAvailable) };
}

/** A refresh may add options, but never replaces an existing editorial choice. */
export function reconcilePickerSelection<T extends { id: string; partner: string }>(
  previous: PickerSelection,
  candidates: T[],
  isAvailable: (piece: T) => boolean,
): PickerSelection {
  const available = new Map(candidates.filter(isAvailable).map((piece) => [piece.id, piece]));
  const voices = new Set<string>();
  return {
    view: previous.view && available.has(previous.view) ? previous.view : null,
    field: previous.field && available.has(previous.field) ? previous.field : null,
    team: previous.team.filter((id) => {
      const piece = available.get(id);
      if (!piece || voices.has(piece.partner) || voices.size >= 4) return false;
      voices.add(piece.partner);
      return true;
    }),
  };
}
