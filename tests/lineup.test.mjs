import test from "node:test";
import assert from "node:assert/strict";
import { distinctTeamPieces } from "../lib/lineup.ts";

test("a four-take lineup needs four distinct voices", () => {
  const pieces = [
    { id: "a1", partner: "A" }, { id: "b1", partner: "B" },
    { id: "a2", partner: "A" }, { id: "c1", partner: "C" },
    { id: "d1", partner: "D" }, { id: "b2", partner: "B" },
  ];
  assert.deepEqual(distinctTeamPieces(pieces).map((p) => p.id), ["a1", "b1", "c1", "d1"]);
  assert.equal(distinctTeamPieces(pieces.slice(0, 4)).length, 3);
});
