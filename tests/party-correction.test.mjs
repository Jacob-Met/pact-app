import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,appendEvent,partyNames,exportProject,importProject,evaluateProject} from '../app/core.mjs';
const original=createProject({id:'studio',title:'Studio agreement',sourceText:'Northstar delivers artwork.',parties:[{id:'a',name:'Nortstar'},{id:'b',name:'Harbor'}],budgetMinor:5000,createdAt:'2026-11-10T10:00:00.000Z'});
const change={id:'correction',at:'2026-11-10T10:01:00.000Z',actorId:'a',type:'party.name-corrected',payload:{partyId:'a',previousName:'Nortstar',name:'Northstar',reason:'Correct misspelling from original intake'}};
test('correction survives portable handoff without rewriting declared identity or financial state',()=>{
 const next=importProject(exportProject(appendEvent(original,change)));
 assert.deepEqual(next.parties,original.parties);
 assert.equal(partyNames(next)[0].name,'Northstar');
 assert.equal(partyNames(next,0)[0].name,'Nortstar');
 assert.deepEqual(evaluateProject(next,change.at).totals,evaluateProject(original,change.at).totals);
 assert.equal(original.events.length,0);
});
test('stale correction is refused and subsequent reviewed correction retains chronology',()=>{
 const next=appendEvent(original,change);
 assert.throws(()=>appendEvent(next,{...change,id:'second'}),/current party name/);
 const final=appendEvent(next,{...change,id:'second',payload:{...change.payload,previousName:'Northstar',name:'Northstar Studio'}});
 assert.equal(partyNames(final,1)[0].name,'Northstar');
 assert.equal(partyNames(final)[0].name,'Northstar Studio');
});
