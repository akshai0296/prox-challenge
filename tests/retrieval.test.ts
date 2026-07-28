import test from "node:test";
import assert from "node:assert/strict";
import { getCorpusStats, getManualPage, searchManual } from "../server/retrieval.js";

test("indexes every supplied source page", () => {
  assert.deepEqual(getCorpusStats(),{
    totalPages:51,
    documents:{"owner-manual":48,"quick-start":2,"selection-chart":1}
  });
});

test("retrieves the wire-weld porosity pages", () => {
  const results = searchManual("porosity in MIG weld",{limit:3});
  assert.ok(results.some(result => result.document === "owner-manual" && result.page === 37));
  assert.ok(results.some(result => result.document === "owner-manual" && result.page === 43));
});

test("retrieves the wire-feed troubleshooting matrix", () => {
  const [first] = searchManual("wire feed motor runs but wire does not feed properly",{limit:1});
  assert.equal(first.document,"owner-manual");
  assert.equal(first.page,42);
});

test("makes the visual-only selection chart searchable", () => {
  const [first] = searchManual("outdoor windy welding without shielding gas",{limit:1});
  assert.equal(first.document,"selection-chart");
  assert.equal(first.page,1);
});

test("resolves valid pages and rejects invalid pages", () => {
  assert.ok(getManualPage("owner-manual",19)?.text.includes("Duty Cycle"));
  assert.equal(getManualPage("owner-manual",99),undefined);
});
