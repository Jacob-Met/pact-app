import test from "node:test";
import assert from "node:assert/strict";
import { LIMITS, createProject, appendEvent, evaluateProject, projectView, previewAmendment, exportProject, importProject, FORMAT, AMENDMENT_FORMAT } from "../app/core.mjs";

const at = "2026-11-10T12:00:00.000Z";
const parties = [{id:"alder",name:"Alder Film"},{id:"salt",name:"Salt Marsh Festival"},{id:"captioner",name:"Reed Captions"}];
const source = "Alder Film delivers a trailer for USD 450. Salt Marsh Festival reviews the final stereo mix. Captions follow accepted trailer delivery for USD 900. The parties may revise their local completion terms.";
function add(p, type, actorId, payload) { return appendEvent(p, {id:"e-"+(p.events.length+1),seq:0,at,actorId,type,payload}); }
function obligation(id, title, amountMinor, dependsOn=[]) { return { id, revision:1, title, criterion:title+" delivered and checked", citation:{sourceId:"source-1",sourceRevision:1,start:0,end:source.length,quote:source}, performerId:"alder",reviewerId:"salt",dependsOn,dueAt:null,amountMinor }; }
function fixture() {
  let p=createProject({id:"festival",title:"Festival trailer",sourceText:source,parties,budgetMinor:135000,createdAt:at});
  for (const o of [obligation("trailer","Trailer",45000),obligation("captions","Captions",90000,["trailer"])]) {
    p=add(p,"obligation.added","alder",{obligation:o});
    p=add(p,"evidence.submitted","alder",{evidence:{id:"proof-"+o.id,obligationId:o.id,obligationRevision:1,submittedBy:"alder",description:"Original delivery",reference:o.id+".zip"}});
    p=add(p,"evidence.accepted","salt",{evidenceId:"proof-"+o.id,rationale:"Original terms reviewed"});
  }
  return p;
}
function terms(p, changes={}) { const old=projectView(p).obligations[0];return {...old,revision:old.revision+1,amountMinor:40000,criterion:"Final stereo mix and 30 second edit",...changes}; }
function propose(p, candidate=terms(p), id="amend-1", actor="alder") { return add(p,"amendment.proposed",actor,{amendment:{id,baseRevision:candidate.revision-1,obligation:candidate,reason:"Shorter festival edit; reduce fee"}}); }
function reviews(p, id="amend-1") { for(const party of p.parties) p=add(p,"amendment.reviewed",party.id,{amendmentId:id,decision:"accept",reason:"Recorded review of these exact proposed terms"});return p; }
function adopt(p, id="amend-1") { return add(p,"amendment.adopted","salt",{amendmentId:id}); }
const code = expected => cause => cause.code === expected;

test("a proposed cheaper replacement does not alter active terms, evidence or allocation; v1 files still round-trip", () => {
  const original=fixture(), bytes=exportProject(original);
  assert.equal(original.format,FORMAT);
  const next=propose(original);
  assert.equal(next.format,AMENDMENT_FORMAT);
  assert.equal(evaluateProject(next,at).totals.readyMinor,135000);
  assert.equal(evaluateProject(next,at).totals.allocatedMinor,135000);
  assert.equal(projectView(next).obligations[0].revision,1);
  assert.equal(projectView(next).amendments[0].awaitingPartyIds.length,3);
  assert.equal(exportProject(original),bytes);
  assert.deepEqual(importProject(bytes),original);
  assert.deepEqual(importProject(exportProject(next)),next);
});

test("every declared party reviews the exact proposal, and final review alone does not apply it", () => {
  let p=propose(fixture());
  assert.throws(()=>adopt(p),code("AMENDMENT_REVIEW_REQUIRED"));
  p=add(p,"amendment.reviewed","alder",{amendmentId:"amend-1",decision:"accept",reason:"Recorded proposer review"});
  assert.throws(()=>add(p,"amendment.reviewed","alder",{amendmentId:"amend-1",decision:"accept",reason:"Duplicate"}),code("DUPLICATE_DECISION"));
  p=add(p,"amendment.reviewed","salt",{amendmentId:"amend-1",decision:"accept",reason:"Recorded client review"});
  assert.throws(()=>adopt(p),code("AMENDMENT_REVIEW_REQUIRED"));
  p=add(p,"amendment.reviewed","captioner",{amendmentId:"amend-1",decision:"accept",reason:"Recorded downstream party review"});
  assert.equal(projectView(p).obligations[0].revision,1);
  assert.equal(evaluateProject(p,at).totals.readyMinor,135000);
  p=adopt(p);
  assert.equal(projectView(p).obligations[0].revision,2);
  assert.equal(evaluateProject(p,at).totals.allocatedMinor,130000);
  assert.equal(evaluateProject(p,at).totals.unallocatedMinor,5000);
  assert.equal(evaluateProject(p,at).totals.readyMinor,0);
  assert.equal(projectView(p).amendments[0].status,"adopted");
  assert.throws(()=>adopt(p),code("AMENDMENT_NOT_PENDING"));
});

test("preview names direct and dependent readiness losses without writing; fresh revision evidence restores the chain", () => {
  const original=fixture(), bytes=exportProject(original);
  const preview=previewAmendment(original,terms(original),at);
  assert.equal(preview.before.totals.readyMinor,135000);
  assert.equal(preview.after.totals.readyMinor,0);
  assert.deepEqual(preview.changed.map(x=>x.after.obligationId),["trailer","captions"]);
  assert.deepEqual(preview.historicalEvidenceIds,["proof-trailer"]);
  assert.equal(exportProject(original),bytes);
  let p=adopt(reviews(propose(original)));
  assert.throws(()=>add(p,"evidence.submitted","alder",{evidence:{id:"stale-proof",obligationId:"trailer",obligationRevision:1,submittedBy:"alder",description:"Old contract",reference:"old.wav"}}),code("UNKNOWN_OBLIGATION"));
  p=add(p,"evidence.submitted","alder",{evidence:{id:"revised-proof",obligationId:"trailer",obligationRevision:2,submittedBy:"alder",description:"30 second edit and stereo mix",reference:"festival-30s.wav"}});
  p=add(p,"evidence.accepted","salt",{evidenceId:"revised-proof",rationale:"Current revision checked"});
  const result=evaluateProject(p,at);
  assert.equal(result.totals.readyMinor,130000);
  assert.deepEqual(result.obligations[0].validEvidenceIds,["revised-proof"]);
  assert.equal(projectView(p).evidence.length,3);
  assert.equal(projectView(p).obligationVersions.length,3);
  assert.deepEqual(importProject(exportProject(p)),p);
});

test("rejection and proposer withdrawal preserve current terms; a new proposal inherits no reviews", () => {
  let p=propose(fixture());
  p=add(p,"amendment.reviewed","salt",{amendmentId:"amend-1",decision:"reject",reason:"Keep full length"});
  assert.equal(projectView(p).amendments[0].status,"rejected");
  assert.equal(evaluateProject(p,at).totals.readyMinor,135000);
  p=propose(p,terms(p,{amountMinor:42500}),"amend-2");
  assert.deepEqual(projectView(p).amendments[1].reviews,[]);
  assert.throws(()=>add(p,"amendment.withdrawn","salt",{amendmentId:"amend-2",reason:"Not my proposal"}),code("ACTOR_FORBIDDEN"));
  p=add(p,"amendment.withdrawn","alder",{amendmentId:"amend-2",reason:"Rework proposal after discussion"});
  assert.equal(projectView(p).amendments[1].status,"withdrawn");
  assert.equal(projectView(p).obligations[0].amountMinor,45000);
  assert.equal(evaluateProject(p,at).totals.readyMinor,135000);
});

test("historical disputes remain visible blockers; historical evidence keeps its original reviewer", () => {
  let p=fixture();
  p=add(p,"evidence.submitted","alder",{evidence:{id:"unreviewed-old",obligationId:"trailer",obligationRevision:1,submittedBy:"alder",description:"Alternate original mix",reference:"old-alt.wav"}});
  p=add(p,"evidence.disputed","captioner",{evidenceId:"proof-trailer",disputeId:"timing",reason:"Cue timings do not match"});
  p=adopt(reviews(propose(p,terms(p,{reviewerId:"captioner"}))));
  assert.throws(()=>add(p,"evidence.accepted","captioner",{evidenceId:"unreviewed-old",rationale:"New reviewer cannot adopt old evidence"}),code("HISTORICAL_EVIDENCE"));
  assert.throws(()=>add(p,"evidence.revoked","captioner",{evidenceId:"unreviewed-old",reason:"Not its original reviewer"}),code("ACTOR_FORBIDDEN"));
  p=add(p,"evidence.revoked","salt",{evidenceId:"unreviewed-old",reason:"Original reviewer withdraws old reference"});
  p=add(p,"evidence.submitted","alder",{evidence:{id:"new-proof",obligationId:"trailer",obligationRevision:2,submittedBy:"alder",description:"Corrected timing",reference:"new.wav"}});
  p=add(p,"evidence.accepted","captioner",{evidenceId:"new-proof",rationale:"Revised timing checked"});
  assert.ok(evaluateProject(p,at).obligations[0].blockers.includes("OPEN_DISPUTE"));
  assert.throws(()=>add(p,"dispute.resolved","salt",{disputeId:"timing",reason:"Wrong declarer"}),code("ACTOR_FORBIDDEN"));
  p=add(p,"dispute.resolved","captioner",{disputeId:"timing",reason:"Earlier timing concern resolved"});
  assert.equal(evaluateProject(p,at).totals.readyMinor,130000);
});

test("revised dependencies may refer to a later-created commitment, but cannot create a cycle", () => {
  let p=createProject({id:"stages",title:"Festival",sourceText:source,parties,budgetMinor:100000,createdAt:at});
  for(const id of ["edit","mix"])p=add(p,"obligation.added","alder",{obligation:obligation(id,id,40000)});
  p=add(p,"evidence.submitted","alder",{evidence:{id:"mix-proof",obligationId:"mix",obligationRevision:1,submittedBy:"alder",description:"Mix",reference:"mix.wav"}});
  p=add(p,"evidence.accepted","salt",{evidenceId:"mix-proof",rationale:"Mix checked"});
  p=adopt(reviews(propose(p,terms(p,{amountMinor:35000,dependsOn:["mix"]}))));
  assert.deepEqual(evaluateProject(p,at).obligations[0].dependencyBlockers,[]);
  const mix=projectView(p).obligations[1];
  assert.throws(()=>propose(p,{...mix,revision:2,dependsOn:["edit"]},"cycle"),code("DEPENDENCY_CYCLE"));
  assert.throws(()=>propose(p,{...mix,revision:2,dependsOn:["mix"]},"self"),code("DEPENDENCY_CYCLE"));
});

test("a pending proposal cannot hide allocation consumed by another adopted amendment", () => {
  let p=createProject({id:"budget",title:"Budget",sourceText:source,parties,budgetMinor:100000,createdAt:at});
  for(const id of ["one","two"])p=add(p,"obligation.added","alder",{obligation:obligation(id,id,40000)});
  const [one,two]=projectView(p).obligations;
  p=propose(p,{...one,revision:2,amountMinor:60000},"raise-one");
  p=propose(p,{...two,revision:2,amountMinor:60000},"raise-two");
  p=adopt(reviews(p,"raise-one"),"raise-one");
  p=reviews(p,"raise-two");
  assert.throws(()=>adopt(p,"raise-two"),code("BUDGET_EXCEEDED"));
  assert.equal(evaluateProject(p,at).totals.allocatedMinor,100000);
});

test("unchanged, parallel and stale proposals fail without altering history", () => {
  const p=fixture(), old=projectView(p).obligations[0];
  assert.throws(()=>propose(p,{...old,revision:2}),code("NO_AMENDMENT"));
  assert.throws(()=>propose(p,{...old,revision:3,amountMinor:40000}),code("STALE_AMENDMENT"));
  const proposed=propose(p);
  assert.throws(()=>propose(proposed,terms(p,{amountMinor:42000}),"other"),code("AMENDMENT_PENDING"));
  const malformed={...proposed,format:FORMAT};
  assert.throws(()=>importProject(JSON.stringify(malformed)),code("UNSUPPORTED_FORMAT"));
});

test("a previously accepting party can reject before application without erasing its earlier review", () => {
  let p=reviews(propose(fixture()));
  p=add(p,"amendment.reviewed","captioner",{amendmentId:"amend-1",decision:"reject",reason:"Festival changed the access requirement after my review"});
  const proposal=projectView(p).amendments[0];
  assert.equal(proposal.status,"rejected");
  assert.equal(proposal.reviews.length,4);
  assert.deepEqual(proposal.reviews.filter(r=>r.actorId==="captioner").map(r=>r.decision),["accept","reject"]);
  assert.equal(evaluateProject(p,at).totals.readyMinor,135000);
  assert.throws(()=>adopt(p),code("AMENDMENT_NOT_PENDING"));
  p=propose(p,terms(p,{amountMinor:41000}),"amend-2");
  assert.equal(projectView(p).amendments[1].reviews.length,0);
});

test('dependent review names changed prerequisite until newer dependent evidence is reviewed', async () => {
  const {buildObligationNetwork}=await import('../app/obligation-network.mjs');
  let p=fixture();
  const row=()=>buildObligationNetwork(projectView(p),evaluateProject(p,at)).find(x=>x.id==='captions');
  assert.deepEqual(row().changedPrerequisites,[]);
  p=adopt(reviews(propose(p)));
  assert.deepEqual(row().changedPrerequisites,[{id:'trailer',title:'Trailer',before:1,after:2}]);
  p=add(p,'evidence.submitted','alder',{evidence:{id:'updated-captions',obligationId:'captions',obligationRevision:1,submittedBy:'alder',description:'Captions updated for new cut',reference:'captions-v2.zip'}});
  assert.equal(row().changedPrerequisites.length,1);
  p=add(p,'evidence.accepted','salt',{evidenceId:'updated-captions',rationale:'Checked against revised cut'});
  assert.deepEqual(row().changedPrerequisites,[]);
  assert.deepEqual(buildObligationNetwork(projectView(importProject(exportProject(p)))).find(x=>x.id==='captions').changedPrerequisites,[]);
});

test('changed prerequisite context follows indirect dependencies but excludes unrelated work', async () => {
  const {buildObligationNetwork}=await import('../app/obligation-network.mjs');
  let p=fixture();
  for(const o of [obligation('delivery','Delivery',0,['captions']),obligation('poster','Poster',0)]) {
    p=add(p,'obligation.added','alder',{obligation:o});
    p=add(p,'evidence.submitted','alder',{evidence:{id:'proof-'+o.id,obligationId:o.id,obligationRevision:1,submittedBy:'alder',description:'Checked original work',reference:o.id+'.zip'}});
    p=add(p,'evidence.accepted','salt',{evidenceId:'proof-'+o.id,rationale:'Checked original dependencies'});
  }
  p=adopt(reviews(propose(p)));
  const rows=buildObligationNetwork(projectView(p));
  assert.deepEqual(rows.find(x=>x.id==='delivery').changedPrerequisites,[{id:'trailer',title:'Trailer',before:1,after:2}]);
  assert.deepEqual(rows.find(x=>x.id==='poster').changedPrerequisites,[]);
});

test("complete replacement criteria survive review, adoption and imported history without truncation", () => {
  const original = fixture(), clause = "Delivery requires approval; exceptions remain. ";
  const criterion = clause.repeat(Math.ceil(LIMITS.criterion/clause.length)).slice(0, LIMITS.criterion);
  assert.equal(criterion.length, LIMITS.criterion);
  const replacement = terms(original, { criterion });
  const proposed = propose(original, replacement);
  assert.equal(projectView(proposed).amendments[0].obligation.criterion, criterion);
  assert.equal(projectView(proposed).obligations[0].criterion, projectView(original).obligations[0].criterion);
  const adopted = importProject(exportProject(adopt(reviews(proposed))));
  assert.equal(projectView(adopted).obligations[0].criterion, criterion);
  assert.equal(projectView(adopted).obligationVersions.find(item => item.id === replacement.id && item.revision === 1).criterion, projectView(original).obligations[0].criterion);
  assert.throws(() => propose(original, { ...replacement, criterion: criterion + "x" }), code("INVALID_TEXT"));
  const oversized = structuredClone(proposed);
  oversized.events.at(-1).payload.amendment.obligation.criterion += "x";
  assert.throws(() => importProject(JSON.stringify(oversized)), code("INVALID_TEXT"));
});


test("adding a distant source condition previews older agreement formats without rewriting the active record",async()=>{
  const {readFile}=await import("node:fs/promises");
  const {sourceCitation,citationText}=await import("../app/source-citations.mjs");
  const {SOURCE_RANGES_FORMAT}=await import("../app/core.mjs");
  const retained=JSON.parse(await readFile(new URL("./fixtures/long-conditions.json",import.meta.url),"utf8"));
  const text=retained.source,span=(start,end)=>({start,end,quote:text.slice(start,end)});
  const a=text.indexOf("“MWESB Report”"),b=text.indexOf("“Reimbursable Expenses”",a);
  const c=text.indexOf("Upon completion of all Work under this Agreement"),d=text.indexOf("VI.",c);
  const ranges=[span(a,a+text.slice(a,b).trimEnd().length),span(c,c+text.slice(c,d).trimEnd().length)];
  assert.ok(ranges[1].start-ranges[0].end>18000);
  const initial=createProject({id:"report-amendment",title:"Final MWESB report",sourceText:text,parties,budgetMinor:100,createdAt:at});
  const citation=sourceCitation(initial.source,[ranges[1]]);
  const original=add(initial,"obligation.added","alder",{obligation:{...obligation("report","Final MWESB report",100),citation,criterion:citationText(citation)}});
  for(const format of [FORMAT,AMENDMENT_FORMAT]){
    const record={...original,format},snapshot=exportProject(record),previous=projectView(record).obligations[0];
    const complete=sourceCitation(record.source,ranges),candidate={...previous,revision:2,citation:complete,criterion:citationText(complete)};
    const preview=previewAmendment(record,candidate,at);
    assert.equal(preview.baseSnapshot,snapshot);assert.equal(exportProject(record),snapshot);
    assert.deepEqual(preview.candidate.citation,complete);
    const proposed=propose(record,candidate,"report-proposal");
    assert.equal(proposed.format,SOURCE_RANGES_FORMAT);
    assert.deepEqual(projectView(proposed).obligations[0].citation,citation);
    const applied=adopt(reviews(proposed,"report-proposal"),"report-proposal");
    assert.deepEqual(projectView(importProject(exportProject(applied))).obligations[0].citation,complete);
  }
});
