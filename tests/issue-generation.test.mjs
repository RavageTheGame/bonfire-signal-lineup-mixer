import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { editorAccessConfigured, requireEditorAccess } from "../lib/editor-access.ts";

// Match the app bundler's resolution of extensionless TypeScript imports.
registerHooks({ resolve(specifier, context, nextResolve) {
  try { return nextResolve(specifier, context); }
  catch (error) {
    if (error.code === "ERR_MODULE_NOT_FOUND" && specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
    throw error;
  }
} });
const { issueHasGenerated, parseIssueGenerationPayload, queueIssueGeneration } = await import("../lib/issue-generation.ts");

const issueId = "11111111-1111-4111-8111-111111111111";
const issuesDatabaseId = "22222222-2222-4222-8222-222222222222";
const otherId = "33333333-3333-4333-8333-333333333333";
const piecesDatabaseId = "44444444-4444-4444-8444-444444444444";
const pieceId = "55555555-5555-4555-8555-555555555555";
const select = (name) => ({ type: "select", select: name ? { name } : null });
const date = (start) => ({ type: "date", date: start ? { start } : null });
const lineup = (value) => ({ type: "rich_text", rich_text: value ? [{ plain_text: value }] : [] });

function fixture() {
  const issue = {
    id: issueId, parent: { type: "database_id", database_id: issuesDatabaseId }, archived: false, in_trash: false,
    properties: {
      "Active issue": { type: "checkbox", checkbox: true },
      "Generation status": select("Idle"), Status: select("Draft"),
      "Source start": date("2026-09-25"), "Source end": date("2026-10-30"),
      "Generated at": date(null), "Draft lineup": lineup(null),
    },
  };
  const piece = {
    id: pieceId, parent: { type: "database_id", database_id: piecesDatabaseId }, archived: false, in_trash: false,
    last_edited_time: "2026-11-05T09:00:00.000Z",
    properties: {
      Type: select("Big Idea"), Status: select("Draft"), "Editorial decision": select(null),
      "Related Issue": { type: "relation", relation: [{ id: issueId }] },
    },
  };
  const issues = [{ id: issueId }];
  const writes = [];
  const schema = { properties: { "Generation status": { type: "select", select: { options: [{ id: "queued-option", name: "Queued" }] } } } };
  const client = {
    databases: {
      retrieve: async ({ database_id }) => { assert.equal(database_id, issuesDatabaseId); return schema; },
      query: async (request) => {
      assert.equal(request.database_id, issuesDatabaseId);
      assert.deepEqual(request.filter, { property: "Active issue", checkbox: { equals: true } });
      return { results: issues };
    } },
    pages: {
      retrieve: async ({ page_id }) => {
        if (page_id === pieceId) return piece;
        assert.equal(page_id.replaceAll("-", ""), issueId.replaceAll("-", ""));
        return issue;
      },
      update: async (request) => { writes.push(request); return issue; },
    },
  };
  return { client, issue, issues, piece, writes, schema };
}

test("editor-only actions fail closed unless configured and presented with the exact key", () => {
  const previous = process.env.SIGNAL_EDITOR_KEY;
  const key = "test-key-1234567890-1234567890-1234567890";
  const request = (value) => new Request("https://example.com/api/issues", value ? { headers: { "X-Signal-Editor-Key": value } } : {});
  try {
    for (const unconfigured of ["", "short"]) {
      process.env.SIGNAL_EDITOR_KEY = unconfigured;
      assert.equal(editorAccessConfigured(), false);
      assert.throws(() => requireEditorAccess(request(key)), { status: 503 });
    }
    process.env.SIGNAL_EDITOR_KEY = key;
    assert.equal(editorAccessConfigured(), true);
    assert.throws(() => requireEditorAccess(request()), { status: 401 });
    assert.throws(() => requireEditorAccess(request(key.toUpperCase())), { status: 401 });
    assert.doesNotThrow(() => requireEditorAccess(request(key)));
  } finally {
    if (previous === undefined) delete process.env.SIGNAL_EDITOR_KEY;
    else process.env.SIGNAL_EDITOR_KEY = previous;
  }
});

test("generation accepts only the requested mode, supported destination and source identifier", () => {
  for (const request of [{ mode: "initial" }, { mode: "additive" }, { mode: "section", section: "Field Notes" },
    { mode: "move", pieceId, section: "Team take" }]) {
    assert.deepEqual(parseIssueGenerationPayload(request), request);
  }
  for (const payload of [null, {}, [], { mode: "rebuild" }, { mode: "additive", force: true },
    { mode: "section", section: "toString" }, { mode: "section", section: "Big Idea", requestId: otherId },
    { mode: "move", section: "Team take", pieceId: "invalid" }]) {
    assert.throws(() => parseIssueGenerationPayload(payload), { status: 400 });
  }
});

test("both generation paths change only the trigger property and preserve draft and metadata", async () => {
  for (const mode of ["initial", "additive"]) {
    const f = fixture();
    if (mode === "additive") {
      f.issue.properties["Draft lineup"] = lineup("A saved editor lineup, including unparseable legacy contents.");
      f.issue.properties["Generation status"] = select("Needs attention");
    }
    const before = structuredClone(f.issue);
    assert.equal(issueHasGenerated(f.issue.properties), mode === "additive");
    assert.equal(await queueIssueGeneration(f.client, issueId, { mode }, issuesDatabaseId), "Queued");
    assert.deepEqual(f.writes, [{ page_id: issueId, properties: { "Generation status": { select: { id: "queued-option" } } } }]);
    assert.deepEqual(f.issue, before);
  }
});

test("dated generation remains additive after the status becomes Queued", () => {
  const f = fixture();
  f.issue.properties["Generated at"] = date("2026-11-02");
  f.issue.properties["Generation status"] = select("Queued");
  assert.equal(issueHasGenerated(f.issue.properties), true);
});

test("queue refuses inactive, invalid-window, already running, finalized and stale mode requests", async () => {
  const cases = [
    [(f) => { f.issues.push({ id: otherId }); }, 409],
    [(f) => { f.issues[0].id = otherId; }, 409],
    [(f) => { f.issue.parent.database_id = otherId; }, 404],
    [(f) => { f.issue.in_trash = true; }, 404],
    [(f) => { f.issue.properties["Active issue"].checkbox = false; }, 409],
    [(f) => { f.issue.properties["Generation status"] = select("Queued"); }, 409],
    [(f) => { f.issue.properties["Generation status"] = select("Drafting"); }, 409],
    [(f) => { f.issue.properties.Status = select("Sent"); }, 409],
    [(f) => { f.issue.properties["Source start"] = date("2026-11-01"); }, 409],
    [(f) => { f.issue.properties["Source end"] = date(null); }, 409],
    [(f) => { f.issue.properties["Generated at"] = date("2026-11-02"); }, 409],
    [(f) => { delete f.issue.properties["Draft lineup"]; }, 503],
    [(f) => { f.schema.properties["Generation status"].select.options.length = 0; }, 503],
  ];
  for (const [change, status] of cases) {
    const f = fixture();
    change(f);
    await assert.rejects(queueIssueGeneration(f.client, issueId, { mode: "initial" }, issuesDatabaseId), { status });
    assert.equal(f.writes.length, 0);
  }
});

test("overlapping requests for the same issue queue at most once in one instance", async () => {
  const f = fixture();
  const first = queueIssueGeneration(f.client, issueId, { mode: "initial" }, issuesDatabaseId);
  await assert.rejects(queueIssueGeneration(f.client, issueId.replaceAll("-", ""), { mode: "initial" }, issuesDatabaseId), { status: 409 });
  assert.equal(await first, "Queued");
  assert.equal(f.writes.length, 1);
});

function enableScopedRequests(f) {
  f.issue.properties["Generation request"] = lineup(null);
  f.schema.properties["Generation request"] = { type: "rich_text", rich_text: {} };
}

function savedScopedRequest(f) {
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].page_id, issueId);
  assert.deepEqual(f.writes[0].properties["Generation status"], { select: { id: "queued-option" } });
  return JSON.parse(f.writes[0].properties["Generation request"].rich_text[0].text.content);
}

test("section generation sets one bounded scope and its server request ID with the Queued option", async () => {
  const f = fixture();
  const request = { mode: "section", section: "Field Notes" };
  await assert.rejects(queueIssueGeneration(f.client, issueId, request, issuesDatabaseId), { status: 503 });
  enableScopedRequests(f);
  await queueIssueGeneration(f.client, issueId, request, issuesDatabaseId);
  const { requestId, ...scope } = savedScopedRequest(f);
  assert.match(requestId, /^[a-f0-9-]{36}$/);
  assert.deepEqual(scope, request);
  assert.deepEqual(Object.keys(f.writes[0].properties).sort(), ["Generation request", "Generation status"]);
});

test("a regular full-issue run clears old scoped request data in the queue write", async () => {
  const f = fixture();
  enableScopedRequests(f);
  f.issue.properties["Generation request"] = lineup('{"mode":"section","section":"Big Idea"}');
  await queueIssueGeneration(f.client, issueId, { mode: "initial" }, issuesDatabaseId);
  assert.deepEqual(f.writes[0].properties["Generation request"], { rich_text: [] });
});

test("moves leave source rows alone while recording when Bonnie must keep the original", async () => {
  for (const protection of ["none", "saved", "malformed lineup", "Keep", "Banked", "Ruled out", "Approved", "Cleared"]) {
    const f = fixture();
    enableScopedRequests(f);
    if (protection === "saved") f.issue.properties["Draft lineup"] = lineup(JSON.stringify({ bigIdeaId: pieceId, teamTakeIds: [], fieldNoteId: otherId }));
    if (protection === "malformed lineup") f.issue.properties["Draft lineup"] = lineup("Previously saved draft");
    if (protection === "Approved") f.piece.properties.Status = select("Approved");
    if (protection === "Cleared") f.piece.properties["Confidentiality cleared"] = { type: "checkbox", checkbox: true };
    if (["Keep", "Banked", "Ruled out"].includes(protection)) f.piece.properties["Editorial decision"] = select(protection);
    const originalPiece = structuredClone(f.piece);
    const request = { mode: "move", pieceId, section: "Team take" };
    await queueIssueGeneration(f.client, issueId, request, issuesDatabaseId, piecesDatabaseId);
    const { requestId, ...scope } = savedScopedRequest(f);
    assert.match(requestId, /^[a-f0-9-]{36}$/);
    assert.deepEqual(scope, { ...request, sourceEditedTime: f.piece.last_edited_time, preserveSource: protection !== "none" });
    assert.deepEqual(f.piece, originalPiece);
  }
});

test("reject cross-issue, same-section and archived moves before queueing", async () => {
  for (const [section, alter, status] of [
    ["Big Idea", () => {}, 400],
    ["Team take", (f) => { f.piece.properties["Related Issue"].relation[0].id = otherId; }, 409],
    ["Team take", (f) => { f.piece.properties.Status = select("Archived"); }, 409],
    ["Team take", (f) => { f.piece.parent.database_id = otherId; }, 404],
  ]) {
    const f = fixture();
    enableScopedRequests(f);
    alter(f);
    await assert.rejects(queueIssueGeneration(f.client, issueId, { mode: "move", pieceId, section }, issuesDatabaseId, piecesDatabaseId), { status });
    assert.deepEqual(f.writes, []);
  }
});
