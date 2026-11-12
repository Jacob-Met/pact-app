import { dependentCommitments } from "../app/obligation-network.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { appendEvent, createProject, evaluateProject, projectView } from "../app/core.mjs";
import { buildObligationNetwork } from "../app/obligation-network.mjs";

const T0 = "2026-11-01T00:00:00.000Z";
const SOURCE = "Stage A delivers the signed illustration. Stage B follows Stage A after review.";
function makeProject() {
  return createProject({ id: "map-fixture", title: "Dependency receiving",
    sourceText: SOURCE, parties: [{ id: "studio", name: "Studio" }, { id: "client", name: "Client" }],
    budgetMinor: 15_000, createdAt: T0 });
}
function add(project, type, actorId, payload) {
  return appendEvent(project, {
    id: "event-" + (project.events.length + 1),
    seq: 0, at: new Date(Date.parse(T0) + (project.events.length + 1) * 60_000).toISOString(),
    actorId, type, payload
  });
}
function clause(id, title, quote, dependsOn, amountMinor) {
  const start = SOURCE.indexOf(quote);
  return { id, revision: 1, title, criterion: "Review " + title,
    performerId: "studio", reviewerId: "client", dependsOn, dueAt: null, amountMinor,
    citation: { sourceId: "source-1", sourceRevision: 1, start, end: start + quote.length, quote } };
}
function graph() {
  let p = makeProject();
  p = add(p, "obligation.added", "studio", { obligation: clause("a", "Illustration delivered", "Stage A", [], 5_000) });
  p = add(p, "obligation.added", "studio", { obligation: clause("b", "Production handoff", "Stage B", ["a"], 10_000) });
  for (const [id, obligationId] of [["ea","a"],["eb","b"]]) {
    p = add(p, "evidence.submitted", "studio", { evidence: {
      id, obligationId, obligationRevision: 1, submittedBy: "studio",
      description: "Evidence for " + obligationId, reference: "local-note-" + id
    } });
    p = add(p, "evidence.accepted", "client", { evidenceId: id, rationale: "Reviewer accepted illustration" });
  }
  return p;
}
const asOf = "2026-11-02T00:00:00.000Z";

test("causal network preserves exact source, explicit dependencies and nonexecuting readiness", () => {
  const p = graph(), evaluation = evaluateProject(p, asOf);
  const nodes = buildObligationNetwork(projectView(p), evaluation);
  assert.equal(nodes.length, 2);
  assert.deepEqual(nodes.map(n => [n.depth,n.state,n.acceptedCount,n.amountMinor]), [
    [0, "ready", 1, 5_000], [1, "ready", 1, 10_000]
  ]);
  assert.deepEqual(nodes[1].dependsOn, ["a"]);
  assert.equal(nodes[1].source, "Stage B");
  assert.equal(nodes[0].source, SOURCE.slice(nodes[0].citation.start,nodes[0].citation.end));
  assert.equal(nodes[1].executable, false);
  assert.equal(evaluation.totals.executedMinor, 0);
});

test("without explicit evaluation, accepted authored notes do not imply payment readiness", () => {
  const nodes = buildObligationNetwork(projectView(graph()));
  assert.deepEqual(nodes.map(n => n.state), ["unevaluated","unevaluated"]);
  assert.equal(nodes[0].evidence[0].status, "accepted");
  assert.equal(nodes[1].evaluatedAsOf, null);
});

test("revoked upstream evidence blocks downstream money despite local acceptance", () => {
  let p = graph();
  p = add(p, "evidence.revoked", "studio", { evidenceId: "ea", reason: "Source proof withdrawn" });
  const nodes = buildObligationNetwork(projectView(p), evaluateProject(p, asOf));
  assert.deepEqual(nodes.map(n => n.state), ["blocked","blocked"]);
  assert.ok(nodes[1].blockers.includes("DEPENDENCY_NOT_READY"));
  assert.equal(nodes[0].evidence[0].status, "revoked");
});

test("disputes are visible and distinct from an ordinary missing-evidence blocker", () => {
  let p = graph();
  p = add(p, "evidence.disputed", "studio", { evidenceId: "ea", disputeId:"dispute-1",reason:"Client disagrees with visual quality" });
  const nodes = buildObligationNetwork(projectView(p), evaluateProject(p, asOf));
  assert.equal(nodes[0].state,"disputed");
  assert.equal(nodes[0].evidence[0].status,"disputed");
  assert.deepEqual(nodes[0].openDisputes,["dispute-1"]);
  assert.equal(nodes[1].state,"blocked");
  assert.ok(nodes[1].blockers.includes("DEPENDENCY_NOT_READY"));
});

test("shared prerequisite exposes transitive dependents once without unrelated commitments", () => {
  const items = [
    { id: "record", dependsOn: [] },
    { id: "edit", dependsOn: ["record"] },
    { id: "caption", dependsOn: ["record"] },
    { id: "deliver", dependsOn: ["edit", "caption"] },
    { id: "new-contract", dependsOn: [] }
  ];
  assert.deepEqual(dependentCommitments(items, "record").map(item => item.id), ["edit", "caption", "deliver"]);
  assert.deepEqual(dependentCommitments(items, "caption").map(item => item.id), ["deliver"]);
  assert.deepEqual(dependentCommitments(items, "deliver"), []);
});

test("a commitment can be found by wording in its distant governing passage",async()=>{
 const {readFile}=await import("node:fs/promises");
 const {sourceCitation,citationText}=await import("../app/source-citations.mjs");
 const {findCommitments}=await import("../app/commitment-search.mjs");
 const source=JSON.parse(await readFile(new URL("fixtures/long-conditions.json",import.meta.url),"utf8")).source;
 let p=makeProject();p={...p,source:{...p.source,text:source}};
 const a=source.indexOf("“MWESB Report”"),b=source.indexOf("“Reimbursable Expenses”",a),
  c=source.indexOf("Upon completion of all Work under this Agreement"),d=source.indexOf("VI.",c);
 const range=(start,stop)=>{const end=start+source.slice(start,stop).trimEnd().length;return {start,end,quote:source.slice(start,end)};};
 const citation=sourceCitation(p.source,[range(a,b),range(c,d)]);
 p=add(p,"obligation.added","studio",{obligation:{...clause("report","Final report","Stage A",[],5000),citation}});
 const nodes=buildObligationNetwork(projectView(p));
 assert.equal(nodes[0].source,citationText(citation));
 assert.deepEqual(findCommitments(nodes,{query:"dollar value"}).map(r=>r.item.id),["report"]);
 assert.deepEqual(findCommitments(nodes,{query:"certified State Oregon"}).map(r=>r.item.id),["report"]);
 assert.equal(nodes[0].state,"unevaluated");
 assert.equal(p.events.length,1);
});
