"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { EditableBody } from "./components/EditableBody";
import { MIXER_SLOTS, cleanLineup, currentCandidates, emptyLineup, recommendedLineup, slotForPiece, type LineupState, type SlotKey } from "@/lib/issue-workflow";
import type { Piece, SignalIssue, PiecesPayload } from "@/lib/types";
import "./mixer.css";

const COMMAND_URL = "https://app.notion.com/p/Signal-Command-3e59dd857da1812c82f6cc782758948e";
const ARCHIVE_URL = "https://app.notion.com/p/Signal-Command-Databases-3e69dd857da180fb96c7d8ee411a359a";
const STORAGE_PREFIX = "bonfireSignalLineup.issue.v2.";
const OPEN_SECTIONS_KEY = "bonfireSignalLineup.openSlots.v2";
const DEFAULT_OPEN: Record<SlotKey, boolean> = { view: true, team1: false, team2: false, team3: false, team4: false, field: false };

function loadOpenSections(): Record<SlotKey, boolean> {
  try {
    const saved = JSON.parse(localStorage.getItem(OPEN_SECTIONS_KEY) || "{}");
    return Object.fromEntries(MIXER_SLOTS.map(({ key }) => [key, typeof saved[key] === "boolean" ? saved[key] : DEFAULT_OPEN[key]])) as Record<SlotKey, boolean>;
  } catch { return { ...DEFAULT_OPEN }; }
}

function loadLineup(issue: SignalIssue, pieces: Piece[]): LineupState {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_PREFIX + issue.id) || "null");
    if (saved?.edited === true) return cleanLineup(saved.lineup, pieces);
  } catch { /* A malformed or unavailable browser store must not leak the old issue. */ }
  return issue.generationStatus === "Ready" ? recommendedLineup(pieces) : emptyLineup();
}

function dateLabel(date: string | null | undefined): string {
  if (!date) return "Not set";
  const parsed = new Date(`${date.slice(0, 10)}T12:00:00Z`);
  return Number.isFinite(parsed.getTime())
    ? parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
    : "Not set";
}

function issueMetaLine(label: string) {
  return label.replace(/\s+[—–-]\s+/g, " · ");
}

const PARTNERS: Record<string, { full: string; title: string; url: string }> = {
  Brett: { full: "Brett Queener", title: "Partner", url: "https://www.bonfirevc.com/team/brett-queener" },
  Tyler: { full: "Tyler Churchill", title: "Partner", url: "https://www.bonfirevc.com/team/tyler-churchill" },
  Jim: { full: "Jim Andelman", title: "Partner", url: "https://www.bonfirevc.com/team/jim-andelman" },
  Mark: { full: "Mark Mullen", title: "Partner", url: "https://www.bonfirevc.com/team/mark-mullen" },
  Jen: { full: "Jen Richard", title: "Principal", url: "https://www.bonfirevc.com/team/jennifer-richard" },
  Jason: { full: "Jason Tahir", title: "VP", url: "https://www.bonfirevc.com/team/jason-tahir" },
  Dominique: { full: "Dominique", title: "", url: "" },
  Loren: { full: "Loren", title: "", url: "" },
  Brian: { full: "Brian", title: "", url: "" },
  Deb: { full: "Deb Goldstein", title: "", url: "" },
  Anonymous: { full: "A Bonfire portfolio company", title: "", url: "" },
  TBD: { full: "TBD", title: "", url: "" },
};

function partnerMeta(key: string) {
  return PARTNERS[key] || { full: key || "Bonfire team", title: "", url: "" };
}

function partnerByline(item: Piece, forBigIdea: boolean) {
  const meta = partnerMeta(item.partner);
  if (item.partner === "Anonymous") return meta.full;
  if (forBigIdea && meta.title) return `${meta.full}, ${meta.title}`;
  return meta.full;
}

function partnerDisplayName(item: Piece | undefined | null) {
  if (!item || item.partner === "Anonymous" || item.partner === "TBD") return null;
  return partnerMeta(item.partner).full;
}


export default function MixerPage() {
  const [candidates, setCandidates] = useState<Piece[]>([]);
  const [issue, setIssue] = useState<SignalIssue | null>(null);
  const [issueError, setIssueError] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [state, setState] = useState<LineupState>(emptyLineup);
  const [openSections, setOpenSections] = useState(DEFAULT_OPEN);
  const [syncNote, setSyncNote] = useState("Loading the current issue from Notion…");
  const [toast, setToast] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [liveNotion, setLiveNotion] = useState(false);
  const controlsRef = useRef<HTMLDivElement | null>(null);
  const scrollLockRef = useRef<{ windowY: number; controlsY: number } | null>(null);
  const requestVersion = useRef(0);
  const refreshInFlight = useRef(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const find = (id: string | null) => candidates.find((item) => item.id === id);
  const bySlot = (key: SlotKey) => candidates.filter((item) => slotForPiece(item)?.key === key && (statusFilter === "all" || item.status === statusFilter));
  const flash = (message: string) => {
    setToast(message);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setToast(""), 3000);
  };
  const preserveScroll = (update: () => void) => {
    scrollLockRef.current = { windowY: window.scrollY, controlsY: controlsRef.current?.scrollTop ?? 0 };
    update();
  };
  useLayoutEffect(() => {
    const lock = scrollLockRef.current;
    if (!lock) return;
    scrollLockRef.current = null;
    window.scrollTo({ top: lock.windowY, left: 0, behavior: "auto" });
    if (controlsRef.current) controlsRef.current.scrollTop = lock.controlsY;
  });

  const persist = (next: LineupState) => {
    if (!issue) return;
    preserveScroll(() => setState(next));
    try { localStorage.setItem(STORAGE_PREFIX + issue.id, JSON.stringify({ edited: true, lineup: next })); }
    catch { flash("This browser cannot save picks. Keep this tab open while reviewing."); }
  };
  const toggleSection = (key: SlotKey) => preserveScroll(() => {
    setOpenSections((previous) => {
      const next = { ...previous, [key]: !previous[key] };
      try { localStorage.setItem(OPEN_SECTIONS_KEY, JSON.stringify(next)); } catch { /* Optional UI preference. */ }
      return next;
    });
  });

  const refreshPieces = useCallback(async (reason: string) => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    const version = ++requestVersion.current;
    try {
      const response = await fetch(`/api/pieces?${reason === "manual" ? "force=1&" : ""}t=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Could not refresh the current issue.");
      const payload: PiecesPayload = await response.json();
      if (version !== requestVersion.current) return;
      const next = currentCandidates(payload.pieces || [], payload.issue || null);
      setIssue(payload.issue || null);
      setIssueError(payload.issueError || "");
      setCandidates(next);
      setState(payload.issue ? loadLineup(payload.issue, next) : emptyLineup());
      setLiveNotion(payload.source === "notion-live");
      const checked = payload.refreshedAt || payload.syncedAt;
      setSyncNote(`${payload.source === "notion-live" ? "Live Notion" : "Notion disconnected"} · ${next.length} current issue candidates · checked ${new Date(checked).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}. Picks are saved for this issue in this browser.`);
      if (reason === "manual") setToast("Current issue refreshed.");
    } catch {
      if (version !== requestVersion.current) return;
      setCandidates([]);
      setState(emptyLineup());
      setIssue(null);
      setIssueError("The current issue could not be loaded. Refresh or open Signal Command to check the connection.");
      setSyncNote("Refresh unavailable. Previous issue content stays hidden.");
    } finally {
      if (version === requestVersion.current) refreshInFlight.current = false;
    }
  }, []);

  useEffect(() => {
    setOpenSections(loadOpenSections());
    setHydrated(true);
    void refreshPieces("boot");
    const onFocus = () => void refreshPieces("focus");
    const onVisibility = () => { if (document.visibilityState === "visible") void refreshPieces("focus"); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    const poll = setInterval(() => void refreshPieces("poll"), 45_000);
    return () => {
      requestVersion.current++;
      refreshInFlight.current = false;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      clearInterval(poll);
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, [refreshPieces]);

  if (!hydrated) return <main className="app"><p className="deck">Loading the current issue…</p></main>;

  const view = find(state.view);
  const field = find(state.field);
  const team = [state.team1, state.team2, state.team3, state.team4].map(find).filter(Boolean) as Piece[];
  const teamCount = team.length;
  const isComplete = Boolean(view && field && teamCount === 4 && new Set(team.map((p) => p.partner)).size === 4);
  const names = [...new Set([view, ...team, field].map(partnerDisplayName).filter(Boolean))];
  const filledSlots = MIXER_SLOTS.filter(({ key }) => state[key]).length;
  const handlePick = (key: SlotKey, item: Piece) => {
    const next = cleanLineup({ ...state, [key]: item.id }, candidates);
    if (next[key] !== item.id) { flash("Choose a different contributor for this team slot."); return; }
    persist(next);
  };
  const applyBodySave = (pieceId: string, next: { bodyHtml: string; hasBody: boolean; optionBodies: { label: string; bodyHtml: string }[]; options: string[] }) => {
    setCandidates((previous) => previous.map((piece) => piece.id === pieceId ? { ...piece, ...next } : piece));
  };
  const bodyOrPending = (item: Piece, fieldMode: boolean) => <EditableBody pieceId={item.id} bodyHtml={item.bodyHtml} optionBodies={item.optionBodies} fieldMode={fieldMode} canEdit={liveNotion} onSaved={(next) => applyBodySave(item.id, next)} onFlash={flash} />;
  const placeholder = (label: string) => <div className="placeholder">{label} is open. Bonnie needs a current issue candidate for this slot.</div>;

  return (
    <main className="app">
      <header className="topbar">
        <div>
          <p className="eyebrow">Bonfire Signal</p>
          <h1>Signal Mixer</h1>
          <p className="deck">Start with Bonnie’s recommended draft, then swap from three ranked options for each slot.</p>
        </div>
        <div className="state-note" role="status">{syncNote}</div>
      </header>
      <section className="issue-bar" aria-label="Current issue">
        <div>
          <p className="eyebrow">Current issue</p>
          <h2>{issue?.title || "Choose the current issue in Notion"}</h2>
          <p className="issue-dates">Source calls {dateLabel(issue?.sourceStart)} – {dateLabel(issue?.sourceEnd)}{issue?.targetSend ? ` · Target send ${dateLabel(issue.targetSend)}` : ""}</p>
          <p className="issue-progress"><strong>{issue?.generationStatus || "Awaiting setup"}</strong> · {filledSlots}/6 draft slots · {candidates.length}/18 candidates</p>
          {issue?.generationNote ? <p className="issue-note">{issue.generationNote}</p> : null}
        </div>
        <div className="issue-actions">
          <a className="action primary" href={issue?.url || COMMAND_URL} target="_blank" rel="noreferrer">Generate / refresh in Notion</a>
          <a className="action" href={ARCHIVE_URL} target="_blank" rel="noreferrer">Past issues</a>
          {!liveNotion ? <a className="action" href="/connect">Connect Notion</a> : null}
        </div>
      </section>
      {issueError ? <p className="workflow-alert" role="alert">{issueError}</p> : null}
      <section className="workspace" aria-label="Signal lineup mixer">
        <div className="panel">
          <div className="panel-head"><h2>Current issue options</h2><div className="counter">{filledSlots}/6 slots</div></div>
          <div className="filters" role="group" aria-label="Status filter">
            {["all", "Approved", "Draft"].map((filter) => <button key={filter} type="button" className="chip" aria-pressed={statusFilter === filter} onClick={() => preserveScroll(() => setStatusFilter(filter))}>{filter === "all" ? "All candidates" : filter}</button>)}
            <button type="button" className="chip" onClick={() => void refreshPieces("manual")}>Refresh now</button>
          </div>
          <div className="controls" ref={controlsRef}>
            {!candidates.length ? <p className="empty-data">{issue?.generationStatus === "Generating" ? "Bonnie is preparing this issue. Candidates appear here as they are ready." : "No eligible candidates for this issue yet. Generate in Notion to start; previous issues stay in the archive."}</p> : null}
            {MIXER_SLOTS.map((slot) => {
              const options = bySlot(slot.key);
              const isOpen = openSections[slot.key];
              const selected = find(state[slot.key]);
              return <div className={`section-card ${isOpen ? "is-open" : ""}`} key={slot.key}>
                <button type="button" className="section-title" aria-expanded={isOpen} aria-controls={`options-${slot.key}`} onClick={() => toggleSection(slot.key)}>
                  <h3>{slot.title}</h3><span className="hint">{options.length}/3 options</span><span className="section-chevron" aria-hidden="true">›</span>
                </button>
                {!isOpen ? <p className="section-summary"><strong>{selected?.title || "Awaiting a selection"}</strong>{selected ? <span> · {partnerDisplayName(selected) || selected.partner}</span> : null}</p> :
                  <div className="section-body" id={`options-${slot.key}`} role="radiogroup" aria-label={slot.title}>
                    {!options.length ? <p className="empty-data">No {slot.title} candidates for this filter.</p> : options.map((item) => {
                      const checked = state[slot.key] === item.id;
                      const duplicateVoice = slot.type === "Team take" && team.some((other) => other.partner === item.partner && slotForPiece(other)?.key !== slot.key);
                      return <div key={item.id} className="candidate">
                        <label className={`option ${checked ? "is-on" : ""} ${duplicateVoice ? "is-disabled" : ""}`} data-kind="radio">
                          <input type="radio" name={slot.key} value={item.id} checked={checked} disabled={duplicateVoice} onChange={() => handlePick(slot.key, item)} />
                          <span className="check" aria-hidden="true" />
                          <span><span className="option-title">{item.title}</span><span className="meta"><span className="pill">#{item.candidateRank}</span><span className="pill">{partnerDisplayName(item) || item.partner}</span><span className={`pill ${item.status === "Approved" ? "approved" : ""}`}>{item.status}</span>{item.recommended ? <span className="pill recommended">Bonnie’s pick</span> : null}</span>{item.rankingReason ? <span className="ranking-reason">{item.rankingReason}</span> : null}<span className="source-date">Source call {dateLabel(item.sourceDate)}</span>{duplicateVoice ? <span className="source-date">This voice is already in another team slot.</span> : null}</span>
                        </label>
                        <a className="candidate-source" href={item.url} target="_blank" rel="noreferrer">Open piece and sources</a>
                      </div>;
                    })}
                  </div>}
              </div>;
            })}
          </div>
          <div className="actions">
            <button type="button" className="action primary" disabled={!candidates.length} onClick={() => { persist(recommendedLineup(candidates)); flash("Bonnie’s ranked lineup loaded. Missing slots remain open."); }}>Load Bonnie’s lineup</button>
            <button type="button" className="action" disabled={!issue} onClick={() => persist(emptyLineup())}>Clear lineup</button>
            <button type="button" className="action" disabled={!issue} onClick={async () => {
              const lines = [issue?.title || "Bonfire Signal", `Source calls ${dateLabel(issue?.sourceStart)} – ${dateLabel(issue?.sourceEnd)}`, "Draft for review", "", ...MIXER_SLOTS.map((slot) => { const piece = find(state[slot.key]); return `${slot.title}: ${piece ? `${piece.title} | ${partnerByline(piece, slot.key === "view")} | ${piece.url}` : "[open]"}`; }), "", `In this issue: ${names.join(" · ")}`];
              try { await navigator.clipboard.writeText(lines.join("\n")); flash("Current issue lineup copied."); } catch { flash("Could not copy. Copy from the preview instead."); }
            }}>Copy lineup summary</button>
          </div>
          <div className="toast" aria-live="polite">{toast}</div>
        </div>

        <aside className="preview-shell">
          <div className="preview-label">
            <span>Signal email preview</span>
            <span style={{ color: isComplete ? "var(--good)" : "var(--warn)", fontWeight: 700 }}>
              {isComplete ? "Draft ready for review" : "Draft incomplete"}
            </span>
          </div>
          <article className="email" aria-label="Email preview">
            <div className="email-inner">
              <div className="email-util">
                <span>{issueMetaLine(issue?.title || "Current issue")}</span>
                <a href="#" onClick={(e) => e.preventDefault()}>
                  Open in browser
                </a>
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                className="masthead-img"
                src="/masthead.png"
                width={1360}
                height={536}
                alt="The Bonfire Signal"
              />

              <div className="email-pad">
                <div className="intro-rule" />
                <h2 className="intro-head">Early-stage B2B from the inside.</h2>
                <p className="intro-copy">
                  <span className="mark">Bonfire</span> Ventures leads seed rounds for AI-native B2B
                  companies, which means we spend our days in the rooms where they get built.{" "}
                  <span className="mark">Signal</span> is our monthly take on the patterns we&apos;re
                  seeing and the questions we think are worth asking next.
                </p>

                <section className="email-section">
                  <div className="sec-head">
                    <span className="sec-num">01</span>
                    <p className="sec-label">
                      THE <span className="mark">BONFIRE</span> VIEW
                    </p>
                    <span className="sec-rail">One investor&apos;s point of view</span>
                    <div className="sec-line" />
                  </div>
                  {view ? (
                    <>
                      <h2>{view.title}</h2>
                      <p className="byline">{partnerByline(view, true)},</p>
                      {bodyOrPending(view, false)}
                    </>
                  ) : (
                    placeholder("The Bonfire View")
                  )}
                </section>

                <section className="email-section">
                  <div className="sec-head">
                    <span className="sec-num">02</span>
                    <p className="sec-label">FROM THE BONFIRE TEAM</p>
                    <span className="sec-rail">Four voices, four patterns</span>
                    <div className="sec-line" />
                  </div>
                  <div className="team-list">
                    {(["team1", "team2", "team3", "team4"] as const).map((key, index) => {
                      const item = find(state[key]);
                      return item ? (
                      <div className="team-item" key={item.id}>
                        <p className="team-name">
                          {(partnerDisplayName(item) || item.partner || "").toUpperCase()}
                        </p>
                        <h3>{item.title}</h3>
                        {bodyOrPending(item, false)}
                      </div>
                      ) : <div key={key}>{placeholder(`Team take ${index + 1}`)}</div>;
                    })}
                  </div>
                </section>

                <section className="email-section">
                  <div className="sec-head">
                    <span className="sec-num">03</span>
                    <p className="sec-label">FIELD NOTES FROM THE PORTFOLIO</p>
                    <span className="sec-rail">AI in practice</span>
                    <div className="sec-line" />
                  </div>
                  {field ? (
                    <>
                      <h2 className="field">{field.title}</h2>
                      {field.partner !== "Anonymous" ? (
                        <p className="byline">{partnerByline(field, false)},</p>
                      ) : null}
                      {bodyOrPending(field, true)}
                    </>
                  ) : (
                    placeholder("Field Note")
                  )}
                </section>

                <div className="cta-box">
                  <h4>Building an AI-native B2B company?</h4>
                  <p>
                    We lead seed rounds and invest $2 to $6 million. If that sounds like you, tell us
                    what you&apos;re building.
                  </p>
                  <div className="cta-row">
                    <a
                      className="cta-btn"
                      href="https://bonfireventures.fillout.com/t/oDd8NpWYHhus"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Share your company
                    </a>
                    <a className="cta-btn ghost" href="#" onClick={(e) => e.preventDefault()}>
                      Share this issue
                    </a>
                  </div>
                </div>

                <div className="team-row">
                  <p className="label">In this issue</p>
                  <p className="names">
                    {names.length ? names.join(" · ") : "Select pieces to build the contributor row."}
                  </p>
                </div>

                <p className="tiny">
                  Bonfire Ventures · 11611 San Vicente Boulevard #650 · Los Angeles, CA 90049
                </p>
              </div>
            </div>
          </article>
        </aside>
      </section>
    </main>
  );
}
