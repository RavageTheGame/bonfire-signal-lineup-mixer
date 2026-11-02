export type PickerSelection = {
  view: string | null;
  field: string | null;
  team: string[];
};

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
