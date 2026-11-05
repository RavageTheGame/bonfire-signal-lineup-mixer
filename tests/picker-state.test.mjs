import test from "node:test";
import assert from "node:assert/strict";
import { chooseIssuePickerSelection, readSavedPickerSelections, reconcilePickerSelection } from "../lib/picker-state.ts";
import { isAvailableCandidate } from "../lib/editorial-decision.ts";

test("new regenerated options preserve selected and kept choices in their existing order", () => {
  const before = { view: "view-kept", field: "field", team: ["team-b", "team-a"] };
  const pieces = [
    { id: "new-view", partner: "New voice", status: "Draft" },
    { id: "new-team", partner: "A", status: "Draft" },
    { id: "view-kept", partner: "A", status: "Draft", editorialDecision: "Keep" },
    { id: "field", partner: "Anonymous", status: "Draft" },
    { id: "team-a", partner: "A", status: "Approved" },
    { id: "team-b", partner: "B", status: "Draft", editorialDecision: "Keep" },
  ];
  assert.deepEqual(reconcilePickerSelection(before, pieces, isAvailableCandidate), before);
});

test("banking or ruling out a selected Piece clears only that slot without substituting another", () => {
  for (const editorialDecision of ["Banked", "Ruled out"]) {
    const pieces = [
      { id: "view", partner: "A", editorialDecision },
      { id: "field", partner: "Anonymous" },
      { id: "new-view", partner: "B" },
      { id: "team-a", partner: "A" },
      { id: "team-b", partner: "B", editorialDecision },
    ];
    assert.deepEqual(
      reconcilePickerSelection({ view: "view", field: "field", team: ["team-a", "team-b"] }, pieces, isAvailableCandidate),
      { view: null, field: "field", team: ["team-a"] },
    );
  }
});

test("refresh removes unavailable rows and duplicate team voices while retaining unrelated choices", () => {
  const pieces = [
    { id: "view", partner: "A" },
    { id: "team-a1", partner: "A" },
    { id: "team-a2", partner: "A" },
    { id: "team-b", partner: "B", status: "Archived" },
    { id: "team-c", partner: "C" },
  ];
  assert.deepEqual(
    reconcilePickerSelection({ view: "view", field: "missing", team: ["team-a2", "team-a1", "team-b", "team-c"] }, pieces, isAvailableCandidate),
    { view: "view", field: null, team: ["team-a2", "team-c"] },
  );
});

test("a fresh browser starts with the issue draft while saved custom swaps and intentional clears remain", () => {
  const pieces = [{ id: "view", partner: "A" }, { id: "alternative", partner: "B" }, { id: "field", partner: "Anonymous" }];
  const draft = { view: "view", field: "field", team: [] };
  assert.deepEqual(chooseIssuePickerSelection(null, null, draft, pieces, isAvailableCandidate), { origin: "draft", selection: draft });
  const custom = { origin: "custom", selection: { ...draft, view: "alternative" } };
  assert.deepEqual(chooseIssuePickerSelection(custom, null, draft, pieces, isAvailableCandidate), custom);
  const cleared = { origin: "custom", selection: { view: null, field: null, team: [] } };
  assert.deepEqual(chooseIssuePickerSelection(cleared, null, draft, pieces, isAvailableCandidate), cleared);
});

test("legacy valid choices migrate as custom; empty or another issue's choices do not suppress defaults", () => {
  const pieces = [{ id: "view", partner: "A" }, { id: "alternative", partner: "B" }];
  const draft = { view: "view", field: null, team: [] };
  const legacy = { view: "alternative", field: null, team: [] };
  assert.deepEqual(chooseIssuePickerSelection(null, legacy, draft, pieces, isAvailableCandidate), { origin: "custom", selection: legacy });
  for (const previous of [{ view: null, field: null, team: [] }, { view: "another-issue", field: null, team: [] }]) {
    assert.deepEqual(chooseIssuePickerSelection(null, previous, draft, pieces, isAvailableCandidate), { origin: "draft", selection: draft });
  }
});

test("untouched defaults follow a regenerated issue draft while an omitted Keep remains available", () => {
  const pieces = [{ id: "old", partner: "A", editorialDecision: "Keep" }, { id: "new", partner: "B" }];
  const before = { origin: "draft", selection: { view: "old", field: null, team: [] } };
  const draft = { view: "new", field: null, team: [] };
  assert.deepEqual(chooseIssuePickerSelection(before, null, draft, pieces, isAvailableCandidate), { origin: "draft", selection: draft });
  assert.equal(isAvailableCandidate(pieces[0]), true);
  // A deliberate local pick still remains custom when the issue draft changes.
  assert.deepEqual(chooseIssuePickerSelection({ ...before, origin: "custom" }, null, draft, pieces, isAvailableCandidate), {
    origin: "custom", selection: before.selection,
  });
});

test("saved browser data is scoped by issue and rejects malformed records", () => {
  const issue = "11111111-1111-1111-1111-111111111111";
  const saved = { origin: "custom", selection: { view: "a", field: null, team: [] } };
  assert.deepEqual(readSavedPickerSelections({ [issue]: saved, bad: { origin: "unexpected", selection: saved.selection } }), { [issue]: saved });
  assert.deepEqual(readSavedPickerSelections([saved]), {});
});
