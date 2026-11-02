import test from "node:test";
import assert from "node:assert/strict";
import { readPullQuoteProperty, withPullQuote } from "../lib/pull-quote.ts";
import { PIECE_PROPS } from "../lib/piece-schema.ts";

test("reads a split Notion Pull quote text property without rich formatting", () => {
  const props = {
    "Pull quote": {
      type: "rich_text",
      rich_text: [
        { plain_text: "  A useful ", annotations: { bold: true } },
        { plain_text: "observation.  " },
      ],
    },
  };
  assert.equal(readPullQuoteProperty(props, PIECE_PROPS.pullQuote), "A useful observation.");
  assert.equal(readPullQuoteProperty({}, PIECE_PROPS.pullQuote), "");
  assert.equal(readPullQuoteProperty({ "Pull quote": { type: "select" } }, PIECE_PROPS.pullQuote), "");
});

test("adds one display quote after the second paragraph without changing source copy", () => {
  const body = "<p>Opening copy.</p>\n<p>A useful observation.</p>\n<p>Closing thought.</p>";
  const displayed = withPullQuote(body, "A useful observation.", "Draft body", 1);
  assert.equal(displayed, "<p>Opening copy.</p>\n<p>A useful observation.</p>\n<blockquote class=\"pull-quote\">A useful observation.</blockquote>\n<p>Closing thought.</p>");
  assert.equal(body.includes("blockquote"), false);
});

test("quote metadata is escaped as text and cannot introduce HTML", () => {
  const displayed = withPullQuote('<p>Literal example &lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; words.</p>', '<img src=x onerror="alert(1)"> & words', "Draft body", 1);
  assert.equal(displayed.includes("<img"), false);
  assert.ok(displayed.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; words"));
});

test("empty quotes and missing bodies add no placeholder or markup", () => {
  for (const quote of [undefined, "", "  "]) {
    assert.equal(withPullQuote("<p>Keep copy.</p>", quote, "Draft body", 1), "<p>Keep copy.</p>");
  }
  assert.equal(withPullQuote("", "A quote without a draft.", "Draft body", 1), "");
});

test("a Piece quote does not follow an unrelated alternate option", () => {
  const body = "<p>Canonical quote.</p>";
  assert.equal(withPullQuote(body, "Canonical quote.", "Option 2", 3), body);
  assert.notEqual(withPullQuote(body, "Canonical quote.", "Draft body", 3), body);
});

test("editing or removing the excerpt hides stale metadata while unrelated edits retain it", () => {
  const quote = "The customer keeps the final decision.";
  const before = `<p>Opening.</p><p>${quote} The tool prepares the work.</p>`;
  assert.notEqual(withPullQuote(before, quote, "Draft body", 1), before);
  const rewritten = before.replace(quote, "The customer reviews the proposed decision.");
  assert.equal(withPullQuote(rewritten, quote, "Draft body", 1), rewritten);
  const removed = "<p>Opening.</p><p>The tool prepares the work.</p>";
  assert.equal(withPullQuote(removed, quote, "Draft body", 1), removed);
  const otherEdit = before.replace("Opening.", "A revised opening with more context.");
  assert.notEqual(withPullQuote(otherEdit, quote, "Draft body", 1), otherEdit);
});

test("encoded text, inline formatting, and whitespace still match the current excerpt", () => {
  const body = '<p>A <em>founder&#39;s</em> choice &amp; the team&rsquo;s work&nbsp; belong\n together. &quot;Decide&#x20;with care.&quot;</p>';
  assert.notEqual(withPullQuote(body, "A founder's choice & the team’s work belong together.", "Draft body", 1), body);
  assert.notEqual(withPullQuote(body, '"Decide with care."', "Draft body", 1), body);
});

test("noncontiguous fragments cannot be joined across paragraph boundaries", () => {
  for (const body of [
    "<p>The customer keeps</p><p>the final decision.</p>",
    "<p>The customer keeps another responsibility and the final decision.</p>",
  ]) {
    assert.equal(withPullQuote(body, "The customer keeps the final decision.", "Draft body", 1), body);
  }
});
