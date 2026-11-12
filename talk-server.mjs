// "Talk it through" back end. Two routes, both local:
//   POST /api/talk/listen  raw audio/video bytes -> {lines:[{start,end,text}]} from the local speech-to-text service
//   POST /api/talk/draft   {lines, today} -> {draft|null, via:"model"|"rules"} using the local model when it answers
// Nothing leaves this machine. In the simulated demo, or when the services are down, the browser falls back
// to its deterministic reader (app/pact-draft.mjs) and canned sample.
import { checkModelDraft, modelPrompt } from "./app/pact-draft.mjs";

const STT_URL = process.env.PACT_STT_URL || "http://127.0.0.1:5621/listen";
const MODEL_BASE = process.env.PACT_TALK_MODEL_URL || "http://127.0.0.1:11434";
const MODEL = process.env.PACT_TALK_MODEL || "qwen2.5:7b";
const MAX_AUDIO = 40 * 1024 * 1024;

const send = (response, status, body) => {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'" });
  response.end(JSON.stringify(body)); return true;
};
async function readBytes(request, limit) {
  const parts = []; let size = 0;
  for await (const part of request) { size += part.length; if (size > limit) throw Object.assign(new Error("Too large."), { status: 413 }); parts.push(part); }
  return Buffer.concat(parts);
}

export function createTalk({ demo = false, fetchImpl = fetch } = {}) {
  return async function handle(request, response, pathname) {
    if (!pathname.startsWith("/api/talk/")) return false;
    if (pathname === "/api/talk/status") {
      return send(response, 200, { simulated: demo, listening: !demo, model: demo ? null : MODEL });
    }
    if (request.method !== "POST") return send(response, 405, { code: "METHOD_NOT_ALLOWED" });
    try {
      if (pathname === "/api/talk/listen") {
        const bytes = await readBytes(request, MAX_AUDIO);
        if (demo) return send(response, 200, { simulated: true, lines: [] });
        const reply = await fetchImpl(STT_URL, { method: "POST", body: bytes, headers: { "content-type": request.headers["content-type"] || "application/octet-stream" }, signal: AbortSignal.timeout(120_000) });
        if (!reply.ok) return send(response, 502, { code: "LISTEN_FAILED", error: "The local speech-to-text service did not accept the recording." });
        const out = await reply.json();
        const lines = (Array.isArray(out.lines) ? out.lines : []).map(l => ({ start: Number(l.start) || 0, end: Number(l.end) || 0, text: String(l.text ?? "") })).filter(l => l.text.trim());
        return send(response, 200, { lines });
      }
      if (pathname === "/api/talk/draft") {
        const body = JSON.parse((await readBytes(request, 1_048_576)).toString("utf8"));
        const lines = Array.isArray(body.lines) ? body.lines.slice(0, 400).map((l, i) => ({ n: Number(l.n) || i + 1, speaker: String(l.speaker || ""), text: String(l.text || "").slice(0, 1000) })) : [];
        if (demo || !lines.length) return send(response, 200, { draft: null, via: "rules" });
        const today = new Date(String(body.today || Date.now()));
        const prompt = modelPrompt(lines, Number.isNaN(today.valueOf()) ? new Date() : today);
        try {
          const reply = await fetchImpl(MODEL_BASE + "/api/chat", { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(90_000),
            body: JSON.stringify({ model: MODEL, stream: false, format: "json", options: { temperature: 0 }, messages: [{ role: "system", content: prompt.system }, { role: "user", content: prompt.user }] }) });
          if (!reply.ok) return send(response, 200, { draft: null, via: "rules" });
          const out = await reply.json();
          const draft = checkModelDraft(out?.message?.content, lines);
          return send(response, 200, draft ? { draft, via: "model" } : { draft: null, via: "rules" });
        } catch { return send(response, 200, { draft: null, via: "rules" }); }
      }
    } catch (cause) {
      return send(response, cause.status || 400, { code: "TALK_FAILED", error: cause.status === 413 ? "That recording is too large." : "That request could not be read." });
    }
    return send(response, 404, { code: "NOT_FOUND" });
  };
}
