export type PieceType = "Big Idea" | "Team take" | "Field Notes";

export type SignalIssue = {
  id: string;
  title: string;
  url: string;
  sourceStart: string | null;
  sourceEnd: string | null;
  targetSend: string | null;
  generationStatus: string;
  generationNote: string;
  generatedAt: string | null;
};

export type OptionBody = {
  label: string;
  bodyHtml: string;
};

export type Piece = {
  id: string;
  title: string;
  partner: string;
  type: PieceType | string;
  status: string;
  issue: string | null;
  issueId: string | null;
  url: string;
  hasBody: boolean;
  bodyHtml: string;
  /** Section labels (Draft body / Option 1 / …) for quick checks. */
  options: string[];
  /** Per-section bodies so the mixer can toggle Option 1 vs Option 2. */
  optionBodies: OptionBody[];
  lastEditedTime?: string;
  mixerSlot?: string | null;
  candidateRank?: number | null;
  rankingReason?: string;
  recommended?: boolean;
  sourceDate?: string | null;
};

export type PiecesPayload = {
  syncedAt: string;
  /** Wall-clock of this response (set even when serving a snapshot). */
  refreshedAt?: string;
  source: "notion-live" | "fallback-json";
  pieces: Piece[];
  issue: SignalIssue | null;
  issueError?: string;
  excludedCount?: number;
  staleSeconds?: number;
};
