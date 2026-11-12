import test from "node:test";
import assert from "node:assert/strict";
import { createPactServer } from "../server.mjs";

async function withServer(run) {
  const server = createPactServer(); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try { await run(`http://127.0.0.1:${port}`); } finally { await new Promise(resolve => server.close(resolve)); }
}

test("server exposes the maintained application and recovery modules", async () => withServer(async base => {
  for (const path of ["/", "/index.html", "/styles.css", "/app.mjs", "/core.mjs", "/participants.mjs", "/ui-utils.mjs", "/payment-ui.mjs", "/proposal-source-review.mjs", "/proposal-source-review.css", "/tab-recovery.mjs", "/recovery-ui.mjs", "/decision-review.mjs", "/decision-review-ui.mjs", "/decision-review.css", "/authoring.css", "/source-passages.mjs", "/source-references.mjs", "/source-references-ui.mjs", "/source-citations.mjs", "/citation-view.mjs", "/commitment-search.mjs", "/commitment-search.css", "/review-export.mjs", "/amendment-ui.mjs", "/amendment.css", "/evidence-file.mjs", "/source-identity.mjs", "/source-hash.mjs", "/source-hash-worker.mjs", "/vendor/noble-hashes/sha2.js", "/vendor/noble-hashes/utils.js", "/vendor/noble-hashes/_u64.js", "/vendor/noble-hashes/_md.js", "/audit-trail.mjs", "/audit-trail-ui.mjs", "/audit-trail.css"]) {
    const response = await fetch(base + path); assert.equal(response.status, 200, path); assert.equal(response.headers.get("x-content-type-options"), "nosniff"); assert.ok((await response.text()).length > 50);
  }
}));

test("server refuses unknown paths, query-shaped escapes and non-read methods", async () => withServer(async base => {
  for (const path of ["/missing", "/../package.json", "/%2e%2e/package.json", "/index.html/extra"]) assert.equal((await fetch(base + path)).status, 404, path);
  const response = await fetch(base + "/", { method: "POST" }); assert.equal(response.status, 405); assert.equal(response.headers.get("allow"), "GET, HEAD");
}));

test("HEAD returns headers without a body", async () => withServer(async base => {
  const response = await fetch(base + "/core.mjs", { method: "HEAD" }); assert.equal(response.status, 200); assert.equal(await response.text(), "");
}));


test("vendor downloads revalidate their bytes while application and state responses stay uncached",async()=>withServer(async base=>{
 const path="/vendor/pdfjs/pdf.worker.mjs";
 const first=await fetch(base+path),etag=first.headers.get("etag"),bytes=await first.arrayBuffer();
 assert.ok(bytes.byteLength>2000000);assert.ok(etag);assert.equal(first.headers.get("cache-control"),"public, no-cache");
 const same=await fetch(base+path,{headers:{"if-none-match":etag}});
 assert.equal(same.status,304);assert.equal((await same.arrayBuffer()).byteLength,0);
 const stale=await fetch(base+path,{headers:{"if-none-match":'"old-dependency"'}});
 assert.equal(stale.status,200);assert.equal((await stale.arrayBuffer()).byteLength,bytes.byteLength);
 for(const path of ["/","/app.mjs","/api/config"]){const r=await fetch(base+path,{headers:{"if-none-match":"*"}});assert.equal(r.status,200);assert.equal(r.headers.get("cache-control"),"no-store");assert.equal(r.headers.get("etag"),null);await r.arrayBuffer();}
}));


test("document dependencies transfer compressed bytes without mixing their cache validators",async()=>withServer(async base=>{
 const path="/vendor/pdfjs/pdf.worker.mjs";
 const raw=await fetch(base+path,{headers:{"accept-encoding":"identity"}}),plain=await raw.text();
 const packed=await fetch(base+path,{headers:{"accept-encoding":"gzip"}});
 assert.equal(packed.headers.get("content-encoding"),"gzip");assert.equal(packed.headers.get("vary"),"Accept-Encoding");
 assert.ok(Number(packed.headers.get("content-length"))<Number(raw.headers.get("content-length")));
 assert.equal(await packed.text(),plain);assert.notEqual(packed.headers.get("etag"),raw.headers.get("etag"));
 const variant=await fetch(base+path,{headers:{"accept-encoding":"identity","if-none-match":packed.headers.get("etag")}});
 assert.equal(variant.status,200);assert.equal(await variant.text(),plain);
 const refused=await fetch(base+path,{headers:{"accept-encoding":"gzip;q=0, identity"}});
 assert.equal(refused.headers.get("content-encoding"),null);assert.equal(await refused.text(),plain);
}));
