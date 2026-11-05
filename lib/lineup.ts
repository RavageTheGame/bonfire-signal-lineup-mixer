/** Retain one candidate per voice, preserving choice order. */
export function distinctTeamPieces<T extends { partner: string }>(pieces: T[]): T[] {
  const seen = new Set<string>();
  return pieces.filter((piece) => {
    if (seen.has(piece.partner)) return false;
    seen.add(piece.partner);
    return true;
  });
}
