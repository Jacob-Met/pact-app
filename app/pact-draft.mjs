// Turns a conversation into a pact, and fixes it from short corrections.
// Pure functions only: the same code runs in the browser and in the tests. A model may propose
// the draft (see talk-server.mjs); everything here is the deterministic path and the checker.

export const SAMPLE_CHAT = [
  "Maya: So here is what I can do. I'll design the logo and then the brand sheet for your bakery.",
  "Sam: Perfect. I'll pay you $600 in total, $250 when the logo is done and $350 when the brand sheet is done.",
  "Maya: Logo by November 20th, brand sheet by December 4th.",
  "Sam: Deal. I pay as soon as I see the finished work."
].join("\n");

export const SAMPLE_LINES = SAMPLE_CHAT.split("\n").map((l, i) => ({ n: i + 1, start: i * 6, ...splitSpeaker(l) }));

function splitSpeaker(line) {
  const m = /^\s*([A-Za-z][\w .'-]{0,24}?)\s*[:\-–]\s+(.+)$/.exec(line);
  return m ? { speaker: m[1].trim(), text: m[2].trim() } : { speaker: "", text: line.trim() };
}

// Pasted chat -> numbered lines. Timestamps like "[10:42]" or "10:42 -" are removed from the text.
export function linesFromChat(raw) {
  return String(raw).split(/\r?\n/).map(l => l.replace(/^\s*[\[(]?\d{1,2}:\d{2}(?::\d{2})?\s*(?:[AP]M)?[\])]?\s*[-–]?\s*/i, "").trim()).filter(Boolean)
    .slice(0, 400).map((l, i) => ({ n: i + 1, start: null, ...splitSpeaker(l) }));
}

// Speech-to-text lines ({start,end,text}) -> numbered lines. Speakers are unknown, so they alternate on pauses only if asked to.
export function linesFromSpeech(lines) {
  return lines.filter(l => l && String(l.text || "").trim()).map((l, i) => ({ n: i + 1, start: Number(l.start) || 0, speaker: "", text: String(l.text).trim() }));
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, half: 2, both: 2 };
const ORDINAL_WORDS = { first: 1, second: 2, third: 3, fourth: 4, last: -1, final: -1 };
const iso = d => d.toISOString().slice(0, 10);

export function parseDate(text, today = new Date()) {
  const t = String(text).toLowerCase();
  const base = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const fix = (m, d) => {
    let y = base.getUTCFullYear(), c = new Date(Date.UTC(y, m, d));
    if (c.getUTCMonth() !== m) return null;
    if (c < base) c = new Date(Date.UTC(y + 1, m, d));
    return iso(c);
  };
  let m = new RegExp("\\b(" + MONTHS.map(x => x.slice(0, 3) + "[a-z]*").join("|") + ")\\.?\\s+(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\b").exec(t);
  if (m) return fix(MONTHS.findIndex(x => x.startsWith(m[1].slice(0, 3))), Number(m[2]));
  m = new RegExp("\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+of\\s+(" + MONTHS.map(x => x.slice(0, 3) + "[a-z]*").join("|") + ")\\b").exec(t);
  if (m) return fix(MONTHS.findIndex(x => x.startsWith(m[2].slice(0, 3))), Number(m[1]));
  m = /\b(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)\b/.exec(t);
  if (m) { const d = Number(m[1]); let c = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), d)); if (c.getUTCDate() !== d) return null; if (c < base) c = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, d)); return c.getUTCDate() === d ? iso(c) : null; }
  m = /\bin\s+(\d+|one|two|three|four)\s+(day|week)s?\b/.exec(t);
  if (m) { const n = Number(m[1]) || NUMBER_WORDS[m[1]]; return iso(new Date(base.getTime() + n * (m[2] === "week" ? 7 : 1) * 864e5)); }
  if (/\btomorrow\b/.test(t)) return iso(new Date(base.getTime() + 864e5));
  if (/\bnext week\b/.test(t)) return iso(new Date(base.getTime() + 7 * 864e5));
  return null;
}

export function allDates(text, today) {
  const out = [], seen = new Set();
  const re = new RegExp("(" + MONTHS.map(x => x.slice(0, 3) + "[a-z]*\\.?\\s+(?:the\\s+)?\\d{1,2}(?:st|nd|rd|th)?").join("|") + "|\\b\\d{1,2}(?:st|nd|rd|th)\\b)", "gi");
  for (const m of text.matchAll(re)) { const d = parseDate(m[0], today); if (d && !seen.has(m.index)) { seen.add(m.index); out.push({ date: d, index: m.index }); } }
  return out;
}

export const money = text => [...String(text).matchAll(/\$\s*([\d,]+(?:\.\d{1,2})?)|\b([\d,]+(?:\.\d{1,2})?)\s*(?:dollars|usd|bucks)\b/gi)]
  .map(m => ({ minor: Math.round(Number((m[1] ?? m[2]).replace(/,/g, "")) * 100), index: m.index })).filter(x => Number.isFinite(x.minor) && x.minor > 0);

export const formatMoney = minor => "$" + (minor / 100).toLocaleString("en-US", { minimumFractionDigits: minor % 100 ? 2 : 0, maximumFractionDigits: 2 });
export const formatDay = d => d ? new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : "";

function cleanWork(s) {
  return s.replace(/^(so|ok(?:ay)?|well|and|great|sure|yes|yeah)[,.]?\s+/i, "").replace(/^(here is what i can do|here's what i can do)[.:]?\s*/i, "")
    .replace(/\b(i'll|i will|i can|i'm going to|we'll|we will)\b\s*/i, "").replace(/\s+(for|at|by|on)\s+(?:your|the)\s+(bakery|company|shop)\b/i, " for your $2")
    .replace(/[.!]+$/, "").replace(/\s+/g, " ").trim();
}

// Deterministic draft: finds who works, who pays, what the pieces of work are, the amounts and the dates,
// and remembers the sentence each came from.
export function ruleDraft(lines, today = new Date()) {
  if (!lines.length) throw new Error("There is nothing to read yet.");
  const speakers = [...new Set(lines.map(l => l.speaker).filter(Boolean))];
  const workRe = /\b(i'll|i will|i can|i'm going to|we'll|we will)\s+(?!pay\b|send you the money|transfer)(\w+)/i;
  const payRe = /\b(pay|paid|send you|transfer)\b/i;
  const workLine = lines.find(l => workRe.test(l.text) && !payRe.test(l.text.match(workRe)[0] + " " + (l.text.split(workRe).pop() || "").slice(0, 12))) ?? lines.find(l => workRe.test(l.text));
  const payLine = lines.find(l => /\b(i'll|i will|i can)\s+pay\b|\bpay you\b|\bfor \$/i.test(l.text) && money(l.text).length) ?? lines.find(l => money(l.text).length);
  let doer = workLine?.speaker || speakers[0] || "The first person", payer = payLine?.speaker && payLine.speaker !== doer ? payLine.speaker : speakers.find(s => s !== doer) || "The second person";
  if (payer === doer) payer = speakers.find(s => s !== doer) || "The second person";
  if (!workLine) throw new Error("I could not find who is doing what. Add a correction or say it again.");

  // Pieces of work: "the logo and then the brand sheet" -> two milestones.
  const objectText = cleanWork(workLine.text);
  const verb = (/^(design|build|write|make|paint|deliver|create|edit|fix|film|shoot|record|draw|develop|set up|produce|photograph|translate|mow|clean|paint)\b\s*/i.exec(objectText) || [""])[0];
  const rest = objectText.slice(verb.length).replace(/^(the|a|an)\s+/i, "");
  const pieces = rest.split(/\s*(?:,\s*(?:and\s+)?|\s+and then\s+|\s+then\s+|\s+and\s+)/i).map(s => s.replace(/^(the|a|an)\s+/i, "").trim()).filter(Boolean);
  const chunks = pieces.length >= 2 && pieces.length <= 4 && pieces.every(p => p.split(" ").length <= 6) ? pieces : [rest || objectText];
  const tail = chunks.length === 1 ? "" : (/\bfor your .*$/.exec(objectText)?.[0] ?? "");
  const whats = chunks.map(c => (verb.trim() || "do").toLowerCase().replace(/^do$/, "complete") + " the " + c.replace(/\s+for your .*$/i, "").replace(/^the\s+/i, "") + (tail && c === chunks.at(-1) ? " " + tail : (chunks.length === 1 ? "" : "")));

  const amountLines = lines.filter(l => money(l.text).length);
  let amounts = [], payFrom = [];
  const richest = amountLines.map(l => ({ l, ms: money(l.text) })).sort((a, b) => b.ms.length - a.ms.length)[0];
  if (richest) {
    const ms = richest.ms.map(x => x.minor);
    const total = /total|in all|altogether|overall/i.test(richest.l.text) ? Math.max(...ms) : null;
    if (total && ms.length === chunks.length + 1) { amounts = ms.filter((x, i) => !(x === total && ms.indexOf(x) === ms.lastIndexOf(x) && i === ms.indexOf(total))); }
    else if (ms.length === chunks.length) amounts = ms;
    else if (ms.length === 1 || total) amounts = even(total ?? ms[0], chunks.length);
    else amounts = even(ms.reduce((a, b) => a + b, 0), chunks.length);
    if (amounts.length !== chunks.length) amounts = even(total ?? Math.max(...ms), chunks.length);
    payFrom = amounts.map(() => richest.l.n);
  } else { throw new Error("I could not find an amount. Add a correction like “the price is $500”."); }

  // Dates, in order of mention.
  const dated = lines.flatMap(l => allDates(l.text, today).map(d => ({ ...d, n: l.n }))).filter((d, i, a) => a.findIndex(x => x.n === d.n && x.date === d.date) === i);
  const milestones = chunks.map((_, i) => {
    const d = dated.length === chunks.length ? dated[i] : dated.length === 1 ? (i === chunks.length - 1 ? dated[0] : null) : dated[Math.min(i, dated.length - 1)] ?? null;
    return { id: "m" + (i + 1), what: whats[i], amountMinor: amounts[i], due: d?.date ?? null, from: { what: workLine.n, amount: payFrom[i], due: d?.n ?? null } };
  });
  return { doer, payer, title: titleFor(doer, payer, rest), milestones };
}

function even(total, n) {
  const base = Math.floor(total / n / 100) * 100, out = Array(n).fill(base);
  out[n - 1] += total - base * n; return out;
}
function titleFor(doer, payer, rest) {
  const first = String(rest).split(/\s+(?:and|then)\s+|,/)[0].replace(/^(the|a|an)\s+/i, "").trim();
  return (first ? first[0].toUpperCase() + first.slice(1) : "Our agreement") + " for " + payer;
}

// Model output -> checked draft. Anything doubtful returns null and the caller uses ruleDraft instead.
export function checkModelDraft(raw, lines) {
  try {
    const d = typeof raw === "string" ? JSON.parse(raw) : raw;
    const n = new Set(lines.map(l => l.n));
    const ref = x => (Number.isInteger(x) && n.has(x) ? x : null);
    if (!d || typeof d.doer !== "string" || typeof d.payer !== "string" || !Array.isArray(d.milestones) || !d.milestones.length || d.milestones.length > 6) return null;
    const ms = d.milestones.map((m, i) => {
      const cents = Math.round(Number(m.amount) * 100);
      if (typeof m.what !== "string" || !m.what.trim() || !Number.isFinite(cents) || cents <= 0) throw 0;
      const due = typeof m.due === "string" && /^\d{4}-\d\d-\d\d$/.test(m.due) ? m.due : null;
      return { id: "m" + (i + 1), what: m.what.trim().slice(0, 140), amountMinor: cents, due, from: { what: ref(m.what_line), amount: ref(m.amount_line), due: due ? ref(m.due_line) : null } };
    });
    // A claimed source must contain the number it supports; otherwise drop the claim rather than keep a false pointer.
    for (const m of ms) {
      const amt = lines.find(l => l.n === m.from.amount);
      if (amt && !money(amt.text).some(x => x.minor === m.amountMinor) && !/half|equal|each|rest|remaining/i.test(amt.text)) m.from.amount = lines.find(l => money(l.text).some(x => x.minor === m.amountMinor))?.n ?? null;
    }
    if (ms.some(m => !m.from.what)) return null;
    return { doer: d.doer.trim().slice(0, 60), payer: d.payer.trim().slice(0, 60), title: String(d.title || "").trim().slice(0, 100) || "Our agreement", milestones: ms };
  } catch { return null; }
}

export const modelPrompt = (lines, today) => ({
  system: "You read a conversation where two people agree a deal. Return only JSON: {\"title\":str,\"doer\":str,\"payer\":str,\"milestones\":[{\"what\":str,\"what_line\":int,\"amount\":number,\"amount_line\":int,\"due\":\"YYYY-MM-DD\"|null,\"due_line\":int|null}]}. doer is the person who does the work; payer pays. A milestone is one deliverable and its payment. Use the line numbers given. Today is " + iso(today) + ". Never invent amounts or dates that are not said.",
  user: lines.map(l => l.n + ". " + (l.speaker ? l.speaker + ": " : "") + l.text).join("\n")
});

// ---- Corrections ("make it two payments", "deadline is the 30th", "the price is $500") ----
export function applyCorrection(draft, text, lineNo, today = new Date()) {
  const t = String(text).toLowerCase();
  const d = structuredClone(draft), ms = d.milestones;
  const pick = () => {
    const m = /\b(first|second|third|fourth|last|final)\b/.exec(t) || /\b(?:milestone|payment|part|step)\s+(\d)\b/.exec(t);
    if (!m) return null;
    const k = ORDINAL_WORDS[m[1]] ?? Number(m[1]);
    return k === -1 ? ms.length - 1 : k - 1 < ms.length ? k - 1 : null;
  };
  const said = [];
  const nPay = /\b(\d|one|two|three|four|five|six)\s+(?:equal\s+)?(?:payments?|milestones?|installments?|parts?|steps?)\b/.exec(t) || (/\bsplit (?:it )?in(?:to)?\s+(half|two|three|four)\b/.exec(t));
  if (nPay) {
    const n = Number(nPay[1]) || NUMBER_WORDS[nPay[1]];
    if (!n || n < 1 || n > 6) throw new Error("Pick between one and six payments.");
    const total = ms.reduce((a, m) => a + m.amountMinor, 0), amounts = even(total, n);
    if (n < ms.length) { ms.splice(n - 1, ms.length - n + 1, { ...ms[n - 1], what: ms.slice(n - 1).map(m => m.what).join(", then ") , due: ms.at(-1).due, from: { ...ms.at(-1).from } }); }
    else while (ms.length < n) { const l = ms.at(-1); ms.splice(ms.length - 1, 0, { id: "x", what: l.what + " (part " + ms.length + ")", amountMinor: 0, due: l.due, from: { ...l.from } }); }
    ms.forEach((m, i) => { m.id = "m" + (i + 1); m.amountMinor = amounts[i]; m.from = { ...m.from, amount: lineNo }; });
    said.push(n + (n === 1 ? " payment" : " payments"));
  }
  const dates = allDates(text, today);
  if (dates.length && /\b(deadline|due|finish|done|deliver|by|before|date)\b/.test(t)) {
    const target = pick();
    const idx = target ?? ms.length - 1, targets = /\b(all|each|everything)\b/.test(t) ? ms.map((_, i) => i) : [idx];
    targets.forEach(i => { ms[i].due = dates[0].date; ms[i].from = { ...ms[i].from, due: lineNo }; });
    said.push("deadline " + formatDay(dates[0].date));
  }
  const amounts = money(text);
  if (amounts.length && !nPay && /\b(price|total|cost|pay|paid|fee|amount|charge|make it|is|for|instead)\b/.test(t)) {
    const target = pick();
    if (target !== null) { ms[target].amountMinor = amounts[0].minor; ms[target].from = { ...ms[target].from, amount: lineNo }; said.push("payment " + (target + 1) + " " + formatMoney(amounts[0].minor)); }
    else { const a = even(amounts[0].minor, ms.length); ms.forEach((m, i) => { m.amountMinor = a[i]; m.from = { ...m.from, amount: lineNo }; }); said.push("total " + formatMoney(amounts[0].minor)); }
  }
  const ren = /\b(?:call it|rename (?:it )?(?:to)?|title (?:is|to))\s+["“]?([^"”.]{3,80})/i.exec(text);
  if (ren) { d.title = ren[1].trim(); said.push("title"); }
  if (!said.length) throw new Error("I did not catch a change. Try “make it two payments”, “deadline is the 30th” or “the total is $500”.");
  return { draft: d, said };
}

// ---- The one-page document ----
// Returns plain text (used as the agreement source) with the character range of every clause, plus a structured view for the screen.
export function buildDocument(pact) {
  const d = pact.draft, ms = d.milestones, total = ms.reduce((a, m) => a + m.amountMinor, 0);
  const parts = [], clauses = [];
  let text = "";
  const push = s => { text += s; };
  push(`${d.title}\n`);
  push(`${d.doer} does the work. ${d.payer} pays.\n\n`);
  ms.forEach((m, i) => {
    const start = text.length;
    const sentence = `${i + 1}. ${d.doer} will ${m.what}${m.due ? ", finished by " + formatDay(m.due) : ""}. ${d.payer} will pay ${formatMoney(m.amountMinor)} after ${d.payer} has seen a photo of the finished work.`;
    push(sentence);
    clauses.push({ id: m.id, start, end: text.length, quote: sentence });
    push("\n");
  });
  push(`\nTotal: ${formatMoney(total)}.`);
  return { text, clauses, total };
}

// ---- Engine project from a started pact ----
export async function buildEngine(pact, { createProject, appendEvent, captureSourceCitation }) {
  const doc = buildDocument(pact), d = pact.draft, ts = Date.now();
  let project = createProject({ id: pact.id, title: d.title.slice(0, 200), sourceText: doc.text, budgetMinor: doc.total, currency: "USD", createdAt: new Date(ts).toISOString(),
    parties: [{ id: "party-a", name: d.doer }, { id: "party-b", name: d.payer }] });
  let previous = null;
  d.milestones.forEach((m, i) => {
    const c = doc.clauses[i];
    const obligation = { id: `${pact.id}-${m.id}`, revision: 1, title: m.what.replace(/^./, x => x.toUpperCase()).slice(0, 160),
      criterion: ("A photo shows the finished work: " + m.what).slice(0, 1000), citation: captureSourceCitation(project.source, [{ start: c.start, end: c.end, quote: c.quote }]),
      performerId: "party-a", reviewerId: "party-b", dependsOn: previous ? [previous] : [], dueAt: m.due ? m.due + "T23:59:59.000Z" : null, amountMinor: m.amountMinor };
    project = appendEvent(project, { id: `event-${i + 1}-${ts}`, seq: 0, at: new Date(ts + i + 1).toISOString(), actorId: "party-a", type: "obligation.added", payload: { obligation } });
    previous = obligation.id;
  });
  return project;
}
