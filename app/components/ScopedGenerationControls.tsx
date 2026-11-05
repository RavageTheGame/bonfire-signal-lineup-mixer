"use client";

import { useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import { EditorRequestError, editorRequest } from "../../lib/editor-request";
import { GENERATION_SECTIONS, type GenerationRequest, type GenerationSection } from "../../lib/generation-request";
import "./scoped-generation.css";

const SECTION_TYPES = { view: "Big Idea", team: "Team take", field: "Field Notes" } as const;
type SectionKey = keyof typeof SECTION_TYPES;
type ScopedAction = { mode: "section"; section: GenerationSection }
  | { mode: "move"; source: GenerationSection; pieceId: string; title: string };

type Props = {
  issueId: string;
  available: boolean;
  blocked: boolean;
  editorKey: RefObject<string>;
  onQueueChange: (pending: boolean, queued?: boolean) => void;
};

export function useScopedGenerationControls({ issueId, available, blocked, editorKey, onQueueChange }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pending = useRef(false);
  const [action, setAction] = useState<(ScopedAction & { issueId: string }) | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (action && dialog && !dialog.open) dialog.showModal();
    else if (!action && dialog?.open) dialog.close();
  }, [action]);

  const close = () => {
    if (pending.current) return;
    setAction(null);
    setError("");
  };

  const start = (next: ScopedAction) => {
    if (!available || blocked || pending.current || !issueId) return;
    setError("");
    setAction({ ...next, issueId });
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!action || !available || blocked || pending.current || !issueId) return;
    if (action.issueId !== issueId) {
      setError("The active issue changed. Close this request and try again.");
      return;
    }
    const form = new FormData(event.currentTarget);
    const key = editorKey.current || String(form.get("editor-key") || "");
    if (!key) return;
    let request: GenerationRequest;
    if (action.mode === "section") request = { mode: "section", section: action.section };
    else {
      const section = form.get("destination");
      if (typeof section !== "string" || !Object.hasOwn(GENERATION_SECTIONS, section) || section === action.source) return;
      request = { mode: "move", pieceId: action.pieceId, section: section as GenerationSection };
    }

    pending.current = true;
    setBusy(true);
    setError("");
    onQueueChange(true);
    let queued = false;
    try {
      const result = await editorRequest(`/api/issues/${encodeURIComponent(action.issueId)}/generate`, key,
        "Could not queue Bonnie. Refresh and try again.", request);
      if (result.status !== "Queued") throw new Error("Could not confirm the request. Refresh before trying again.");
      editorKey.current = key;
      queued = true;
      setAction(null);
    } catch (err) {
      if (err instanceof EditorRequestError && err.status === 401) editorKey.current = "";
      setError(err instanceof Error ? err.message : "Could not queue Bonnie. Refresh and try again.");
    } finally {
      pending.current = false;
      setBusy(false);
      onQueueChange(false, queued);
    }
  };

  const dialog = (
    <dialog className="piece-generation-dialog" ref={dialogRef} aria-labelledby="piece-generation-title"
      onCancel={(event) => { event.preventDefault(); close(); }}>
      {action ? (
        <form onSubmit={(event) => void submit(event)} autoComplete="off">
          <h2 id="piece-generation-title">{action.mode === "section" ? `Regenerate ${GENERATION_SECTIONS[action.section]}` : "Move and rewrite"}</h2>
          {action.mode === "section" ? (
            <p>Bonnie will add options to this section. Your saved draft stays in place.</p>
          ) : (
            <>
              <p><strong>{action.title}</strong></p>
              <label htmlFor="piece-generation-destination">Rewrite for</label>
              <select id="piece-generation-destination" name="destination" required disabled={busy} defaultValue="">
                <option value="" disabled>Choose a section</option>
                {Object.entries(GENERATION_SECTIONS).filter(([section]) => section !== action.source).map(([section, label]) => (
                  <option key={section} value={section}>{label}</option>
                ))}
              </select>
              <p>Bonnie archives the original once the rewrite is ready. Pieces with an editorial decision, review status, confidentiality clearance, or a place in the saved draft stay in place.</p>
            </>
          )}
          {!editorKey.current ? (
            <>
              <label htmlFor="piece-generation-key">Signal editor key</label>
              <input id="piece-generation-key" name="editor-key" type="password" required disabled={busy} />
            </>
          ) : null}
          {error ? <p className="decision-error" role="alert">{error}</p> : null}
          <div className="piece-generation-actions">
            <button className="action" type="button" onClick={close} disabled={busy}>Cancel</button>
            <button className="action primary" type="submit" disabled={busy || blocked}>
              {busy ? "Queuing Bonnie…" : action.mode === "section" ? "Regenerate section" : "Queue rewrite"}
            </button>
          </div>
        </form>
      ) : null}
    </dialog>
  );

  return {
    dialog,
    regenerateSection: (section: SectionKey) => start({ mode: "section", section: SECTION_TYPES[section] }),
    movePiece: (piece: { id: string; title: string; section: SectionKey }) => start({ mode: "move", source: SECTION_TYPES[piece.section], pieceId: piece.id, title: piece.title }),
  };
}
