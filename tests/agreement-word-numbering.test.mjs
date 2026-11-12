import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {extractWordText} from "../app/agreement-word-text.mjs";
import {sourceSectionIndex} from "../app/source-references.mjs";
const file=name=>readFile(new URL("./fixtures/word/"+name+".docx",import.meta.url));
test("Common Paper inherited numbering preserves actual source section identities",async()=>{
 const text=await extractWordText(await file("commonpaper-psa-1.1"));
 for(const [label,title] of [["1","Services"],["4","Payment & Taxes"],["4.4","Payment Dispute"],["5.2","Termination"],["6.3","From Provider"],["12.7","No Publicity"],["13","Definitions"]])
  assert(sourceSectionIndex(text).some(e=>e.label===label&&e.quote.includes(title)),label+" "+title);
});
test("based-on styles preserve original numbering and direct suppression",async()=>{
 const text=await extractWordText(await file("style-inherited"));
 assert.match(text,/1\. First/);assert.match(text,/1\.1 Nested/);
 assert.match(text,/2\. Second/);assert.match(text,/2\.1 Reset/);
 assert.doesNotMatch(text,/\d\. Suppressed/);
});
test("cyclic paragraph styles refuse rather than inventing labels",async()=>{await assert.rejects(extractWordText(await file("style-cycle")));});
