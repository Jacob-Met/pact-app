import test from "node:test";
import assert from "node:assert/strict";
import {findCommitments} from "../app/commitment-search.mjs";
const items=[
{id:"audio",title:"Museum audio",source:"Deliver bilingual captions.",criterion:"Review Spanish and English captions",performer:"Field Studio",reviewer:"Morrow Museum",state:"blocked",dependsOn:["recording"],evidence:[{description:"Final narration delivered",reference:"review-ES-417"}]},
{id:"recording",title:"Record narration",source:"Record narration.",criterion:"Audio reviewed",performer:"Field Studio",reviewer:"Morrow Museum",state:"ready",dependsOn:[],evidence:[]}
];
test("find by non-title evidence reference and preserve full dependency identity",()=>{
 const before=JSON.stringify(items),r=findCommitments(items,{query:"ES-417"});assert.equal(r.length,1);assert.equal(r[0].item,items[0]);assert.equal(r[0].context,"Reference: review-ES-417");assert.deepEqual(r[0].item.dependsOn,["recording"]);assert.equal(JSON.stringify(items),before);
});
test("combine terms across source and party with explicit current readiness",()=>{
 assert.deepEqual(findCommitments(items,{query:"morrow BILINGUAL",state:"blocked"}).map(r=>r.item.id),["audio"]);
 assert.equal(findCommitments(items,{query:"morrow bilingual",state:"ready"}).length,0);
 assert.equal(findCommitments(items,{query:"unfamiliar missing"}).length,0);
});
test("no evaluation does not imply ready or disputed from evidence",()=>{
 const unknown=items.map(i=>({...i,state:"unevaluated"}));assert.equal(findCommitments(unknown,{state:"ready"}).length,0);assert.equal(findCommitments(unknown,{state:"unevaluated"}).length,2);
});
test("blank and unicode-normalized search preserve authored order",()=>{
 assert.deepEqual(findCommitments(items,{query:"   "}).map(r=>r.item.id),["audio","recording"]);assert.equal(findCommitments(items,{query:"ＭＵＳＥＵＭ"}).length,2);
});

test("deadline attention combines with readiness and never treats unevaluated dates as overdue",()=>{
 const dates=["overdue","due","accepted-late","accepted-on-time","upcoming","none",null];
 const records=dates.map((deadlineState,i)=>({...items[0],id:String(i),deadlineState,state:i===2?"ready":"blocked"}));
 assert.deepEqual(findCommitments(records,{deadline:"attention"}).map(r=>r.item.id),["0","1","2"]);
 assert.deepEqual(findCommitments(records,{deadline:"attention",state:"ready"}).map(r=>r.item.id),["2"]);
 assert.deepEqual(findCommitments(records,{deadline:"none"}).map(r=>r.item.id),["5"]);
 assert.equal(findCommitments(records,{deadline:"upcoming",query:"missing"}).length,0);
});
