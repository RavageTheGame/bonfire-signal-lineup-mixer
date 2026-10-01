export type PieceType = "Big Idea" | "Team take" | "Field Notes";

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
  options: string[];
  lastEditedTime?: string;
};

export type PiecesPayload = {
  syncedAt: string;
  /** Wall-clock of this response (set even when serving a snapshot). */
  refreshedAt?: string;
  source: "notion-live" | "fallback-json";
  pieces: Piece[];
  staleSeconds?: number;
};
