import { htmlToNotionBlocks, normalizeEditorHtml } from "../lib/html-notion";
import { locateBodyWriteTarget, type BodyWriteTarget } from "../lib/body-writeback";
import type { NotionBlock } from "../lib/blocks-to-html";

function check(name: string, ok: boolean) {
  if (!ok) throw new Error(`FAIL: ${name}`);
  console.log("ok", name);
}

const normalized = normalizeEditorHtml("<div>Hello <strong>world</strong></div><div>Second</div>");
check("normalize wraps divs", normalized.includes("<p>") && normalized.includes("Second"));

const blocks = htmlToNotionBlocks(
  `<p>Seat pricing <strong>worked</strong>.</p><p>• Bullet one</p><blockquote>Quoted</blockquote>`,
);
check("three blocks", blocks.length === 3);
check("paragraph bold", blocks[0].type === "paragraph");
check("bullet", blocks[1].type === "bulleted_list_item");
check("quote", blocks[2].type === "quote");

const tree: NotionBlock[] = [
  {
    id: "sec-1",
    type: "heading_2",
    has_children: true,
    heading_2: {
      rich_text: [{ plain_text: "Draft body" }],
      is_toggleable: true,
    },
    children: [
      {
        id: "p-1",
        type: "paragraph",
        paragraph: { rich_text: [{ plain_text: "Old copy" }] },
      },
    ],
  },
  {
    id: "src-1",
    type: "heading_2",
    heading_2: { rich_text: [{ plain_text: "Sources" }] },
  },
];

const target = locateBodyWriteTarget(tree, "page-1") as BodyWriteTarget;
check("target parent is Draft body", target.parentId === "sec-1");
check("replace old paragraph", target.replaceIds.includes("p-1"));
check("does not touch Sources", !target.replaceIds.includes("src-1"));

console.log(JSON.stringify({ normalized, blockTypes: blocks.map((b) => b.type), target }, null, 2));
