import { validateFileFingerprint } from "./evidence-file.mjs";
import { exportProject, importProject, MAX_SERIALIZED_BYTES, SOURCE_RANGES_FORMAT, LIMITS } from "./core.mjs";
import { MAX_CITATION_DRAFT_LENGTH, citationFromDraft } from "./source-citations.mjs";

export const RECOVERY_KEY = "pact.tab-recovery.v1";
const FORMAT = "pact-tab-recovery/v1";
const RANGE_FORMAT = "pact-tab-recovery/v2";
function hasSeparateDrafts(drafts) {
  const separate = raw => {
    if (!raw) return false;
    try { const ranges = JSON.parse(raw); return !Array.isArray(ranges) || ranges.length > 0; }
    catch { return true; }
  };
  if (separate(drafts.obligation?.citationRelated)) return true;
  try {
    const amendments = JSON.parse(drafts.amendment?.state || "[]");
    const items = Array.isArray(amendments) ? amendments : amendments?.items;
    return Array.isArray(items) && items.some(item => {
      const passages = item.values?.citationPassages;
      return separate(item.values?.citationRelated) || passages !== undefined && (!Array.isArray(passages) || passages.length > 1);
    });
  } catch { return false; }
}

export const MAX_RECOVERY_BYTES = MAX_SERIALIZED_BYTES + 4 * 1024 * 1024;
const FIELDS = {
  setup: ["title", "budget", "performer", "reviewer", "additionalParties", "source"],
  obligation: ["title", "amount", "performerId", "reviewerId", "criterion", "dueAt", "citationStart", "citationEnd", "citationQuote", "citationRelated"],
  evidence: ["obligationId", "submittedBy", "description", "reference"],
  evaluation: ["asOf"],
  amendment: ["state"],
  agreementImport: ["text", "label"],
  sourceLookup: ["question"]
};

function draftCopy(input = {}) {
  const result = {};
  for (const [section, names] of Object.entries(FIELDS)) {
    const source = input[section] ?? {};
    result[section] = {};
    for (const name of names) {
      const value = source[name];
      if (value === undefined) continue;
      const limit = section === "sourceLookup" ? 500
        : name === "citationRelated" ? MAX_CITATION_DRAFT_LENGTH
        : section === "amendment" ? 1_000_000
        : section === "obligation" && name === "criterion" ? LIMITS.criterion
        : (name === "source" || section === "agreementImport" && name === "text") ? 100_000 : 4_000;
      if (typeof value !== "string" || value.length > limit) {
        throw new Error("Saved authoring draft is invalid.");
      }
      result[section][name] = value;
    }
  }
  result.agreementFiles = {};
  for (const name of ["pending", "adopted"]) {
    const value = input.agreementFiles?.[name];
    if (value == null) continue;
    validateFileFingerprint(value.fingerprint);
    if (typeof value.originalText !== "string" || value.originalText.length > 100000) throw Error("Invalid imported source text.");
    result.agreementFiles[name] = { fingerprint: structuredClone(value.fingerprint), originalText: value.originalText };
  }
  result.dependencies = Array.isArray(input.dependencies)
    ? input.dependencies.filter(value => typeof value === "string" && value.length <= 80).slice(0, 100)
    : [];
  result.decisions = {};
  if (input.decisions && typeof input.decisions === "object" && !Array.isArray(input.decisions)) {
    for (const [id, value] of Object.entries(input.decisions).slice(0, 500)) {
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(id)) continue;
      if (typeof value?.reason !== "string" || value.reason.length > 1_000 || typeof value?.actor !== "string" || value.actor.length > 80) {
        throw new Error("Saved decision draft is invalid.");
      }
      result.decisions[id] = { reason: value.reason, actor: value.actor };
    }
  }
  return result;
}

export function encodeRecovery({ project, drafts = {}, savedAt = new Date().toISOString() }) {
  const validated = project ? JSON.parse(exportProject(project)) : null;
  const copiedDrafts = draftCopy(drafts);
  const format = validated?.format === SOURCE_RANGES_FORMAT || hasSeparateDrafts(copiedDrafts) ? RANGE_FORMAT : FORMAT;
  const raw = JSON.stringify({ format, savedAt, project: validated, drafts: copiedDrafts });
  if (new TextEncoder().encode(raw).byteLength > MAX_RECOVERY_BYTES) throw new Error("Workspace exceeds the supported recovery size.");
  return raw;
}

export function decodeRecovery(raw) {
  if (typeof raw !== "string" || new TextEncoder().encode(raw).byteLength > MAX_RECOVERY_BYTES) {
    throw new Error("Saved workspace exceeds the supported recovery size.");
  }
  const value = JSON.parse(raw);
  if (!value || ![FORMAT, RANGE_FORMAT].includes(value.format) || typeof value.savedAt !== "string" ||
      !Number.isFinite(Date.parse(value.savedAt))) throw new Error("Saved workspace format is not supported.");
  if (value.format === FORMAT && hasSeparateDrafts(value.drafts ?? {})) throw new Error("Separate source passages require the newer workspace format.");
  // The core replays and validates all events; no saved readiness, payment or authorization is trusted.
  const project = value.project === null ? null : importProject(JSON.stringify(value.project));
  const drafts = draftCopy(value.drafts);
  // Validate the complete saved selection before restoration can replace work.
  // An unsupported citation must not be silently cleared by the form renderer.
  if (project) citationFromDraft(project.source, drafts.obligation);
  return { project, drafts, savedAt: value.savedAt };
}

export function createTabRecovery(getStorage) {
  return {
    read() {
      let raw;
      try { raw = getStorage().getItem(RECOVERY_KEY); }
      catch { return { status: "unavailable" }; }
      if (raw === null) return { status: "empty" };
      try { return { status: "restored", snapshot: decodeRecovery(raw) }; }
      catch (error) {
        // Retain unreadable bytes. Merely opening the app must never destroy the recovery copy.
        return { status: "invalid", error: error.message };
      }
    },
    write(snapshot) {
      try {
        const raw = encodeRecovery(snapshot);
        getStorage().setItem(RECOVERY_KEY, raw);
        return { status: "saved" };
      } catch (error) { return { status: "unavailable", error: error.message }; }
    },
    clear() {
      try { getStorage().removeItem(RECOVERY_KEY); return { status: "cleared" }; }
      catch (error) { return { status: "unavailable", error: error.message }; }
    }
  };
}


export function exportWorkspace(snapshot) {
  const value = JSON.parse(encodeRecovery(snapshot));
  value.format = value.format === RANGE_FORMAT ? "pact-workspace/v2" : "pact-workspace/v1";
  return JSON.stringify(value);
}

export const isWorkspaceFormat = format => ["pact-workspace/v1", "pact-workspace/v2"].includes(format);

export function importWorkspace(raw) {
  if (typeof raw !== "string" || new TextEncoder().encode(raw).byteLength > MAX_RECOVERY_BYTES) {
    throw new Error("Saved workspace exceeds the supported recovery size.");
  }
  const value = JSON.parse(raw);
  if (!value || !isWorkspaceFormat(value.format)) throw new Error("Saved workspace format is not supported.");
  return decodeRecovery(JSON.stringify({ ...value, format: value.format === "pact-workspace/v2" ? RANGE_FORMAT : FORMAT }));
}
