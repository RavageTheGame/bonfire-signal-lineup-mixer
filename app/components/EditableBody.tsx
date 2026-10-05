"use client";

import { useEffect, useRef, useState } from "react";
import { normalizeEditorHtml } from "@/lib/html-notion";

type EditableBodyProps = {
  pieceId: string;
  bodyHtml: string;
  fieldMode?: boolean;
  canEdit: boolean;
  preferredSection?: string | null;
  onSaved: (next: { bodyHtml: string; hasBody: boolean }) => void;
  onFlash: (message: string) => void;
};

/**
 * Email-preview body that can switch into an editor and PATCH Notion.
 */
export function EditableBody({
  pieceId,
  bodyHtml,
  fieldMode = false,
  canEdit,
  preferredSection = null,
  onSaved,
  onFlash,
}: EditableBodyProps) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const editorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!editing || !editorRef.current) return;
    editorRef.current.innerHTML = bodyHtml?.trim() ? bodyHtml : "<p><br></p>";
    editorRef.current.focus();
    // Only seed when entering edit mode
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const startEdit = () => {
    if (!canEdit) {
      onFlash("Connect Notion to edit draft bodies.");
      return;
    }
    setError("");
    setEditing(true);
  };

  const cancel = () => {
    setEditing(false);
    setError("");
  };

  const save = async () => {
    if (!canEdit || saving) return;
    const html = normalizeEditorHtml(editorRef.current?.innerHTML || "");
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/pieces/${encodeURIComponent(pieceId)}/body`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bodyHtml: html, sectionLabel: preferredSection }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload.error || `Save failed (${res.status})`);
      }
      onSaved({
        bodyHtml: payload.bodyHtml || html,
        hasBody: Boolean((payload.bodyHtml || html).trim()),
      });
      setEditing(false);
      onFlash(payload.createdSection ? "Saved — created Draft body in Notion" : "Saved to Notion");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Save failed";
      setError(message);
      onFlash(message);
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <div className="body-edit">
        {bodyHtml?.trim() ? (
          <div
            className={`body-copy ${fieldMode ? "field" : ""}`}
            dangerouslySetInnerHTML={{ __html: bodyHtml }}
          />
        ) : (
          <div className="placeholder">
            Draft body is not on this Piece page yet. Title and byline still preview as they would in
            the issue.
          </div>
        )}
        <div className="body-edit__bar">
          <button type="button" className="body-edit__btn" onClick={startEdit}>
            {bodyHtml?.trim() ? "Edit body" : "Add draft body"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="body-edit is-editing">
      <div
        ref={editorRef}
        className={`body-copy body-editor ${fieldMode ? "field" : ""}`}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label="Edit piece draft body"
      />
      <div className="body-edit__bar">
        <button
          type="button"
          className="body-edit__btn primary"
          disabled={saving}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : "Save to Notion"}
        </button>
        <button type="button" className="body-edit__btn" disabled={saving} onClick={cancel}>
          Cancel
        </button>
        {error ? <span className="body-edit__err">{error}</span> : null}
      </div>
    </div>
  );
}
