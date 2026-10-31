import { blocksToBodyHtml } from "../lib/blocks-to-html";
import { peopleNameToPartnerKey } from "../lib/piece-schema";

const price = [
  { id: "1", type: "heading_2", heading_2: { rich_text: [{ plain_text: "Draft body" }] } },
  {
    id: "2",
    type: "paragraph",
    paragraph: {
      rich_text: [
        { plain_text: "Price the work, not the headcount", annotations: { bold: true } },
      ],
    },
  },
  {
    id: "3",
    type: "paragraph",
    paragraph: {
      rich_text: [
        {
          plain_text:
            "Seat pricing worked when each additional user created another unit of value.",
        },
      ],
    },
  },
  { id: "4", type: "heading_2", heading_2: { rich_text: [{ plain_text: "Sources notes" }] } },
  {
    id: "5",
    type: "paragraph",
    paragraph: { rich_text: [{ plain_text: "Spark and corroboration are on the linked Idea." }] },
  },
  { id: "6", type: "heading_2", heading_2: { rich_text: [{ plain_text: "Confidentiality" }] } },
  {
    id: "7",
    type: "paragraph",
    paragraph: { rich_text: [{ plain_text: "Avoid quoting proposed prices." }] },
  },
] as any[];

const vibe = [
  { id: "c", type: "callout", callout: { rich_text: [{ plain_text: "Draft created" }] } },
  { id: "1", type: "heading_2", heading_2: { rich_text: [{ plain_text: "Draft body" }] } },
  {
    id: "2",
    type: "paragraph",
    paragraph: {
      rich_text: [
        { plain_text: "JEN", annotations: { bold: true } },
        { plain_text: " (draft voice, needs partner pass)" },
      ],
    },
  },
  {
    id: "3",
    type: "paragraph",
    paragraph: {
      rich_text: [{ plain_text: "The pitch now is we can build it ourselves with AI." }],
    },
  },
  { id: "4", type: "heading_2", heading_2: { rich_text: [{ plain_text: "Sources" }] } },
  {
    id: "5",
    type: "paragraph",
    paragraph: { rich_text: [{ plain_text: "Pulled from Idea Bank." }] },
  },
] as any[];

const field = [
  {
    id: "1",
    type: "heading_2",
    has_children: true,
    heading_2: { rich_text: [{ plain_text: "Option 1" }], is_toggleable: true },
    children: [
      {
        id: "1a",
        type: "paragraph",
        paragraph: {
          rich_text: [{ plain_text: "A portfolio company entered a pricing session." }],
      },
      },
    ],
  },
  {
    id: "2",
    type: "heading_2",
    has_children: true,
    heading_2: { rich_text: [{ plain_text: "Provenance" }], is_toggleable: true },
    children: [
      {
        id: "2a",
        type: "paragraph",
        paragraph: { rich_text: [{ plain_text: "Should not appear" }] },
      },
    ],
  },
] as any[];

const fieldMulti = [
  {
    id: "1",
    type: "heading_2",
    has_children: true,
    heading_2: { rich_text: [{ plain_text: "Option 1" }], is_toggleable: true },
    children: [
      {
        id: "1a",
        type: "paragraph",
        paragraph: { rich_text: [{ plain_text: "First option copy." }] },
      },
    ],
  },
  {
    id: "2",
    type: "heading_2",
    has_children: true,
    heading_2: { rich_text: [{ plain_text: "Option 2" }], is_toggleable: true },
    children: [
      {
        id: "2a",
        type: "paragraph",
        paragraph: { rich_text: [{ plain_text: "Second option copy." }] },
      },
    ],
  },
] as any[];

const p = blocksToBodyHtml(price, { title: "Price the work, not the headcount" });
const v = blocksToBodyHtml(vibe, { title: "Vibe coding breaks at multiplayer" });
const f = blocksToBodyHtml(field);
const m = blocksToBodyHtml(fieldMulti);

const checks: [string, boolean][] = [
  ["price has seat pricing", p.bodyHtml.includes("Seat pricing")],
  [
    "price strips title echo",
    !p.bodyHtml.toLowerCase().includes("price the work, not the headcount"),
  ],
  ["price strips sources", !p.bodyHtml.includes("Spark and corroboration")],
  ["price strips confidentiality", !p.bodyHtml.includes("Avoid quoting")],
  ["vibe keeps voice line", v.bodyHtml.includes("JEN") && v.bodyHtml.includes("draft voice")],
  ["vibe keeps pitch", v.bodyHtml.includes("pitch now")],
  ["vibe strips Sources", !v.bodyHtml.includes("Pulled from Idea")],
  ["field option body", f.bodyHtml.includes("portfolio company")],
  ["field strips provenance", !f.bodyHtml.includes("Should not appear")],
  ["multi has two options", m.optionBodies.length === 2],
  ["multi defaults to option 1", m.bodyHtml.includes("First option") && !m.bodyHtml.includes("Second option")],
  ["multi keeps option 2 separate", m.optionBodies[1]?.bodyHtml.includes("Second option") === true],
  ["people Jen", peopleNameToPartnerKey("Jennifer Richard") === "Jen"],
  ["people Brett", peopleNameToPartnerKey("Brett Queener") === "Brett"],
  ["people Jim", peopleNameToPartnerKey("Jim Andelman") === "Jim"],
];

const failed = checks.filter(([, ok]) => !ok);
console.log(JSON.stringify({ ok: failed.length === 0, checks, p: p.bodyHtml, v: v.bodyHtml, f: f.bodyHtml, m }, null, 2));
if (failed.length) process.exit(1);
