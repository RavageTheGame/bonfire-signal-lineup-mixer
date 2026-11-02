import test from "node:test";
import assert from "node:assert/strict";
import { reconcilePickerSelection } from "../lib/picker-state.ts";
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
