import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// The app's bundler resolves extensionless TS imports; use that same resolution in Node's strip-types tests.
registerHooks({ resolve(specifier, context, nextResolve) {
  try { return nextResolve(specifier, context); }
  catch (error) {
    if (error.code === "ERR_MODULE_NOT_FOUND" && specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context);
    throw error;
  }
} });
const { IssueDraftError, issueDraftRevision, locateIssueDraftRegion, parseIssueDraftPayload,
  readIssueDraftSnapshot, renderIssueDraftBlocks, saveIssueDraft } = await import("../lib/issue-draft-writeback.ts");

const issueId = "11111111-1111-4111-8111-111111111111";
const issuesDatabaseId = "22222222-2222-4222-8222-222222222222";
const piecesDatabaseId = "33333333-3333-4333-8333-333333333333";
const ids = Array.from({ length: 6 }, (_, index) => `44444444-4444-4444-8444-${String(index + 1).padStart(12, "0")}`);
const lineup = { bigIdeaId: ids[0], teamTakeIds: ids.slice(1, 5), fieldNoteId: ids[5] };
const config = { issuesDatabaseId, piecesDatabaseId };
const rich = (content) => [{ type: "text", plain_text: content, text: { content } }];
const block = (id, type, content) => ({ object: "block", id, type, has_children: false, [type]: { rich_text: rich(content) } });
const select = (name) => ({ type: "select", select: { name } });

function fixture() {
  const issue = { object: "page", id: issueId, parent: { type: "database_id", database_id: issuesDatabaseId }, archived: false, in_trash: false,
    properties: { Name: { type: "title", title: rich("Issue 04 — November 2026") }, "Active issue": { type: "checkbox", checkbox: true },
      "Generation status": select("Ready"), "Draft lineup": { type: "rich_text", rich_text: [] },
      "Human property": { type: "rich_text", rich_text: rich("Keep this property.") } } };
  const voices = ["Jen Richard", "Brett Queener", "Jim Andelman", "Mark Mullen", "Tyler Churchill", ""];
  const pages = new Map([[issueId, issue]]);
  const trees = new Map([[issueId, [block("overview", "paragraph", "Human overview."), block("marker", "heading_1", "Newsletter draft"),
    block("old1", "paragraph", "Previous draft one."), block("old2", "paragraph", "Previous draft two."),
    block("boundary", "heading_1", "Editorial notes"), block("human-note", "paragraph", "Keep human notes.")]]]);
  ids.forEach((id, index) => {
    pages.set(id, { object: "page", id, parent: { type: "database_id", database_id: piecesDatabaseId }, archived: false, in_trash: false,
      properties: { Name: { type: "title", title: rich(`Piece ${index + 1}`) }, Type: select(index === 0 ? "Big Idea" : index === 5 ? "Field Notes" : "Team take"),
        Status: select("Approved"), "Editorial decision": select("Keep"), "Related Issue": { type: "relation", relation: [{ id: issueId }] },
        People: { type: "people", people: voices[index] ? [{ name: voices[index] }] : [] },
        "Pull quote": { type: "rich_text", rich_text: rich("A supported quotation.") }, "Source notes": { type: "rich_text", rich_text: rich("Never touch provenance.") } } });
    trees.set(id, [block(`draft-${index}`, "heading_2", "Draft body"),
      ...(index === 0 ? [block(`byline-${index}`, "paragraph", "Jen Richard, Principal")] : []),
      block(`para-${index}`, "paragraph", "First paragraph. A supported quotation."), block(`para2-${index}`, "paragraph", "Second paragraph.")]);
  });
  const writes = [];
  const lists = new Map();
  let nextId = 0;
  const hooks = {};
  const locate = (id) => [...trees.values()].flat().find((item) => item.id === id);
  const client = {
    databases: { query: async (request) => {
      await hooks.query?.(request);
      return { results: hooks.activeIssues || [structuredClone(issue)] };
    } },
    pages: {
      retrieve: async ({ page_id }) => { await hooks.retrieve?.(page_id); return structuredClone(pages.get(page_id)); },
      update: async (request) => {
        writes.push(structuredClone(request));
        await hooks.beforePageUpdate?.(request);
        for (const [key, value] of Object.entries(request.properties)) {
          pages.get(request.page_id).properties[key] = { type: "rich_text", ...structuredClone(value) };
        }
        await hooks.afterPageUpdate?.(request);
        return structuredClone(pages.get(request.page_id));
      },
    },
    blocks: {
      children: {
        list: async ({ block_id, start_cursor }) => {
          const count = (lists.get(block_id) || 0) + 1;
          lists.set(block_id, count);
          await hooks.list?.(block_id, count);
          const visible = (trees.get(block_id) || []).filter((item) => !item.archived);
          const start = start_cursor ? Number(start_cursor) : 0;
          // Exercise pagination without requiring a 100-block fixture.
          const results = visible.slice(start, start + 8);
          return { results: structuredClone(results), has_more: start + 8 < visible.length, next_cursor: start + 8 < visible.length ? String(start + 8) : null };
        },
        append: async (request) => {
          writes.push(structuredClone(request));
          const requested = request.children.map((child) => ({ ...structuredClone(child), id: `new-${++nextId}`, has_children: false }));
          const result = typeof hooks.actualAppendCount === "number" ? requested.slice(0, hooks.actualAppendCount) : requested;
          const tree = trees.get(request.block_id);
          const index = tree.findIndex((item) => item.id === request.after);
          assert.notEqual(index, -1, "new draft is anchored inside the managed region");
          tree.splice(index + 1, 0, ...result);
          await hooks.append?.(request);
          return { results: hooks.appendResponse ? hooks.appendResponse(structuredClone(result), structuredClone(tree)) : structuredClone(result) };
        },
      },
      delete: async (request) => {
        writes.push(structuredClone(request));
        await hooks.beforeDelete?.(request);
        locate(request.block_id).archived = true;
      },
      update: async (request) => {
        writes.push(structuredClone(request));
        await hooks.beforeBlockUpdate?.(request);
        locate(request.block_id).archived = request.archived;
      },
    },
  };
  const revision = () => issueDraftRevision(trees.get(issueId).filter((item) => !item.archived), issue.properties);
  const input = () => ({ lineup: structuredClone(lineup), revision: revision() });
  return { client, issue, pages, trees, writes, hooks, revision, input };
}

test("draft save input requires the exact six IDs and an optimistic version, never client prose", () => {
  const valid = { lineup, revision: "a".repeat(64) };
  assert.deepEqual(parseIssueDraftPayload(valid), valid);
  for (const value of [null, {}, { ...valid, bodyHtml: "Injected prose" }, { ...valid, revision: "" },
    { ...valid, lineup: { ...lineup, teamTakeIds: ids.slice(1, 4) } },
    { ...valid, lineup: { ...lineup, bigIdeaId: null } }, { ...valid, lineup: { ...lineup, other: ids[0] } },
    { ...valid, lineup: { ...lineup, fieldNoteId: ids[0].replaceAll("-", "") } }]) {
    assert.throws(() => parseIssueDraftPayload(value), IssueDraftError);
  }
});

test("the visible managed region is unique, explicitly bounded and never owns human containers", () => {
  const f = fixture();
  const root = f.trees.get(issueId);
  assert.deepEqual(locateIssueDraftRegion(root).content.map((item) => item.id), ["old1", "old2"]);
  for (const change of [
    (blocks) => blocks.filter((item) => item.id !== "marker"),
    (blocks) => [...blocks, block("duplicate", "heading_1", "Newsletter draft")],
    (blocks) => blocks.filter((item) => item.id !== "boundary"),
    (blocks) => blocks.map((item) => item.id === "old1" ? { ...item, type: "child_database" } : item),
    (blocks) => blocks.map((item) => item.id === "old1" ? { ...item, has_children: true } : item),
  ]) assert.throws(() => locateIssueDraftRegion(change(root)), IssueDraftError);
});

test("revision covers human notes, draft formatting/order and lineup but ignores volatile timestamps", () => {
  const f = fixture();
  const initial = f.revision();
  f.trees.get(issueId)[0].last_edited_time = "new timestamp";
  assert.equal(f.revision(), initial);
  f.trees.get(issueId)[5].paragraph.rich_text = rich("Human edited a note.");
  assert.notEqual(f.revision(), initial);
  f.trees.get(issueId)[5].paragraph.rich_text = rich("Keep human notes.");
  f.issue.properties["Draft lineup"].rich_text = rich(JSON.stringify(lineup));
  assert.notEqual(f.revision(), initial);
});

test("save assembles current server bodies and commits only the canonical issue mapping; outside content and Pieces survive", async () => {
  const f = fixture();
  const beforePages = structuredClone([...f.pages.entries()]);
  const beforeHuman = structuredClone(f.trees.get(issueId).filter((item) => ["overview", "marker", "boundary", "human-note"].includes(item.id)));
  const response = await saveIssueDraft(f.client, issueId, f.input(), config);
  assert.deepEqual(response.lineup, lineup);
  assert.equal(response.revision, f.revision());
  assert.match(response.savedAt, /^\d{4}-/);
  assert.equal(f.trees.get(issueId).find((item) => item.id === "old1").archived, true);
  assert.equal(f.trees.get(issueId).find((item) => item.id === "old2").archived, true);
  assert.deepEqual(f.trees.get(issueId).filter((item) => ["overview", "marker", "boundary", "human-note"].includes(item.id)), beforeHuman);
  assert.deepEqual([...f.pages.entries()].filter(([id]) => id !== issueId), beforePages.filter(([id]) => id !== issueId));
  const propertyWrites = f.writes.filter((request) => request.page_id);
  assert.equal(propertyWrites.length, 1);
  assert.deepEqual(Object.keys(propertyWrites[0].properties), ["Draft lineup"]);
  assert.deepEqual(JSON.parse(propertyWrites[0].properties["Draft lineup"].rich_text[0].text.content), lineup);
  const region = locateIssueDraftRegion(f.trees.get(issueId).filter((item) => !item.archived));
  const content = region.content.map((item) => (item[item.type].rich_text || []).map((text) => text.text?.content || "").join(""));
  assert.equal(content.filter((text) => text === "Jen Richard, Principal").length, 1);
  assert.equal(region.content.filter((item) => item.type === "quote").length, 2);
  assert.ok(content.includes("First paragraph. A supported quotation."));
  assert.ok(content.includes("Early-stage B2B from the inside."));
  assert.ok(!f.writes.some((request) => request.block_id?.startsWith("para-")));
});

test("legacy mixed append responses never grant ownership of existing boundaries, notes or overview", async () => {
  for (const failAfterAppend of [false, true]) {
    const f = fixture();
    f.trees.get(issueId).push(block("note2", "paragraph", "Second protected human note."), block("note3", "paragraph", "Third protected human note."));
    const protectedIds = ["overview", "marker", "boundary", "human-note", "note2", "note3"];
    const original = structuredClone(f.trees.get(issueId).filter((item) => protectedIds.includes(item.id)));
    // Reproduce the real legacy response: newly created children plus following existing siblings.
    f.hooks.appendResponse = (created, tree) => [...created, ...tree.filter((item) => protectedIds.includes(item.id))];
    if (failAfterAppend) f.hooks.append = () => { f.issue.properties["Generation status"].select.name = "Drafting"; };
    if (failAfterAppend) await assert.rejects(saveIssueDraft(f.client, issueId, f.input(), config), (error) => error.status === 409);
    else await saveIssueDraft(f.client, issueId, f.input(), config);
    assert.deepEqual(f.trees.get(issueId).filter((item) => protectedIds.includes(item.id)), original);
    assert.ok(!f.writes.some((request) => protectedIds.includes(request.block_id)), "existing outside IDs must never be mutated, even during rollback");
    if (failAfterAppend) {
      assert.ok(f.trees.get(issueId).filter((item) => item.id.startsWith("new-")).every((item) => item.archived));
      assert.ok(f.trees.get(issueId).filter((item) => item.id.startsWith("old")).every((item) => !item.archived));
    }
  }
});

test("partial append responses are verified from the paginated tree, not assumed to be complete created-child inventories", async () => {
  const f = fixture();
  f.hooks.appendResponse = (created, tree) => [...created.slice(0, 2), ...tree.filter((item) => ["boundary", "human-note"].includes(item.id))];
  const result = await saveIssueDraft(f.client, issueId, f.input(), config);
  assert.deepEqual(result.lineup, lineup);
  assert.ok(!f.writes.some((request) => ["overview", "marker", "boundary", "human-note"].includes(request.block_id)));
});

test("multi-chunk saves verify every insertion independently even when each append response includes all existing siblings", async () => {
  const f = fixture();
  for (let piece = 0; piece < ids.length; piece++) {
    for (let paragraph = 0; paragraph < 20; paragraph++) f.trees.get(ids[piece]).push(block(`long-${piece}-${paragraph}`, "paragraph", `Saved source paragraph ${piece}.${paragraph}.`));
  }
  f.hooks.appendResponse = (_created, tree) => tree;
  await saveIssueDraft(f.client, issueId, f.input(), config);
  const appends = f.writes.filter((request) => request.children);
  assert.equal(appends.length, 2);
  assert.equal(appends[0].children.length, 100);
  assert.ok(!f.writes.some((request) => ["overview", "marker", "boundary", "human-note"].includes(request.block_id)));
  assert.ok(f.trees.get(issueId).filter((item) => item.id.startsWith("new-")).every((item) => !item.archived));
});

test("a genuinely partial insertion is retained for recovery and mixed response IDs never authorize cleanup", async () => {
  const f = fixture();
  f.hooks.actualAppendCount = 5;
  f.hooks.appendResponse = (created, tree) => [...created, ...tree.filter((item) => ["boundary", "human-note"].includes(item.id))];
  await assert.rejects(saveIssueDraft(f.client, issueId, f.input(), config), (error) => error.status === 503);
  assert.ok(f.trees.get(issueId).filter((item) => item.id.startsWith("new-")).every((item) => !item.archived));
  assert.ok(f.trees.get(issueId).filter((item) => !item.id.startsWith("new-")).every((item) => !item.archived));
  assert.ok(!f.writes.some((request) => ["overview", "marker", "old1", "old2", "boundary", "human-note"].includes(request.block_id)));
});

test("concurrent human blocks returned by append remain protected inside and outside the insertion range", async () => {
  for (const position of ["before", "after", "interleaved", "outside"]) {
    const f = fixture();
    f.hooks.append = () => {
      const tree = f.trees.get(issueId);
      const first = tree.findIndex((item) => item.id.startsWith("new-"));
      const boundary = tree.findIndex((item) => item.id === "boundary");
      const at = position === "before" ? first : position === "interleaved" ? first + 1 : position === "outside" ? boundary + 1 : boundary;
      tree.splice(at, 0, block("concurrent-human", "paragraph", "Human note added during save."));
    };
    f.hooks.appendResponse = (created, tree) => [...created, ...tree.filter((item) => ["boundary", "human-note", "concurrent-human"].includes(item.id))];
    await assert.rejects(saveIssueDraft(f.client, issueId, f.input(), config), IssueDraftError);
    assert.equal(f.trees.get(issueId).find((item) => item.id === "concurrent-human").archived, undefined);
    assert.ok(!f.writes.some((request) => ["overview", "marker", "old1", "old2", "boundary", "human-note", "concurrent-human"].includes(request.block_id)));
    const staged = f.trees.get(issueId).filter((item) => item.id.startsWith("new-"));
    assert.ok(staged.every((item) => position === "interleaved" ? !item.archived : item.archived));
  }
});

test("ambiguous duplicate content spans establish no cleanup ownership", async () => {
  const f = fixture();
  f.hooks.append = () => {
    const tree = f.trees.get(issueId);
    const duplicate = tree.filter((item) => item.id.startsWith("new-")).map((item) => ({ ...structuredClone(item), id: `human-${item.id}` }));
    tree.splice(tree.findIndex((item) => item.id === "boundary"), 0, ...duplicate);
  };
  f.hooks.appendResponse = (_created, tree) => tree;
  await assert.rejects(saveIssueDraft(f.client, issueId, f.input(), config), (error) => error.status === 503);
  assert.ok(!f.writes.some((request) => request.block_id && !request.children), "ambiguous ownership must never produce a delete or restore call");
  assert.ok(f.trees.get(issueId).every((item) => !item.archived));
});

test("stale versions, non-active issues and Bonnie Queued/Drafting are rejected before any write", async () => {
  for (const mutate of [
    (f, input) => { input.revision = "0".repeat(64); },
    (f) => { f.hooks.activeIssues = []; },
    (f) => { f.hooks.activeIssues = [{ id: issueId }, { id: ids[0] }]; },
    (f) => { f.issue.parent.database_id = piecesDatabaseId; },
    (f) => { f.issue.properties["Active issue"].checkbox = false; },
    (f) => { f.issue.properties["Generation status"].select.name = "Queued"; },
    (f) => { f.issue.properties["Generation status"].select.name = "Drafting"; },
    (f) => { delete f.issue.properties["Draft lineup"]; },
  ]) {
    const f = fixture(); const input = f.input(); mutate(f, input);
    await assert.rejects(saveIssueDraft(f.client, issueId, input, config), IssueDraftError);
    assert.equal(f.writes.length, 0);
  }
});

test("each Piece must be current, available, typed, in Signal Pieces and one of four distinct Team voices", async () => {
  for (const mutate of [
    (f) => { f.pages.get(ids[0]).parent.database_id = issuesDatabaseId; },
    (f) => { f.pages.get(ids[1]).archived = true; },
    (f) => { f.pages.get(ids[1]).properties.Status.select.name = "Archived"; },
    (f) => { f.pages.get(ids[1]).properties["Editorial decision"].select.name = "Banked"; },
    (f) => { f.pages.get(ids[1]).properties["Editorial decision"].select.name = "Ruled out"; },
    (f) => { f.pages.get(ids[2]).properties.Type.select.name = "Big Idea"; },
    (f) => { f.pages.get(ids[3]).properties["Related Issue"].relation = [{ id: ids[0] }]; },
    (f) => { f.pages.get(ids[3]).properties.People.people = [{ name: "Brett Queener" }]; },
    (f) => { f.pages.get(ids[4]).properties.People.people = []; },
    (f) => { f.trees.set(ids[5], []); },
  ]) {
    const f = fixture(); const input = f.input(); mutate(f);
    await assert.rejects(saveIssueDraft(f.client, issueId, input, config), IssueDraftError);
    assert.equal(f.writes.length, 0);
  }
});

test("a human edit or Bonnie starting after staging aborts and removes new blocks, preserving old copy", async () => {
  for (const mutate of [
    (f) => { f.trees.get(issueId).find((item) => item.id === "human-note").paragraph.rich_text = rich("New human note."); },
    (f) => { f.issue.properties["Generation status"].select.name = "Drafting"; },
    (f) => { f.pages.get(ids[2]).properties["Editorial decision"].select.name = "Banked"; },
    (f) => { f.trees.get(ids[3])[1].paragraph.rich_text = rich("A newer saved body."); },
  ]) {
    const f = fixture(); const input = f.input(); f.hooks.append = () => mutate(f);
    await assert.rejects(saveIssueDraft(f.client, issueId, input, config), (error) => error.status === 409);
    assert.ok(f.trees.get(issueId).filter((item) => item.id.startsWith("new-")).every((item) => item.archived));
    assert.ok(f.trees.get(issueId).filter((item) => item.id.startsWith("old")).every((item) => !item.archived));
    assert.equal(f.writes.filter((request) => request.page_id).length, 0);
  }
});

test("archive or metadata failures restore original block IDs and do not discard the recovery draft if restore fails", async () => {
  for (const failure of ["archive", "mapping", "restore"]) {
    const f = fixture();
    let failed = false;
    f.hooks.beforeDelete = ({ block_id }) => {
      if (block_id === "old2" && !failed && failure !== "mapping") { failed = true; throw new Error("Notion interrupted archive"); }
    };
    if (failure === "mapping") f.hooks.beforePageUpdate = () => { throw new Error("Notion interrupted property write"); };
    if (failure === "restore") f.hooks.beforeBlockUpdate = () => { throw new Error("Notion interrupted restore"); };
    await assert.rejects(saveIssueDraft(f.client, issueId, f.input(), config));
    assert.equal(f.issue.properties["Draft lineup"].rich_text.length, 0);
    const newBlocks = f.trees.get(issueId).filter((item) => item.id.startsWith("new-"));
    if (failure === "restore") assert.ok(newBlocks.every((item) => !item.archived), "new copy retained for recovery");
    else {
      assert.ok(newBlocks.every((item) => item.archived));
      assert.ok(f.trees.get(issueId).filter((item) => item.id.startsWith("old")).every((item) => !item.archived));
    }
  }
});

test("a timed-out canonical property response is recognized as success when readback confirms the commit", async () => {
  const f = fixture();
  f.hooks.afterPageUpdate = () => { throw new Error("Response lost after successful write"); };
  const result = await saveIssueDraft(f.client, issueId, f.input(), config);
  assert.deepEqual(result.lineup, lineup);
  assert.ok(f.trees.get(issueId).filter((item) => item.id.startsWith("new-")).every((item) => !item.archived));
});

test("a human edit during the archive phase rolls back the draft and preserves the new note", async () => {
  const f = fixture();
  f.hooks.beforeDelete = ({ block_id }) => {
    if (block_id === "old2") f.trees.get(issueId).find((item) => item.id === "human-note").paragraph.rich_text = rich("Edited while save was running.");
  };
  await assert.rejects(saveIssueDraft(f.client, issueId, f.input(), config), (error) => error.status === 409);
  assert.ok(f.trees.get(issueId).filter((item) => item.id.startsWith("old")).every((item) => !item.archived));
  assert.ok(f.trees.get(issueId).filter((item) => item.id.startsWith("new-")).every((item) => item.archived));
  assert.equal(f.trees.get(issueId).find((item) => item.id === "human-note").paragraph.rich_text[0].plain_text, "Edited while save was running.");
  assert.equal(f.writes.filter((request) => request.page_id).length, 0);
});

test("human edits to the newly staged copy are retained for recovery rather than discarded by cleanup", async () => {
  const f = fixture();
  f.hooks.append = () => {
    f.hooks.list = (id) => {
      if (id !== issueId) return;
      const newParagraph = f.trees.get(issueId).find((item) => item.id.startsWith("new-") && item.type === "paragraph");
      newParagraph.paragraph.rich_text = rich("A human changed the new draft.");
    };
  };
  await assert.rejects(saveIssueDraft(f.client, issueId, f.input(), config), (error) => error.status === 503);
  assert.ok(f.trees.get(issueId).filter((item) => item.id.startsWith("old")).every((item) => !item.archived));
  assert.ok(f.trees.get(issueId).filter((item) => item.id.startsWith("new-")).every((item) => !item.archived));
  assert.equal(f.writes.filter((request) => request.page_id).length, 0);
});

test("when mapping commit and readback both fail, the assembled copy is retained without destructive rollback", async () => {
  const f = fixture();
  f.hooks.afterPageUpdate = () => {
    f.hooks.retrieve = (id) => { if (id === issueId) throw new Error("Readback unavailable"); };
    throw new Error("Lost property update response");
  };
  await assert.rejects(saveIssueDraft(f.client, issueId, f.input(), config), (error) => error.status === 503);
  assert.ok(f.trees.get(issueId).filter((item) => item.id.startsWith("new-")).every((item) => !item.archived));
  assert.ok(f.trees.get(issueId).filter((item) => item.id.startsWith("old")).every((item) => item.archived));
});

test("an in-process overlapping save is rejected before it can write a second draft", async () => {
  const f = fixture();
  let entered; const enteredPromise = new Promise((resolve) => { entered = resolve; });
  let release; const hold = new Promise((resolve) => { release = resolve; });
  let first = true;
  f.hooks.query = async () => { if (first) { first = false; entered(); await hold; } };
  const input = f.input();
  const saving = saveIssueDraft(f.client, issueId, input, config);
  await enteredPromise;
  await assert.rejects(saveIssueDraft(f.client, issueId, input, config), (error) => error.status === 409);
  release(); await saving;
  assert.equal(f.writes.filter((request) => request.page_id).length, 1);
});
