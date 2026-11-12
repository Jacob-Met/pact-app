import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";

// Contains routing identities, provider-observed status and payment-review hashes;
// no credentials, access tokens, agreement text, or evidence.
const FORMAT = "pact-sandbox-orders/v1";
const LIMIT = 2_000_000;
const allowed = new Set(["key", "projectId", "obligationId", "obligationRevision", "amountMinor", "requestId", "captureRequestId", "orderId", "state", "approvalUrl", "captureId", "lastObservedAt", "termsDigest", "activeKey", "reviewedAt"]);
const states = new Set(["preparing", "awaiting-payer", "approved-by-payer", "capturing", "captured", "voided", "uncertain"]);
const invalid = () => Object.assign(new Error("Sandbox order journal is unreadable or invalid. No new provider write will be attempted."), { code: "ORDER_JOURNAL_INVALID", status: 503 });
const unavailable = () => Object.assign(new Error("Sandbox order journal could not be saved. No provider success is being asserted."), { code: "ORDER_JOURNAL_UNAVAILABLE", status: 503 });
const text = (v, max) => typeof v === "string" && v.length > 0 && v.length <= max;

function admit(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).some(k => !allowed.has(k))) throw invalid();
  if (!/^[a-f0-9]{48}$/.test(raw.key) || !text(raw.projectId, 128) || !text(raw.obligationId, 80) ||
      !Number.isSafeInteger(raw.amountMinor) || raw.amountMinor < 1 || raw.amountMinor > 99999999 ||
      !/^pact-create-[a-f0-9]{64}$/.test(raw.requestId) ||
      !/^pact-capture-[a-f0-9]{64}$/.test(raw.captureRequestId) || !states.has(raw.state)) throw invalid();
  if (raw.termsDigest != null && !/^[a-f0-9]{64}$/.test(raw.termsDigest)) throw invalid();
  if (raw.activeKey != null && (!/^[a-f0-9]{48}$/.test(raw.activeKey) || !raw.termsDigest || !raw.reviewedAt)) throw invalid();
  if (raw.reviewedAt != null && (!text(raw.reviewedAt,40) || !Number.isFinite(Date.parse(raw.reviewedAt)) || !raw.activeKey)) throw invalid();
  if (raw.obligationRevision != null && (!Number.isSafeInteger(raw.obligationRevision) || raw.obligationRevision < 1)) throw invalid();
  if (raw.orderId != null && (typeof raw.orderId !== "string" || !/^[A-Z0-9]{1,36}$/.test(raw.orderId))) throw invalid();
  if (raw.captureId != null && !text(raw.captureId, 80)) throw invalid();
  if (raw.lastObservedAt != null && (!text(raw.lastObservedAt, 40) || !Number.isFinite(Date.parse(raw.lastObservedAt)))) throw invalid();
  if (raw.approvalUrl != null) {
    try {
      const url = new URL(raw.approvalUrl);
      if (url.protocol !== "https:" || url.hostname !== "www.sandbox.paypal.com" || url.username || url.password) throw invalid();
    } catch { throw invalid(); }
  }
  return { ...raw };
}

export function createOrderJournal(filename) {
  if (!text(filename, 4096)) throw new TypeError("Supply a local Sandbox order journal path.");
  async function load() {
    let content;
    try { content = await readFile(filename, "utf8"); }
    catch (cause) {
      if (cause.code === "ENOENT") return [];
      throw invalid();
    }
    if (Buffer.byteLength(content, "utf8") > LIMIT) throw invalid();
    let doc;
    try { doc = JSON.parse(content); } catch { throw invalid(); }
    if (!doc || typeof doc !== "object" || Array.isArray(doc) ||
        Object.keys(doc).sort().join(",") !== "orders,schema" ||
        doc.schema !== FORMAT || !Array.isArray(doc.orders) || doc.orders.length > 5000) throw invalid();
    const keys = new Set();
    const records = doc.orders.map(raw => {
      const item = admit(raw);
      if (keys.has(item.key)) throw invalid();
      keys.add(item.key);
      return item;
    });
    return records;
  }
  async function save(records) {
    let payload;
    try {
      if (!Array.isArray(records) || records.length > 5000) throw invalid();
      const keys = new Set();
      const items = records.map(raw => {
        const item = admit(raw);
        if (keys.has(item.key)) throw invalid();
        keys.add(item.key);
        return item;
      });
      payload = JSON.stringify({ schema: FORMAT, orders: items });
      if (Buffer.byteLength(payload, "utf8") > LIMIT) throw invalid();
    } catch { throw unavailable(); }
    const parent = dirname(filename);
    const temp = filename + "." + process.pid + "." + randomUUID() + ".tmp";
    try {
      await mkdir(parent, { recursive: true, mode: 0o700 });
      const file = await open(temp, "wx", 0o600);
      try { await file.writeFile(payload, "utf8"); await file.sync(); }
      finally { await file.close(); }
      await rename(temp, filename);
      const directory = await open(parent, "r");
      try { await directory.sync(); } finally { await directory.close(); }
    } catch {
      await unlink(temp).catch(() => {});
      throw unavailable();
    }
  }
  return { load, save };
}
