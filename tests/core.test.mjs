import test from "node:test";
import assert from "node:assert/strict";
import { captureSourceCitation, citationPassages, citationText, sourceCitation, MAX_CITATION_CHARACTERS, MAX_CITATION_PASSAGES, MAX_CITATION_TOTAL_CHARACTERS } from "../app/source-citations.mjs";
import { LIMITS, appendEvent, createProject, evaluateProject, exportProject, importProject, projectView } from "../app/core.mjs";

const T0 = "2026-10-19T05:30:00.000Z";
const SOURCE = "Clause A: Alpha is reviewed. Clause B: Beta follows Alpha. Clause C: Gamma follows Beta. Clause D: Delta is independent.";
const partyA = { id: "studio", name: "Studio <alpha>" };
const partyB = { id: "client", name: "Client & reviewer" };

function base() {
  return createProject({ id: "project-1", title: "Deterministic fixture", sourceText: SOURCE, parties: [partyA, partyB], budgetMinor: 31_000, createdAt: T0 });
}
function event(project, type, actorId, payload, at) {
  return appendEvent(project, { id: `event-${project.events.length + 1}`, seq: 0, at: at ?? `2026-10-19T05:${String(31 + project.events.length).padStart(2, "0")}:00.000Z`, actorId, type, payload });
}
function citation(label) {
  const start = SOURCE.indexOf(label); return { sourceId: "source-1", sourceRevision: 1, start, end: start + label.length, quote: label };
}
function obligation(id, quote, dependsOn = [], amountMinor = 0, dueAt = null) {
  return { id, revision: 1, title: `Obligation ${id}`, criterion: `Criterion ${id}`, citation: citation(quote), performerId: "studio", reviewerId: "client", dependsOn, dueAt, amountMinor };
}
function addObligation(project, item) { return event(project, "obligation.added", "studio", { obligation: item }); }
function submit(project, evidenceId, obligationId) { return event(project, "evidence.submitted", "studio", { evidence: { id: evidenceId, obligationId, obligationRevision: 1, submittedBy: "studio", description: `Evidence ${evidenceId}`, reference: `reference ${evidenceId}` } }); }
function accept(project, evidenceId) { return event(project, "evidence.accepted", "client", { evidenceId, rationale: "Recorded review passed" }); }

function graph() {
  let project = base();
  project = addObligation(project, obligation("A", "Clause A", [], 0));
  project = addObligation(project, obligation("B", "Clause B", ["A"], 10_001));
  project = addObligation(project, obligation("C", "Clause C", ["B"], 20_000, "2026-10-20T00:00:00.000Z"));
  project = addObligation(project, obligation("D", "Clause D", [], 999));
  return project;
}

test("empty evidence blocks every obligation and dependencies are explicit", () => {
  const result = evaluateProject(graph(), "2026-10-19T06:00:00.000Z");
  assert.deepEqual(result.obligations.map(item => [item.obligationId, item.blockers]), [
    ["A", ["NO_VALID_ACCEPTED_EVIDENCE"]],
    ["B", ["NO_VALID_ACCEPTED_EVIDENCE", "DEPENDENCY_NOT_READY"]],
    ["C", ["NO_VALID_ACCEPTED_EVIDENCE", "DEPENDENCY_NOT_READY"]],
    ["D", ["NO_VALID_ACCEPTED_EVIDENCE"]]
  ]);
  assert.equal(result.executable, false); assert.equal(result.totals.executedMinor, 0);
});

test("acceptance and revocation recompute transitive readiness", () => {
  let project = graph();
  project = submit(project, "ev-a", "A"); project = accept(project, "ev-a");
  project = submit(project, "ev-b", "B"); project = accept(project, "ev-b");
  project = submit(project, "ev-c", "C"); project = accept(project, "ev-c");
  let result = evaluateProject(project, "2026-10-19T07:00:00.000Z");
  assert.deepEqual(result.obligations.slice(0, 3).map(item => item.readiness), ["ready-for-human-review", "ready-for-human-review", "ready-for-human-review"]);
  project = event(project, "evidence.revoked", "studio", { evidenceId: "ev-a", reason: "Delivery withdrawn" });
  result = evaluateProject(project, "2026-10-19T08:00:00.000Z");
  assert.deepEqual(result.obligations.slice(0, 3).map(item => item.readiness), ["blocked", "blocked", "blocked"]);
  assert.deepEqual(result.obligations[1].validEvidenceIds, ["ev-b"]);
});

test("dispute remains independent of revocation and resolves only explicitly", () => {
  let project = graph(); project = submit(project, "ev-a", "A"); project = accept(project, "ev-a");
  project = event(project, "evidence.disputed", "studio", { evidenceId: "ev-a", disputeId: "d-1", reason: "Mismatch" });
  project = event(project, "evidence.revoked", "studio", { evidenceId: "ev-a", reason: "Withdrawn" });
  let result = evaluateProject(project, "2026-10-19T08:00:00.000Z");
  assert.deepEqual(result.obligations[0].blockers, ["NO_VALID_ACCEPTED_EVIDENCE", "OPEN_DISPUTE"]);
  project = event(project, "dispute.resolved", "studio", { disputeId: "d-1", reason: "Concern recorded and closed" });
  result = evaluateProject(project, "2026-10-19T09:00:00.000Z");
  assert.deepEqual(result.obligations[0].blockers, ["NO_VALID_ACCEPTED_EVIDENCE"]);
});

test("an open dispute on any related evidence blocks otherwise accepted obligation", () => {
  let project = graph(); project = submit(project, "accepted", "A"); project = accept(project, "accepted"); project = submit(project, "alternate", "A");
  project = event(project, "evidence.disputed", "studio", { evidenceId: "alternate", disputeId: "d-alt", reason: "Conflicting artifact" });
  assert.deepEqual(evaluateProject(project, "2026-10-19T08:00:00.000Z").obligations[0].blockers, ["OPEN_DISPUTE"]);
});

test("deadline state uses exact supplied instant and never ambient time", () => {
  let project = base(); project = addObligation(project, obligation("C", "Clause C", [], 20_000, "2026-10-20T00:00:00.000Z"));
  assert.equal(evaluateProject(project, "2026-10-19T23:59:59.999Z").obligations[0].deadlineState, "upcoming");
  assert.equal(evaluateProject(project, "2026-10-20T00:00:00.000Z").obligations[0].deadlineState, "due");
  assert.equal(evaluateProject(project, "2026-10-20T00:00:00.001Z").obligations[0].deadlineState, "overdue");
});

test("accepted evidence records on-time and late deadline axes separately", () => {
  let onTime = base(); onTime = addObligation(onTime, obligation("C", "Clause C", [], 20_000, "2026-10-20T00:00:00.000Z")); onTime = submit(onTime, "ev", "C"); onTime = event(onTime, "evidence.accepted", "client", { evidenceId: "ev", rationale: "Okay" }, "2026-10-19T23:00:00.000Z");
  assert.equal(evaluateProject(onTime, "2026-10-20T01:00:00.000Z").obligations[0].deadlineState, "accepted-on-time");
  let late = base(); late = addObligation(late, obligation("C", "Clause C", [], 20_000, "2026-10-20T00:00:00.000Z")); late = submit(late, "ev", "C"); late = event(late, "evidence.accepted", "client", { evidenceId: "ev", rationale: "Okay" }, "2026-10-20T00:00:01.000Z");
  assert.equal(evaluateProject(late, "2026-10-20T01:00:00.000Z").obligations[0].deadlineState, "accepted-late");
});

test("citation mismatch, dangling dependency and cycle refuse without mutation", () => {
  const project = base();
  assert.throws(() => addObligation(project, { ...obligation("A", "Clause A"), citation: { ...citation("Clause A"), quote: "changed" } }), { code: "CITATION_MISMATCH" });
  assert.throws(() => addObligation(project, obligation("B", "Clause B", ["missing"])), { code: "MISSING_DEPENDENCY" });
  assert.throws(() => addObligation(project, obligation("A", "Clause A", ["A"])), { code: "DEPENDENCY_CYCLE" });
  assert.equal(project.events.length, 0);
});

test("duplicate entities, invalid transitions and unauthorized reviewer refuse", () => {
  let project = graph(); project = submit(project, "ev-a", "A");
  assert.throws(() => submit(project, "ev-a", "A"), { code: "DUPLICATE_ID" });
  assert.throws(() => event(project, "evidence.accepted", "studio", { evidenceId: "ev-a", rationale: "No" }), { code: "REVIEWER_REQUIRED" });
  assert.throws(() => event(project, "evidence.revoked", "client", { evidenceId: "missing", reason: "No" }), { code: "UNKNOWN_EVIDENCE" });
});

test("budget arithmetic is exact integer minor units and over-allocation refuses", () => {
  const project = graph(); const result = evaluateProject(project, "2026-10-19T06:00:00.000Z");
  assert.deepEqual(result.totals, { budgetMinor: 31_000, allocatedMinor: 31_000, readyMinor: 0, blockedMinor: 31_000, unallocatedMinor: 0, currency: "USD", executedMinor: 0 });
  assert.throws(() => addObligation(project, obligation("E", "Clause A", [], 1)), { code: "BUDGET_EXCEEDED" });
  assert.throws(() => createProject({ id: "bad", title: "Bad", sourceText: SOURCE, parties: [partyA, partyB], budgetMinor: 1.5, createdAt: T0 }), { code: "INVALID_AMOUNT" });
});

test("export/import replay is deterministic and derived claims are rejected", () => {
  let project = graph(); project = submit(project, "ev-a", "A"); project = accept(project, "ev-a");
  const serialized = exportProject(project); const reopened = importProject(serialized);
  assert.deepEqual(evaluateProject(reopened, "2026-10-19T08:00:00.000Z"), evaluateProject(project, "2026-10-19T08:00:00.000Z"));
  const malicious = JSON.parse(serialized); malicious.ready = true;
  assert.throws(() => importProject(JSON.stringify(malicious)), { code: "UNKNOWN_FIELD" });
});

test("failed import cannot mutate an existing in-memory project", () => {
  const current = graph(); const before = exportProject(current);
  assert.throws(() => importProject('{"format":"wrong"}'));
  assert.equal(exportProject(current), before);
});

test("project view preserves literal hostile authored text as data", () => {
  const project = createProject({ id: "literal", title: "<img onerror=alert(1)>", sourceText: "<script>not executable</script>", parties: [partyA, partyB], budgetMinor: 0, createdAt: T0 });
  const view = projectView(project); assert.equal(view.project.title, "<img onerror=alert(1)>"); assert.equal(view.project.source.text, "<script>not executable</script>");
});

test("historical evaluation and noncanonical instants refuse", () => {
  let project = graph(); project = submit(project, "ev-a", "A");
  assert.throws(() => evaluateProject(project, T0), { code: "HISTORICAL_EVALUATION" });
  assert.throws(() => evaluateProject(project, "2026-10-19T08:00:00Z"), { code: "INVALID_INSTANT" });
  assert.throws(() => createProject({ id: "bad-date", title: "Bad date", sourceText: SOURCE, parties: [partyA, partyB], budgetMinor: 0, createdAt: "2026-13-01T00:00:00.000Z" }), { code: "INVALID_INSTANT" });
});

test("large admitted exports and multibyte text always reopen", () => {
  const seed = base();
  const first = { id: "event-1", seq: 1, at: T0, actorId: "studio", type: "obligation.added", payload: { obligation: obligation("A", "Clause A") } };
  const events = [first];
  for (let index = 0; index < 500; index += 1) {
    events.push({ id: `event-${index + 2}`, seq: index + 2, at: T0, actorId: "studio", type: "evidence.submitted", payload: { evidence: { id: `e-${index}`, obligationId: "A", obligationRevision: 1, submittedBy: "studio", description: `😀${"x".repeat(998)}`, reference: `réf-${"y".repeat(996)}` } } });
  }
  const candidate = { ...seed, events };
  const serialized = exportProject(candidate);
  assert.ok(new TextEncoder().encode(serialized).byteLength > 1_000_000);
  assert.deepEqual(importProject(serialized), candidate);
});

test("citations refuse oversized quotes and split surrogate pairs", () => {
  const emojiSource = createProject({ id: "emoji", title: "Emoji", sourceText: "A😀B", parties: [partyA, partyB], budgetMinor: 0, createdAt: T0 });
  const split = obligation("A", "Clause A"); split.citation = { sourceId: "source-1", sourceRevision: 1, start: 1, end: 2, quote: "\ud83d" };
  assert.throws(() => addObligation(emojiSource, split), { code: "CITATION_RANGE" });
  const longSource = createProject({ id: "long", title: "Long", sourceText: "x".repeat(4_001), parties: [partyA, partyB], budgetMinor: 0, createdAt: T0 });
  const long = obligation("A", "Clause A"); long.citation = { sourceId: "source-1", sourceRevision: 1, start: 0, end: 4_001, quote: "x".repeat(4_001) };
  assert.throws(() => addObligation(longSource, long), { code: "CITATION_SIZE" });
});

test("complete manually authored criteria retain the full passage envelope through record and import", () => {
  const quotes = Array.from({ length: MAX_CITATION_PASSAGES }, (_, index) => {
    const prefix = "Condition " + (index + 1) + ": ";
    return prefix + "x".repeat(MAX_CITATION_CHARACTERS - prefix.length - 2) + "🪶";
  });
  let sourceText = "";
  const ranges = quotes.map(quote => {
    if (sourceText) sourceText += "\nUnrelated source instruction.\n";
    const start = sourceText.length;
    sourceText += quote;
    return { start, end: sourceText.length, quote };
  });
  const project = createProject({ id: "complete-criterion", title: "Complete conditions", sourceText, parties: [partyA, partyB], createdAt: T0 });
  const citation = captureSourceCitation(project.source, ranges), criterion = citationText(citation);
  assert.equal(criterion.length, LIMITS.criterion);
  assert.deepEqual(citationPassages(citation), ranges);
  // A deliberate author capture does not widen automatic/model normalization.
  assert.throws(() => sourceCitation(project.source, ranges), {
    code: "CITATION_SIZE",
    citationLimit: { kind: "total_length", actual: criterion.length, limit: MAX_CITATION_TOTAL_CHARACTERS }
  });
  const item = { ...obligation("full", "Clause A"), criterion, citation };
  const recorded = addObligation(project, item);
  const restored = projectView(importProject(exportProject(recorded))).obligations[0];
  assert.equal(restored.criterion, criterion);
  assert.deepEqual(restored.citation, citation);
  assert.equal(project.events.length, 0);
  assert.throws(() => addObligation(project, { ...item, criterion: criterion + "x" }), { code: "INVALID_TEXT" });
  const oversized = structuredClone(recorded);
  oversized.events[0].payload.obligation.criterion += "x";
  assert.throws(() => importProject(JSON.stringify(oversized)), { code: "INVALID_TEXT" });
});

test("original source file identity survives export without changing legacy agreement bytes", () => {
  const legacy = base(), before = exportProject(legacy);
  assert.equal(exportProject(importProject(before)), before);
  const file = { fingerprint: { algorithm: "SHA-256", sha256: "a".repeat(64), bytes: 125, name: "agreement.pdf" }, textEdited: true };
  const current = createProject({ id: "source-file", title: "Imported agreement", sourceText: SOURCE, sourceFile: file, parties: [partyA, partyB], createdAt: T0 });
  assert.deepEqual(importProject(exportProject(current)).source.file, file);
  file.fingerprint.name = "changed.pdf";
  assert.equal(current.source.file.fingerprint.name, "agreement.pdf");
  const bad = structuredClone(current);
  bad.source.file.textEdited = "no";
  assert.throws(() => importProject(JSON.stringify(bad)), /whether its extracted text was edited/);
  bad.source.file.textEdited = false; bad.source.file.fingerprint.sha256 = "wrong";
  assert.throws(() => importProject(JSON.stringify(bad)), /fingerprint/);
});
