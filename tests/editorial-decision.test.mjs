import test from "node:test";
import assert from "node:assert/strict";
import {
  EditorialDecisionError,
  isAvailableCandidate,
  isSameOriginRequest,
  normalizeEditorialDecision,
  parseDecisionPayload,
  updateEditorialDecision,
} from "../lib/editorial-decision.ts";

const pageId = "11111111-1111-4111-8111-111111111111";
const issueId = "22222222-2222-4222-8222-222222222222";
const piecesDatabaseId = "33333333-3333-4333-8333-333333333333";
const config = {
  piecesDatabaseId,
  issuesDatabaseId: "44444444-4444-4444-8444-444444444444",
  props: {
    decision: "Editorial decision",
    status: "Status",
    type: "Type",
    relatedIssue: ["Related Issue"],
  },
};

function pageFixture() {
  return {
    object: "page",
    id: pageId,
    parent: { type: "database_id", database_id: piecesDatabaseId },
    archived: false,
    in_trash: false,
    properties: {
      Name: { type: "title", title: [{ plain_text: "A sourced draft" }] },
      Type: { type: "select", select: { name: "Big Idea" } },
      Status: { type: "select", select: { name: "Approved" } },
      "Editorial decision": { type: "select", select: null },
      "Related Issue": { type: "relation", relation: [{ id: issueId }] },
      "Pull quote": { type: "rich_text", rich_text: [{ plain_text: "Existing quote." }] },
      "Sources notes": { type: "rich_text", rich_text: [{ plain_text: "Existing source pointer." }] },
    },
  };
}

function notionFixture(page = pageFixture(), issues = [{ id: issueId }]) {
  const writes = [];
  const queries = [];
  return {
    writes,
    queries,
    client: {
      pages: {
        retrieve: async ({ page_id }) => {
          assert.equal(page_id, pageId);
          return page;
        },
        update: async (request) => { writes.push(request); return page; },
      },
      databases: {
        query: async (request) => { queries.push(request); return { results: issues }; },
      },
    },
  };
}

test("older Pieces remain available while Banked, Ruled out and Archived stay out of the picker", () => {
  assert.equal(normalizeEditorialDecision(undefined), "");
  assert.equal(normalizeEditorialDecision("not a decision"), "");
  assert.equal(normalizeEditorialDecision("Keep"), "Keep");
  assert.equal(isAvailableCandidate({ status: "Draft" }), true);
  assert.equal(isAvailableCandidate({ editorialDecision: "Keep", status: "Draft" }), true);
  for (const editorialDecision of ["Banked", "Ruled out"]) {
    assert.equal(isAvailableCandidate({ editorialDecision, status: "Approved" }), false);
  }
  assert.equal(isAvailableCandidate({ editorialDecision: "Keep", status: "Archived" }), false);
});

test("only explicit null clears a decision; invalid values or extra write fields are rejected", () => {
  for (const value of ["Keep", "Banked", "Ruled out"]) {
    assert.equal(parseDecisionPayload({ decision: value }), value);
  }
  assert.equal(parseDecisionPayload({ decision: null }), "");
  for (const payload of [null, [], {}, { decision: "" }, { decision: "keep" },
    { decision: false }, { decision: "Approved" }, { decision: "Keep", Status: "Approved" }]) {
    assert.throws(() => parseDecisionPayload(payload), EditorialDecisionError);
  }
});

test("browser decision writes must come from the request's own origin", () => {
  assert.equal(isSameOriginRequest("https://mixer.example", "https://mixer.example/api/pieces/id/decision"), true);
  assert.equal(isSameOriginRequest(null, "https://mixer.example/api/pieces/id/decision"), true);
  for (const origin of ["https://other.example", "https://mixer.example:444", "null", "not a URL"]) {
    assert.equal(isSameOriginRequest(origin, "https://mixer.example/api/pieces/id/decision"), false);
  }
});

test("decision updates preserve approval, copy and provenance by writing only the select property", async () => {
  for (const decision of ["Keep", "Banked", "Ruled out", ""]) {
    const page = pageFixture();
    const before = structuredClone(page);
    const { client, writes, queries } = notionFixture(page);
    assert.equal(await updateEditorialDecision(client, pageId, decision, config), decision);
    assert.deepEqual(writes, [{
      page_id: pageId,
      properties: { "Editorial decision": { select: decision ? { name: decision } : null } },
    }]);
    assert.deepEqual(page, before);
    assert.equal(queries[0].database_id, config.issuesDatabaseId);
    assert.deepEqual(queries[0].filter, { property: "Active issue", checkbox: { equals: true } });
  }
});

test("arbitrary, trashed, archived or non-newsletter pages cannot receive decision writes", async () => {
  const cases = [
    (p) => { p.parent.database_id = issueId; },
    (p) => { p.parent = { type: "page_id", page_id: issueId }; },
    (p) => { p.archived = true; },
    (p) => { p.in_trash = true; },
    (p) => { p.properties.Status.select.name = "Archived"; },
    (p) => { p.properties.Type.select.name = "LinkedIn"; },
    (p) => { delete p.properties["Editorial decision"]; },
  ];
  for (const mutate of cases) {
    const page = pageFixture();
    mutate(page);
    const { client, writes } = notionFixture(page);
    await assert.rejects(updateEditorialDecision(client, pageId, "Keep", config), EditorialDecisionError);
    assert.equal(writes.length, 0);
  }
});

test("writes require exactly one active issue and an actual relation to that issue", async () => {
  for (const issues of [[], [{ id: issueId }, { id: pageId }], [{ id: pageId }]]) {
    const { client, writes } = notionFixture(pageFixture(), issues);
    await assert.rejects(updateEditorialDecision(client, pageId, "Banked", config), (error) => error.status === 409);
    assert.equal(writes.length, 0);
  }
});

test("UUID separators do not cause a current Piece to be mistaken for a different issue or database", async () => {
  const page = pageFixture();
  page.parent.database_id = piecesDatabaseId.replaceAll("-", "");
  page.properties["Related Issue"].relation[0].id = issueId.replaceAll("-", "");
  const { client, writes } = notionFixture(page);
  await updateEditorialDecision(client, pageId, "Keep", config);
  assert.equal(writes.length, 1);
});

test("bad IDs and invalid direct-call decisions fail before any Notion write", async () => {
  const { client, writes } = notionFixture();
  await assert.rejects(updateEditorialDecision(client, "not-a-page", "Keep", config), EditorialDecisionError);
  await assert.rejects(updateEditorialDecision(client, pageId, "Approved", config), EditorialDecisionError);
  assert.equal(writes.length, 0);
});
