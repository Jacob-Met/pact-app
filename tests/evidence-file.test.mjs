import test from 'node:test';
import assert from 'node:assert/strict';
import {deliveryReferenceUrl,fingerprintFile,compareFileFingerprint,validateFileFingerprint,MAX_EVIDENCE_FILE_BYTES} from '../app/evidence-file.mjs';
import {createProject,appendEvent,exportProject,importProject,projectView,evaluateProject} from '../app/core.mjs';
test('file identity compares bytes, rejects changed same-name file and survives portable replay without granting readiness',async()=>{
 const original=await fingerprintFile(new File(['catalogue,v1\n'], 'master.csv'));
 const changed=await fingerprintFile(new File(['catalogue,v2\n'], 'master.csv'));
 const renamed=await fingerprintFile(new File(['catalogue,v1\n'], 'renamed.csv'));
 assert.equal(compareFileFingerprint(original,changed),false);assert.equal(compareFileFingerprint(original,renamed),true);
 let p=createProject({id:'files',title:'Evidence identity',sourceText:'Deliver catalogue.',parties:[{id:'a',name:'Archive'},{id:'b',name:'Museum'}],budgetMinor:35000,createdAt:'2026-11-10T10:00:00.000Z'});
 const add=(type,actorId,payload)=>{p=appendEvent(p,{id:'e'+(p.events.length+1),seq:0,at:'2026-11-10T10:01:00.000Z',type,actorId,payload});};
 add('obligation.added','a',{obligation:{id:'catalogue',revision:1,title:'Catalogue',criterion:'Approved inventory',citation:{sourceId:'source-1',sourceRevision:1,start:0,end:18,quote:'Deliver catalogue.'},performerId:'a',reviewerId:'b',dependsOn:[],dueAt:null,amountMinor:35000}});
 add('evidence.submitted','a',{evidence:{id:'proof',obligationId:'catalogue',obligationRevision:1,submittedBy:'a',description:'Review original bytes',reference:'master.csv',fileFingerprint:original}});
 const serialized=exportProject(p),restored=importProject(serialized);assert.deepEqual(projectView(restored).evidence[0].fileFingerprint,original);assert.equal(serialized.includes('catalogue,v1'),false);
 assert.equal(JSON.stringify(evaluateProject(restored,'2026-11-10T10:02:00.000Z')).includes('NO_VALID_ACCEPTED_EVIDENCE'),true);
 const tampered=JSON.parse(serialized);tampered.events[1].payload.evidence.fileFingerprint.sha256='bad';assert.throws(()=>importProject(JSON.stringify(tampered)),/fingerprint/);
 tampered.events[1].payload.evidence.fileFingerprint.sha256=[original.sha256];assert.throws(()=>importProject(JSON.stringify(tampered)),/fingerprint/);
 assert.throws(()=>validateFileFingerprint({...original,contents:'must not be stored'}),/fingerprint/);
 await assert.rejects(fingerprintFile({size:MAX_EVIDENCE_FILE_BYTES+1}),/exact byte count/);
});

test('delivery references open only supplied absolute web URLs',()=>{
 assert.equal(deliveryReferenceUrl("https://example.org/review/design.pdf"),"https://example.org/review/design.pdf");
 assert.equal(deliveryReferenceUrl("http://127.0.0.1:4173/sample-agreement.json"),"http://127.0.0.1:4173/sample-agreement.json");
 for(const value of ["Design handoff · pages 1–8","javascript:alert(1)","data:text/html,hello","file:///home/private","https://user:password@example.org/review",null])assert.equal(deliveryReferenceUrl(value),null);
});
