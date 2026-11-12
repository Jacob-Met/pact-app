// Simulated demo mode: `node start-pact.mjs --demo` (or `npm run demo`).
// Nothing here runs unless that flag is given. It answers the PayPal Sandbox
// calls and the model call with small in-process fakes, serves a tiny
// "Simulated PayPal approval" page, and adds a badge to the app page.
import { randomBytes } from "node:crypto";

const PAYPAL_API = "https://api-m.sandbox.paypal.com";
const MODEL_URL = "http://127.0.0.1:9/v1/"; // never contacted; the fake answers first
const PAGE_CSP = "default-src 'self'; img-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const words = text => new Set(String(text).toLowerCase().match(/[a-z]{4,}/g) ?? []);

export function createDemo({ origin }) {
  const orders = new Map();
  const view = order => ({
    id: order.id, status: order.status, intent: "CAPTURE",
    purchase_units: [{ ...order.unit, ...(order.captures.length ? { payments: { captures: order.captures } } : {}) }],
    links: [
      { href: PAYPAL_API + "/v2/checkout/orders/" + order.id, rel: "self", method: "GET" },
      ...(order.status === "COMPLETED" ? [] : [{ href: origin + "/demo/paypal/approve?token=" + order.id, rel: "payer-action", method: "GET" }])
    ]
  });

  // Answers PayPal Sandbox requests and the OpenAI-compatible model request.
  async function http(url, init = {}) {
    const target = new URL(url), method = init.method ?? "GET";
    if (target.pathname.endsWith("/chat/completions")) return model(JSON.parse(init.body));
    if (target.pathname === "/v1/oauth2/token")
      return json(200, { scope: "https://uri.paypal.com/services/payments/payment", access_token: "SIMULATED-" + randomBytes(12).toString("hex"), token_type: "Bearer", app_id: "SIMULATED-APP", expires_in: 32400, nonce: "simulated" });
    if (method === "POST" && target.pathname === "/v2/checkout/orders") {
      const unit = JSON.parse(init.body).purchase_units[0];
      const id = "SIM" + randomBytes(8).toString("hex").toUpperCase();
      orders.set(id, { id, status: "PAYER_ACTION_REQUIRED", unit, captures: [] });
      return json(201, view(orders.get(id)));
    }
    const match = target.pathname.match(/^\/v2\/checkout\/orders\/([^/]+)(\/capture)?$/);
    const order = match && orders.get(match[1]);
    if (!order) return json(404, { name: "RESOURCE_NOT_FOUND", message: "Simulated PayPal does not know this order." });
    if (method === "GET" && !match[2]) return json(200, view(order));
    if (method === "POST" && match[2]) {
      if (order.status !== "APPROVED") return json(422, { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "ORDER_NOT_APPROVED" }] });
      order.status = "COMPLETED";
      order.captures = [{ id: "SIMCAP" + randomBytes(7).toString("hex").toUpperCase(), status: "COMPLETED", amount: { ...order.unit.amount }, final_capture: true, create_time: new Date().toISOString() }];
      return json(201, view(order));
    }
    return json(404, { name: "RESOURCE_NOT_FOUND", message: "Not simulated." });
  }

  // Canned model answer: choose the sentence that best matches the question,
  // preferring one that says a preview is not acceptance. Same shape as a real reply.
  async function model(payload) {
    await sleep(1200);
    const input = JSON.parse(payload.messages[1].content);
    const wanted = words(input.objective);
    const score = s => (/preview/i.test(s.text) && /not (an )?acceptance/i.test(s.text) ? 100 : 0) + [...words(s.text)].filter(w => wanted.has(w)).length;
    const best = [...input.sentences].sort((a, b) => score(b) - score(a))[0];
    const n = best ? best.sentence : 0;
    const system = payload.messages[0].content;
    const answer = system.includes('{"sentence"') ? { sentence: n }
      : system.includes('{"clauses"') ? { clauses: n ? [n] : [] }
      : { first: n, last: n };
    return json(200, { id: "simulated", model: "demo-model", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(answer) } }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } });
  }

  const css = "#sim-badge{position:fixed;top:8px;left:50%;transform:translateX(-50%);white-space:nowrap;z-index:2147483647;padding:6px 12px;border-radius:999px;background:#fff3bf;color:#5c4400;border:1px solid #d9a400;font:600 13px/1.2 system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.2);pointer-events:none}"
    + ".sim-page{margin:0;min-height:100vh;display:grid;place-items:center;background:#eef1f6;color:#1a2233;font:16px/1.5 system-ui,sans-serif}.sim-page main{background:#fff;border-radius:12px;padding:28px 32px;max-width:460px;box-shadow:0 6px 24px rgba(0,0,0,.12)}.sim-page h1{margin:0 0 8px;font-size:22px}.sim-page dl{display:grid;grid-template-columns:auto 1fr;gap:4px 16px}.sim-page dt{color:#5b6475}.sim-page dd{margin:0;font-weight:600}.sim-page button{margin-top:18px;padding:10px 22px;border:0;border-radius:999px;background:#0070ba;color:#fff;font:600 16px system-ui,sans-serif;cursor:pointer}";
  const script = "var b=document.createElement('div');b.id='sim-badge';b.textContent='Simulated demo: no real PayPal call';document.body.appendChild(b);";
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  // Returns true when the request was answered here.
  async function handle(request, response, pathname) {
    const send = (status, type, body, extra = {}) => { response.writeHead(status, { "content-type": type, "cache-control": "no-store", "content-security-policy": PAGE_CSP, "x-content-type-options": "nosniff", ...extra }); response.end(body); return true; };
    if (pathname === "/demo-badge.css" || pathname === "/demo-badge.dark.css") return send(200, "text/css; charset=utf-8", css);
    if (pathname === "/demo-badge.js") return send(200, "text/javascript; charset=utf-8", script);
    if (pathname !== "/demo/paypal/approve") return false;
    const url = new URL(request.url, origin), order = orders.get(url.searchParams.get("token"));
    if (!order) return send(404, "text/plain; charset=utf-8", "Unknown simulated order.");
    if (request.method === "POST") {
      for await (const chunk of request) void chunk;
      if (order.status === "PAYER_ACTION_REQUIRED") order.status = "APPROVED";
      return send(303, "text/plain; charset=utf-8", "", { location: "/" });
    }
    const amount = order.unit.amount;
    return send(200, "text/html; charset=utf-8", '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Simulated PayPal approval</title><link rel="stylesheet" href="/demo-badge.css"><script src="/demo-badge.js" defer></script></head><body class="sim-page"><main><h1>Simulated PayPal approval</h1><p>This page stands in for PayPal in the offline demo. No real payment, account or PayPal server is involved.</p><dl><dt>Order</dt><dd>' + esc(order.id) + "</dd><dt>Item</dt><dd>" + esc(order.unit.description ?? "") + "</dd><dt>Amount</dt><dd>" + esc(amount.value) + " " + esc(amount.currency_code) + "</dd><dt>Status</dt><dd>" + esc(order.status) + '</dd></dl><form method="post" action="/demo/paypal/approve?token=' + encodeURIComponent(order.id) + '"><button type="submit" id="sim-approve">Approve</button></form></main></body></html>');
  }
  const decorateHtml = body => Buffer.from(body.toString("utf8").replace("</head>", '<link rel="stylesheet" href="/demo-badge.css"><script src="/demo-badge.js" defer></script></head>'));
  const trustApproval = url => url.href.startsWith(origin + "/demo/paypal/approve?");

  return { http, handle, decorateHtml, trustApproval };
}

// Options for createPactProviders() and createPactServer().
export function demoSetup({ port }) {
  const demo = createDemo({ origin: "http://127.0.0.1:" + port });
  // Orders live in memory only: the real journal insists on a www.sandbox.paypal.com approval link.
  const journal = { load: async () => [], save: async () => {} };
  const env = { PAYPAL_SANDBOX_CLIENT_ID: "simulated", PAYPAL_SANDBOX_CLIENT_SECRET: "simulated", PACT_AI_BASE_URL: MODEL_URL, PACT_AI_MODEL: "demo-model" };
  return { demo, providerOptions: { env, http: demo.http, journal, trustApproval: demo.trustApproval } };
}
