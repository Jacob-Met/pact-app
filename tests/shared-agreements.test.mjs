import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {mkdtemp,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createProject,appendEvent,projectView} from "../app/core.mjs";
import {createSharedAgreementStore,historyDigest} from "../shared-agreements.mjs";
function example(){
 let p=createProject({id:"shared-studio",title:"Museum poster",sourceText:"Deliver the final poster.",parties:[{id:"studio",name:"Pine Studio"},{id:"museum",name:"Lantern Museum"}],budgetMinor:2000,createdAt:"2026-11-10T10:00:00.000Z"});
 p=appendEvent(p,{id:"obligation-event",at:p.createdAt,actorId:"studio",type:"obligation.added",payload:{obligation:{id:"poster",revision:1,title:"Wall poster",criterion:"Final print-ready poster",citation:{sourceId:"source-1",sourceRevision:1,start:0,end:p.source.text.length,quote:p.source.text},performerId:"studio",reviewerId:"museum",dependsOn:[],dueAt:null,amountMinor:1500}}});
 return appendEvent(p,{id:"delivery-event",at:p.createdAt,actorId:"studio",type:"evidence.submitted",payload:{evidence:{id:"poster-file",obligationId:"poster",obligationRevision:1,submittedBy:"studio",description:"Final poster",reference:"poster-final.pdf"}}});
}
const input=p=>({operationId:randomUUID(),digest:historyDigest(p),type:"evidence.accepted",payload:{evidenceId:"poster-file",rationale:"The final poster meets the agreed print specification."}});
test("invited party authority, one-use links, durable records and lost-response retry",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"pact-shared-"));const path=join(dir,"shared.json");let now=Date.parse("2026-11-10T12:00:00.000Z");
 try{
  const store=await createSharedAgreementStore({path,clock:()=>now}),p=example(),opened=await store.open(p,"studio");
  const invite=await store.invite(opened.id,"museum"),claimed=await store.claim(invite.token);
  await assert.rejects(store.claim(invite.token),e=>e.status===401);
  const request=input(p),preview=await store.preview(claimed.session,request);request.reviewSignature=preview.signature;
  assert.equal(preview.review.after.readyMinor,1500);
  const recorded=await store.append(claimed.session,request),replayed=await store.append(claimed.session,request);
  assert.equal(recorded.project.events.length,3);assert.equal(replayed.project.events.length,3);
  assert.equal(recorded.project.events.at(-1).actorId,"museum");
  assert.equal(recorded.receipts[0].method,"invited-session");
  await assert.rejects(store.append(claimed.session,{...request,payload:{...request.payload,rationale:"Different"}}),e=>e.status===409);
  const disk=await readFile(path,"utf8");assert.equal(disk.includes(invite.token),false);assert.equal(disk.includes(claimed.session),false);
  const restarted=await createSharedAgreementStore({path,clock:()=>now});
  assert.equal((await restarted.read(claimed.session)).project.events.length,3);
  await restarted.revoke(opened.id,"museum");
  await assert.rejects(restarted.read(claimed.session),e=>e.status===401);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test("a delivery party cannot impersonate the reviewer or publish forged reviewer records",async()=>{
 const store=await createSharedAgreementStore({clock:()=>Date.parse("2026-11-10T12:00:00.000Z")}),p=example(),a=await store.open(p,"studio");
 const invitation=await store.invite(a.id,"studio"),session=await store.claim(invitation.token);
 await assert.rejects(store.preview(session.session,input(p)),e=>e.code==="REVIEWER_REQUIRED");
 await assert.rejects(store.preview(session.session,{...input(p),actorId:"museum"}),e=>e.code==="ACTION_FIELDS");
 const forged=appendEvent(p,{id:"forged",at:"2026-11-10T11:00:00.000Z",actorId:"museum",type:"evidence.accepted",payload:input(p).payload});
 await assert.rejects(store.publish(a.id,forged,a.digest),e=>e.status===403);
 assert.equal((await store.ownerRead(a.id)).project.events.length,2);
});
test("concurrent review refuses a stale decision and changed effects require another preview",async()=>{
 let now=Date.parse("2026-11-10T12:00:00.000Z");const store=await createSharedAgreementStore({clock:()=>now}),p=example(),a=await store.open(p,"studio");
 const i=await store.invite(a.id,"museum"),s=await store.claim(i.token),one=input(p),two=input(p);
 one.reviewSignature=(await store.preview(s.session,one)).signature;two.reviewSignature=(await store.preview(s.session,two)).signature;
 await store.append(s.session,one);
 await assert.rejects(store.append(s.session,two),e=>e.status===409);
 const state=await store.read(s.session);
 const dispute={operationId:randomUUID(),digest:state.digest,type:"evidence.disputed",payload:{evidenceId:"poster-file",disputeId:"new-dispute",reason:"The submitted version changed."}};
 await assert.rejects(store.append(s.session,dispute),e=>e.code==="REVIEW_CHANGED");
 assert.equal((await store.read(s.session)).project.events.length,3);
});
test("expiry and replacing access stop old sessions without deleting shared history",async()=>{
 let now=Date.parse("2026-11-10T12:00:00.000Z");const store=await createSharedAgreementStore({clock:()=>now}),a=await store.open(example(),"studio");
 const first=await store.invite(a.id,"museum"),s=await store.claim(first.token);
 await store.invite(a.id,"museum");await assert.rejects(store.read(s.session),e=>e.status===401);
 const last=await store.invite(a.id,"museum");now+=2*60*60*1000;
 await assert.rejects(store.claim(last.token),e=>e.status===401);
 assert.equal((await store.ownerRead(a.id)).project.events.length,2);
});

test("payment dispatch is ordered before later shared records and errors release the queue",async()=>{
 const store=await createSharedAgreementStore(),p=example();
 const opened=await store.open(p,"studio"),invite=await store.invite(opened.id,"museum");
 const {session}=await store.claim(invite.token);
 const action=input(p),review=await store.preview(session,action);action.reviewSignature=review.signature;
 let release,started;
 const entered=new Promise(r=>started=r),held=new Promise(r=>release=r),order=[];
 const paying=store.withCurrentProject(p,async()=>{order.push("payment started");started();await held;order.push("payment finished");return "receipt";});
 await entered;
 const recording=store.append(session,action).then(value=>{order.push("review recorded");return value;});
 await new Promise(r=>setImmediate(r));
 assert.deepEqual(order,["payment started"]);
 release();assert.equal(await paying,"receipt");const latest=await recording;
 assert.deepEqual(order,["payment started","payment finished","review recorded"]);
 await assert.rejects(store.withCurrentProject(p,()=>assert.fail("stale dispatch")),e=>e.code==="SHARED_HISTORY_CHANGED");
 await assert.rejects(store.withCurrentProject(latest.project,()=>{throw Error("provider unavailable");}),/provider unavailable/);
 assert.equal((await store.ownerRead(opened.id)).digest,latest.digest);
 assert.equal(await store.withCurrentProject(latest.project,()=>42),42);
});

test("local records must be published before their snapshot can authorize payment",async()=>{
 const store=await createSharedAgreementStore(),p=example(),opened=await store.open(p,"studio");
 const local=appendEvent(p,{id:"second-file",at:p.createdAt,actorId:"studio",type:"evidence.submitted",payload:{evidence:{id:"poster-v2",obligationId:"poster",obligationRevision:1,submittedBy:"studio",description:"Second export",reference:"poster-v2.pdf"}}});
 await assert.rejects(store.withCurrentProject(local,()=>assert.fail("unpublished dispatch")),e=>e.code==="SHARED_HISTORY_UNPUBLISHED");
 await store.publish(opened.id,local,opened.digest);
 assert.equal(await store.withCurrentProject(local,()=>"current"),"current");
});

test("each invited party reviews changed terms before the organizer can apply them",async()=>{
 const clock=()=>Date.parse("2026-11-10T12:00:00.000Z"),store=await createSharedAgreementStore({clock});
 const base={...example(),parties:[...example().parties,{id:"printer",name:"Harbor Print"}]};
 const opened=await store.open(base,"studio"),previous=projectView(base).obligations[0];
 let proposed=appendEvent(base,{id:"proposal-event",at:"2026-11-10T11:00:00.000Z",actorId:"studio",type:"amendment.proposed",payload:{amendment:{id:"poster-revision",baseRevision:1,obligation:{...previous,revision:2,amountMinor:1200,criterion:"Revised A3 print-ready poster"},reason:"Use the smaller print format and reduce the fee."}}});
 proposed=appendEvent(proposed,{id:"studio-review",at:"2026-11-10T11:01:00.000Z",actorId:"studio",type:"amendment.reviewed",payload:{amendmentId:"poster-revision",decision:"accept",reason:"The studio accepts the revised format and fee."}});
 await store.publish(opened.id,proposed,opened.digest);
 const sessions={};
 for(const party of ["museum","printer"]){const i=await store.invite(opened.id,party);sessions[party]=(await store.claim(i.token)).session;}
 const action=()=>({operationId:randomUUID(),digest:historyDigest(proposed),type:"amendment.reviewed",payload:{amendmentId:"poster-revision",decision:"accept",reason:"I reviewed the exact revised format and lower fee."}});
 const museum=action(),printer=action();
 const preview=await store.preview(sessions.museum,museum);
 assert.equal(preview.review.kind,"amendment");assert.equal(preview.review.previous.amountMinor,1500);assert.equal(preview.review.candidate.amountMinor,1200);
 await assert.rejects(store.append(sessions.museum,{...museum,reviewSignature:"unreviewed"}),e=>e.code==="REVIEW_CHANGED");
 museum.reviewSignature=preview.signature;printer.reviewSignature=(await store.preview(sessions.printer,printer)).signature;
 const first=await store.append(sessions.museum,museum);
 assert.equal(projectView(first.project).obligations[0].revision,1);
 assert.throws(()=>appendEvent(first.project,{id:"too-soon",at:"2026-11-10T12:01:00.000Z",actorId:"studio",type:"amendment.adopted",payload:{amendmentId:"poster-revision"}}),e=>e.code==="AMENDMENT_REVIEW_REQUIRED");
 await assert.rejects(store.append(sessions.printer,printer),e=>e.code==="HISTORY_CHANGED");
 printer.digest=first.digest;printer.reviewSignature=(await store.preview(sessions.printer,printer)).signature;
 const reviewed=await store.append(sessions.printer,printer);
 assert.equal(projectView(reviewed.project).obligations[0].revision,1);
 const applied=appendEvent(reviewed.project,{id:"apply-proposal",at:"2026-11-10T12:01:00.000Z",actorId:"studio",type:"amendment.adopted",payload:{amendmentId:"poster-revision"}});
 const published=await store.publish(opened.id,applied,reviewed.digest);
 assert.equal(projectView(published.project).obligations[0].revision,2);
 assert.equal(projectView(published.project).obligations[0].amountMinor,1200);
 assert.deepEqual(published.receipts.map(r=>r.partyId),["museum","printer"]);
});
test("an invited party can reject proposed terms without changing the active commitment",async()=>{
 const store=await createSharedAgreementStore({clock:()=>Date.parse("2026-11-10T12:00:00.000Z")}),base=example(),previous=projectView(base).obligations[0];
 const proposed=appendEvent(base,{id:"proposal-event",at:"2026-11-10T11:00:00.000Z",actorId:"studio",type:"amendment.proposed",payload:{amendment:{id:"poster-revision",baseRevision:1,obligation:{...previous,revision:2,amountMinor:1200},reason:"Reduce the print fee."}}});
 const a=await store.open(proposed,"studio"),i=await store.invite(a.id,"museum"),session=(await store.claim(i.token)).session;
 const input={operationId:randomUUID(),digest:a.digest,type:"amendment.reviewed",payload:{amendmentId:"poster-revision",decision:"reject",reason:"Keep the original agreed print scope."}};
 input.reviewSignature=(await store.preview(session,input)).signature;
 const result=await store.append(session,input),view=projectView(result.project);
 assert.equal(view.amendments[0].status,"rejected");assert.equal(view.obligations[0].revision,1);assert.equal(view.obligations[0].amountMinor,1500);
 assert.equal(result.project.events.at(-1).actorId,"museum");
});

test("an invited party may reject a proposal that no longer fits the available allocation",async()=>{
 const store=await createSharedAgreementStore({clock:()=>Date.parse("2026-11-10T12:00:00.000Z")}),base=example(),old=projectView(base).obligations[0];
 let p=appendEvent(base,{id:"proposal-event",at:"2026-11-10T11:00:00.000Z",actorId:"studio",type:"amendment.proposed",payload:{amendment:{id:"poster-revision",baseRevision:1,obligation:{...old,revision:2,amountMinor:1700},reason:"Add print finishing."}}});
 p=appendEvent(p,{id:"other-work",at:"2026-11-10T11:01:00.000Z",actorId:"studio",type:"obligation.added",payload:{obligation:{...old,id:"guide",title:"Guide",amountMinor:500}}});
 const a=await store.open(p,"studio"),i=await store.invite(a.id,"museum"),session=(await store.claim(i.token)).session;
 const request={operationId:randomUUID(),digest:a.digest,type:"amendment.reviewed",payload:{amendmentId:"poster-revision",decision:"accept",reason:"Review the changed allocation."}};
 await assert.rejects(store.preview(session,request),e=>e.code==="BUDGET_EXCEEDED");
 request.payload.decision="reject";
 const preview=await store.preview(session,request);assert.ok(preview.review.applicationError);
 request.reviewSignature=preview.signature;
 const result=await store.append(session,request);
 assert.equal(projectView(result.project).amendments[0].status,"rejected");
 assert.equal(projectView(result.project).obligations[0].amountMinor,1500);
});

test("saved agreements distinguish identical titles using current parties and recent recorded context",async()=>{
 const store=await createSharedAgreementStore();
 const older=example();const a=await store.open(older,"studio");
 let newer=createProject({id:"other-studio",title:older.title,sourceText:"Deliver the spring exhibition brochure.",parties:[{id:"studio",name:"Cedar Studio"},{id:"museum",name:"River Museum"}],budgetMinor:8500,createdAt:"2026-11-11T10:00:00.000Z"});
 newer=appendEvent(newer,{id:"correct-name",at:"2026-11-11T11:30:00.000Z",actorId:"studio",type:"party.name-corrected",payload:{partyId:"museum",previousName:"River Museum",name:"River Arts Museum",reason:"Use the agreed full trading name."}});
 const b=await store.open(newer,"studio"),rows=await store.ownerList();
 assert.deepEqual(rows.map(row=>row.id),[b.id,a.id]);
 assert.deepEqual(rows[0].parties,["Cedar Studio","River Arts Museum"]);
 assert.equal(rows[0].sourceExcerpt,"Deliver the spring exhibition brochure.");
 assert.equal(rows[0].lastRecordedAt,"2026-11-11T11:30:00.000Z");
 assert.equal(rows[0].budgetMinor,8500);
 assert.equal(rows[1].sourceExcerpt,"Deliver the final poster.");
 assert.equal(rows[0].project,undefined);
 rows[0].parties[0]="Changed outside store";
 assert.equal((await store.ownerList())[0].parties[0],"Cedar Studio");
});


test("archive frees one active slot, preserves reviewed history and isolates access across restart",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"pact-archive-")),path=join(dir,"shared.json");
 try{
  const store=await createSharedAgreementStore({path}),p=example(),first=await store.open(p,"studio");
  const invite=await store.invite(first.id,"museum"),claimed=await store.claim(invite.token),request=input(p);
  request.reviewSignature=(await store.preview(claimed.session,request)).signature;
  const reviewed=await store.append(claimed.session,request);
  const pending=await store.invite(first.id,"studio");
  let other;
  for(let index=1;index<50;index++)other=await store.open({...p,id:"archive-peer-"+index},"studio");
  const otherInvite=await store.invite(other.id,"museum"),otherSession=await store.claim(otherInvite.token);
  const extra={...p,id:"archive-next"};
  await assert.rejects(store.open(extra,"studio"),e=>e.code==="SHARED_LIMIT");
  await assert.rejects(store.archive(first.id,first.digest),e=>e.code==="HISTORY_CHANGED");
  assert.equal((await store.read(claimed.session)).digest,reviewed.digest);
  const archived=await store.archive(first.id,reviewed.digest);
  assert.ok(archived.archivedAt);assert.deepEqual(archived.project,reviewed.project);assert.deepEqual(archived.receipts,reviewed.receipts);
  assert.equal((await store.archive(first.id,reviewed.digest)).archivedAt,archived.archivedAt);
  await assert.rejects(store.read(claimed.session),e=>e.status===401);
  await assert.rejects(store.claim(pending.token),e=>e.status===401);
  assert.equal((await store.read(otherSession.session)).id,other.id);
  for(const call of [()=>store.invite(first.id,"museum"),()=>store.open(reviewed.project,"studio"),()=>store.publish(first.id,reviewed.project,reviewed.digest),()=>store.withCurrentProject(reviewed.project,()=>assert.fail("archived payment dispatched"))])await assert.rejects(call(),e=>e.code==="AGREEMENT_ARCHIVED");
  const next=await store.open(extra,"studio");
  assert.equal((await store.ownerList()).filter(a=>!a.archivedAt).length,50);
  await assert.rejects(store.restore(first.id,reviewed.digest),e=>e.code==="SHARED_LIMIT");
  await store.archive(next.id,next.digest);
  const restored=await store.restore(first.id,reviewed.digest);assert.equal(restored.archivedAt,null);assert.deepEqual(restored.project,reviewed.project);assert.deepEqual(restored.receipts,reviewed.receipts);
  const restarted=await createSharedAgreementStore({path});assert.equal((await restarted.ownerRead(first.id)).digest,reviewed.digest);assert.ok((await restarted.ownerRead(next.id)).archivedAt);
  await assert.rejects(restarted.read(claimed.session),e=>e.status===401);
  assert.equal(await restarted.withCurrentProject(reviewed.project,()=>"current"),"current");
 }finally{await rm(dir,{recursive:true,force:true});}
});

test("archive waits for an already dispatched payment and blocks later effects",async()=>{
 const store=await createSharedAgreementStore(),p=example(),a=await store.open(p,"studio");
 let release,entered;const held=new Promise(r=>release=r),started=new Promise(r=>entered=r),order=[];
 const paying=store.withCurrentProject(p,async()=>{order.push("started");entered();await held;order.push("finished");});await started;
 const archiving=store.archive(a.id,a.digest).then(()=>order.push("archived"));
 await new Promise(r=>setImmediate(r));assert.deepEqual(order,["started"]);
 release();await paying;await archiving;assert.deepEqual(order,["started","finished","archived"]);
 await assert.rejects(store.withCurrentProject(p,()=>assert.fail("later effect")),e=>e.code==="AGREEMENT_ARCHIVED");
});
