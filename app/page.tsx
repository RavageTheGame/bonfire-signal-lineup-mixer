"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { EditableBody } from "./components/EditableBody";
import "./mixer.css";
import { distinctTeamPieces } from "../lib/lineup";
import { stripLeadingByline } from "../lib/byline";
import { isAvailableCandidate, normalizeEditorialDecision, type EditorialDecision } from "../lib/editorial-decision";
import { chooseIssuePickerSelection, readPickerSelection, readSavedPickerSelections, reconcilePickerSelection, type PickerSelection, type SavedPickerSelection } from "../lib/picker-state";
import { parseDraftLineup, resolveDraftLineup } from "../lib/draft-lineup";

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
  pullQuote?: string;
  editorialDecision?: EditorialDecision;
  options: string[];
  optionBodies: { label: string; bodyHtml: string }[];
};

type LineupState = PickerSelection;
type DecisionFilter = "available" | "Keep" | "Banked" | "Ruled out";

type SectionKey = "view" | "team" | "field";

const LEGACY_STORAGE_KEY = "bonfireSignalLiveLineup.v1";
const STORAGE_KEY = "bonfireSignalLiveLineup.v2";
const OPEN_SECTIONS_KEY = "bonfireSignalLiveLineup.openSections.v1";

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

function loadLegacyState(): LineupState | null {
  try {
    return readPickerSelection(JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) || "null"));
  } catch {
    return null;
  }
}

function loadSavedLineups(): Record<string, SavedPickerSelection> {
  try {
    return readSavedPickerSelections(JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"));
  } catch {
    return {};
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
    .map((item) => {
      const optionBodies: Piece["optionBodies"] = Array.isArray(item.optionBodies)
        ? item.optionBodies
            .filter((o: any) => o && typeof o.label === "string")
            .map((o: any) => ({ label: o.label, bodyHtml: o.bodyHtml || "" }))
        : item.bodyHtml
          ? [{ label: (item.options && item.options[0]) || "Draft", bodyHtml: item.bodyHtml }]
          : [];
      const bodyHtml = item.bodyHtml || optionBodies.find((o) => o.bodyHtml.trim())?.bodyHtml || "";
      return {
        id: item.id,
        title: item.title,
        partner: item.partner || "TBD",
        status: item.status || "Draft",
        type: item.type,
        section: TYPE_TO_SECTION[item.type],
        issue: item.issue || null,
        url: item.url,
        hasBody: Boolean(item.hasBody ?? (bodyHtml || optionBodies.some((o) => o.bodyHtml.trim()))),
        bodyHtml,
        pullQuote: typeof item.pullQuote === "string" ? item.pullQuote : "",
        editorialDecision: normalizeEditorialDecision(item.editorialDecision),
        options: Array.isArray(item.options) ? item.options : optionBodies.map((o) => o.label),
        optionBodies,
      };
    });
}

function issueMetaLine(issueLabel: string) {
  // "Issue 03 — October 2026" → "Issue 03 · October 2026 · 6 min read"
  const cleaned = issueLabel.replace(/\s+[—–-]\s+/g, " · ");
  return `${cleaned} · 6 min read`;
}

export default function MixerPage() {
  const [candidates, setCandidates] = useState<Piece[]>([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [decisionFilter, setDecisionFilter] = useState<DecisionFilter>("available");
  const [decisionWrites, setDecisionWrites] = useState<Record<string, boolean>>({});
  const [decisionErrors, setDecisionErrors] = useState<Record<string, string>>({});
  const [state, setState] = useState<LineupState>({ view: null, field: null, team: [] });
  const [openSections, setOpenSections] = useState<Record<SectionKey, boolean>>(DEFAULT_OPEN);
  const [syncNote, setSyncNote] = useState("Loading Pieces from Notion…");
  const [toast, setToast] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [liveNotion, setLiveNotion] = useState(false);
  const [issueTitle, setIssueTitle] = useState("Current issue");
  const [draftLineup, setDraftLineup] = useState<LineupState | null>(null);
  const [draftRevision, setDraftRevision] = useState("");
  const [draftUnavailableReason, setDraftUnavailableReason] = useState("");
  const [generationStatus, setGenerationStatus] = useState("");
  const [lineupOrigin, setLineupOrigin] = useState<SavedPickerSelection["origin"]>("draft");
  const [issueSaving, setIssueSaving] = useState(false);
  const [issueSaveError, setIssueSaveError] = useState("");
  const [editingCount, setEditingCount] = useState(0);
  const [alternatePieceIds, setAlternatePieceIds] = useState(new Set<string>());
  const [draftLoadKey, setDraftLoadKey] = useState(0);
  const controlsRef = useRef<HTMLDivElement | null>(null);
  const scrollLockRef = useRef<{ windowY: number; controlsY: number } | null>(null);
  const editingPieceIds = useRef(new Set<string>());
  const pendingDecisionIds = useRef(new Set<string>());
  const localRevision = useRef(0);
  const refreshSequence = useRef(0);
  const forceFreshAfterMutation = useRef(false);
  const currentIssueId = useRef("");
  const currentSelection = useRef<LineupState>({ view: null, field: null, team: [] });
  const savedLineups = useRef<Record<string, SavedPickerSelection>>({});
  const legacyLineup = useRef<LineupState | null>(null);
  const issueSavePending = useRef(false);
  const onBodyEditingChange = useCallback((pieceId: string, editing: boolean) => {
    if (editing) {
      if (!editingPieceIds.current.has(pieceId)) localRevision.current += 1;
      editingPieceIds.current.add(pieceId);
    }
    else editingPieceIds.current.delete(pieceId);
    setEditingCount(editingPieceIds.current.size);
  }, []);
  const onCanonicalOptionChange = useCallback((pieceId: string, isCanonical: boolean) => {
    setAlternatePieceIds((previous) => {
      if (previous.has(pieceId) === !isCanonical) return previous;
      const next = new Set(previous);
      if (isCanonical) next.delete(pieceId);
      else next.add(pieceId);
      return next;
    });
  }, []);

  const rememberLineup = (selection: LineupState, origin: SavedPickerSelection["origin"], issueId = currentIssueId.current) => {
    if (!issueId) return;
    savedLineups.current[issueId] = { origin, selection };
    setLineupOrigin(origin);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(savedLineups.current));
    } catch {
      // The current tab still works if persistent browser storage is unavailable.
    }
  };
  const applyLineup = (selection: LineupState, origin: SavedPickerSelection["origin"], issueId = currentIssueId.current) => {
    currentSelection.current = selection;
    setState(selection);
    rememberLineup(selection, origin, issueId);
  };

  const find = (id: string | null) => candidates.find((item) => item.id === id && isAvailableCandidate(item));

  const bySection = (section: Piece["section"], filter: DecisionFilter = decisionFilter) =>
    candidates.filter((item) => {
      if (item.section !== section) return false;
      if (filter === "available" ? !isAvailableCandidate(item) : item.editorialDecision !== filter) return false;
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

  const persist = (next: LineupState, origin: SavedPickerSelection["origin"] = "custom") => {
    if (issueSavePending.current) {
      flash("Wait for the issue draft to finish saving.");
      return false;
    }
    if (editingPieceIds.current.size) {
      flash("Save or cancel the open body edit before changing the lineup.");
      return false;
    }
    if (!currentIssueId.current) {
      flash("Wait for the current issue to load.");
      return false;
    }
    localRevision.current += 1;
    preserveScroll(() => {
      applyLineup(next, origin);
    });
    return true;
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
    // Keep a pending response or an external decision from discarding an open editor.
    if (editingPieceIds.current.size || pendingDecisionIds.current.size || issueSavePending.current) {
      if (reason === "manual") flash(editingPieceIds.current.size
        ? "Save or cancel the open body edit before refreshing."
        : "Wait for the current save to finish.");
      return;
    }
    const requestSequence = ++refreshSequence.current;
    const revisionAtStart = localRevision.current;
    const canApply = () => requestSequence === refreshSequence.current
      && revisionAtStart === localRevision.current
      && !editingPieceIds.current.size && !pendingDecisionIds.current.size && !issueSavePending.current;
    try {
      // A completed write can invalidate a fetch even after its pending flag clears.
      const force = reason === "manual" || forceFreshAfterMutation.current;
      const qs = new URLSearchParams({ t: String(Date.now()) });
      if (force) qs.set("force", "1");
      const res = await fetch(`/api/pieces?${qs}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = await res.json();
      const next = normalizePieces(payload);
      if (!canApply()) return;
      const issueId = typeof payload.issue?.id === "string" ? payload.issue.id : "";
      if (!issueId) throw new Error("No active issue in response");
      const recommended = readPickerSelection(payload.issue?.draftLineup);
      const choice = chooseIssuePickerSelection(savedLineups.current[issueId] || null, legacyLineup.current, recommended, next, isAvailableCandidate);
      // Keep forcing this session's later reads: another warm server instance may still hold pre-write data.
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
        currentIssueId.current = issueId;
        setDraftLineup(recommended);
        setDraftRevision(typeof payload.issue?.draftRevision === "string" ? payload.issue.draftRevision : "");
        setDraftUnavailableReason(typeof payload.issue?.draftUnavailableReason === "string" ? payload.issue.draftUnavailableReason : "");
        setGenerationStatus(typeof payload.issue?.generationStatus === "string" ? payload.issue.generationStatus : "");
        setIssueTitle(payload.issue?.title || "Current issue");
        setLiveNotion(payload.source === "notion-live");
        setSyncNote(
          `${source} · <strong>${next.length}</strong> Pieces · ${withBody} with draft body · checked ${when}` +
            reasonNote +
            ". Swaps stay in this browser until you save the draft to Notion.",
        );
        applyLineup(choice.selection, choice.origin, issueId);
      });

      if (reason === "manual") {
        flash(
          payload.source === "notion-live"
            ? `Refreshed from Notion · ${next.length} pieces`
            : `Refreshed snapshot · ${next.length} pieces`,
        );
      }
    } catch {
      if (!canApply()) return;
      setCandidates([]);
      setLiveNotion(false);
      setIssueTitle("Current issue");
      setDraftLineup(null);
      setDraftRevision("");
      setGenerationStatus("");
      setSyncNote("Could not load the active issue. Check Signal Issues in Notion and refresh.");
      if (reason === "manual") flash("Refresh failed — try again.");
    }
  }, []);

  useEffect(() => {
    savedLineups.current = loadSavedLineups();
    legacyLineup.current = loadLegacyState();
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
  const isComplete = Boolean(view && field && distinctTeamPieces(team).length === 4);
  const decisionSaving = Object.values(decisionWrites).some(Boolean);
  const selectedIds = [state.view, state.field, ...state.team].filter((id): id is string => Boolean(id));
  const hasAlternateOption = selectedIds.some((id) => alternatePieceIds.has(id));
  const draftSaveBlockedReason = !liveNotion ? "Connect Notion to save the issue draft."
    : ["Queued", "Drafting"].includes(generationStatus) ? "Bonnie is working on this issue. Wait for generation to finish before saving."
    : editingCount ? "Save or cancel open body edits first."
    : decisionSaving ? "Wait for editorial decisions to finish saving."
    : !isComplete ? "Choose one View, four different Team voices and one Field Note to save a draft."
    : hasAlternateOption ? "Choose each Piece's main draft before saving the issue to Notion."
    : !draftRevision ? draftUnavailableReason || "Refresh to load the latest issue draft before saving."
    : "";

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
    if (!isAvailableCandidate(item)) return;
    if (item.section === "team") {
      let nextTeam = [...state.team];
      if (checked) {
        nextTeam = nextTeam.filter((id) => find(id)?.partner !== item.partner);
        if (nextTeam.length < 4) nextTeam.push(item.id);
      } else {
        nextTeam = nextTeam.filter((id) => id !== item.id);
      }
      persist({ ...state, team: nextTeam });
    } else {
      persist({ ...state, [item.section]: item.id });
    }
  };

  const saveDecision = async (item: Piece, decision: EditorialDecision) => {
    if (!liveNotion || pendingDecisionIds.current.has(item.id) || issueSavePending.current) return;
    if (editingPieceIds.current.has(item.id)) {
      flash("Save or cancel this Piece's body edit before changing its decision.");
      return;
    }
    pendingDecisionIds.current.add(item.id);
    localRevision.current += 1;
    setDecisionWrites((previous) => ({ ...previous, [item.id]: true }));
    setDecisionErrors((previous) => ({ ...previous, [item.id]: "" }));
    try {
      const response = await fetch(`/api/pieces/${encodeURIComponent(item.id)}/decision`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: decision || null }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Decision save failed (${response.status})`);
      if (payload.ok !== true || payload.id !== item.id || payload.decision !== decision) {
        throw new Error("Notion did not confirm this decision. Please refresh and try again.");
      }
      forceFreshAfterMutation.current = true;
      preserveScroll(() => {
        setCandidates((previous) => previous.map((piece) => piece.id === item.id
          ? { ...piece, editorialDecision: decision }
          : piece));
        const previous = currentSelection.current;
          if (!isAvailableCandidate({ ...item, editorialDecision: decision })) {
            const next: LineupState = {
              view: previous.view === item.id ? null : previous.view,
              field: previous.field === item.id ? null : previous.field,
              team: previous.team.filter((id) => id !== item.id),
            };
            applyLineup(next, savedLineups.current[currentIssueId.current]?.origin || "custom");
          } else if (decision === "Keep" && (previous.view === item.id || previous.field === item.id || previous.team.includes(item.id))) {
            rememberLineup(previous, "custom");
          }
      });
      if (!isAvailableCandidate({ ...item, editorialDecision: decision }) || decisionFilter !== "available") {
        document.getElementById("editorial-filter")?.focus({ preventScroll: true });
      }
      flash(decision === "Banked" ? "Banked. You can restore it from the Banked filter."
        : decision === "Ruled out" ? "Ruled out. You can restore it from the Ruled out filter."
        : decision === "Keep" ? "Marked Keep in Notion. Partner approval is unchanged."
        : "Editorial decision cleared in Notion.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not save the editorial decision.";
      setDecisionErrors((previous) => ({ ...previous, [item.id]: message }));
    } finally {
      pendingDecisionIds.current.delete(item.id);
      setDecisionWrites((previous) => ({ ...previous, [item.id]: false }));
    }
  };

  const saveIssueDraft = async () => {
    if (issueSavePending.current || editingPieceIds.current.size || pendingDecisionIds.current.size || draftSaveBlockedReason) return;
    const issueId = currentIssueId.current;
    const selection = { view: state.view, team: [...state.team], field: state.field };
    issueSavePending.current = true;
    localRevision.current += 1;
    setIssueSaving(true);
    setIssueSaveError("");
    try {
      const response = await fetch(`/api/issues/${encodeURIComponent(issueId)}/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lineup: { bigIdeaId: selection.view, teamTakeIds: selection.team, fieldNoteId: selection.field }, revision: draftRevision }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(response.status === 409
        ? `${payload.error || "The issue changed in Notion."} Refresh before saving again.`
        : payload.error || `Issue draft save failed (${response.status})`);
      const saved = resolveDraftLineup(parseDraftLineup(JSON.stringify(payload.lineup)), candidates, isAvailableCandidate);
      if (payload.ok !== true || payload.issueId !== issueId || !saved || !payload.revision) {
        throw new Error("Notion did not confirm the saved draft. Refresh to check it before trying again.");
      }
      setDraftLineup(saved);
      setDraftRevision(payload.revision);
      setDraftUnavailableReason("");
      applyLineup(saved, "draft", issueId);
      setDraftLoadKey((previous) => previous + 1);
      forceFreshAfterMutation.current = true;
      flash("Issue draft saved to Notion. Individual Pieces are unchanged.");
    } catch (error) {
      setIssueSaveError(error instanceof Error ? error.message : "Could not save the issue draft.");
    } finally {
      issueSavePending.current = false;
      setIssueSaving(false);
    }
  };

  const sections = [
    { key: "view" as const, title: "The Bonfire View", hint: "Pick 1", type: "radio" as const },
    { key: "team" as const, title: "From the Bonfire Team", hint: "Pick 4 different voices", type: "checkbox" as const },
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

  const applyBodySave = (
    pieceId: string,
    next: {
      bodyHtml: string;
      hasBody: boolean;
      optionBodies: { label: string; bodyHtml: string }[];
      options: string[];
    },
  ) => {
    localRevision.current += 1;
    forceFreshAfterMutation.current = true;
    setCandidates((prev) =>
      prev.map((piece) =>
        piece.id === pieceId
          ? {
              ...piece,
              bodyHtml: next.bodyHtml,
              hasBody: next.hasBody,
              optionBodies: next.optionBodies,
              options: next.options,
            }
          : piece,
      ),
    );
  };

  const bodyOrPending = (item: Piece, fieldMode: boolean) => {
    const previewBody = (html: string) => item.section === "view"
      ? stripLeadingByline(html, partnerByline(item, true))
      : html;
    return (
      <EditableBody
        key={`${item.id}:${draftLoadKey}`}
        pieceId={item.id}
        bodyHtml={previewBody(item.bodyHtml)}
        optionBodies={item.optionBodies.map((option) => ({
          ...option,
          bodyHtml: previewBody(option.bodyHtml),
        }))}
        fieldMode={fieldMode}
        pullQuote={item.section === "view" || item.section === "field" ? item.pullQuote : undefined}
        canEdit={liveNotion && !decisionWrites[item.id] && !issueSaving}
        onEditingChange={onBodyEditingChange}
        onCanonicalOptionChange={onCanonicalOptionChange}
        onSaved={(next) => applyBodySave(item.id, next)}
        onFlash={flash}
      />
    );
  };

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
        <div className="state-note" dangerouslySetInnerHTML={{ __html: syncNote.replace(
          /<strong>\d+<\/strong> Pieces · \d+ with draft body/,
          `<strong>${candidates.filter(isAvailableCandidate).length}</strong> available Pieces · ${candidates.filter((piece) => isAvailableCandidate(piece) && piece.hasBody).length} with draft body${candidates.some((piece) => !isAvailableCandidate(piece)) ? ` · ${candidates.filter((piece) => !isAvailableCandidate(piece)).length} banked or ruled out` : ""}`,
        ) }} />
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
          <div className="decision-filter">
            <label htmlFor="editorial-filter">Show</label>
            <select id="editorial-filter" value={decisionFilter} onChange={(event) => {
              preserveScroll(() => setDecisionFilter(event.target.value as DecisionFilter));
            }}>
              <option value="available">Available options</option>
              <option value="Keep">Kept</option>
              <option value="Banked">Banked</option>
              <option value="Ruled out">Ruled out</option>
            </select>
            <span>Keep is separate from partner approval.</span>
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
                            const disabled = !isAvailableCandidate(item) || (section.key === "team" && !checked && teamCount >= 4
                              && !team.some((selected) => selected.partner === item.partner));
                            const id = `pick-${item.id}`;
                            return (
                              <div className="option-row" key={item.id}>
                              <label
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
                                    {!item.hasBody && (
                                      <span className="pill missing">Body pending</span>
                                    )}
                                  </span>
                                </span>
                              </label>
                              <div className="decision-actions" aria-label={`Editorial decision for ${item.title}`}>
                                {isAvailableCandidate(item) ? (
                                  <>
                                    <button type="button" className="decision-action" aria-pressed={item.editorialDecision === "Keep"}
                                      aria-label={`Keep ${item.title}`} disabled={!liveNotion || decisionWrites[item.id] || issueSaving}
                                      onClick={() => void saveDecision(item, item.editorialDecision === "Keep" ? "" : "Keep")}>
                                      {item.editorialDecision === "Keep" ? "Kept" : "Keep"}
                                    </button>
                                    <button type="button" className="decision-action" aria-label={`Bank ${item.title}`}
                                      disabled={!liveNotion || decisionWrites[item.id] || issueSaving} onClick={() => void saveDecision(item, "Banked")}>Bank</button>
                                    <button type="button" className="decision-action" aria-label={`Rule out ${item.title}`}
                                      disabled={!liveNotion || decisionWrites[item.id] || issueSaving} onClick={() => void saveDecision(item, "Ruled out")}>Rule out</button>
                                  </>
                                ) : (
                                  <>
                                    <span className="decision-state">{item.editorialDecision}</span>
                                    <button type="button" className="decision-action" aria-label={`Restore ${item.title}`}
                                      disabled={!liveNotion || decisionWrites[item.id] || issueSaving} onClick={() => void saveDecision(item, "")}>Restore</button>
                                  </>
                                )}
                                {decisionWrites[item.id] ? <span className="decision-saving" role="status">Saving…</span> : null}
                              </div>
                              {decisionErrors[item.id] ? <p className="decision-error" role="alert">{decisionErrors[item.id]}</p> : null}
                              </div>
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
            <button type="button" className="action" disabled={!draftLineup || editingCount > 0 || decisionSaving || issueSaving}
              onClick={() => {
                if (draftLineup && persist(reconcilePickerSelection(draftLineup, candidates, isAvailableCandidate), "draft")) {
                  setDraftLoadKey((previous) => previous + 1);
                  setIssueSaveError("");
                  flash("Loaded the issue draft from Notion.");
                }
              }}>
              Load issue draft
            </button>
            <button type="button" className="action primary" disabled={Boolean(draftSaveBlockedReason) || issueSaving}
              onClick={() => void saveIssueDraft()}>
              {issueSaving ? "Saving issue draft…" : "Save draft to Notion"}
            </button>
            <p className="draft-save-note" role="status">{issueSaving ? "Saving the selected lineup to the issue page."
              : draftSaveBlockedReason || (lineupOrigin === "draft" && draftLineup ? "Showing the issue draft. Swap any available Piece to try another lineup." : "Your lineup is saved in this browser. Save it to Notion when ready.")}</p>
            {issueSaveError ? <p className="decision-error issue-save-error" role="alert">{issueSaveError}</p> : null}
            <button
              type="button"
              className="action"
              onClick={() => {
                if (persist({ view: null, field: null, team: [] })) flash("Lineup cleared.");
              }}
            >
              Clear lineup
            </button>
            <button
              type="button"
              className="action"
              onClick={() => {
                const views = bySection("view", "available");
                const fields = bySection("field", "available");
                const teams = bySection("team", "available");
                if (!views.length || !fields.length || distinctTeamPieces(teams).length < 4) {
                  flash("Need 1 View, 4 different team voices, and 1 Field Note.");
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
                const picked = persist({
                  view: pick(views, 1)[0].id,
                  field: pick(fields, 1)[0].id,
                  team: distinctTeamPieces(pick(teams, teams.length)).slice(0, 4).map((item) => item.id),
                });
                if (picked) flash("Complete lineup selected.");
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
                <span>{issueMetaLine(issueTitle)}</span>
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
                      <p className="byline">{partnerByline(view, true)}</p>
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
