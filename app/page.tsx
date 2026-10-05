"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { EditableBody } from "./components/EditableBody";
import "./mixer.css";

type Piece = {
  id: string;
  title: string;
  partner: string;
  status: string;
  type: string;
  section: "view" | "team" | "field";
  issue: string | null;
  url: string;
  hasBody: boolean;
  bodyHtml: string;
};

type LineupState = {
  view: string | null;
  field: string | null;
  team: string[];
};

type SectionKey = "view" | "team" | "field";

const STORAGE_KEY = "bonfireSignalLiveLineup.v1";
const OPEN_SECTIONS_KEY = "bonfireSignalLiveLineup.openSections.v1";
const ISSUE_DEFAULT = "Issue 03 — October 2026";

const DEFAULT_OPEN: Record<SectionKey, boolean> = {
  view: true,
  team: false,
  field: false,
};

function loadOpenSections(): Record<SectionKey, boolean> {
  try {
    const saved = JSON.parse(localStorage.getItem(OPEN_SECTIONS_KEY) || "{}");
    return {
      view: typeof saved.view === "boolean" ? saved.view : DEFAULT_OPEN.view,
      team: typeof saved.team === "boolean" ? saved.team : DEFAULT_OPEN.team,
      field: typeof saved.field === "boolean" ? saved.field : DEFAULT_OPEN.field,
    };
  } catch {
    return { ...DEFAULT_OPEN };
  }
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

const TYPE_TO_SECTION: Record<string, Piece["section"]> = {
  "Big Idea": "view",
  "Team take": "team",
  "Field Notes": "field",
};

function loadState(): LineupState {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return {
      view: typeof saved.view === "string" ? saved.view : null,
      field: typeof saved.field === "string" ? saved.field : null,
      team: Array.isArray(saved.team) ? saved.team.slice(0, 4) : [],
    };
  } catch {
    return { view: null, field: null, team: [] };
  }
}

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

function normalizePieces(payload: { pieces?: any[] }): Piece[] {
  const list = Array.isArray(payload.pieces) ? payload.pieces : [];
  return list
    .filter((item) => TYPE_TO_SECTION[item.type])
    .map((item) => ({
      id: item.id,
      title: item.title,
      partner: item.partner || "TBD",
      status: item.status || "Draft",
      type: item.type,
      section: TYPE_TO_SECTION[item.type],
      issue: item.issue || null,
      url: item.url,
      hasBody: Boolean(item.hasBody && item.bodyHtml),
      bodyHtml: item.bodyHtml || "",
    }));
}

function issueMetaLine(issueLabel: string) {
  // "Issue 03 — October 2026" → "Issue 03 · October 2026 · 6 min read"
  const cleaned = issueLabel.replace(/\s+[—–-]\s+/g, " · ");
  return `${cleaned} · 6 min read`;
}

export default function MixerPage() {
  const [candidates, setCandidates] = useState<Piece[]>([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [state, setState] = useState<LineupState>({ view: null, field: null, team: [] });
  const [openSections, setOpenSections] = useState<Record<SectionKey, boolean>>(DEFAULT_OPEN);
  const [syncNote, setSyncNote] = useState("Loading Pieces from Notion…");
  const [toast, setToast] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [liveNotion, setLiveNotion] = useState(false);
  const controlsRef = useRef<HTMLDivElement | null>(null);
  const scrollLockRef = useRef<{ windowY: number; controlsY: number } | null>(null);

  const find = (id: string | null) => candidates.find((item) => item.id === id);

  const bySection = (section: Piece["section"]) =>
    candidates.filter((item) => {
      if (item.section !== section) return false;
      if (statusFilter !== "all" && item.status !== statusFilter) return false;
      return true;
    });

  const flash = (message: string) => {
    setToast(message);
    window.clearTimeout((flash as any).timer);
    (flash as any).timer = window.setTimeout(() => setToast(""), 2600);
  };

  // Capture scroll before a state update that may grow/shrink the preview,
  // then restore in useLayoutEffect so the page doesn't jump.
  const preserveScroll = (update: () => void) => {
    scrollLockRef.current = {
      windowY: window.scrollY,
      controlsY: controlsRef.current?.scrollTop ?? 0,
    };
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
    preserveScroll(() => {
      setState(next);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    });
  };

  const toggleSection = (key: SectionKey) => {
    preserveScroll(() => {
      setOpenSections((prev) => {
        const next = { ...prev, [key]: !prev[key] };
        localStorage.setItem(OPEN_SECTIONS_KEY, JSON.stringify(next));
        return next;
      });
    });
  };

  const refreshPieces = useCallback(async (reason: string) => {
    try {
      const force = reason === "manual";
      const qs = new URLSearchParams({ t: String(Date.now()) });
      if (force) qs.set("force", "1");
      const res = await fetch(`/api/pieces?${qs}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = await res.json();
      const next = normalizePieces(payload);
      const withBody = next.filter((c) => c.hasBody).length;
      const checkedAt = payload.refreshedAt || payload.syncedAt;
      const when = checkedAt ? new Date(checkedAt).toLocaleString() : "just now";
      const source =
        payload.source === "notion-live"
          ? '<span class="live">Live Notion</span>'
          : '<span class="fallback">Cached snapshot</span>';
      const reasonNote =
        reason === "manual"
          ? " · refreshed just now"
          : reason === "focus"
            ? " · refreshed on focus"
            : "";

      preserveScroll(() => {
        setCandidates(next);
        setLiveNotion(payload.source === "notion-live");
        setSyncNote(
          `${source} · <strong>${next.length}</strong> Pieces · ${withBody} with draft body · checked ${when}` +
            reasonNote +
            ". Picks stay in this browser only.",
        );
        setState((prev) => {
          const cleaned: LineupState = {
            view: prev.view && next.some((p) => p.id === prev.view) ? prev.view : null,
            field: prev.field && next.some((p) => p.id === prev.field) ? prev.field : null,
            team: prev.team.filter((id) => next.some((p) => p.id === id)),
          };
          localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned));
          return cleaned;
        });
      });

      if (reason === "manual") {
        flash(
          payload.source === "notion-live"
            ? `Refreshed from Notion · ${next.length} pieces`
            : `Refreshed snapshot · ${next.length} pieces`,
        );
      }
    } catch {
      setSyncNote("Could not reach live Pieces API. Check /api/pieces.");
      if (reason === "manual") flash("Refresh failed — try again.");
    }
  }, []);

  useEffect(() => {
    setState(loadState());
    setOpenSections(loadOpenSections());
    setHydrated(true);
    void refreshPieces("boot");

    const onFocus = () => void refreshPieces("focus");
    const onVis = () => {
      if (document.visibilityState === "visible") void refreshPieces("focus");
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    // Light polling as a safety net (not a cron job) — keeps Notion embed warm.
    const poll = window.setInterval(() => void refreshPieces("poll"), 45_000);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
      window.clearInterval(poll);
    };
  }, [refreshPieces]);

  if (!hydrated) {
    return (
      <main className="app">
        <p className="deck">Loading mixer…</p>
      </main>
    );
  }

  const teamCount = state.team.length;
  const view = find(state.view);
  const field = find(state.field);
  const team = state.team.map(find).filter(Boolean) as Piece[];
  const isComplete = Boolean(view && field && team.length === 4);

  const contributorNames = () => {
    const ordered: string[] = [];
    const push = (item?: Piece | null) => {
      const name = partnerDisplayName(item);
      if (name && !ordered.includes(name)) ordered.push(name);
    };
    push(view);
    team.forEach(push);
    push(field);
    return ordered;
  };

  const names = contributorNames();

  const handlePick = (item: Piece, checked: boolean) => {
    if (item.section === "team") {
      let nextTeam = [...state.team];
      if (checked) {
        if (!nextTeam.includes(item.id) && nextTeam.length < 4) nextTeam.push(item.id);
      } else {
        nextTeam = nextTeam.filter((id) => id !== item.id);
      }
      persist({ ...state, team: nextTeam });
    } else {
      persist({ ...state, [item.section]: item.id });
    }
  };

  const sections = [
    { key: "view" as const, title: "The Bonfire View", hint: "Pick 1", type: "radio" as const },
    { key: "team" as const, title: "From the Bonfire Team", hint: "Pick exactly 4", type: "checkbox" as const },
    { key: "field" as const, title: "Field Notes from the Portfolio", hint: "Pick 1", type: "radio" as const },
  ];

  const sectionSummary = (key: SectionKey) => {
    if (key === "team") {
      if (!state.team.length) return "None selected";
      const titles = state.team
        .map((id) => find(id)?.title)
        .filter(Boolean)
        .slice(0, 2);
      const extra = state.team.length > 2 ? ` +${state.team.length - 2}` : "";
      return `${state.team.length}/4 · ${titles.join(" · ")}${extra}`;
    }
    const selected = find(state[key]);
    return selected ? selected.title : "None selected";
  };

  const applyBodySave = (pieceId: string, next: { bodyHtml: string; hasBody: boolean }) => {
    setCandidates((prev) =>
      prev.map((piece) =>
        piece.id === pieceId
          ? { ...piece, bodyHtml: next.bodyHtml, hasBody: next.hasBody }
          : piece,
      ),
    );
  };

  const bodyOrPending = (item: Piece, fieldMode: boolean) => (
    <EditableBody
      pieceId={item.id}
      bodyHtml={item.bodyHtml}
      fieldMode={fieldMode}
      canEdit={liveNotion}
      onSaved={(next) => applyBodySave(item.id, next)}
      onFlash={flash}
    />
  );

  const placeholder = (label: string) => (
    <div className="placeholder">{label} is open. Pick a candidate to fill this slot.</div>
  );

  return (
    <main className="app">
      <header className="topbar">
        <div>
          <p className="eyebrow">Bonfire Signal</p>
          <h1>Issue lineup mixer</h1>
          <p className="deck">
            Pick one Bonfire View, four Team takes, and one Field Note from live Notion Pieces. The
            preview matches the Signal email — masthead, section rules, bylines, and the contributor row.
          </p>
          {syncNote.includes("fallback") || syncNote.includes("Cached snapshot") ? (
            <p className="deck" style={{ marginTop: 10 }}>
              <a href="/connect" style={{ color: "var(--ember)", fontWeight: 700 }}>
                Connect Notion
              </a>{" "}
              for live Pieces (OAuth — no API key required).
            </p>
          ) : null}
        </div>
        <div className="state-note" dangerouslySetInnerHTML={{ __html: syncNote }} />
      </header>

      <section className="workspace" aria-label="Signal lineup mixer">
        <div className="panel">
          <div className="panel-head">
            <h2>Picker</h2>
            <div className="counter">{teamCount}/4 Team takes</div>
          </div>
          <div className="filters" role="group" aria-label="Status filter">
            {["all", "Approved", "Draft"].map((filter) => (
              <button
                key={filter}
                type="button"
                className="chip"
                aria-pressed={statusFilter === filter}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  preserveScroll(() => setStatusFilter(filter));
                }}
              >
                {filter === "all" ? "All statuses" : filter}
              </button>
            ))}
            <button
              type="button"
              className="chip"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void refreshPieces("manual")}
            >
              Refresh now
            </button>
          </div>
          <div className="controls" ref={controlsRef}>
            {!candidates.length ? (
              <div className="empty-data">No Pieces loaded yet. Waiting on live Notion sync…</div>
            ) : (
              sections.map((section) => {
                const options = bySection(section.key);
                const isOpen = openSections[section.key];
                return (
                  <div className={`section-card ${isOpen ? "is-open" : ""}`} key={section.key}>
                    <button
                      type="button"
                      className="section-title"
                      aria-expanded={isOpen}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => toggleSection(section.key)}
                    >
                      <h3>{section.title}</h3>
                      <span className="hint">{section.hint}</span>
                      <span className="section-chevron" aria-hidden="true">
                        ›
                      </span>
                    </button>
                    {!isOpen ? (
                      <p className="section-summary">
                        <strong>{sectionSummary(section.key)}</strong>
                      </p>
                    ) : (
                      <div className="section-body">
                        {!options.length ? (
                          <div className="empty-data">No {section.title} candidates for this filter.</div>
                        ) : (
                          options.map((item) => {
                            const checked =
                              section.key === "team"
                                ? state.team.includes(item.id)
                                : state[section.key] === item.id;
                            const disabled = section.key === "team" && !checked && teamCount >= 4;
                            const id = `pick-${item.id}`;
                            return (
                              <label
                                key={item.id}
                                className={`option ${disabled ? "is-disabled" : ""} ${checked ? "is-on" : ""}`}
                                data-kind={section.type}
                                htmlFor={id}
                                onMouseDown={(e) => {
                                  // Block focus scroll-into-view without cancelling the click.
                                  e.preventDefault();
                                }}
                                onClick={(e) => {
                                  // Drive selection ourselves so native radio/checkbox focus
                                  // never yanks the page or picker scroll position.
                                  e.preventDefault();
                                  if (disabled) return;
                                  if (section.key === "team") {
                                    handlePick(item, !checked);
                                  } else if (!checked) {
                                    handlePick(item, true);
                                  }
                                }}
                              >
                                <input
                                  id={id}
                                  name={section.type === "checkbox" ? item.id : item.section}
                                  type={section.type}
                                  value={item.id}
                                  checked={checked}
                                  disabled={disabled}
                                  tabIndex={-1}
                                  onChange={() => {
                                    /* selection handled on label click */
                                  }}
                                />
                                <span className="check" aria-hidden="true" />
                                <span>
                                  <span className="option-title">{item.title}</span>
                                  <span className="meta">
                                    <span className="pill">{partnerDisplayName(item) || item.partner}</span>
                                    <span className={`pill ${item.status === "Approved" ? "approved" : ""}`}>
                                      {item.status}
                                    </span>
                                    {item.hasBody ? (
                                      <span className="pill">Has draft</span>
                                    ) : (
                                      <span className="pill missing">Body pending</span>
                                    )}
                                  </span>
                                </span>
                              </label>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
          <div className="actions">
            <button
              type="button"
              className="action"
              onClick={() => {
                persist({ view: null, field: null, team: [] });
                flash("Lineup cleared.");
              }}
            >
              Clear lineup
            </button>
            <button
              type="button"
              className="action primary"
              onClick={() => {
                const views = bySection("view");
                const fields = bySection("field");
                const teams = bySection("team");
                if (!views.length || !fields.length || teams.length < 4) {
                  flash("Need at least 1 View, 4 Team takes, and 1 Field Note.");
                  return;
                }
                const pick = <T,>(list: T[], count: number) => {
                  const pool = [...list];
                  const out: T[] = [];
                  while (out.length < count && pool.length) {
                    const index = Math.floor(Math.random() * pool.length);
                    out.push(pool.splice(index, 1)[0]);
                  }
                  return out;
                };
                persist({
                  view: pick(views, 1)[0].id,
                  field: pick(fields, 1)[0].id,
                  team: pick(teams, 4).map((item) => item.id),
                });
                flash("Complete lineup selected.");
              }}
            >
              Random complete lineup
            </button>
            <button
              type="button"
              className="action"
              onClick={async () => {
                const lines = [
                  "Bonfire Signal lineup",
                  "",
                  `The Bonfire View: ${view ? `${view.title} | ${partnerByline(view, true)}` : "[open]"}`,
                  "",
                  "From the Bonfire Team",
                  ...[0, 1, 2, 3].map(
                    (i) =>
                      `${i + 1}. ${team[i] ? `${team[i].title} | ${partnerByline(team[i], false)}` : "[open]"}`,
                  ),
                  "",
                  `Field Notes from the Portfolio: ${
                    field
                      ? field.title +
                        (field.partner === "Anonymous" ? "" : ` | ${partnerByline(field, false)}`)
                      : "[open]"
                  }`,
                  "",
                  `In this issue: ${names.join(" · ") || "[none yet]"}`,
                ];
                try {
                  await navigator.clipboard.writeText(lines.join("\n"));
                  flash("Lineup summary copied.");
                } catch {
                  flash("Copy failed. Select and copy from the preview instead.");
                }
              }}
            >
              Copy lineup summary
            </button>
          </div>
          <div className="toast" aria-live="polite">
            {toast}
          </div>
        </div>

        <aside className="preview-shell">
          <div className="preview-label">
            <span>Signal email preview</span>
            <span style={{ color: isComplete ? "var(--good)" : "var(--warn)", fontWeight: 700 }}>
              {isComplete ? "Complete" : "Incomplete"}
            </span>
          </div>
          <article className="email" aria-label="Email preview">
            <div className="email-inner">
              <div className="email-util">
                <span>{issueMetaLine(ISSUE_DEFAULT)}</span>
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
                    {team.map((item) => (
                      <div className="team-item" key={item.id}>
                        <p className="team-name">
                          {(partnerDisplayName(item) || item.partner || "").toUpperCase()}
                        </p>
                        <h3>{item.title}</h3>
                        {bodyOrPending(item, false)}
                      </div>
                    ))}
                    {Array.from({ length: Math.max(0, 4 - team.length) }, (_, i) => (
                      <div key={`empty-${i}`}>{placeholder(`Team take ${team.length + i + 1}`)}</div>
                    ))}
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
