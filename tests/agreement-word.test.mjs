import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { extractWordText } from "../app/agreement-word-text.mjs";
import {sourceSectionIndex,resolveSourceReferences,resolveSourceDefinitions} from "../app/source-references.mjs";
const file = name => readFile(new URL("./fixtures/word/" + name + ".docx", import.meta.url));
test("Word preserves clause labels, actual numbering, tables, footnotes and headers", async () => {
  const text = await extractWordText(await file("terms"));
  assert.match(text, /C1\.3 Payment follows acceptance/);
  assert.doesNotMatch(text, /1\. C1\.3/);
  assert.match(text, /1\. Deliver the final files/);
  assert.match(text, /Price/); assert.match(text, /USD 250/);
  assert.match(text, /Written acceptance is required/);
  assert.match(text, /Contract ref S-42/);
});
test("unresolved Word insertions and deletions require a resolved original", async () => {
  for (const name of ["tracked", "deleted"]) await assert.rejects(extractWordText(await file(name)), /tracked changes/);
});
test("non-Word and damaged bytes cannot produce agreement text", async () => {
  await assert.rejects(extractWordText(new TextEncoder().encode("Agreement")), /could not be read/);
});

test("explicit Word page and column breaks preserve a referenced appendix boundary", async () => {
  const text=await extractWordText(await file("page-break"));
  assert.match(text,/Resolution Procedure\.\n+Appendix 1/);
  assert.match(text,/Column one\n+Column two/);
  const index=sourceSectionIndex(text);
  const exit=index.find(entry=>entry.label==="H13.3");
  assert(!exit.quote.includes("Appendix"));
  const reference=resolveSourceReferences(text,[{start:0,end:text.indexOf("\n")}])[0];
  assert.equal(reference.status,"resolved");
  assert.equal(reference.targets[0].kind,"appendix");
  assert.match(reference.targets[0].quote,/Notify the named officer within 24 hours/);
  assert.equal(reference.targets[0].quote,text.slice(reference.targets[0].start,reference.targets[0].end));
});

test("Word cell paragraphs remain distinct without guessing cross-column pairs",async()=>{
 const text=await extractWordText(await file("cell-paragraphs"));
 const row=text.split("\n").find(line=>line.includes("First Term"));
 assert.match(row,/First Term \u2029 ‘Second Term’/);
 assert.match(row,/First original paragraph\. \u2029 Additional first detail\. \u2029 Second original paragraph\./);
 const start=text.indexOf("Read Second Term");
 const refs=resolveSourceDefinitions(text,[{start,end:text.length}]);
 const target=refs.find(ref=>ref.labels.includes("Second Term")).targets[0];
 assert.equal(target.quote,row.trim());
 assert.match(target.quote,/Additional first detail/);
 assert.equal(target.quote,text.slice(target.start,target.end));
});

test("only generated simple-table padding is removed; original spaces and pipes survive",async()=>{
 const text=await extractWordText(await file("table-padding"));
 assert.match(text,/PACT_TABLE_LAYOUT_ is original wording/);
 assert.match(text,/\| Original prose  retains   spaces \| unchanged \|/);
 assert.match(text,/Keep  two   spaces/);
 const form=sourceSectionIndex(text).find(entry=>entry.kind==="appendix"&&entry.label==="1");
 assert(form.quote.length<4000);
 assert.match(form.quote,/Field 23/);
 assert.match(text,/\| Field 0 \| Keep  two   spaces \|/);
 assert.match(text,/\| A \| B +\| Keep  two   spaces \|/);
 assert.doesNotMatch(text,/PACT_TABLE_LAYOUT__\d+_(?:START|END)/);
});
