import test from "node:test";
import assert from "node:assert/strict";
import { SAMPLE_LINES, ruleDraft, applyCorrection, buildDocument, buildEngine, parseDate, linesFromChat, checkModelDraft } from "../app/pact-draft.mjs";
import { createProject, appendEvent, evaluateProject } from "../app/core.mjs";
import { captureSourceCitation } from "../app/source-citations.mjs";

const today = new Date("2026-11-12T12:00:00Z");

test("the sample conversation becomes two milestones with sources", () => {
  const d = ruleDraft(SAMPLE_LINES, today);
  assert.equal(d.doer, "Maya"); assert.equal(d.payer, "Sam");
  assert.deepEqual(d.milestones.map(m => m.amountMinor), [25000, 35000]);
  assert.deepEqual(d.milestones.map(m => m.due), ["2026-11-20", "2026-12-04"]);
  assert.equal(d.milestones[0].from.due, 3); assert.equal(d.milestones[1].from.amount, 2);
});

test("corrections change the pact and cite the new sentence", () => {
  const d = ruleDraft(SAMPLE_LINES, today);
  const a = applyCorrection(d, "deadline is the 30th", 5, today).draft;
  assert.equal(a.milestones[1].due, "2026-11-30"); assert.equal(a.milestones[1].from.due, 5);
  const b = applyCorrection(d, "make it three payments", 6, today).draft;
  assert.equal(b.milestones.length, 3); assert.equal(b.milestones.reduce((s, m) => s + m.amountMinor, 0), 60000);
  const c = applyCorrection(d, "the total is $500", 7, today).draft;
  assert.equal(c.milestones.reduce((s, m) => s + m.amountMinor, 0), 50000);
  assert.throws(() => applyCorrection(d, "hello there", 8, today));
});

test("the document builds a project the engine accepts", async () => {
  const d = ruleDraft(SAMPLE_LINES, today), pact = { id: "pact-1", draft: d };
  const doc = buildDocument(pact);
  for (const c of doc.clauses) assert.equal(doc.text.slice(c.start, c.end), c.quote);
  const project = await buildEngine(pact, { createProject, appendEvent, captureSourceCitation });
  assert.equal(project.events.length, 2);
  assert.equal(evaluateProject(project, "2026-11-13T00:00:00.000Z").totals.unallocatedMinor, 0);
});

test("dates, chat paste and model checking", () => {
  assert.equal(parseDate("on the 30th", today), "2026-11-30");
  assert.equal(parseDate("Dec 5", today), "2026-12-05");
  assert.equal(linesFromChat("[10:41] Ann: hi\nBo: yes")[0].speaker, "Ann");
  assert.equal(checkModelDraft({ doer: "A", payer: "B", milestones: [{ what: "x", what_line: 99, amount: 5 }] }, SAMPLE_LINES), null);
  const ok = checkModelDraft({ doer: "A", payer: "B", milestones: [{ what: "x", what_line: 1, amount: 250, amount_line: 2, due: null }] }, SAMPLE_LINES);
  assert.equal(ok.milestones[0].amountMinor, 25000);
});
