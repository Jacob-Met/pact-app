import test from "node:test";
import assert from "node:assert/strict";
import {createProject, appendEvent, exportProject, projectView} from "../app/core.mjs";
import {previewHistoryMerge, commitHistoryMerge} from "../app/history-merge.mjs";
export function branches() {
 let base=createProject({id:"harbor-prints",title:"Harbor prints",sourceText:"Deliver the poster. Deliver the catalogue.",parties:[{id:"studio",name:"Harbor Studio"},{id:"client",name:"North Museum"}],budgetMinor:90000,createdAt:"2026-11-10T10:00:00.000Z"});
 for (const [i,title,start,end] of [[1,"Poster",0,19],[2,"Catalogue",20,42]]) {
  base=appendEvent(base,{id:"add-"+i,at:"2026-11-10T10:00:00.000Z",actorId:"studio",type:"obligation.added",payload:{obligation:{id:"work-"+i,revision:1,title,criterion:"Deliver final PDF",citation:{sourceId:"source-1",sourceRevision:1,start,end:Math.min(end,base.source.text.length),quote:base.source.text.slice(start,end)},performerId:"studio",reviewerId:"client",dependsOn:[],dueAt:null,amountMinor:30000}}});
 }
 const submit=(project,n,at)=>appendEvent(project,{id:"submit-"+n,at,actorId:"studio",type:"evidence.submitted",payload:{evidence:{id:"file-"+n,obligationId:"work-"+n,obligationRevision:1,submittedBy:"studio",description:n===1?"Poster final":"Catalogue final",reference:"delivery-"+n+".pdf"}}});
 return {base,local:submit(base,1,"2026-11-10T11:00:00.000Z"),incoming:submit(base,2,"2026-11-10T10:30:00.000Z")};
}
test("independent collaborator records both survive earlier incoming timestamps and repeat exchange",()=>{
 const {local,incoming}=branches(), left=previewHistoryMerge(local,incoming),right=previewHistoryMerge(incoming,local);
 assert.equal(left.added,1);assert.equal(left.retained,1);
 assert.deepEqual(left.project,right.project);
 assert.equal(projectView(left.project).evidence.length,2);
 assert.deepEqual(left.project.events.map(e=>e.id),["add-1","add-2","submit-2","submit-1"]);
 assert.equal(exportProject(local),exportProject(branches().local));
 assert.throws(()=>previewHistoryMerge(left.project,incoming),/no independent changes/);
});
test("conflicting same record, same commitment, changed base and stale confirmation refuse",()=>{
 const {local,incoming}=branches();
 const changed=structuredClone(incoming);changed.events[0].payload.obligation.title="Changed poster";
 assert.throws(()=>previewHistoryMerge(local,changed),/different contents/);
 const overlap=structuredClone(incoming);overlap.events.at(-1).payload.evidence.obligationId="work-1";
 assert.throws(()=>previewHistoryMerge(local,overlap),/same commitment/);
 assert.throws(()=>previewHistoryMerge(local,{...incoming,title:"Different"}),/base terms/);
 const review=previewHistoryMerge(local,incoming);
 assert.throws(()=>commitHistoryMerge(incoming,incoming,review),/workspace changed/);
});
test("dependent decisions cannot bypass validation",()=>{
 const {base,local,incoming}=branches();
 const dependant=p=>{const q=structuredClone(p);q.events[1].payload.obligation.dependsOn=["work-1"];return q;};
 assert.throws(()=>previewHistoryMerge(dependant(local),dependant(incoming)),/prerequisites/);
});
test("equal timestamp ordering respects both authored histories",()=>{
 const {local,incoming}=branches();
 incoming.events.at(-1).at=local.events.at(-1).at;
 const a=previewHistoryMerge(local,incoming).project,b=previewHistoryMerge(incoming,local).project;
 assert.deepEqual(a,b);
});

test("independent additions still obey the combined agreement budget",()=>{
 const {base}=branches();
 const extra=(name)=>appendEvent(base,{id:"event-"+name,at:"2026-11-10T12:00:00.000Z",actorId:"studio",type:"obligation.added",payload:{obligation:{...base.events[0].payload.obligation,id:name,title:name,amountMinor:20000}}});
 assert.throws(()=>previewHistoryMerge(extra("print-finish"),extra("book-finish")));
});
