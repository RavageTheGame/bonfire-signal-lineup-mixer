import test from "node:test";
import assert from "node:assert/strict";
import { belongsToIssue, requireActiveIssue } from "../lib/issue-workflow.ts";

test("requires exactly one issue selected in Notion", () => {
  const november = { id: "november" };
  assert.equal(requireActiveIssue([november]), november);
  assert.throws(() => requireActiveIssue([]), /Select an Active issue/);
  assert.throws(() => requireActiveIssue([november, { id: "october" }]), /only one/);
});

test("historical and unrelated Pieces stay out of the selected issue", () => {
  const november = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  assert.equal(belongsToIssue([november.replace(/-/g, "").toUpperCase()], november), true);
  assert.equal(belongsToIssue(["11111111-2222-3333-4444-555555555555"], november), false);
  assert.equal(belongsToIssue([], november), false);
});
