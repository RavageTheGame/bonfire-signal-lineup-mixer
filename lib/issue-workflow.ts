/** One issue selected in Notion controls the mixer's source. */
export function requireActiveIssue<T>(issues: T[]): T {
  if (issues.length !== 1) {
    throw new Error(
      issues.length
        ? "Select only one Active issue in Signal Issues."
        : "Select an Active issue in Signal Issues to load its Pieces.",
    );
  }
  return issues[0];
}

/** Relation IDs can arrive with or without UUID separators. */
export function belongsToIssue(relationIds: string[], issueId: string): boolean {
  const normalized = issueId.replace(/-/g, "").toLowerCase();
  return relationIds.some((id) => id.replace(/-/g, "").toLowerCase() === normalized);
}
