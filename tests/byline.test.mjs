import test from "node:test";
import assert from "node:assert/strict";
import { stripLeadingByline } from "../lib/byline.ts";

test("each Bonfire View contributor appears once above the essay", () => {
  const essay = "<p>Keep the opening paragraph.</p>";
  for (const byline of ["Jen Richard, Principal", "Brett Queener, Partner", "Tyler Churchill, Partner"]) {
    const body = `<p><strong>${byline}</strong></p>\n${essay}`;
    assert.equal(stripLeadingByline(body, byline), essay);
    assert.equal((`<p>${byline}</p>${stripLeadingByline(body, byline)}`).split(byline).length - 1, 1);
  }
});

test("recognizes a formatted standalone byline with a By prefix or trailing comma", () => {
  assert.equal(
    stripLeadingByline('<p>By <b>JEN&nbsp;RICHARD</b>, Principal,</p><p>Keep this <em>copy</em>.</p>', "Jen Richard, Principal"),
    "<p>Keep this <em>copy</em>.</p>",
  );
});

test("preserves opening prose, other contributors, and attribution later in the essay", () => {
  for (const body of [
    "<p>Jen Richard, Principal, sees the workflow differently.</p>",
    "<p><strong>Brett Queener, Partner</strong></p><p>Keep this copy.</p>",
    "<p>Opening thought.</p><p>Jen Richard, Principal</p>",
  ]) assert.equal(stripLeadingByline(body, "Jen Richard, Principal"), body);
});

test("leaves drafts without an inline byline unchanged", () => {
  const body = "<p>An opening paragraph with useful prose.</p>";
  assert.equal(stripLeadingByline(body, "Jen Richard, Principal"), body);
  assert.equal(stripLeadingByline(body, ""), body);
});
