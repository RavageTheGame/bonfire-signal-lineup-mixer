import { createHash, timingSafeEqual } from "node:crypto";

const EDITOR_KEY_HEADER = "X-Signal-Editor-Key";

export class EditorAccessError extends Error {
  readonly status: 401 | 503;

  constructor(message: string, status: 401 | 503) {
    super(message);
    this.name = "EditorAccessError";
    this.status = status;
  }
}

function configuredEditorKey(): string {
  const key = process.env.SIGNAL_EDITOR_KEY?.trim() ?? "";
  return key.length >= 32 ? key : "";
}

export function editorAccessConfigured(): boolean {
  return Boolean(configuredEditorKey());
}

/** The deployed mixer is public. Protect editor-only actions with a server-held key. */
export function requireEditorAccess(request: Request): void {
  const expected = configuredEditorKey();
  if (!expected) throw new EditorAccessError("Editor access is not configured for this mixer", 503);
  const supplied = request.headers.get(EDITOR_KEY_HEADER);
  if (!supplied || !timingSafeEqual(digest(expected), digest(supplied))) {
    throw new EditorAccessError("Enter a valid editor access key", 401);
  }
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}
