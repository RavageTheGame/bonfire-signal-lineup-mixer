import test from "node:test";
import assert from "node:assert/strict";
import { parseDraftLineup, readDraftLineupProperty, resolveDraftLineup } from "../lib/draft-lineup.ts";
import { isAvailableCandidate } from "../lib/editorial-decision.ts";

const id = (number) => number.toString(16).padStart(32, "0");
const dashed = (value) => `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
const definition = { bigIdeaId: id(1), teamTakeIds: [id(2), id(3), id(4), id(5)], fieldNoteId: id(6) };
const pieces = [
  { id: dashed(id(1)), type: "Big Idea", partner: "A", hasBody: true },
  ...[2, 3, 4, 5].map((number) => ({ id: dashed(id(number)), type: "Team take", partner: `Voice ${number}`, hasBody: true })),
  { id: dashed(id(6)), type: "Field Notes", partner: "Anonymous", hasBody: true },
];

test("the explicit Issue JSON preserves Team order and resolves actual current Piece IDs", () => {
  const parsed = parseDraftLineup(JSON.stringify(definition));
  assert.deepEqual(parsed, definition);
  assert.deepEqual(resolveDraftLineup(parsed, pieces, isAvailableCandidate), {
    view: dashed(id(1)), team: [2, 3, 4, 5].map((number) => dashed(id(number))), field: dashed(id(6)),
  });
  assert.deepEqual(readDraftLineupProperty({ "Draft lineup": { type: "rich_text", rich_text: [
    { plain_text: JSON.stringify(definition).slice(0, 40) }, { plain_text: JSON.stringify(definition).slice(40) },
  ] } }, "Draft lineup"), definition);
});

test("missing or malformed metadata never infers a lineup from prose or accepts extra fields", () => {
  for (const value of [undefined, "", "Choose the first six Pieces", "[]", "{}", JSON.stringify({ ...definition, instructions: "choose something else" }),
    JSON.stringify({ ...definition, bigIdeaId: "https://example.com/piece" }),
    JSON.stringify({ ...definition, teamTakeIds: [id(2), id(3), id(4), id(5), id(7)] })]) {
    assert.equal(parseDraftLineup(value), null);
  }
  assert.equal(readDraftLineupProperty({}, "Draft lineup"), null);
  assert.equal(resolveDraftLineup(null, pieces, isAvailableCandidate), null);
});

test("banked, ruled-out, wrong-section, missing and bodyless Pieces leave their slots open", () => {
  for (const patch of [{ editorialDecision: "Banked" }, { editorialDecision: "Ruled out" }, { status: "Archived" }, { type: "Team take" }, { hasBody: false }]) {
    const changed = pieces.map((piece, index) => index ? piece : { ...piece, ...patch });
    assert.equal(resolveDraftLineup(definition, changed, isAvailableCandidate).view, null);
  }
  const result = resolveDraftLineup({ ...definition, fieldNoteId: id(99) }, pieces, isAvailableCandidate);
  assert.equal(result.field, null);
  assert.equal(result.team.length, 4);
});

test("invalid or duplicate Team voices cannot form a false complete newsletter", () => {
  const changed = pieces.map((piece, index) => index === 2 ? { ...piece, partner: "Voice 2" }
    : index === 3 ? { ...piece, partner: "TBD" } : piece);
  assert.deepEqual(resolveDraftLineup(definition, changed, isAvailableCandidate).team, [dashed(id(2)), dashed(id(5))]);
  assert.deepEqual(resolveDraftLineup({ ...definition, teamTakeIds: [id(2), id(2)] }, pieces, isAvailableCandidate).team, [dashed(id(2))]);
});
