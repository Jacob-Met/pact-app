import test from "node:test";
import assert from "node:assert/strict";
import { appendEvent, createProject, evaluateProject, exportProject, importProject, projectView } from "../app/core.mjs";

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


import { paymentReadiness } from '../app/payment-readiness.mjs';
const at = '2026-10-19T09:00:00.000Z';
test('payment preparation names missing evidence and prerequisite commitments', () => {
 const p=graph(); const state=paymentReadiness(p,'B',at,'configured');
 assert.equal(state.eligible,false);assert.match(state.message,/accepted evidence/);assert.match(state.message,/Obligation A/);
});
test('acceptance permits local review but a dispute or missing provider still blocks preparation', () => {
 let p=graph();p=accept(submit(p,'ea','A'),'ea');p=accept(submit(p,'eb','B'),'eb');
 assert.equal(paymentReadiness(p,'B',at,'configured').eligible,true);
 for(const config of ['checking','unavailable','not-configured']) assert.equal(paymentReadiness(p,'B',at,config).eligible,false);
 p=event(p,'evidence.disputed','studio',{evidenceId:'eb',disputeId:'d1',reason:'Delivery is contested'});
 assert.match(paymentReadiness(p,'B',at,'configured').message,/open evidence disputes/);
 assert.equal(paymentReadiness(p,'B',at,'configured').eligible,false);
});
test('invalid evaluation instant and zero amount fail closed without losing explanation', () => {
 let p=graph();p=accept(submit(p,'ea','A'),'ea');
 assert.match(paymentReadiness(p,'A',at,'configured').message,/amount must/);
 assert.match(paymentReadiness(p,'B','', 'configured').message,/evaluation time/);
 assert.equal(paymentReadiness(p,'',at,'configured').eligible,false);
});
