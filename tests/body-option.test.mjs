import test from "node:test";
import assert from "node:assert/strict";
import { canonicalBodyOption } from "../lib/body-option.ts";

test("saved alternate copy does not replace the canonical Draft body section", () => {
  const options = [
    { label: "Option 1", bodyHtml: "<p>First alternative</p>" },
    { label: "Draft body", bodyHtml: "<p>Main draft</p>" },
    { label: "Option 2", bodyHtml: "<p>Newly saved second alternative</p>" },
  ];
  // Even if a save response's bodyHtml equals Option 2, only the main section is saveable in an issue lineup.
  const activeOption = options[2];
  assert.equal(canonicalBodyOption(options).label, "Draft body");
  assert.notEqual(activeOption.label, canonicalBodyOption(options).label);
});

test("legacy options use the first nonempty body when no nonempty Draft body exists", () => {
  const options = [
    { label: "Draft body", bodyHtml: " " },
    { label: "Option 1", bodyHtml: "" },
    { label: "Option 2", bodyHtml: "<p>Saved body</p>" },
    { label: "Option 3", bodyHtml: "<p>Another saved body</p>" },
  ];
  assert.equal(canonicalBodyOption(options).label, "Option 2");
  assert.equal(canonicalBodyOption(options.slice(0, 2)), undefined);
});
