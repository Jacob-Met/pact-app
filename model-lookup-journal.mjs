import { randomUUID } from "node:crypto";
import { mkdir, open, link, unlink } from "node:fs/promises";
import { join } from "node:path";

const schema = "pact-model-lookups/v1";
const fields = "createdAt,deadlineUnixMs,id,projectId,requestSha256,route,schema,timeoutSeconds";
const maximumBytes = 4096;
const failure = (code, message) => Object.assign(new Error(message), { code, status: 503 });
const invalid = () => failure("AI_LOOKUP_STORE_INVALID", "The saved source lookup cannot be read. Its original model turn must be inspected before another request.");
const unavailable = () => failure("AI_LOOKUP_STORE_UNAVAILABLE", "The source lookup could not be saved before dispatch.");
const conflict = () => failure("AI_LOOKUP_CONFLICT", "The saved source lookup belongs to a different request.");
const idValid = id => typeof id === "string" && /^pact-source-[a-f0-9]{64}$/.test(id);
function routeValid(value) {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password &&
      !url.search && !url.hash && url.href === value;
  } catch { return false; }
}
function admit(record, id) {
  if (!record || typeof record !== "object" || Array.isArray(record) ||
      Object.keys(record).sort().join(",") !== fields || record.schema !== schema ||
      !idValid(record.id) || record.id !== id ||
      !/^[a-f0-9]{64}$/.test(record.requestSha256) || !routeValid(record.route) ||
      typeof record.projectId !== "string" || !record.projectId || record.projectId.length > 128 ||
      typeof record.createdAt !== "string" || !Number.isFinite(Date.parse(record.createdAt)) ||
      !Number.isSafeInteger(record.deadlineUnixMs) || record.deadlineUnixMs <= 0 ||
      !Number.isSafeInteger(record.timeoutSeconds) || record.timeoutSeconds < 1 || record.timeoutSeconds > 600)
    throw invalid();
  return { ...record };
}
function same(record, input) {
  if (record.requestSha256 !== input.requestSha256 || record.route !== input.route ||
      record.projectId !== input.projectId) throw conflict();
  return record;
}

// A reservation means dispatch may have begun, never that inference succeeded.
// There is no automatic release or expiry: later attempts observe the original ID.
// Records contain only request identity and timing, never source text or credentials.
export function createModelLookupJournal(directory) {
  if (typeof directory !== "string" || !directory || directory.length > 4096)
    throw new TypeError("Supply a private source lookup directory.");
  async function load(id) {
    if (!idValid(id)) throw invalid();
    let file;
    try {
      file = await open(join(directory, id + ".json"), "r");
      const stat = await file.stat();
      if (!stat.isFile() || stat.size < 1 || stat.size > maximumBytes) throw invalid();
      return admit(JSON.parse(await file.readFile("utf8")), id);
    } catch (cause) {
      if (cause.code === "ENOENT") return null;
      throw invalid();
    } finally { await file?.close(); }
  }
  async function reserve(input) {
    const record = admit({ schema, id: input?.id, requestSha256: input?.requestSha256,
      route: input?.route, projectId: input?.projectId,
      createdAt: new Date().toISOString(), deadlineUnixMs: input?.deadlineUnixMs, timeoutSeconds: input?.timeoutSeconds }, input?.id);
    const existing = await load(record.id);
    if (existing) return { created: false, record: same(existing, record) };
    const target = join(directory, record.id + ".json");
    const temporary = join(directory, "." + record.id + "." + process.pid + "." + randomUUID() + ".tmp");
    const payload = JSON.stringify(record);
    if (Buffer.byteLength(payload) > maximumBytes) throw invalid();
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const file = await open(temporary, "wx", 0o600);
      try { await file.writeFile(payload, "utf8"); await file.sync(); }
      finally { await file.close(); }
      try {
        // Link a complete synced record atomically; never replace another claim.
        await link(temporary, target);
      } catch (cause) {
        if (cause.code !== "EEXIST") throw cause;
        const winner = await load(record.id);
        if (!winner) throw invalid();
        return { created: false, record: same(winner, record) };
      }
      const parent = await open(directory, "r");
      try { await parent.sync(); } finally { await parent.close(); }
      return { created: true, record };
    } catch (cause) {
      if (["AI_LOOKUP_STORE_INVALID", "AI_LOOKUP_CONFLICT"].includes(cause.code)) throw cause;
      throw unavailable();
    } finally { await unlink(temporary).catch(() => {}); }
  }
  return { load, reserve };
}
