import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {amendmentTextChanges,amendmentCitationPairs} from "../app/amendment-terms.mjs";

function check(before,after){
  const parts=amendmentTextChanges(before,after);
  assert.equal(parts.map(part=>part.before).join(""),before);
  assert.equal(parts.map(part=>part.after).join(""),after);
  for(const part of parts){
    assert.ok(part.before||part.after);
    if(!part.changed)assert.equal(part.before,part.after);
    for(const value of [part.before,part.after])for(const character of value){
      const point=character.codePointAt(0);
      assert.ok(point<0xD800||point>0xDFFF,"No split Unicode surrogate pair");
    }
  }
  return parts;
}
test("wording edits reconstruct both versions exactly, including unchanged and empty values",()=>{
  for(const [before,after]of [["",""],["same wording","same wording"],["","Add the source file."],["Remove this.",""],["<proof> & approval","<proof> & written approval"]])check(before,after);
});
test("the retained complete criterion exposes its fee and added sentence without marking unchanged promises",async()=>{
  const fixtures=JSON.parse(await readFile(new URL("./fixtures/complete-criteria.json",import.meta.url),"utf8"));
  const before=fixtures.find(item=>item.id==="studio-delivery-conditions").source.replace("USD 45.50","USD 15.00");
  const after=before.replace("USD 15.00","USD 12.00").replace(/\r\n?/g,"\n")+"\nThe final poster is supplied in A3 format.";
  const edits=check(before,after).filter(part=>part.changed&&/\S/.test(part.before+part.after));
  assert.deepEqual(edits.map(({before,after})=>({before,after})),[
    {before:"15.00",after:"12.00"},
    {before:"",after:"\nThe final poster is supplied in A3 format."}
  ]);
});
test("removing a negation remains a visible edit among repeated payment terms",()=>{
  const before="Payment is due after approval. Payment is not due while a dispute remains open.";
  const after="Payment is due after approval. Payment is due while a dispute remains open.";
  const edits=check(before,after).filter(part=>part.changed);
  assert.equal(edits.map(part=>part.before).join("").trim(),"not");
  assert.equal(edits.map(part=>part.after).join(""),"");
});
test("mixed line endings, accented names and emoji keep their exact original text",()=>{
  check("Zoë 🦊 approves café.\r\nNo payment before approval.\rKeep 👩🏽‍🎨 source layers.","Zoë 🦊 approves café.\nPayment follows written approval.\rKeep 👩🏽‍🎨 source layers.");
});
test("moved and repeated clauses remain in order in both complete versions",()=>{
  check("Approve the proof. Keep the layers. Approve the print.","Keep the layers. Approve the print. Approve the proof.");
});
test("a completely rewritten maximum-size criterion keeps every character",()=>{
  const before="old ".repeat(1000),after="new ".repeat(1000);
  assert.equal(before.length,4000);assert.equal(after.length,4000);
  check(before,after);
});

test("adding an earlier definition does not redline the unchanged payment passage",()=>{
  const definition={start:20,end:39,quote:"Report definition."},payment={start:21000,end:21020,quote:"Payment needs report."};
  assert.deepEqual(amendmentCitationPairs([payment],[definition,payment]),[
    {beforeIndex:null,afterIndex:0},{beforeIndex:0,afterIndex:1}
  ]);
  assert.deepEqual(amendmentCitationPairs([definition,payment],[payment]),[
    {beforeIndex:0,afterIndex:null},{beforeIndex:1,afterIndex:0}
  ]);
});
test("citation comparison retains exact occurrence identity among repeated words",()=>{
  const first={start:0,end:20,quote:"Approval is required."},last={start:100,end:120,quote:"Approval is required."};
  assert.deepEqual(amendmentCitationPairs([first,last],[last]),[{beforeIndex:0,afterIndex:null},{beforeIndex:1,afterIndex:0}]);
  assert.deepEqual(amendmentCitationPairs([first],[last]),[{beforeIndex:0,afterIndex:0}]);
});
test("bounded whole-agreement comparison preserves separated edits and every original byte",()=>{
 const before="Clause approved. ".repeat(2500)+"Main Hall 🎨."+ " Archive copy.".repeat(2000);
 const after=before.replace("Main Hall","East Hall")+" A further condition.";
 const parts=amendmentTextChanges(before,after,{maxCells:10000});
 assert.equal(parts.map(p=>p.before).join(""),before);
 assert.equal(parts.map(p=>p.after).join(""),after);
 for(const p of parts)if(!p.changed)assert.equal(p.before,p.after);
 assert.ok(parts.some(p=>p.changed && p.before.includes("Main")));
 const unrelated=amendmentTextChanges("Alpha ".repeat(1000),"Beta ".repeat(1000),{maxCells:1000});
 assert.equal(unrelated.map(p=>p.before).join(""),"Alpha ".repeat(1000));
 assert.equal(unrelated.map(p=>p.after).join(""),"Beta ".repeat(1000));
 assert.ok(unrelated.some(p=>p.changed));
});
