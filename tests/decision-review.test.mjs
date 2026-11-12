import test from "node:test";
import assert from "node:assert/strict";
import { appendEvent, createProject, exportProject, projectView } from "../app/core.mjs";
import { commitDecisionReview, previewEvidenceDecision } from "../app/decision-review.mjs";

const START = "2026-11-10T12:00:00.000Z";
const REVIEW = "2026-11-10T12:01:00.000Z";
const CONFIRM = "2026-11-10T12:01:05.000Z";
const SOURCE = "Morrow Sound delivers final WAV masters and stems for $425.50. After acceptance of masters, four episode edits are reviewed for $850.";
const criterion = "Final unclipped WAV masters and all stems are delivered.";
function event(project, type, actorId, payload, at) {
  return { id: "event-" + (project.events.length + 1), seq: 0, at: at ?? new Date(Date.parse(START) + (project.events.length + 1) * 1000).toISOString(), actorId, type, payload };
}
function add(project, type, actorId, payload) { return appendEvent(project, event(project, type, actorId, payload)); }
function citation(quote) {
  const start = SOURCE.indexOf(quote);
  return { sourceId: "source-1", sourceRevision: 1, start, end: start + quote.length, quote };
}
function submit(project, id, obligationId) {
  return add(project, "evidence.submitted", "morrow", { evidence: {
    id, obligationId, obligationRevision: 1, submittedBy: "morrow",
    description: id === "preview" ? "Preview MP3 sounds good; final WAV masters and stems are missing." : "Reviewed complete deliverable.",
    reference: id === "preview" ? "preview-mix.mp3" : id + ".zip"
  } });
}
function accept(project, evidenceId) {
  return add(project, "evidence.accepted", "juniper", { evidenceId, rationale: "Reviewed the deliverable." });
}
function studio({ downstreamAccepted = true, dueAt = null } = {}) {
  let project = createProject({ id: "studio", title: "Morrow Sound / Juniper Press", sourceText: SOURCE,
    parties: [{ id: "morrow", name: "Morrow Sound" }, { id: "juniper", name: "Juniper Press" }],
    budgetMinor: 127550, createdAt: START });
  project = add(project, "obligation.added", "morrow", { obligation: {
    id: "masters", revision: 1, title: "Final theme masters", criterion,
    citation: citation("Morrow Sound delivers final WAV masters and stems for $425.50."),
    performerId: "morrow", reviewerId: "juniper", dependsOn: [], dueAt, amountMinor: 42550
  } });
  project = add(project, "obligation.added", "morrow", { obligation: {
    id: "episodes", revision: 1, title: "Four episode edits", criterion: "Four final episode edits delivered.",
    citation: citation("After acceptance of masters, four episode edits are reviewed for $850."),
    performerId: "morrow", reviewerId: "juniper", dependsOn: ["masters"], dueAt: null, amountMinor: 85000
  } });
  project = submit(project, "edits", "episodes");
  if (downstreamAccepted) project = accept(project, "edits");
  return submit(project, "preview", "masters");
}
function acceptance(project, at = REVIEW) {
  return previewEvidenceDecision(project, event(project, "evidence.accepted", "juniper",
    { evidenceId: "preview", rationale: "Accepting preview only, final masters still pending." }, at));
}

test("preview exposes exact criterion and the $1275.50 chain without deciding semantic truth or appending", () => {
  const project = studio(); const original = exportProject(project);
  const review = acceptance(project);
  assert.equal(exportProject(project), original);
  assert.equal(review.obligation.criterion, criterion);
  assert.equal(review.obligation.citation.quote, SOURCE.slice(0, SOURCE.indexOf(" After")));
  assert.match(review.evidence.description, /masters and stems are missing/);
  assert.equal(review.actor.name, "Juniper Press");
  assert.equal(review.before.asOf, REVIEW); assert.equal(review.after.asOf, REVIEW);
  assert.equal(review.before.totals.readyMinor, 0); assert.equal(review.after.totals.readyMinor, 127550);
  assert.deepEqual(review.rows.map(row => [row.obligation.title, row.before.readiness, row.after.readiness]), [
    ["Final theme masters", "blocked", "ready-for-human-review"],
    ["Four episode edits", "blocked", "ready-for-human-review"]
  ]);
  assert.equal(review.after.executable, false); assert.equal(review.after.totals.executedMinor, 0);
});

test("downstream evidence without acceptance remains blocked when its prerequisite is accepted", () => {
  const review = acceptance(studio({ downstreamAccepted: false }));
  assert.equal(review.after.totals.readyMinor, 42550);
  assert.equal(review.rows[1].after.readiness, "blocked");
  assert.deepEqual(review.rows[1].after.blockers, ["NO_VALID_ACCEPTED_EVIDENCE"]);
  assert.equal(review.rows[1].before.blockers.includes("DEPENDENCY_NOT_READY"), true);
});

test("confirmation records once at actual confirmation time and refuses the same stale review again", () => {
  const project = studio(); const review = acceptance(project);
  const result = commitDecisionReview(project, review, CONFIRM);
  assert.equal(result.status, "recorded");
  assert.equal(result.project.events.length, project.events.length + 1);
  assert.equal(result.event.at, CONFIRM);
  assert.equal(result.event.actorId, "juniper");
  assert.equal(result.event.payload.rationale, review.reason);
  assert.throws(() => commitDecisionReview(result.project, review, CONFIRM), error => error.code === "REVIEW_STALE");
});

test("revoking one accepted evidence record does not invent a blocker while another valid acceptance exists", () => {
  let project = accept(studio(), "preview");
  project = submit(project, "final-masters", "masters"); project = accept(project, "final-masters");
  const review = previewEvidenceDecision(project, event(project, "evidence.revoked", "morrow",
    { evidenceId: "preview", reason: "Replace preview with the final delivery." }, REVIEW));
  assert.equal(review.before.totals.readyMinor, 127550); assert.equal(review.after.totals.readyMinor, 127550);
  assert.deepEqual(review.rows.map(row => row.after.readiness), ["ready-for-human-review", "ready-for-human-review"]);
  assert.deepEqual(review.rows[0].after.validEvidenceIds, ["final-masters"]);
  const result = commitDecisionReview(project, review, CONFIRM);
  assert.equal(projectView(result.project).evidence.find(item => item.id === "preview").decision.revoked, true);
});

test("dispute blocks the complete accepted chain, and explicit resolution projects its recovery", () => {
  const project = accept(studio(), "preview");
  const review = previewEvidenceDecision(project, event(project, "evidence.disputed", "morrow",
    { evidenceId: "preview", disputeId: "preview-dispute", reason: "The final stems are missing." }, REVIEW));
  assert.equal(review.after.totals.readyMinor, 0);
  assert.deepEqual(review.rows.map(row => row.after.readiness), ["blocked", "blocked"]);
  const disputed = commitDecisionReview(project, review, CONFIRM).project;
  const resolution = previewEvidenceDecision(disputed, event(disputed, "dispute.resolved", "morrow",
    { disputeId: "preview-dispute", reason: "Replacement masters received." }, "2026-11-10T12:01:10.000Z"));
  assert.equal(resolution.evidence.id, "preview");
  assert.equal(resolution.actor.name, "Morrow Sound");
  assert.equal(resolution.before.totals.readyMinor, 0); assert.equal(resolution.after.totals.readyMinor, 127550);
});

test("history changed during review cannot silently receive a decision reviewed against older evidence", () => {
  const project = studio(); const review = acceptance(project);
  const changed = submit(project, "replacement", "masters"); const original = exportProject(changed);
  assert.throws(() => commitDecisionReview(changed, review, CONFIRM), error => error.code === "REVIEW_STALE");
  assert.equal(exportProject(changed), original);
});

test("a deadline crossing during review refreshes the projection without recording until reviewed again", () => {
  const project = studio({ dueAt: "2026-11-10T12:02:00.000Z" });
  const review = acceptance(project, "2026-11-10T12:01:59.000Z");
  const result = commitDecisionReview(project, review, "2026-11-10T12:02:01.000Z");
  assert.equal(result.status, "changed");
  assert.equal(review.rows[0].after.deadlineState, "accepted-on-time");
  assert.equal(result.review.rows[0].after.deadlineState, "accepted-late");
  assert.equal(result.review.before.asOf, result.review.after.asOf);
  assert.equal(project.events.length, 5);
  const recorded = commitDecisionReview(project, result.review, "2026-11-10T12:02:02.000Z");
  assert.equal(recorded.status, "recorded");
  assert.equal(recorded.event.at, "2026-11-10T12:02:02.000Z");
});
