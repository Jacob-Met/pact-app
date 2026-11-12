import test from "node:test";
import assert from "node:assert/strict";
import { createProject, appendEvent, projectView, exportProject } from "../app/core.mjs";
import { buildAuditTrail } from "../app/audit-trail.mjs";

const at = "2026-11-10T12:00:00.000Z";
function add(p, type, payload, actorId = "studio") {
  return appendEvent(p, { id: "event-" + (p.events.length + 1), seq: 0, at, actorId, type, payload });
}
function fixture() {
  const source = "Studio delivers the original stereo master. Gallery reviews the mix.";
  let p = createProject({ id: "history", title: "Gallery audio", sourceText: source, createdAt: at,
    budgetMinor: 50000, parties: [{ id: "studio", name: "Sedge Studio" }, { id: "gallery", name: "East Gallery" }] });
  p = add(p, "obligation.added", { obligation: { id: "audio", revision: 1, title: "Original stereo master",
    criterion: "Stereo mix without clipping", performerId: "studio", reviewerId: "gallery",
    dependsOn: [], dueAt: null, amountMinor: 50000,
    citation: { sourceId: p.source.id, sourceRevision: 1, start: 0, end: source.length, quote: source } } });
  p = add(p, "evidence.submitted", { evidence: { id: "proof", obligationId: "audio", obligationRevision: 1,
    submittedBy: "studio", description: "Stereo master and stems", reference: "EG-MIX-07.wav" } });
  return add(p, "evidence.accepted", { evidenceId: "proof", rationale: "Listened to every stem" }, "gallery");
}
function propose(p, id, title) {
  const old = projectView(p).obligations[0];
  return add(p, "amendment.proposed", { amendment: { id, baseRevision: old.revision,
    obligation: { ...old, revision: old.revision + 1, title }, reason: "New installation playback format" } });
}

test("evidence decisions and dispute resolution resolve named work, proof and exact reasons", () => {
  let p = fixture();
  p = add(p, "evidence.disputed", { evidenceId: "proof", disputeId: "d1", reason: "Left channel clicks" }, "gallery");
  p = add(p, "dispute.resolved", { disputeId: "d1", reason: "The player caused the click" }, "gallery");
  p = add(p, "evidence.revoked", { evidenceId: "proof", reason: "Superseded delivery" });
  const before = exportProject(p), rows = buildAuditTrail(projectView(p));
  assert.deepEqual(rows.map(row => row.action), ["Added commitment", "Submitted evidence", "Recorded acceptance", "Opened dispute", "Resolved dispute", "Revoked evidence"]);
  for (const row of rows.slice(1)) {
    assert.equal(row.obligation.title, "Original stereo master");
    assert.equal(row.evidence.reference, "EG-MIX-07.wav");
    assert.equal(row.evidence.description, "Stereo master and stems");
  }
  assert.equal(rows[2].reason, "Listened to every stem");
  assert.equal(rows[3].disputeId, "d1");
  assert.equal(rows[4].reason, "The player caused the click");
  assert.equal(rows[4].actor, "East Gallery");
  assert.equal(rows[5].reason, "Superseded delivery");
  assert.equal(exportProject(p), before, "presentation does not append or alter decisions");
});

test("renaming an adopted amendment never rewrites earlier evidence titles or revisions", () => {
  let p = propose(fixture(), "a1", "Quadraphonic installation master");
  for (const actor of ["studio", "gallery"]) p = add(p, "amendment.reviewed", { amendmentId: "a1", decision: "accept", reason: "Exact revised mix reviewed" }, actor);
  p = add(p, "amendment.adopted", { amendmentId: "a1" });
  p = add(p, "evidence.submitted", { evidence: { id: "quad", obligationId: "audio", obligationRevision: 2,
    submittedBy: "studio", description: "Four-channel master", reference: "EG-QUAD-08.wav" } });
  const rows = buildAuditTrail(projectView(p));
  assert.equal(projectView(p).obligations[0].title, "Quadraphonic installation master");
  for (const row of rows.slice(0, 3)) {
    assert.equal(row.obligation.title, "Original stereo master");
    assert.equal(row.obligation.revision, 1);
  }
  for (const row of rows.slice(3)) {
    assert.equal(row.obligation.title, "Quadraphonic installation master");
    assert.equal(row.obligation.revision, 2);
  }
  assert.equal(rows[3].reason, "New installation playback format");
  assert.equal(rows[4].amendment.id, "a1");
  assert.equal(rows[4].reason, "Exact revised mix reviewed");
  assert.equal(rows[6].action, "Applied amendment");
  assert.equal(rows[7].evidence.reference, "EG-QUAD-08.wav");
});

test("rejected and withdrawn proposals retain their distinct titles and proposal identity", () => {
  let p = propose(fixture(), "rejected", "Rejected surround mix");
  p = add(p, "amendment.reviewed", { amendmentId: "rejected", decision: "reject", reason: "Wrong speaker layout" }, "gallery");
  p = propose(p, "withdrawn", "Withdrawn binaural mix");
  p = add(p, "amendment.withdrawn", { amendmentId: "withdrawn", reason: "Need another source" });
  const rows = buildAuditTrail(projectView(p));
  assert.equal(rows[4].action, "Recorded amendment rejection");
  assert.equal(rows[4].obligation.title, "Rejected surround mix");
  assert.equal(rows[6].action, "Withdrew amendment");
  assert.equal(rows[6].obligation.title, "Withdrawn binaural mix");
  assert.equal(rows[6].amendment.id, "withdrawn");
  assert.equal(projectView(p).obligations[0].revision, 1);
});

test("party corrections preserve attribution at each event rather than retroactively renaming authors", () => {
  let p = fixture();
  p = add(p, "party.name-corrected", {partyId:"gallery",previousName:"East Gallery",name:"East Gallery Collective",reason:"Correct full display name"}, "gallery");
  p = add(p, "evidence.disputed", {evidenceId:"proof",disputeId:"names",reason:"Need a cleaner stem"}, "gallery");
  const rows = buildAuditTrail(projectView(p));
  assert.equal(rows[2].actor, "East Gallery");
  assert.equal(rows[3].actor, "East Gallery");
  assert.equal(rows[3].action, "Corrected party name");
  assert.equal(rows[3].subject, "East Gallery → East Gallery Collective");
  assert.equal(rows[4].actor, "East Gallery Collective");
  assert.equal(rows[4].obligation.title, "Original stereo master");
});
