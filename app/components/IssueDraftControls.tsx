"use client";

import { useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import type { IssueHistoryEntry } from "../../lib/types";
import { EditorRequestError, editorRequest } from "../../lib/editor-request";

type EditorAction = { type: "generate" } | { type: "history" } | { type: "open"; issue: IssueHistoryEntry };

type Props = {
  issueId: string;
  editorKey: RefObject<string>;
  issueTitle: string;
  issueUrl: string;
  generationStatus: string;
  hasGenerated: boolean;
  generationAvailable: boolean;
  blocked: boolean;
  onQueueChange: (pending: boolean, queued?: boolean) => void;
  onViewPastDraft: (viewing: boolean) => void;
};

const GENERATION_LABELS: Record<string, string> = {
  Queued: "Queued for Bonnie",
  Drafting: "Bonnie is drafting",
  Ready: "Draft ready",
  "Needs attention": "Needs attention",
};

function dateLabel(value: IssueHistoryEntry["targetSend"]) {
  if (!value) return "";
  const date = new Date(value.slice(0, 10));
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(date);
}

export function IssueDraftControls({ issueId, editorKey, issueTitle, issueUrl, generationStatus, hasGenerated,
  generationAvailable, blocked, onQueueChange, onViewPastDraft }: Props) {
  const requestPending = useRef(false);
  const pastDraftRef = useRef<HTMLElement>(null);
  const [request, setRequest] = useState<EditorAction["type"] | null>(null);
  const [keyPrompt, setKeyPrompt] = useState<EditorAction | null>(null);
  const [error, setError] = useState("");
  const [pastIssues, setPastIssues] = useState<IssueHistoryEntry[] | null>(null);
  const [pastDraft, setPastDraft] = useState<{ issue: IssueHistoryEntry; html: string } | null>(null);
  const generationBusy = generationStatus === "Queued" || generationStatus === "Drafting";
  const generateLabel = hasGenerated ? "Generate more options" : "Generate draft";

  useEffect(() => {
    if (pastDraft) pastDraftRef.current?.focus();
  }, [pastDraft]);

  const perform = async (action: EditorAction, key: string) => {
    if (requestPending.current || blocked || (action.type === "generate" && (!issueId || generationBusy))) return;
    requestPending.current = true;
    setRequest(action.type);
    setError("");
    if (action.type === "generate") onQueueChange(true);
    let queued = false;
    try {
      if (action.type === "generate") {
        const payload = await editorRequest(`/api/issues/${encodeURIComponent(issueId)}/generate`, key,
          "Could not queue Bonnie. Try again.", { mode: hasGenerated ? "additive" : "initial" });
        if (payload.status !== "Queued") throw new Error("Could not confirm the request. Refresh before trying again.");
        queued = true;
      } else if (action.type === "history") {
        const payload = await editorRequest("/api/issues", key, "Could not load past drafts. Try again.");
        if (!Array.isArray(payload.issues)) throw new Error("Could not load past drafts. Try again.");
        setPastIssues(payload.issues);
      } else {
        const query = new URLSearchParams({ issueId: action.issue.id });
        const payload = await editorRequest(`/api/pieces?${query}`, key, "Could not open this draft. Try again.");
        if (payload.issue?.id !== action.issue.id) throw new Error("Could not open this draft. Try again.");
        setPastDraft({ issue: action.issue, html: typeof payload.savedDraftHtml === "string" ? payload.savedDraftHtml : "" });
        onViewPastDraft(true);
      }
      editorKey.current = key;
      setKeyPrompt(null);
    } catch (err) {
      if (err instanceof EditorRequestError && err.status === 401) {
        editorKey.current = "";
        setKeyPrompt(action);
      }
      setError(err instanceof Error ? err.message : "The request failed. Try again.");
    } finally {
      if (action.type === "generate") onQueueChange(false, queued);
      requestPending.current = false;
      setRequest(null);
    }
  };

  const start = (action: EditorAction) => {
    setError("");
    if (editorKey.current) void perform(action, editorKey.current);
    else setKeyPrompt(action);
  };

  const submitKey = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const key = new FormData(event.currentTarget).get("editor-key");
    event.currentTarget.reset();
    if (keyPrompt && typeof key === "string" && key) void perform(keyPrompt, key);
  };

  const closeHistory = () => {
    setPastIssues(null);
    setPastDraft(null);
    setKeyPrompt(null);
    setError("");
    onViewPastDraft(false);
  };

  return (
    <section className="issue-tools" aria-label="Issue drafts">
      <div className="issue-toolbar">
        <div>
          <p className="eyebrow">{pastDraft ? "Past draft" : "Current issue"}</p>
          <h2>{pastDraft?.issue.name || (issueId ? issueTitle : "Signal drafts")}</h2>
          {!pastDraft && (request === "generate" || GENERATION_LABELS[generationStatus]) ? (
            <p className="issue-generation-state" role="status">
              {request === "generate" ? "Queuing Bonnie…" : GENERATION_LABELS[generationStatus]}
            </p>
          ) : null}
        </div>
        <div className="issue-tools-actions">
          {(pastDraft?.issue.url || issueUrl) ? (
            <a className="action" href={pastDraft?.issue.url || issueUrl} target="_blank" rel="noreferrer">Open in Notion</a>
          ) : null}
          {pastIssues ? (
            <button className="action" type="button" disabled={Boolean(request)} onClick={closeHistory}>
              {pastDraft ? "Back to current issue" : "Close past drafts"}
            </button>
          ) : (
            <button className="action" type="button" disabled={blocked || Boolean(request)}
              onClick={() => start({ type: "history" })}>Past drafts</button>
          )}
          {!pastDraft && issueId && generationAvailable ? (
            <button className="action primary" type="button" disabled={blocked || generationBusy || Boolean(request)}
              onClick={() => start({ type: "generate" })}>{generateLabel}</button>
          ) : null}
        </div>
      </div>
      {keyPrompt ? (
        <form className="editor-key-form" onSubmit={submitKey} autoComplete="off">
          <label htmlFor="signal-editor-key">Signal editor key</label>
          <input key={keyPrompt.type} id="signal-editor-key" name="editor-key" type="password" autoFocus required />
          <button className="action primary" type="submit" disabled={blocked || Boolean(request)}>
            {keyPrompt.type === "generate" ? "Queue Bonnie" : keyPrompt.type === "open" ? "Open draft" : "Open past drafts"}
          </button>
          <button className="action" type="button" disabled={Boolean(request)} onClick={() => {
            setKeyPrompt(null);
            setError("");
          }}>Cancel</button>
        </form>
      ) : null}
      {request && request !== "generate" ? <p className="issue-tools-message" role="status">Loading {request === "history" ? "past drafts" : "draft"}…</p> : null}
      {error ? <p className="decision-error issue-tools-message" role="alert">{error}</p> : null}
      {pastIssues ? (
        <div className="past-issues">
          <h3>Past drafts</h3>
          {pastIssues.length ? (
            <ul>
              {pastIssues.map((issue) => (
                <li key={issue.id}>
                  <button className="past-issue" type="button" aria-pressed={pastDraft?.issue.id === issue.id}
                    disabled={blocked || Boolean(request)} onClick={() => start({ type: "open", issue })}>
                    <strong>{issue.name}</strong>
                    <span>{[issue.status, dateLabel(issue.targetSend)].filter(Boolean).join(" · ")}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : <p>No past issues are available in Signal Issues.</p>}
        </div>
      ) : null}
      {pastDraft ? (
        <article ref={pastDraftRef} tabIndex={-1} className="preview-shell past-draft" aria-label={`Saved draft for ${pastDraft.issue.name}`}>
          <div className="preview-label"><span>Saved issue draft</span><span>Read only</span></div>
          {pastDraft.html ? (
            <div className="email past-draft-email"><div className="email-pad" dangerouslySetInnerHTML={{ __html: pastDraft.html }} /></div>
          ) : <p className="empty-data">This draft can be opened in Notion.</p>}
        </article>
      ) : null}
    </section>
  );
}
