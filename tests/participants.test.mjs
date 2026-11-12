import test from "node:test";
import assert from "node:assert/strict";
import { declaredParties } from "../app/participants.mjs";
import { createProject, appendEvent, evaluateProject, exportProject, importProject } from "../app/core.mjs";
import { encodeRecovery, decodeRecovery } from "../app/tab-recovery.mjs";
test("distinct two through eight party labels retain stable creation IDs and explicit text", () => {
  assert.deepEqual(declaredParties(" Studio ", "Client", "Translator\r\n\nSound team"), [
    {id:"party-a",name:"Studio"},{id:"party-b",name:"Client"},{id:"party-c",name:"Translator"},{id:"party-d",name:"Sound team"}]);
  assert.equal(declaredParties("A","B","C\nD\nE\nF\nG\nH").length,8);
  for (const args of [["A","B","C\nD\nE\nF\nG\nH\nI"],["A"," a ",""],["A","B","Ａ"],["","B","C"],["A","B","X".repeat(121)]]) assert.throws(()=>declaredParties(...args));
});
test("unfinished participant text survives recovery including invalid entries for correction", () => {
  for (const additionalParties of ["Translator\nSound team", "Client\nClient", ""]) {
    const result = decodeRecovery(encodeRecovery({project:null,drafts:{setup:{performer:"Studio",reviewer:"Client",additionalParties}}}));
    assert.equal(result.drafts.setup.additionalParties, additionalParties);
  }
  assert.equal(decodeRecovery(encodeRecovery({project:null,drafts:{setup:{performer:"Studio",reviewer:"Client"}}})).drafts.setup.additionalParties,undefined);
});
test("three-party roles and dispute consequences survive project export/import", () => {
  const source="Translator delivers subtitles. Studio assembles film after subtitle acceptance.";
  let project=createProject({id:"three-party",title:"Festival film",sourceText:source,parties:declaredParties("Studio","Client","Translator"),budgetMinor:10000,createdAt:"2026-11-10T00:00:00.000Z"});
  const add=(type,actorId,payload)=>{project=appendEvent(project,{id:"e"+(project.events.length+1),seq:0,at:"2026-11-10T00:01:00.000Z",type,actorId,payload});};
  function obligation(id,title,start,end,performerId,reviewerId,dependsOn,amountMinor){return {id,revision:1,title,criterion:title,citation:{sourceId:"source-1",sourceRevision:1,start,end,quote:source.slice(start,end)},performerId,reviewerId,dependsOn,amountMinor,dueAt:null};}
  add("obligation.added","party-c",{obligation:obligation("subtitles","Subtitles",0,29,"party-c","party-a",[],3000)});
  add("obligation.added","party-a",{obligation:obligation("film","Film",30,source.length,"party-a","party-b",["subtitles"],7000)});
  for(const [id,submittedBy,reviewer] of [["subtitles","party-c","party-a"],["film","party-a","party-b"]]){
    add("evidence.submitted",submittedBy,{evidence:{id:"proof-"+id,obligationId:id,obligationRevision:1,submittedBy,description:"Delivered "+id,reference:"Delivery log"}});
    add("evidence.accepted",reviewer,{evidenceId:"proof-"+id,rationale:"Reviewed delivery"});
  }
  const at="2026-11-10T00:02:00.000Z";
  assert.equal(evaluateProject(project,at).totals.readyMinor,10000);
  add("evidence.disputed","party-b",{evidenceId:"proof-subtitles",disputeId:"missing",reason:"Missing captions"});
  assert.equal(evaluateProject(project,at).totals.readyMinor,0);
  const restored=importProject(exportProject(project));
  assert.deepEqual(restored,project);
  assert.equal(restored.events.at(-1).actorId,"party-b");
  assert.equal(restored.parties[2].name,"Translator");
});
