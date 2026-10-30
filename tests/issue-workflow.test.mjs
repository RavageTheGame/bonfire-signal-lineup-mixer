import assert from "node:assert/strict";
import { test } from "node:test";
import { currentCandidates, recommendedLineup, cleanLineup, emptyLineup, validSourceWindow } from "../lib/issue-workflow.ts";

const issue = { id: "november", title: "Issue 04 — November 2026", sourceStart: "2026-09-25", sourceEnd: "2026-10-30", generationStatus: "Ready" };
const piece = (changes = {}) => ({ id: "current", title: "A fresh pattern", type: "Big Idea", partner: "Jen", issueId: "november", mixerSlot: "Bonfire View", candidateRank: 1, recommended: true, sourceDate: "2026-10-20", status: "Draft", hasBody: true, ...changes });

test("current issue filtering excludes old issues, missing relations, dates, and archived copy", () => {
  const items = [piece(), piece({ id: "oct", issueId: "october", lastEditedTime: "2026-10-30" }), piece({ id: "missing", issueId: null }), piece({ id: "old", sourceDate: "2026-09-24" }), piece({ id: "future", sourceDate: "2026-10-31" }), piece({ id: "undated", sourceDate: null }), piece({ id: "archived", status: "Archived" }), piece({ id: "no-body", hasBody: false })];
  assert.deepEqual(currentCandidates(items, issue).map((p) => p.id), ["current"]);
});

test("source window is inclusive, validates dates, and fails closed without an active issue", () => {
  assert.equal(currentCandidates([piece({ sourceDate: "2026-09-25" })], issue).length, 1);
  assert.equal(currentCandidates([piece({ sourceDate: "2026-10-30T23:59:00-07:00" })], issue).length, 1);
  assert.deepEqual(currentCandidates([piece()], null), []);
  assert.deepEqual(currentCandidates([piece()], { ...issue, sourceStart: null }), []);
  assert.equal(validSourceWindow({ ...issue, sourceStart: "2026-11-01" }), false);
  assert.equal(validSourceWindow({ ...issue, sourceStart: "2026-09-31" }), false);
});

test("only three ranked distinct candidates per slot are returned, regardless of source order", () => {
  const items = [piece({ id: "rank3", candidateRank: 3 }), piece({ id: "rank1", candidateRank: 1 }), piece({ id: "rank2", candidateRank: 2 }), piece({ id: "rank4", candidateRank: 4 }), piece({ id: "rank1", candidateRank: 1 }), piece({ id: "wrong-type", mixerSlot: "Team take 1" })];
  assert.deepEqual(currentCandidates(items, issue).map((p) => p.id), ["rank1", "rank2", "rank3"]);
});

test("recommended draft fills six slots with four distinct voices", () => {
  const items = [piece(), ...["Brett", "Jim", "Mark", "Jason"].map((partner, i) => piece({ id: `t${i+1}`, type: "Team take", mixerSlot: `Team take ${i+1}`, partner })), piece({ id: "field", type: "Field Notes", mixerSlot: "Field Notes" })];
  assert.deepEqual(recommendedLineup(items), { view: "current", team1: "t1", team2: "t2", team3: "t3", team4: "t4", field: "field" });
  const duplicate = items.map((p) => p.id === "t4" ? { ...p, partner: "Brett" } : p);
  assert.equal(recommendedLineup(duplicate).team4, null);
});

test("saved picks cannot cross issues or slots, and an intentionally cleared lineup stays empty", () => {
  const items = currentCandidates([piece()], issue);
  assert.deepEqual(cleanLineup({ view: "october-piece", field: "current" }, items), emptyLineup());
  assert.deepEqual(cleanLineup(emptyLineup(), items), emptyLineup());
  assert.equal(cleanLineup({ view: "current" }, items).view, "current");
});
