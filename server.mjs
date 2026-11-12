import { captureSourceCitation, citationPassages, MAX_CITATION_PASSAGES } from "./app/source-citations.mjs";
import {sendStaticAsset} from "./static-asset.mjs";
import { pdfAssets } from "./app/vendor/pdfjs/assets.mjs";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createPactProviders } from "./providers.mjs";
import { createOrderJournal } from "./order-journal.mjs";
import { createTalk } from "./talk-server.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "app");
const assets = new Map([
  ...["source-file-review.mjs","source-file-diff.worker.mjs","source-file-diff.mjs", "source-dom-selection.mjs"].map(name=>["/"+name,[name,"text/javascript; charset=utf-8"]]),
  ...pdfAssets.filter(name => name !== "LICENSE").map(name => ["/vendor/pdfjs/" + name, ["vendor/pdfjs/" + name, name.endsWith(".mjs") ? "text/javascript; charset=utf-8" : "application/octet-stream"]]),
  ["/agreement-word.mjs", ["agreement-word.mjs", "text/javascript; charset=utf-8"]],
  ["/agreement-word.worker.mjs", ["agreement-word.worker.mjs", "text/javascript; charset=utf-8"]],
  ["/agreement-word-text.mjs", ["agreement-word-text.mjs", "text/javascript; charset=utf-8"]],
  ["/agreement-word-numbering.mjs", ["agreement-word-numbering.mjs", "text/javascript; charset=utf-8"]],
  ["/vendor/officeparser/officeparser.browser.slim.mjs", ["vendor/officeparser/officeparser.browser.slim.mjs", "text/javascript; charset=utf-8"]],
  ["/agreement-file.mjs", ["agreement-file.mjs", "text/javascript; charset=utf-8"]],
  ["/agreement-file-ui.mjs", ["agreement-file-ui.mjs", "text/javascript; charset=utf-8"]],
  ["/vendor/source-serif/SourceSerif4.ttf", ["vendor/source-serif/SourceSerif4.ttf", "font/ttf"]],
  ["/vendor/manrope/Manrope.ttf", ["vendor/manrope/Manrope.ttf", "font/ttf"]],
  ["/sample-agreement.json", ["../docs/examples/studio-review.json", "application/json; charset=utf-8"]],
  ["/source-identity.mjs", ["source-identity.mjs", "text/javascript; charset=utf-8"]],
  ["/source-hash.mjs", ["source-hash.mjs", "text/javascript; charset=utf-8"]],
  ["/source-hash-worker.mjs", ["source-hash-worker.mjs", "text/javascript; charset=utf-8"]],
  ["/vendor/noble-hashes/sha2.js", ["vendor/noble-hashes/sha2.js", "text/javascript; charset=utf-8"]],
  ["/vendor/noble-hashes/utils.js", ["vendor/noble-hashes/utils.js", "text/javascript; charset=utf-8"]],
  ["/vendor/noble-hashes/_u64.js", ["vendor/noble-hashes/_u64.js", "text/javascript; charset=utf-8"]],
  ["/vendor/noble-hashes/_md.js", ["vendor/noble-hashes/_md.js", "text/javascript; charset=utf-8"]],
  ["/review-export.mjs", ["review-export.mjs", "text/javascript; charset=utf-8"]],
  ["/payment-history.mjs", ["payment-history.mjs", "text/javascript; charset=utf-8"]],
  ["/payment-history.css", ["payment-history.css", "text/css; charset=utf-8"]],
  ["/evidence-file.mjs", ["evidence-file.mjs", "text/javascript; charset=utf-8"]],
  ["/audit-trail.mjs", ["audit-trail.mjs", "text/javascript; charset=utf-8"]],
  ["/audit-trail-ui.mjs", ["audit-trail-ui.mjs", "text/javascript; charset=utf-8"]],
  ["/audit-trail.css", ["audit-trail.css", "text/css; charset=utf-8"]],
  ["/commitment-search.mjs", ["commitment-search.mjs", "text/javascript; charset=utf-8"]],
  ["/commitment-search.css", ["commitment-search.css", "text/css; charset=utf-8"]],
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/decision-review.mjs", ["decision-review.mjs", "text/javascript; charset=utf-8"]],
  ["/decision-review-ui.mjs", ["decision-review-ui.mjs", "text/javascript; charset=utf-8"]],
  ["/authoring.css", ["authoring.css", "text/css; charset=utf-8"]],
  ["/source-passages.mjs", ["source-passages.mjs", "text/javascript; charset=utf-8"]],
  ["/source-references.mjs", ["source-references.mjs", "text/javascript; charset=utf-8"]],
  ["/source-references-ui.mjs", ["source-references-ui.mjs", "text/javascript; charset=utf-8"]],
  ["/source-citations.mjs", ["source-citations.mjs", "text/javascript; charset=utf-8"]],
  ["/citation-view.mjs", ["citation-view.mjs", "text/javascript; charset=utf-8"]],
  ["/proposal-source-review.mjs", ["proposal-source-review.mjs", "text/javascript; charset=utf-8"]],
  ["/proposal-source-review.css", ["proposal-source-review.css", "text/css; charset=utf-8"]],
  ["/decision-review.css", ["decision-review.css", "text/css; charset=utf-8"]],
  ["/amendment-terms.mjs", ["amendment-terms.mjs", "text/javascript; charset=utf-8"]],
  ["/amendment-ui.mjs", ["amendment-ui.mjs", "text/javascript; charset=utf-8"]],
  ["/workspace-views.mjs", ["workspace-views.mjs", "text/javascript; charset=utf-8"]],
  ["/contract-document.css", ["contract-document.css", "text/css; charset=utf-8"]],
  ["/contract-document.mjs", ["contract-document.mjs", "text/javascript; charset=utf-8"]],
  ["/workspace-views.css", ["workspace-views.css", "text/css; charset=utf-8"]],
  ["/amendment.css", ["amendment.css", "text/css; charset=utf-8"]],
  ["/app.mjs", ["app.mjs", "text/javascript; charset=utf-8"]],
  ["/participants.mjs", ["participants.mjs", "text/javascript; charset=utf-8"]],
  ["/core.mjs", ["core.mjs", "text/javascript; charset=utf-8"]],
  ["/ui-utils.mjs", ["ui-utils.mjs", "text/javascript; charset=utf-8"]],
  ["/payment-ui.mjs", ["payment-ui.mjs", "text/javascript; charset=utf-8"]],
  ["/payment-readiness.mjs", ["payment-readiness.mjs", "text/javascript; charset=utf-8"]],
  ["/obligation-network.mjs", ["obligation-network.mjs", "text/javascript; charset=utf-8"]],
  ["/import-review.mjs", ["import-review.mjs", "text/javascript; charset=utf-8"]],
  ["/history-merge.mjs", ["history-merge.mjs", "text/javascript; charset=utf-8"]],
  ["/shared-owner.mjs", ["shared-owner.mjs", "text/javascript; charset=utf-8"]],
  ["/organizer-access-ui.mjs", ["organizer-access-ui.mjs", "text/javascript; charset=utf-8"]],
  ["/organizer-access.css", ["organizer-access.css", "text/css; charset=utf-8"]],
  ["/shared-review.css", ["shared-review.css", "text/css; charset=utf-8"]],
  ["/tab-recovery.mjs", ["tab-recovery.mjs", "text/javascript; charset=utf-8"]],
  ["/recovery-ui.mjs", ["recovery-ui.mjs", "text/javascript; charset=utf-8"]]
]);
// Dark mode: every stylesheet has a generated .dark.css twin; theme.js switches between them.
for (const [route, [file, type]] of [...assets]) if (file.endsWith(".css")) assets.set(route.replace(/\.css$/, ".dark.css"), [file.replace(/\.css$/, ".dark.css"), type]);
assets.set("/theme.js", ["theme.js", "text/javascript; charset=utf-8"]);
for (const f of ["pact-draft.mjs","pacts.mjs"]) assets.set("/"+f,[f,"text/javascript; charset=utf-8"]);
assets.set("/pacts.css",["pacts.css","text/css; charset=utf-8"]);
assets.set("/pacts.dark.css",["pacts.dark.css","text/css; charset=utf-8"]);
assets.set("/polish.css", ["polish.css", "text/css; charset=utf-8"]);


const apiPaths = new Map([
  ["/api/paypal/history", "history"],
  ["/api/paypal/history-status", "historyStatus"],
  ["/api/ai/suggest", "suggest"],
  ["/api/paypal/prepare", "prepare"],
  ["/api/paypal/restore", "restore"],
  ["/api/paypal/status", "status"],
  ["/api/paypal/review-preview", "previewExisting"],
  ["/api/paypal/review-existing", "reviewExisting"],
  ["/api/paypal/capture", "capture"]
]);
function json(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store", "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer", "content-security-policy": "default-src 'none'"
  });
  response.end(JSON.stringify(body));
}
async function readRequest(request) {
  if (!(request.headers["content-type"] || "").startsWith("application/json")) {
    throw Object.assign(new Error("Use application/json."), { status: 415, code: "CONTENT_TYPE" });
  }
  const declared = Number(request.headers["content-length"] || 0);
  if (declared > 1048576) throw Object.assign(new Error("Request exceeds 1 MiB."), { status: 413, code: "REQUEST_TOO_LARGE" });
  const parts = [];
  let size = 0;
  for await (const part of request) {
    size += part.length;
    if (size > 1048576) throw Object.assign(new Error("Request exceeds 1 MiB."), { status: 413, code: "REQUEST_TOO_LARGE" });
    parts.push(part);
  }
  try {
    const body = JSON.parse(Buffer.concat(parts).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("object required");
    return body;
  } catch {
    throw Object.assign(new Error("Supply a JSON object."), { status: 400, code: "INVALID_JSON" });
  }
}

function publicCitationLimit(cause) {
  if (!["AI_CONTEXT_TOO_LONG", "CITATION_SIZE", "CITATION_RANGES"].includes(cause.code)) return null;
  const value = cause.citationLimit;
  if (!value || !["passage_length", "total_length", "passage_count"].includes(value.kind) ||
      !Number.isSafeInteger(value.actual) || !Number.isSafeInteger(value.limit) ||
      value.limit <= 0 || value.actual <= value.limit) return null;
  return { kind:value.kind, actual:value.actual, limit:value.limit };
}

function publicSourceReviewSections(cause, input) {
  const source = input?.project?.source?.text;
  if (cause.code !== "AI_CONTEXT_TOO_LONG" || typeof source !== "string" ||
      !Array.isArray(cause.sourceReviewSections) || cause.sourceReviewSections.length > 16) return [];
  return cause.sourceReviewSections.filter(section => section?.kind === "section" &&
    typeof section.label === "string" && section.label.length > 0 && section.label.length <= 80 &&
    Number.isSafeInteger(section.start) && Number.isSafeInteger(section.end) &&
    section.start >= 0 && section.end > section.start && section.end <= source.length)
    .map(({kind,label,start,end}) => ({kind,label,start,end}));
}

function publicSourceReviewSelection(cause, input) {
  const source = input?.project?.source, selected = cause.sourceReviewSelection;
  if (cause.code !== "AI_CONTEXT_TOO_LONG" || typeof source?.text !== "string" ||
      selected?.sourceId !== source.id || selected?.sourceRevision !== source.revision ||
      !Array.isArray(selected?.passages) || !selected.passages.length ||
      selected.passages.length > MAX_CITATION_PASSAGES) return null;
  try {
    // Validate the complete selection against this original request. Nothing is
    // truncated or promoted to an automatic proposal; only locations leave here.
    const citation = captureSourceCitation(source, selected.passages.map(({start,end,quote}) => ({start,end,quote})));
    return {sourceId:source.id, sourceRevision:source.revision,
      passages:citationPassages(citation).map(({start,end}) => ({start,end}))};
  } catch { return null; }
}

export function createPactServer({ providers = createPactProviders(), shared = null, demo = null } = {}) {
  const talk = createTalk({ demo: Boolean(demo) });
  return createServer(async (request, response) => {
    if (shared && await shared.handleOwner(request, response)) return;
    let pathname;
    try { pathname = new URL(request.url, "http://localhost").pathname; } catch { response.writeHead(400); response.end(); return; }
    if (demo && await demo.handle(request, response, pathname)) return;
    if (await talk(request, response, pathname)) return;
    if (pathname === "/api/config") {
      if (request.method !== "GET") { json(response, 405, { code: "METHOD_NOT_ALLOWED" }); return; }
      json(response, 200, providers.config()); return;
    }
    if (apiPaths.has(pathname)) {
      if (request.method !== "POST") { json(response, 405, { code: "METHOD_NOT_ALLOWED" }); return; }
      const sourceLookup = pathname === "/api/ai/suggest";
      const cancellation = sourceLookup ? new AbortController() : null;
      const disconnect = () => { if (!response.writableEnded) cancellation.abort(); };
      if (sourceLookup) response.once("close", disconnect);
      let input;
      try {
        input=await readRequest(request);
        const method=apiPaths.get(pathname);
        const act=()=>sourceLookup ? providers[method](input, { signal: cancellation.signal }) : providers[method](input);
        const result=shared && ["prepare","capture","previewExisting","reviewExisting"].includes(method)
          ? await shared.withPaymentReview(input.project,act) : await act();
        if (!response.destroyed) json(response,200,result);
      }
      catch (cause) {
        const status = Number.isInteger(cause.status) && cause.status >= 400 && cause.status < 600 ? cause.status : 400;
        const citationLimit = sourceLookup ? publicCitationLimit(cause) : null;
        const sourceReviewSections = sourceLookup ? publicSourceReviewSections(cause, input) : [];
        const sourceReviewSelection = sourceLookup ? publicSourceReviewSelection(cause, input) : null;
        if (!response.destroyed) json(response, status, {
          code: typeof cause.code === "string" ? cause.code : "INVALID_REQUEST",
          error: cause.code ? cause.message : "Invalid request.",
          ...(pathname === "/api/ai/suggest" && cause.modelUsage ? { modelUsage: cause.modelUsage } : {}),
          ...(citationLimit ? { citationLimit } : {}),
          ...(sourceReviewSections.length ? { sourceReviewSections } : {}),
          ...(sourceReviewSelection ? { sourceReviewSelection } : {})
        });
      } finally {
        if (sourceLookup) response.off("close", disconnect);
      }
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { "content-type": "text/plain; charset=utf-8", allow: "GET, HEAD", "x-content-type-options": "nosniff" });
      response.end("Method not allowed\n"); return;
    }
    const asset = assets.get(pathname);
    if (!asset) { response.writeHead(404, { "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff" }); response.end("Not found\n"); return; }
    try {
      let body = await readFile(join(root, asset[0]));
      if (demo && asset[1].startsWith("text/html")) body = demo.decorateHtml(body);
      sendStaticAsset(request,response,{path:pathname,type:asset[1],body,policy:"default-src 'self'; img-src 'self' blob:; media-src blob:; object-src 'none'; base-uri 'none'; form-action 'self'"});
    } catch {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" }); response.end("Local asset unavailable\n");
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4173);
  const journal = createOrderJournal(process.env.PACT_ORDER_JOURNAL || join(dirname(fileURLToPath(import.meta.url)), ".pact-local", "sandbox-orders.json"));
  const server = createPactServer({ providers: createPactProviders({ journal }) });
  server.listen(port, "127.0.0.1", () => console.log(`PACT local workbench: http://127.0.0.1:${port}`));
}
