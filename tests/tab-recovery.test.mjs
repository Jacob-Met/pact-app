import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { captureSourceCitation, citationDraftFields, citationFromDraft, citationPassages, citationText, MAX_CITATION_CHARACTERS, MAX_CITATION_PASSAGES, MAX_CITATION_DRAFT_LENGTH, MAX_CITATION_TOTAL_CHARACTERS } from "../app/source-citations.mjs";
import { LIMITS, appendEvent, createProject, evaluateProject, exportProject } from "../app/core.mjs";
import { createTabRecovery, decodeRecovery, encodeRecovery, exportWorkspace, importWorkspace, RECOVERY_KEY } from "../app/tab-recovery.mjs";

function studioProject() {
  let project = createProject({
    id: "morrow-juniper", title: "Morrow Sound / Juniper Press",
    sourceText: "Morrow delivers WAV masters. Juniper accepts final masters. Episode edits follow acceptance.",
    parties: [{ id: "morrow", name: "Morrow Sound" }, { id: "juniper", name: "Juniper Press" }],
    budgetMinor: 127550, createdAt: "2026-11-10T16:00:00.000Z"
  });
  const at = "2026-11-10T16:01:00.000Z";
  const event = (type, actorId, payload) => {
    project = appendEvent(project, { id: "event-" + (project.events.length + 1), at, actorId, type, payload });
  };
  const quote = "Juniper accepts final masters.";
  const start = project.source.text.indexOf(quote);
  const obligation = {
    id: "masters", revision: 1, title: "Final theme masters", criterion: "WAV masters with no clipping",
    citation: { sourceId: "source-1", sourceRevision: 1, start, end: start + quote.length, quote },
    performerId: "morrow", reviewerId: "juniper", dependsOn: [], dueAt: null, amountMinor: 42550
  };
  event("obligation.added", "morrow", { obligation });
  event("obligation.added", "morrow", { obligation: { ...obligation, id: "edits", title: "Four episode edits", dependsOn: ["masters"], amountMinor: 85000 } });
  event("evidence.submitted", "morrow", { evidence: { id: "preview", obligationId: "masters", obligationRevision: 1, submittedBy: "morrow", description: "Preview received", reference: "Juniper review notes" } });
  event("evidence.accepted", "juniper", { evidenceId: "preview", rationale: "Preview approved" });
  event("evidence.disputed", "juniper", { evidenceId: "preview", disputeId: "needs-wav", reason: "WAV masters are still missing" });
  return project;
}
function memory() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key), values };
}

test("reload recovers exact source, obligations and contested event history; readiness is replayed", () => {
  const project = studioProject(), storage = memory();
  const recovery = createTabRecovery(() => storage);
  assert.equal(recovery.write({ project, drafts: { evidence: { description: "Ask for WAV masters" } } }).status, "saved");
  const recovered = createTabRecovery(() => storage).read();
  assert.equal(recovered.status, "restored");
  assert.equal(exportProject(recovered.snapshot.project), exportProject(project));
  assert.equal(recovered.snapshot.drafts.evidence.description, "Ask for WAV masters");
  const result = evaluateProject(recovered.snapshot.project, "2026-11-10T17:00:00.000Z");
  assert.equal(result.obligations[0].readiness, "blocked");
  assert.ok(result.obligations[0].blockers.includes("OPEN_DISPUTE"));
  assert.ok(result.obligations[1].blockers.includes("DEPENDENCY_NOT_READY"));
  assert.equal(result.totals.executedMinor, 0);
});

test("unsubmitted agreement drafts survive with no made-up project or provider state", () => {
  const raw = encodeRecovery({ project: null, drafts: { setup: { source: "Our unfinished agreement", title: "Mix review" }, payment: { acknowledged: true, captured: true }, payAcknowledge: true } });
  const value = decodeRecovery(raw);
  assert.equal(value.project, null);
  assert.equal(value.drafts.setup.source, "Our unfinished agreement");
  assert.ok(!raw.includes("acknowledged"));
  assert.ok(!raw.includes("captured"));
  assert.ok(!raw.includes("payAcknowledge"));
});

test("a saved project with changed source cannot replace work or be treated as recovered", () => {
  const storage = memory();
  const record = JSON.parse(encodeRecovery({ project: studioProject() }));
  record.project.source.text = "A different agreement";
  const raw = JSON.stringify(record);
  storage.setItem(RECOVERY_KEY, raw);
  const recovery = createTabRecovery(() => storage);
  assert.equal(recovery.read().status, "invalid");
  assert.equal(storage.getItem(RECOVERY_KEY), raw);
});

test("storage refusal is visible as unsaved and preserves the last recoverable agreement", () => {
  const storage = memory(), recovery = createTabRecovery(() => storage);
  assert.equal(recovery.write({ project: studioProject() }).status, "saved");
  const old = storage.getItem(RECOVERY_KEY);
  storage.setItem = () => { throw new Error("QuotaExceededError"); };
  assert.equal(recovery.write({ project: studioProject(), drafts: { evidence: { description: "New notes" } } }).status, "unavailable");
  assert.equal(storage.getItem(RECOVERY_KEY), old);
  assert.equal(createTabRecovery(() => { throw new Error("SecurityError"); }).read().status, "unavailable");
});

test("confirmed new-project snapshot cannot resurrect the prior agreement", () => {
  const storage = memory(), recovery = createTabRecovery(() => storage);
  recovery.write({ project: studioProject() });
  recovery.write({ project: null, drafts: { setup: { title: "Next agreement" } } });
  assert.equal(recovery.read().snapshot.project, null);
  assert.equal(recovery.read().snapshot.drafts.setup.title, "Next agreement");
});


test("portable workspace preserves unsubmitted fields but never financial consent", async () => {
  const { exportWorkspace, importWorkspace } = await import("../app/tab-recovery.mjs");
  const project = studioProject();
  const restored = importWorkspace(exportWorkspace({ project, drafts: {
    obligation: { title: "Mix handoff", criterion: "Deliver WAV stems", amount: "75.00" },
    evidence: { description: "Unsubmitted listening notes" },
    decisions: { "evidence-1": { reason: "Need a second listen", actor: "party-b" } },
    payment: { acknowledged: true, captured: true }
  }}));
  assert.equal(restored.drafts.obligation.criterion, "Deliver WAV stems");
  assert.equal(restored.drafts.evidence.description, "Unsubmitted listening notes");
  assert.equal(restored.drafts.decisions["evidence-1"].reason, "Need a second listen");
  assert.equal(restored.drafts.payment, undefined);
  assert.deepEqual(restored.project, project);
  const unfinished = importWorkspace(exportWorkspace({ project: null, drafts: { setup: { source: "An unfinished source agreement" } } }));
  assert.equal(unfinished.project, null);
  assert.equal(unfinished.drafts.setup.source, "An unfinished source agreement");
  assert.throws(() => importWorkspace('{"format":"pact-workspace/v1","savedAt":"today","project":null}'));
});

test("pending imported review survives recovery without replacing source or retaining file authority", () => {
  const source = "Existing agreed terms stay unchanged.";
  const text = "Reviewed service and acceptance terms.\n".repeat(300);
  const raw = encodeRecovery({ project: null, drafts: { setup: { source }, agreementImport: { text, label: "services.pdf · 11 pages", originalUrl: "blob:expired-file", accepted: true } } });
  const restored = decodeRecovery(raw);
  assert.equal(restored.project, null);
  assert.equal(restored.drafts.setup.source, source);
  assert.deepEqual(restored.drafts.agreementImport, { text, label: "services.pdf · 11 pages" });
  assert.equal(decodeRecovery(encodeRecovery({ project: null, drafts: { agreementImport: { text: "", label: "Editing" } } })).drafts.agreementImport.text, "");
  assert.deepEqual(decodeRecovery(encodeRecovery({ project: null, drafts: { agreementImport: {} } })).drafts.agreementImport, {});
  assert.throws(() => encodeRecovery({ project: null, drafts: { agreementImport: { text: "x".repeat(100001) } } }), /invalid/);
});


test("source question survives portable recovery without retaining a model answer or consent", async () => {
  const { exportWorkspace, importWorkspace } = await import("../app/tab-recovery.mjs");
  const project = studioProject();
  const question = "What clauses must the Commercial General Liability policy contain regarding subrogation and separate insureds?";
  const raw = exportWorkspace({ project, drafts: { sourceLookup: { question, approved: true, result: { evidence_status: "present" } } } });
  const recovered = importWorkspace(raw);
  assert.deepEqual(recovered.drafts.sourceLookup, { question });
  assert.deepEqual(recovered.project, project);
  assert.ok(!raw.includes("evidence_status"));
  assert.deepEqual(importWorkspace(exportWorkspace({ project })).drafts.sourceLookup, {});
  assert.throws(() => exportWorkspace({ project, drafts: { sourceLookup: { question: "x".repeat(501) } } }), /invalid/);
});

test("the observed cumulative F1 G4 and F2 capture survives complete workspace recovery", () => {
  const sourceText = readFileSync(new URL("./fixtures/ashfield-source.txt", import.meta.url), "utf8");
  const project = createProject({ id: "surviving-liability", title: "Surviving liability source review", sourceText,
    parties: [{ id: "contractor", name: "Contractor" }, { id: "council", name: "Council" }],
    createdAt: "2026-11-12T01:00:00.000Z" });
  // Original installed capture immediately before adding F2.11.
  const coordinates = [[2683,2877],[11328,11829],[14982,15880],[21038,21914],[34033,35935],[37031,37751],[38408,39501],[39538,41588],[41612,42124],[49290,49386],[60595,62214],[65066,66342]];
  const range = (start, end) => ({ start, end, quote: sourceText.slice(start, end) });
  const prior = captureSourceCitation(project.source, coordinates.map(([start, end]) => range(start, end)));
  assert.equal(citationText(prior).length, 11759);
  const withConditions = captureSourceCitation(project.source, [...citationPassages(prior), range(48754, 49289)]);
  assert.ok(citationText(withConditions).length > MAX_CITATION_TOTAL_CHARACTERS);
  assert.ok(citationText(withConditions).includes(sourceText.slice(48754, 49386)));
  const f2Start = 41589, f2End = sourceText.indexOf("\nF3", f2Start);
  assert.ok(f2End > 49386);
  const complete = captureSourceCitation(project.source, [...citationPassages(withConditions), range(f2Start, f2End)]);
  assert.ok(citationText(complete).includes(sourceText.slice(39538, f2End)));
  assert.ok(citationPassages(complete).length <= MAX_CITATION_PASSAGES);
  for (const citation of [withConditions, complete]) {
    const draft = { ...citationDraftFields(citation), criterion: citationText(citation) };
    const snapshot = { project, drafts: { obligation: draft } };
    const storage = memory(), recovery = createTabRecovery(() => storage);
    assert.equal(recovery.write(snapshot).status, "saved");
    for (const restored of [recovery.read().snapshot, importWorkspace(exportWorkspace(snapshot))]) {
      assert.equal(restored.drafts.obligation.criterion, draft.criterion);
      assert.deepEqual(citationFromDraft(restored.project.source, restored.drafts.obligation), citation);
      assert.deepEqual(restored.project, project);
      assert.equal(restored.project.events.length, 0);
    }
  }
});

test("escaped quotations at the full manual envelope survive draft JSON and portable recovery", () => {
  let sourceText = "";
  const ranges = Array.from({ length: MAX_CITATION_PASSAGES }, (_, index) => {
    if (sourceText) sourceText += "\nUnselected source wording.\n";
    const prefix = "Section " + (index + 1) + ": ";
    const quote = prefix + "\u0001".repeat(MAX_CITATION_CHARACTERS - prefix.length);
    const start = sourceText.length;
    sourceText += quote;
    return { start, end: sourceText.length, quote };
  });
  const project = createProject({ id: "escaped-capture", title: "Exact captured characters", sourceText,
    parties: [{ id: "studio", name: "Studio" }, { id: "client", name: "Client" }],
    createdAt: "2026-11-12T01:00:00.000Z" });
  const citation = captureSourceCitation(project.source, ranges);
  const draft = { ...citationDraftFields(citation), criterion: citationText(citation) };
  assert.equal(draft.criterion.length, LIMITS.criterion);
  assert.ok(draft.citationRelated.length > 32768);
  assert.ok(draft.citationRelated.length <= MAX_CITATION_DRAFT_LENGTH);
  const snapshot = { project, drafts: { obligation: draft } };
  const storage = memory(), recovery = createTabRecovery(() => storage);
  assert.equal(recovery.write(snapshot).status, "saved");
  const saved = storage.getItem(RECOVERY_KEY), portable = exportWorkspace(snapshot);
  for (const restored of [recovery.read().snapshot, importWorkspace(portable)]) {
    assert.equal(restored.drafts.obligation.criterion, draft.criterion);
    assert.equal(restored.drafts.obligation.citationRelated, draft.citationRelated);
    assert.deepEqual(citationFromDraft(restored.project.source, restored.drafts.obligation), citation);
    assert.equal(restored.project.events.length, 0);
  }
  const tooLarge = structuredClone(snapshot);
  tooLarge.drafts.obligation.citationRelated = " ".repeat(MAX_CITATION_DRAFT_LENGTH + 1);
  assert.equal(recovery.write(tooLarge).status, "unavailable");
  assert.equal(storage.getItem(RECOVERY_KEY), saved);
  const forged = JSON.parse(portable);
  const related = JSON.parse(forged.drafts.obligation.citationRelated);
  related[0].quote = "x" + related[0].quote.slice(1);
  forged.drafts.obligation.citationRelated = JSON.stringify(related);
  assert.throws(() => importWorkspace(JSON.stringify(forged)), { code: "CITATION_MISMATCH" });
  assert.equal(storage.getItem(RECOVERY_KEY), saved);
});
