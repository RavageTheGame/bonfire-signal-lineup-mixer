"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { normalizeEditorHtml } from "@/lib/html-notion";

export type OptionBody = {
  label: string;
  bodyHtml: string;
};

type EditableBodyProps = {
  pieceId: string;
  bodyHtml: string;
  optionBodies?: OptionBody[];
  fieldMode?: boolean;
  canEdit: boolean;
  onSaved: (next: {
    bodyHtml: string;
    hasBody: boolean;
    optionBodies: OptionBody[];
    options: string[];
  }) => void;
  onFlash: (message: string) => void;
};

function shortLabel(label: string): string {
  if (/^draft body$/i.test(label)) return "Draft";
  const opt = label.match(/^option\s+(.+)$/i);
  if (opt) return `Option ${opt[1]}`;
  return label;
}

function defaultLabel(optionBodies: OptionBody[], fallbackHtml: string): string {
  if (!optionBodies.length) return "Draft";
  const draft = optionBodies.find((o) => /^draft body$/i.test(o.label) && o.bodyHtml.trim());
  if (draft) return draft.label;
  const withCopy = optionBodies.find((o) => o.bodyHtml.trim());
  if (withCopy) return withCopy.label;
  if (fallbackHtml.trim() && optionBodies[0]) return optionBodies[0].label;
  return optionBodies[0]?.label || "Draft";
}

/**
 * Email-preview body with optional Option 1 / Option 2 toggle and Notion save.
 */
export function EditableBody({
  pieceId,
  bodyHtml,
  optionBodies = [],
  fieldMode = false,
  canEdit,
  onSaved,
  onFlash,
}: EditableBodyProps) {
  const resolvedOptions = useMemo(() => {
    if (optionBodies.length) return optionBodies;
    if (bodyHtml?.trim()) return [{ label: "Draft", bodyHtml }];
    return [] as OptionBody[];
  }, [optionBodies, bodyHtml]);

  const [selectedLabel, setSelectedLabel] = useState(() =>
    defaultLabel(resolvedOptions, bodyHtml),
  );
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const editorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // Keep selection valid when pieces refresh
    if (!resolvedOptions.some((o) => o.label === selectedLabel)) {
      setSelectedLabel(defaultLabel(resolvedOptions, bodyHtml));
    }
  }, [resolvedOptions, selectedLabel, bodyHtml]);

  const active =
    resolvedOptions.find((o) => o.label === selectedLabel) ||
    resolvedOptions[0] ||
    null;
  const activeHtml = active?.bodyHtml || "";
  const showToggle = resolvedOptions.length > 1;

  useEffect(() => {
    if (!editing || !editorRef.current) return;
    editorRef.current.innerHTML = activeHtml?.trim() ? activeHtml : "<p><br></p>";
    editorRef.current.focus();
    // Seed when entering edit mode or switching options while editing
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, selectedLabel]);

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

  const selectOption = (label: string) => {
    if (editing && label !== selectedLabel) {
      // Don't silently discard edits
      const ok = window.confirm("Switch options and discard unsaved edits?");
      if (!ok) return;
      setEditing(false);
      setError("");
    }
    setSelectedLabel(label);
  };

  const save = async () => {
    if (!canEdit || saving) return;
    const html = normalizeEditorHtml(editorRef.current?.innerHTML || "");
    const sectionLabel = active?.label || selectedLabel || null;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/pieces/${encodeURIComponent(pieceId)}/body`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bodyHtml: html, sectionLabel }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload.error || `Save failed (${res.status})`);
      }
      const nextBodies: OptionBody[] = Array.isArray(payload.optionBodies)
        ? payload.optionBodies
        : resolvedOptions.map((o) =>
            o.label === sectionLabel ? { ...o, bodyHtml: payload.bodyHtml || html } : o,
          );
      onSaved({
        bodyHtml: payload.bodyHtml || html,
        hasBody: Boolean(payload.hasBody ?? (payload.bodyHtml || html).trim()),
        optionBodies: nextBodies,
        options: nextBodies.map((o) => o.label),
      });
      if (payload.sectionLabel) setSelectedLabel(payload.sectionLabel);
      setEditing(false);
      onFlash(
        payload.createdSection
          ? "Saved — created Draft body in Notion"
          : `Saved ${shortLabel(payload.sectionLabel || sectionLabel || "body")} to Notion`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Save failed";
      setError(message);
      onFlash(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`body-edit${editing ? " is-editing" : ""}`}>
      {showToggle ? (
        <div className="option-toggle" role="tablist" aria-label="Draft options">
          {resolvedOptions.map((opt) => {
            const selected = opt.label === selectedLabel;
            return (
              <button
                key={opt.label}
                type="button"
                role="tab"
                aria-selected={selected}
                className={`option-toggle__btn${selected ? " is-on" : ""}`}
                onClick={() => selectOption(opt.label)}
              >
                {shortLabel(opt.label)}
                {!opt.bodyHtml.trim() ? <span className="option-toggle__empty"> · empty</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}

      {editing ? (
        <div
          ref={editorRef}
          className={`body-copy body-editor ${fieldMode ? "field" : ""}`}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label={`Edit ${shortLabel(selectedLabel)}`}
        />
      ) : activeHtml.trim() ? (
        <div
          className={`body-copy ${fieldMode ? "field" : ""}`}
          dangerouslySetInnerHTML={{ __html: activeHtml }}
        />
      ) : (
        <div className="placeholder">
          {showToggle
            ? `${shortLabel(selectedLabel)} has no draft copy yet.`
            : "Draft body is not on this Piece page yet. Title and byline still preview as they would in the issue."}
        </div>
      )}

      <div className="body-edit__bar">
        {editing ? (
          <>
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
          </>
        ) : (
          <button type="button" className="body-edit__btn" onClick={startEdit}>
            {activeHtml.trim()
              ? showToggle
                ? `Edit ${shortLabel(selectedLabel)}`
                : "Edit body"
              : showToggle
                ? `Add ${shortLabel(selectedLabel)}`
                : "Add draft body"}
          </button>
        )}
        {error ? <span className="body-edit__err">{error}</span> : null}
      </div>
    </div>
  );
}
