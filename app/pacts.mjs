// Pacts: the phone-first front door. Two people talk through a deal; this turns it into a one-page pact whose
// every term points at the sentence it came from, shows milestones as a path, and hands approvals to the
// existing Commitments / evidence / Payments machinery through window.pactEngine (see the end of app.mjs).
import { createProject, appendEvent, exportProject, importProject } from "./core.mjs";
import { captureSourceCitation } from "./source-citations.mjs";
import { SAMPLE_LINES, linesFromChat, linesFromSpeech, ruleDraft, applyCorrection, buildDocument, buildEngine, formatMoney, formatDay } from "./pact-draft.mjs";

const KEY = "pact.pacts.v1";
const $ = s => document.querySelector(s);
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v; else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else if (k === "text") e.textContent = v; else e.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid.nodeType ? kid : document.createTextNode(kid));
  return e;
}
const load = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || "[]"); return Array.isArray(v) ? v : []; } catch { return []; } };
let pacts = load();
let status = { simulated: false };
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(pacts)); } catch { toast("This browser is out of room; the newest photo may not be kept."); } };
const byId = id => pacts.find(p => p.id === id);
const urlCache = new Map();
function blobUrl(dataUrl) {
  if (!dataUrl) return "";
  if (urlCache.has(dataUrl)) return urlCache.get(dataUrl);
  const [head, body] = dataUrl.split(","), bin = atob(body), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: /:(.*?);/.exec(head)?.[1] || "image/jpeg" }));
  urlCache.set(dataUrl, url); return url;
}

// ---------- shell ----------
const root = h("div", { id: "pacts", class: "pacts", hidden: true, role: "dialog", "aria-label": "Pacts" });
const toastBox = h("div", { class: "pacts-toast", role: "status", "aria-live": "polite", hidden: true });
document.body.append(root, toastBox);
let toastTimer = 0;
function toast(msg) { toastBox.textContent = msg; toastBox.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { toastBox.hidden = true; }, 3800); }

let view = { name: "home" }, busy = null;
function go(next) { view = next; busy = null; draw(); root.scrollTo({ top: 0 }); if (next.name !== "home") history.replaceState(null, "", "#pacts"); }
function openPacts() { root.hidden = false; document.body.classList.add("pacts-on"); syncFromEngine(); draw(); }
function closePacts() { root.hidden = true; document.body.classList.remove("pacts-on"); }
$("#pacts-open")?.addEventListener("click", () => { view = { name: "home" }; openPacts(); });
if (location.hash === "#pacts") { view = { name: "home" }; openPacts(); }
fetch("/api/talk/status").then(r => r.json()).then(s => { status = s; if (!root.hidden) draw(); }).catch(() => {});

// ---------- engine sync ----------
function engine() { return window.pactEngine; }
function syncFromEngine() {
  const e = engine(); const p = e?.project && byId(e.project.id);
  if (p) { p.engine = exportProject(e.project); save(); }
}
function projectOf(p) {
  const e = engine();
  if (e?.project?.id === p.id) return e.project;
  try { return importProject(p.engine); } catch { return null; }
}
function ensureOpen(p) {
  const e = engine(); if (e?.project?.id === p.id) return e.project;
  const proj = importProject(p.engine); e.open(proj); return e.project;
}
function record(p, type, actor, payload) {
  ensureOpen(p); engine().record(type, actor, payload); p.engine = exportProject(engine().project); save();
}

// ---------- state of a started pact ----------
const oid = (p, m) => p.id + "-" + m.id;
function stateOf(p) {
  const proj = p.stage === "live" ? projectOf(p) : null;
  return p.draft.milestones.map(m => {
    const ev = proj?.events.filter(e => e.type === "evidence.submitted" && e.payload.evidence.obligationId === oid(p, m)).at(-1)?.payload.evidence;
    const accepted = ev && proj.events.some(e => e.type === "evidence.accepted" && e.payload.evidenceId === ev.id);
    const paid = Boolean(p.paid?.[m.id]);
    return { m, ev, state: paid ? "done" : accepted ? "release" : ev ? "review" : "todo" };
  });
}
const owner = s => (s === "todo" ? "a" : s === "done" ? null : "b");
function markOf(p) {
  if (p.stage !== "live") return { cls: "draft", text: "Draft" };
  const next = stateOf(p).find(x => x.state !== "done");
  if (!next) return { cls: "done", text: "Done" };
  const who = owner(next.state), me = p.viewer || "a";
  return who === me ? { cls: "you", text: "Waiting on you" } : { cls: "them", text: "Waiting on them" };
}
const nameOf = (p, side) => side === "a" ? p.draft.doer : p.draft.payer;
const youAre = p => nameOf(p, p.viewer || "a");

// ---------- drawing ----------
function draw() {
  root.replaceChildren(); root.classList.toggle("sim", Boolean(status.simulated));
  const p = view.id ? byId(view.id) : null;
  const top = h("header", { class: "pacts-top" },
    view.name === "home" ? h("strong", { class: "pacts-brand" }, "Pacts") : h("button", { type: "button", class: "pacts-back", id: "pacts-back", onclick: () => go({ name: "home" }), "aria-label": "Back to your pacts" }, "‹"),
    h("span", { class: "pacts-top-title" }, view.name === "home" ? "" : view.name === "new" ? "New pact" : p?.draft.title || ""),
    h("button", { type: "button", class: "pacts-link", id: "pacts-workspace", onclick: () => { if (p?.stage === "live") { try { ensureOpen(p); } catch {} } closePacts(); } }, "Full workspace"));
  const body = h("main", { class: "pacts-body" });
  root.append(top, body);
  if (status.simulated) body.append(h("p", { class: "pacts-note", id: "pacts-sim" }, "Simulated demo: speech and model are replaced by a sample recording and a built-in reader."));
  if (view.name === "home") drawHome(body);
  else if (view.name === "new") drawNew(body);
  else if (p && p.stage === "draft") drawDraft(body, p);
  else if (p) drawPact(body, p);
  else go({ name: "home" });
}

function drawHome(body) {
  body.append(h("h1", { class: "pacts-h1" }, "Your pacts"), h("p", { class: "pacts-sub" }, "Agree out loud. Pact writes it down, and money moves only when the work is seen."));
  const list = h("ul", { class: "pact-list", id: "pact-list" });
  for (const p of [...pacts].sort((a, b) => b.updated - a.updated)) {
    const mark = markOf(p), st = p.stage === "live" ? stateOf(p) : [], total = p.draft.milestones.reduce((a, m) => a + m.amountMinor, 0);
    list.append(h("li", {}, h("button", { type: "button", class: "pact-card", "data-pact": p.id, onclick: () => go({ name: p.stage === "live" ? "pact" : "draft", id: p.id, tab: "path" }) },
      h("span", { class: "pact-card-main" }, h("strong", {}, p.draft.title), h("span", { class: "muted" }, p.draft.doer + " → " + p.draft.payer + " · " + formatMoney(total))),
      h("span", { class: "dots", "aria-hidden": "true" }, p.draft.milestones.map((m, i) => h("i", { class: st[i]?.state || "todo" }))),
      h("span", { class: "mark " + mark.cls, "data-mark": mark.cls }, mark.text))));
  }
  if (!pacts.length) body.append(h("div", { class: "pacts-empty" }, h("p", {}, "No pacts yet."), h("p", { class: "muted" }, "Record the two of you agreeing, or paste the chat where you did.")));
  else body.append(list);
  body.append(h("button", { type: "button", class: "pacts-big", id: "pact-new", onclick: () => go({ name: "new", tab: "record" }) }, "New pact"));
}

// ----- new: record / paste / sample -----
let recorder = null;
async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true }), rec = new MediaRecorder(stream), chunks = [];
  rec.ondataavailable = e => e.data.size && chunks.push(e.data); rec.start();
  return { stop: () => new Promise(res => { rec.onstop = () => { stream.getTracks().forEach(t => t.stop()); res(new Blob(chunks, { type: rec.mimeType || "audio/webm" })); }; rec.stop(); }) };
}
async function transcribe(blob) {
  const r = await fetch("/api/talk/listen", { method: "POST", body: blob, headers: { "content-type": blob.type || "audio/webm" } });
  if (!r.ok) throw new Error("The speech-to-text service did not answer.");
  return (await r.json()).lines || [];
}

function drawNew(body) {
  const tab = view.tab || "record";
  const tabs = h("div", { class: "seg", role: "tablist" }, [["record", "Say it"], ["paste", "Paste chat"], ["sample", "Sample"]].map(([k, t]) =>
    h("button", { type: "button", role: "tab", "aria-selected": String(tab === k), id: "new-tab-" + k, onclick: () => { view = { ...view, tab: k }; draw(); } }, t)));
  body.append(h("h1", { class: "pacts-h1" }, "Talk it through"), tabs);
  const msg = h("p", { class: "pacts-note", id: "new-msg", role: "status", hidden: !busy }, busy || "");
  if (tab === "record") {
    const live = Boolean(recorder);
    body.append(h("div", { class: "rec" }, h("button", { type: "button", id: "rec-button", class: "rec-button" + (live ? " on" : ""), "aria-pressed": String(live), "aria-label": live ? "Stop and read it" : "Start recording",
      onclick: async () => {
        if (!recorder) {
          try { recorder = await startRecording(); draw(); } catch { busy = "No microphone here. Paste the chat instead, or try the sample."; draw(); }
          return;
        }
        const r = recorder; recorder = null; busy = "Listening to what you said…"; draw();
        try {
          const lines = linesFromSpeech(await transcribe(await r.stop()));
          if (!lines.length) { busy = status.simulated ? "The simulated demo does not transcribe. Using the sample recording instead." : "I did not hear any words. Try again, or paste the chat."; if (status.simulated) { setTimeout(() => read(SAMPLE_LINES, "sample"), 900); } draw(); return; }
          read(lines, "voice");
        } catch (e) { busy = e.message + " Paste the chat instead."; draw(); }
      } }, live ? "Stop" : "Record"),
      h("p", { class: "rec-hint" }, live ? "Recording. Say who does what, by when, and for how much. Press stop when you agree." : "Both of you, together: say who does what, by when, and for how much.")), msg);
  } else if (tab === "paste") {
    const ta = h("textarea", { id: "chat-text", rows: 9, placeholder: "Maya: I'll design the logo for you\nSam: I'll pay $300 when you send it", "aria-label": "Paste the chat" });
    body.append(ta, msg, h("button", { type: "button", class: "pacts-big", id: "chat-go", onclick: () => { const lines = linesFromChat(ta.value); if (lines.length < 2) { busy = "Paste at least a couple of messages."; draw(); ta.value = ""; return; } read(lines, "chat"); } }, "Make the pact"));
  } else {
    body.append(h("div", { class: "sample-chat" }, SAMPLE_LINES.map(l => h("p", {}, h("b", {}, l.speaker + " "), l.text))), msg,
      h("button", { type: "button", class: "pacts-big", id: "sample-go", onclick: () => read(SAMPLE_LINES, "sample") }, "Use this conversation"));
  }
}

async function read(lines, via) {
  busy = "Writing it up…"; draw();
  let draft = null, how = "rules";
  try {
    const r = await fetch("/api/talk/draft", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lines, today: new Date().toISOString() }), signal: AbortSignal.timeout(100_000) });
    const out = r.ok ? await r.json() : null; if (out?.draft) { draft = out.draft; how = "model"; }
  } catch {}
  try { draft ||= ruleDraft(lines, new Date()); }
  catch (e) { busy = e.message; draw(); return; }
  const p = { id: "pact-" + Date.now(), updated: Date.now(), stage: "draft", viewer: "a", draft, lines, via, how, history: [], photos: {}, paid: {}, engine: null };
  pacts.push(p); save(); go({ name: "draft", id: p.id });
}

// ----- the one-page document, every term clickable back to its sentence -----
function lineText(p, n) { const l = p.lines.find(x => x.n === n); return l; }
function clock(s) { return s == null ? "" : Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0"); }
function drawDocument(p, { fresh = null } = {}) {
  const d = p.draft, total = d.milestones.reduce((a, m) => a + m.amountMinor, 0);
  const term = (text, n, kind) => n && lineText(p, n) ? h("button", { type: "button", class: "term " + kind, "data-from": n, onclick: e => showSource(p, n, e.currentTarget) }, text) : h("span", { class: "term none " + kind, title: "Not said in the conversation" }, text);
  const sheet = h("article", { class: "sheet", id: "pact-doc" },
    h("h2", {}, d.title),
    h("p", { class: "sheet-people" }, h("b", {}, d.doer), " does the work. ", h("b", {}, d.payer), " pays."),
    h("ol", { class: "clauses" }, d.milestones.map(m => h("li", { class: "clause" + (fresh === m.id ? " fresh" : ""), "data-clause": m.id },
      h("b", {}, d.doer), " will ", term(m.what, m.from.what, "what"), m.due ? [", finished by ", term(formatDay(m.due), m.from.due, "due")] : [", ", term("no date set", null, "due")], ". ",
      h("b", {}, d.payer), " will pay ", term(formatMoney(m.amountMinor), m.from.amount, "amount"), " after seeing a photo of the finished work."))),
    h("p", { class: "sheet-total" }, "Total ", h("b", {}, formatMoney(total)), "."),
    h("div", { id: "pact-source", class: "source-card", hidden: true, role: "status" }));
  return sheet;
}
function showSource(p, n, from) {
  const l = lineText(p, n), card = $("#pact-source"); if (!l || !card) return;
  card.hidden = false; card.replaceChildren(h("span", { class: "source-by" }, "Said by " + (l.speaker || "someone") + (l.start != null ? " at " + clock(l.start) : "") + (l.speaker === "Correction" ? "" : "")), h("q", {}, l.text));
  document.querySelectorAll(".term.on").forEach(x => x.classList.remove("on")); from?.classList.add("on");
  document.querySelectorAll(".tline").forEach(x => x.classList.toggle("on", Number(x.dataset.n) === n));
  card.scrollIntoView({ block: "nearest", behavior: "smooth" });
}
function drawTranscript(p) {
  return h("details", { class: "transcript", id: "pact-transcript" }, h("summary", {}, "What was said (" + p.lines.length + ")"),
    h("ol", {}, p.lines.map(l => h("li", { class: "tline" + (l.speaker === "Correction" ? " fix" : ""), "data-n": l.n }, l.speaker ? h("b", {}, l.speaker + " ") : "", l.start != null && l.speaker !== "Correction" ? h("span", { class: "muted" }, clock(l.start) + " ") : "", l.text))));
}

// ----- draft: read, fix, start -----
function drawDraft(body, p) {
  const names = h("div", { class: "people" }, ["doer", "payer"].map(k => h("label", {}, h("span", {}, k === "doer" ? "Does the work" : "Pays"),
    h("input", { value: p.draft[k], maxlength: 60, "aria-label": k === "doer" ? "Name of the person doing the work" : "Name of the person paying", id: "name-" + k, onchange: e => { const v = e.target.value.trim(); if (v) { p.draft[k] = v; p.updated = Date.now(); save(); draw(); } } }))));
  body.append(h("p", { class: "pacts-note" }, p.how === "model" ? "Read by the local model. Tap any underlined term to see the sentence it came from." : "Tap any underlined term to see the sentence it came from."), names, drawDocument(p, { fresh: view.fresh }), drawTranscript(p));
  const fix = h("input", { id: "pact-fix", placeholder: "Fix something: “make it two payments”", "aria-label": "Say or type a correction", autocomplete: "off", enterkeyhint: "send" });
  const apply = async text => {
    if (!text.trim()) return;
    try {
      const n = p.lines.length + 1, before = structuredClone({ draft: p.draft, lines: p.lines });
      const { draft, said } = applyCorrection(p.draft, text, n, new Date());
      p.history.push(before); p.draft = draft; p.lines.push({ n, start: null, speaker: "Correction", text: text.trim() }); p.updated = Date.now(); save();
      view = { ...view, fresh: draft.milestones.find((m, i) => JSON.stringify(m) !== JSON.stringify(before.draft.milestones[i]))?.id || null }; draw(); toast("Changed: " + said.join(", "));
    } catch (e) { toast(e.message); }
  };
  let mic = null;
  const bar = h("form", { class: "fixbar", id: "pact-fixbar", onsubmit: e => { e.preventDefault(); apply(fix.value); } }, fix,
    h("button", { type: "button", id: "pact-fix-mic", class: "round", "aria-label": "Say a correction", onclick: async e => {
      const b = e.currentTarget;
      if (!mic) { try { mic = await startRecording(); b.classList.add("on"); } catch { toast("No microphone here. Type the correction."); } return; }
      const r = mic; mic = null; b.classList.remove("on");
      try { const lines = await transcribe(await r.stop()); const t = lines.map(l => l.text).join(" ").trim(); if (!t) { toast(status.simulated ? "The simulated demo does not transcribe. Type it." : "I did not hear anything."); return; } fix.value = t; apply(t); } catch { toast("Could not listen. Type it instead."); }
    } }, "🎤"),
    h("button", { type: "submit", class: "round send", id: "pact-fix-send", "aria-label": "Apply the correction" }, "→"));
  const undo = p.history.length ? h("button", { type: "button", class: "pacts-link", id: "pact-undo", onclick: () => { const b = p.history.pop(); p.draft = b.draft; p.lines = b.lines; save(); draw(); } }, "Undo last fix") : null;
  body.append(h("div", { class: "chips" }, ["make it two payments", "deadline is the 30th", "the total is $500"].map(t => h("button", { type: "button", class: "chip", onclick: () => { fix.value = t; fix.focus(); } }, t)), undo),
    h("button", { type: "button", class: "pacts-big", id: "pact-start", onclick: () => startPact(p) }, "Start this pact"), h("div", { class: "fixspace" }), bar);
}

async function startPact(p) {
  try {
    if (!engine()) throw new Error("The workspace is still loading. Try again in a moment.");
    const project = await buildEngine(p, { createProject, appendEvent, captureSourceCitation });
    p.engine = exportProject(project); p.stage = "live"; p.updated = Date.now(); save();
    ensureOpen(p); go({ name: "pact", id: p.id, tab: "path" }); toast("Pact started. Both of you can see it now.");
  } catch (e) { toast(e.message); }
}

// ----- a started pact: the path -----
async function shrink(file) {
  const bmp = await createImageBitmap(file), scale = Math.min(1, 720 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas"); c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise(r => c.toBlob(r, "image/jpeg", 0.74));
  return await new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(blob); });
}
function addPhoto(p, m, file) {
  shrink(file).then(url => {
    const ref = "photo added by " + p.draft.doer + " on " + new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });
    p.photos[m.id] = url;
    try {
      record(p, "evidence.submitted", "party-a", { evidence: { id: `${p.id}-ev-${m.id}-${Date.now()}`, obligationId: oid(p, m), obligationRevision: 1, submittedBy: "party-a", description: ("Photo of the finished work: " + m.what).slice(0, 1000), reference: ref } });
      p.viewer = "a"; p.updated = Date.now(); save(); toast("Photo added. " + p.draft.payer + " can look at it now."); draw();
    } catch (e) { delete p.photos[m.id]; toast(e.message); }
  }).catch(() => toast("That file could not be read as a picture."));
}
function release(p, x) {
  const dlg = h("div", { class: "sheet-modal", role: "dialog", "aria-modal": "true", "aria-label": "Release payment", id: "release-dialog" },
    h("div", { class: "modal-card" }, h("h3", {}, "Release " + formatMoney(x.m.amountMinor) + "?"),
      p.photos[x.m.id] ? h("img", { src: blobUrl(p.photos[x.m.id]), alt: "Photo of the finished work" }) : null,
      h("p", {}, "You are saying this is the work: ", h("b", {}, x.m.what), ". Next you will approve the payment on PayPal. Nothing is sent until you do."),
      h("div", { class: "modal-actions" }, h("button", { type: "button", class: "pacts-big", id: "release-confirm", onclick: () => {
        try { record(p, "evidence.accepted", "party-b", { evidenceId: x.ev.id, rationale: p.draft.payer + " looked at the photo of the finished work and released this payment." }); p.updated = Date.now(); save(); dlg.remove(); draw(); toast("Approved. Now pay it."); } catch (e) { toast(e.message); }
      } }, "Yes, release it"), h("button", { type: "button", class: "pacts-ghost", onclick: () => dlg.remove() }, "Not yet"))));
  root.append(dlg); dlg.querySelector("#release-confirm").focus();
}
function pay(p, x) {
  ensureOpen(p); closePacts();
  const sel = $("#pay-obligation");
  setTimeout(() => { if (sel) { sel.value = oid(p, x.m); sel.dispatchEvent(new Event("change", { bubbles: true })); engine().reveal(sel); sel.scrollIntoView({ block: "center" }); } }, 60);
}

function drawPact(body, p) {
  const st = stateOf(p), done = st.filter(x => x.state === "done").length, total = p.draft.milestones.reduce((a, m) => a + m.amountMinor, 0), mark = markOf(p);
  const viewer = p.viewer || "a";
  body.append(h("div", { class: "pact-head" }, h("h1", { class: "pacts-h1" }, p.draft.title), h("p", { class: "pacts-sub" }, p.draft.doer + " → " + p.draft.payer + " · " + formatMoney(total) + " · " + done + " of " + st.length + " paid"), h("span", { class: "mark " + mark.cls, id: "pact-mark" }, mark.text)),
    h("div", { class: "seg", "aria-label": "Who is looking" }, ["a", "b"].map(s => h("button", { type: "button", "aria-pressed": String(viewer === s), class: "viewer", "data-viewer": s, onclick: () => { p.viewer = s; save(); draw(); } }, "I'm " + nameOf(p, s)))),
    h("div", { class: "seg", role: "tablist" }, [["path", "Path"], ["terms", "Terms"]].map(([k, t]) => h("button", { type: "button", role: "tab", id: "tab-" + k, "aria-selected": String((view.tab || "path") === k), onclick: () => { view = { ...view, tab: k }; draw(); } }, t))));
  if ((view.tab || "path") === "terms") { body.append(drawDocument(p), drawTranscript(p)); return; }
  const path = h("ol", { class: "path", id: "pact-path" });
  const firstOpen = st.findIndex(x => x.state !== "done");
  st.forEach((x, i) => {
    const m = x.m, photo = p.photos[m.id];
    const note = (() => {
      if (x.state === "done") return h("p", { class: "step-note ok" }, "Paid.");
      if (x.state === "todo") return viewer === "a" ? h("label", { class: "pacts-big photo-btn" }, "Add a photo of the finished work", h("input", { type: "file", accept: "image/*", "data-photo": m.id, hidden: true, onchange: e => e.target.files[0] && addPhoto(p, m, e.target.files[0]) })) : h("p", { class: "step-note" }, "Waiting for " + p.draft.doer + " to add a photo of the finished work.");
      if (x.state === "review") return viewer === "b" ? h("button", { type: "button", class: "pacts-big", "data-release": m.id, onclick: () => release(p, x) }, "Release " + formatMoney(m.amountMinor)) : h("p", { class: "step-note" }, "Waiting for " + p.draft.payer + " to look at the photo.");
      return viewer === "b" ? h("button", { type: "button", class: "pacts-big", "data-pay": m.id, onclick: () => pay(p, x) }, "Pay " + formatMoney(m.amountMinor) + " with PayPal") : h("p", { class: "step-note" }, "Approved. Waiting for " + p.draft.payer + " to pay.");
    })();
    path.append(h("li", { class: "pp-step " + x.state + (i === firstOpen ? " current" : ""), "data-step": m.id },
      h("span", { class: "node", "aria-hidden": "true" }, x.state === "done" ? "✓" : String(i + 1)),
      h("div", { class: "step-card" }, h("div", { class: "step-row" }, h("strong", {}, m.what.replace(/^./, c => c.toUpperCase())), h("span", { class: "amount" }, formatMoney(m.amountMinor))),
        h("p", { class: "muted" }, m.due ? "Due " + formatDay(m.due) : "No date set"),
        photo ? h("img", { class: "proof", src: blobUrl(photo), alt: "Photo of the finished work", onclick: e => e.currentTarget.classList.toggle("big") }) : null, note)));
  });
  body.append(path, h("p", { class: "pacts-note" }, "Payment goes through the PayPal Sandbox path already in this workspace. Releasing a payment records your approval there, then takes you to it."));
}

// ---------- payments made in the full workspace mark the step paid ----------
const watchPaid = () => {
  const anchor = $("#pay-state"); if (!anchor) return;
  new MutationObserver(() => {
    if (!/captured|completed/i.test(anchor.textContent || "") || /not captured|no sandbox/i.test(anchor.textContent || "")) return;
    const id = $("#pay-obligation")?.value; const p = pacts.find(x => id?.startsWith(x.id + "-")); if (!p) return;
    const m = p.draft.milestones.find(x => oid(p, x) === id); if (m && !p.paid[m.id]) { p.paid[m.id] = true; p.updated = Date.now(); save(); }
  }).observe(anchor, { childList: true, characterData: true, subtree: true });
};
watchPaid();
addEventListener("keydown", e => { if (e.key === "Escape" && !root.hidden) { const d = $("#release-dialog"); if (d) d.remove(); } });
window.pactsUI = { open: openPacts, close: closePacts, data: () => pacts };
