import { validateFileFingerprint } from './evidence-file.mjs';
import { validateSourceCitation, MAX_CAPTURE_TOTAL_CHARACTERS } from './source-citations.mjs';
export const FORMAT = "pact-local-obligations/v1";
export const AMENDMENT_FORMAT = "pact-local-obligations/v2";
export const SOURCE_RANGES_FORMAT = "pact-local-obligations/v3";
const AMENDMENT_TYPES = new Set(["amendment.proposed", "amendment.reviewed", "amendment.withdrawn", "amendment.adopted"]);
export const LIMITS = Object.freeze({ source: 100_000, criterion: MAX_CAPTURE_TOTAL_CHARACTERS, obligations: 100, evidence: 500, events: 2_000 });
export const MAX_SERIALIZED_BYTES = 16 * 1024 * 1024;

const TYPES = new Set([
  "party.name-corrected", "obligation.added", "evidence.submitted", "evidence.accepted",
  "evidence.disputed", "evidence.revoked", "dispute.resolved", ...AMENDMENT_TYPES
]);

export class PactError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PactError";
    this.code = code;
  }
}

const fail = (code, message) => { throw new PactError(code, message); };
const text = (value, name, max = 2_000) => {
  if (typeof value !== "string" || !value.trim() || value.length > max) fail("INVALID_TEXT", `${name} must be non-empty text of at most ${max} characters.`);
  return value;
};
const id = (value, name = "id") => {
  text(value, name, 80);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) fail("INVALID_ID", `${name} contains unsupported characters.`);
  return value;
};
const instant = (value, name) => {
  let canonical = false;
  try { canonical = typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && new Date(value).toISOString() === value; } catch { canonical = false; }
  if (!canonical) {
    fail("INVALID_INSTANT", `${name} must be a canonical UTC instant.`);
  }
  return value;
};
const minor = (value, name) => {
  if (!Number.isSafeInteger(value) || value < 0) fail("INVALID_AMOUNT", `${name} must be a non-negative safe integer in minor units.`);
  return value;
};
const exactKeys = (value, allowed, name) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("INVALID_OBJECT", `${name} must be an object.`);
  const extras = Object.keys(value).filter(key => !allowed.includes(key));
  if (extras.length) fail("UNKNOWN_FIELD", `${name} contains unsupported field ${extras[0]}.`);
};
const clone = value => structuredClone(value);

export function createProject({ id: projectId, title, sourceText, sourceFile, parties, budgetMinor = 0, currency = "USD", createdAt }) {
  id(projectId, "project id");
  text(title, "title", 200);
  text(sourceText, "agreement source", LIMITS.source);
  instant(createdAt, "createdAt");
  if (currency !== "USD") fail("UNSUPPORTED_CURRENCY", "This baseline supports USD only.");
  minor(budgetMinor, "budgetMinor");
  if (!Array.isArray(parties) || parties.length < 2 || parties.length > 8) fail("INVALID_PARTIES", "Record between two and eight declared parties.");
  const seen = new Set();
  for (const party of parties) {
    exactKeys(party, ["id", "name"], "party");
    id(party.id, "party id"); text(party.name, "party name", 120);
    if (seen.has(party.id)) fail("DUPLICATE_ID", `Duplicate party id ${party.id}.`);
    seen.add(party.id);
  }
  return validateProject({ format: FORMAT, id: projectId, title, currency, budgetMinor, source: { id: "source-1", revision: 1, text: sourceText, ...(sourceFile ? { file: sourceFile } : {}) }, parties, createdAt, events: [] });
}

function validateCitation(citation, project) {
  if (citation?.related !== undefined && project.format !== SOURCE_RANGES_FORMAT)
    fail("UNSUPPORTED_FORMAT", "Separate source passages require the v3 project format.");
  try { validateSourceCitation(citation, project.source); }
  catch (error) { fail(error.code || "CITATION_RANGE", error.message); }
}

function validateObligation(obligation, project, knownObligations, expectedRevision = 1) {
  exactKeys(obligation, ["id", "revision", "title", "criterion", "citation", "performerId", "reviewerId", "dependsOn", "dueAt", "amountMinor"], "obligation");
  id(obligation.id, "obligation id");
  if (!Number.isSafeInteger(obligation.revision) || obligation.revision !== expectedRevision) fail("INVALID_REVISION", "An obligation must use the exact next revision.");
  text(obligation.title, "obligation title", 160); text(obligation.criterion, "criterion", LIMITS.criterion);
  validateCitation(obligation.citation, project);
  const partyIds = new Set(project.parties.map(p => p.id));
  if (!partyIds.has(obligation.performerId) || !partyIds.has(obligation.reviewerId)) fail("UNKNOWN_PARTY", "Obligation parties must be declared project parties.");
  if (!Array.isArray(obligation.dependsOn)) fail("INVALID_DEPENDENCIES", "dependsOn must be an array.");
  if (new Set(obligation.dependsOn).size !== obligation.dependsOn.length) fail("DUPLICATE_DEPENDENCY", "Dependencies must be unique.");
  for (const dep of obligation.dependsOn) {
    id(dep, "dependency id");
    if (dep === obligation.id) fail("DEPENDENCY_CYCLE", "An obligation cannot depend on itself.");
    if (!knownObligations.has(dep)) fail("MISSING_DEPENDENCY", `Dependency ${dep} must be added first.`);
  }
  if (obligation.dueAt !== null) instant(obligation.dueAt, "dueAt");
  minor(obligation.amountMinor, "amountMinor");
}

function terms(obligation) {
  const c = obligation.citation;
  const values = [obligation.title, obligation.criterion, c.sourceId, c.sourceRevision,
    c.start, c.end, c.quote, obligation.performerId, obligation.reviewerId,
    [...obligation.dependsOn].sort(), obligation.dueAt, obligation.amountMinor];
  if (c.related !== undefined) values.push(c.related.map(({start,end,quote}) => [start,end,quote]));
  return JSON.stringify(values);
}

function replacementAllocation(project, obligations, allocated, candidate) {
  const previous = obligations.get(candidate?.id);
  if (!previous) fail("UNKNOWN_OBLIGATION", "Choose an existing commitment to amend.");
  validateObligation(candidate, project, obligations, previous.revision + 1);
  if (terms(candidate) === terms(previous)) fail("NO_AMENDMENT", "Change at least one commitment term before proposing an amendment.");
  const nextAllocated = allocated - previous.amountMinor + candidate.amountMinor;
  if (!Number.isSafeInteger(nextAllocated) || nextAllocated > project.budgetMinor) fail("BUDGET_EXCEEDED", "The replacement amount exceeds the agreement's unallocated budget.");
  const proposed = new Map(obligations); proposed.set(candidate.id, candidate);
  const done = new Set(), visiting = new Set();
  const visit = key => {
    if (visiting.has(key)) fail("DEPENDENCY_CYCLE", "The amended dependencies would create a cycle.");
    if (done.has(key)) return;
    visiting.add(key);
    for (const dependency of proposed.get(key).dependsOn) visit(dependency);
    visiting.delete(key); done.add(key);
  };
  for (const key of proposed.keys()) visit(key);
  return nextAllocated;
}

function replay(project) {
  const obligations = new Map();
  const obligationVersions = new Map();
  const amendments = new Map();
  const evidence = new Map();
  const decisions = new Map();
  const disputes = new Map();
  const eventIds = new Set();
  let lastAt = project.createdAt;
  let allocated = 0;
  for (let index = 0; index < project.events.length; index += 1) {
    const event = project.events[index];
    exactKeys(event, ["id", "seq", "at", "actorId", "type", "payload"], "event");
    id(event.id, "event id");
    if (eventIds.has(event.id)) fail("DUPLICATE_ID", `Duplicate event id ${event.id}.`);
    eventIds.add(event.id);
    if (event.seq !== index + 1) fail("INVALID_SEQUENCE", "Event sequence must be contiguous from 1.");
    instant(event.at, "event at");
    if (event.at < lastAt) fail("EVENT_ORDER", "Event timestamps must be nondecreasing.");
    lastAt = event.at;
    if (!project.parties.some(p => p.id === event.actorId)) fail("UNKNOWN_PARTY", `Unknown actor ${event.actorId}.`);
    if (!TYPES.has(event.type)) fail("UNKNOWN_EVENT", `Unknown event type ${event.type}.`);
    const payload = event.payload;
    if (event.type === "party.name-corrected") {
      exactKeys(payload, ["partyId", "previousName", "name", "reason"], "party.name-corrected payload");
      const party = project.parties.find(p => p.id === payload.partyId);
      if (!party) fail("UNKNOWN_PARTY", "Correction must identify an existing party.");
      text(payload.name, "corrected party name", 120); text(payload.reason, "correction reason", 1000);
      const previous = partyNames(project, event.seq - 1).find(p => p.id === party.id).name;
      if (previous !== payload.previousName) fail("STALE_PARTY_NAME", "Review the current party name before correcting it.");
      if (previous === payload.name) fail("UNCHANGED_PARTY_NAME", "Enter a corrected name.");
    } else if (event.type === "obligation.added") {
      exactKeys(payload, ["obligation"], "obligation.added payload");
      if (obligations.has(payload.obligation?.id)) fail("DUPLICATE_ID", `Duplicate obligation id ${payload.obligation.id}.`);
      validateObligation(payload.obligation, project, obligations);
      allocated += payload.obligation.amountMinor;
      if (!Number.isSafeInteger(allocated) || allocated > project.budgetMinor) fail("BUDGET_EXCEEDED", "Obligation amounts exceed the simulated budget.");
      obligations.set(payload.obligation.id, clone(payload.obligation));
      obligationVersions.set(payload.obligation.id + "@1", clone(payload.obligation));
    } else if (event.type === "evidence.submitted") {
      exactKeys(payload, ["evidence"], "evidence.submitted payload");
      const item = payload.evidence;
      exactKeys(item, ["id", "obligationId", "obligationRevision", "submittedBy", "description", "reference", "fileFingerprint"], "evidence");
      id(item.id, "evidence id");
      if (evidence.has(item.id)) fail("DUPLICATE_ID", `Duplicate evidence id ${item.id}.`);
      const obligation = obligations.get(item.obligationId);
      if (!obligation || item.obligationRevision !== obligation.revision) fail("UNKNOWN_OBLIGATION", "Evidence must target an existing exact obligation revision.");
      if (item.submittedBy !== event.actorId) fail("ACTOR_MISMATCH", "Evidence submitter must match the event actor.");
      text(item.description, "evidence description", 1_000); text(item.reference, "evidence reference", 1_000);
      if (item.fileFingerprint !== undefined) { try { validateFileFingerprint(item.fileFingerprint); } catch (error) { fail("INVALID_FILE_FINGERPRINT", error.message); } }
      evidence.set(item.id, clone(item));
      decisions.set(item.id, { acceptedAt: null, acceptedBy: null, revoked: false, openDisputeIds: [] });
    } else if (event.type === "evidence.accepted") {
      exactKeys(payload, ["evidenceId", "rationale"], "evidence.accepted payload");
      const item = evidence.get(payload.evidenceId); const state = decisions.get(payload.evidenceId);
      if (!item) fail("UNKNOWN_EVIDENCE", "Cannot accept unknown evidence.");
      if (state.revoked) fail("REVOKED_EVIDENCE", "Revoked evidence cannot be accepted.");
      if (state.acceptedAt) fail("DUPLICATE_DECISION", "Evidence already has a recorded acceptance.");
      if (item.obligationRevision !== obligations.get(item.obligationId).revision) fail("HISTORICAL_EVIDENCE", "Earlier-revision evidence cannot be accepted for the current commitment. Submit evidence for the current revision.");
      if (obligationVersions.get(item.obligationId + "@" + item.obligationRevision).reviewerId !== event.actorId) fail("REVIEWER_REQUIRED", "Only the declared reviewer can record acceptance.");
      text(payload.rationale, "acceptance rationale", 1_000);
      state.acceptedAt = event.at; state.acceptedBy = event.actorId;
    } else if (event.type === "evidence.disputed") {
      exactKeys(payload, ["evidenceId", "disputeId", "reason"], "evidence.disputed payload");
      if (!evidence.has(payload.evidenceId)) fail("UNKNOWN_EVIDENCE", "Cannot dispute unknown evidence.");
      id(payload.disputeId, "dispute id");
      if (disputes.has(payload.disputeId)) fail("DUPLICATE_ID", `Duplicate dispute id ${payload.disputeId}.`);
      text(payload.reason, "dispute reason", 1_000);
      disputes.set(payload.disputeId, { evidenceId: payload.evidenceId, openedBy: event.actorId, open: true });
      decisions.get(payload.evidenceId).openDisputeIds.push(payload.disputeId);
    } else if (event.type === "evidence.revoked") {
      exactKeys(payload, ["evidenceId", "reason"], "evidence.revoked payload");
      const item = evidence.get(payload.evidenceId); const state = decisions.get(payload.evidenceId);
      if (!item) fail("UNKNOWN_EVIDENCE", "Cannot revoke unknown evidence.");
      if (state.revoked) fail("DUPLICATE_DECISION", "Evidence is already revoked.");
      const reviewer = obligationVersions.get(item.obligationId + "@" + item.obligationRevision).reviewerId;
      if (event.actorId !== item.submittedBy && event.actorId !== reviewer) fail("ACTOR_FORBIDDEN", "Only the submitter or declared reviewer can revoke evidence.");
      text(payload.reason, "revocation reason", 1_000);
      state.revoked = true;
    } else if (event.type === "dispute.resolved") {
      exactKeys(payload, ["disputeId", "reason"], "dispute.resolved payload");
      const dispute = disputes.get(payload.disputeId);
      if (!dispute || !dispute.open) fail("UNKNOWN_DISPUTE", "Dispute must exist and be open.");
      if (dispute.openedBy !== event.actorId) fail("ACTOR_FORBIDDEN", "Only the declarer can resolve this local dispute.");
      text(payload.reason, "resolution reason", 1_000);
      dispute.open = false;
      const list = decisions.get(dispute.evidenceId).openDisputeIds;
      decisions.get(dispute.evidenceId).openDisputeIds = list.filter(value => value !== payload.disputeId);
    } else if (event.type === "amendment.proposed") {
      exactKeys(payload, ["amendment"], "amendment.proposed payload");
      const amendment = payload.amendment;
      exactKeys(amendment, ["id", "baseRevision", "obligation", "reason"], "amendment");
      id(amendment.id, "amendment id"); text(amendment.reason, "amendment reason", 1_000);
      if (amendments.has(amendment.id)) fail("DUPLICATE_ID", "An amendment with this id already exists.");
      const current = obligations.get(amendment.obligation?.id);
      if (!current || amendment.baseRevision !== current.revision) fail("STALE_AMENDMENT", "The proposal must identify the current commitment revision.");
      if ([...amendments.values()].some(a => a.obligation.id === current.id && a.status === "pending")) fail("AMENDMENT_PENDING", "Review or withdraw the existing proposal before proposing another amendment.");
      replacementAllocation(project, obligations, allocated, amendment.obligation);
      amendments.set(amendment.id, { ...clone(amendment), proposedBy: event.actorId, proposedAt: event.at,
        status: "pending", reviews: [], closedAt: null, closedBy: null });
    } else {
      const isReview = event.type === "amendment.reviewed";
      const isWithdrawal = event.type === "amendment.withdrawn";
      exactKeys(payload, isReview ? ["amendmentId", "decision", "reason"] : isWithdrawal ? ["amendmentId", "reason"] : ["amendmentId"], event.type + " payload");
      const amendment = amendments.get(payload.amendmentId);
      if (!amendment || amendment.status !== "pending") fail("AMENDMENT_NOT_PENDING", "This amendment is no longer awaiting review.");
      const current = obligations.get(amendment.obligation.id);
      if (current.revision !== amendment.baseRevision) fail("STALE_AMENDMENT", "The commitment changed after this proposal.");
      if (isReview) {
        if (!["accept", "reject"].includes(payload.decision)) fail("INVALID_DECISION", "Record acceptance or rejection of the exact proposed terms.");
        text(payload.reason, "amendment review reason", 1_000);
        if (amendment.reviews.some(review => review.actorId === event.actorId) && payload.decision !== "reject") fail("DUPLICATE_DECISION", "This party already recorded acceptance. It may still record a rejection before application.");
        amendment.reviews.push({ actorId: event.actorId, decision: payload.decision, reason: payload.reason, at: event.at });
        if (payload.decision === "reject") { amendment.status = "rejected"; amendment.closedAt = event.at; amendment.closedBy = event.actorId; }
      } else if (isWithdrawal) {
        if (event.actorId !== amendment.proposedBy) fail("ACTOR_FORBIDDEN", "Only the recorded proposer can withdraw this amendment.");
        text(payload.reason, "withdrawal reason", 1_000);
        amendment.status = "withdrawn"; amendment.closedAt = event.at; amendment.closedBy = event.actorId; amendment.withdrawalReason = payload.reason;
      } else {
        const accepted = new Set(amendment.reviews.filter(review => review.decision === "accept").map(review => review.actorId));
        if (!project.parties.every(party => accepted.has(party.id))) fail("AMENDMENT_REVIEW_REQUIRED", "Record every declared party's review of these exact proposed terms before applying the revision.");
        allocated = replacementAllocation(project, obligations, allocated, amendment.obligation);
        obligations.set(amendment.obligation.id, clone(amendment.obligation));
        obligationVersions.set(amendment.obligation.id + "@" + amendment.obligation.revision, clone(amendment.obligation));
        amendment.status = "adopted"; amendment.closedAt = event.at; amendment.closedBy = event.actorId;
      }
    }
  }
  return { obligations, obligationVersions, amendments, evidence, decisions, disputes, lastAt, allocated };
}

export function validateProject(input) {
  const project = clone(input);
  exactKeys(project, ["format", "id", "title", "currency", "budgetMinor", "source", "parties", "createdAt", "events"], "project");
  if (![FORMAT, AMENDMENT_FORMAT, SOURCE_RANGES_FORMAT].includes(project.format)) fail("UNSUPPORTED_FORMAT", "Unsupported PACT project format.");
  id(project.id, "project id"); text(project.title, "title", 200); minor(project.budgetMinor, "budgetMinor");
  if (project.currency !== "USD") fail("UNSUPPORTED_CURRENCY", "This baseline supports USD only.");
  exactKeys(project.source, ["id", "revision", "text", "file"], "source");
  if (project.source.file !== undefined) {
    exactKeys(project.source.file, ["fingerprint", "textEdited"], "source file");
    try { validateFileFingerprint(project.source.file.fingerprint); } catch (error) { fail("INVALID_FILE_FINGERPRINT", error.message); }
    if (typeof project.source.file.textEdited !== "boolean") fail("INVALID_SOURCE_FILE", "Source file must say whether its extracted text was edited.");
  }
  id(project.source.id, "source id"); if (project.source.revision !== 1) fail("UNSUPPORTED_REVISION", "Only source revision 1 is supported.");
  text(project.source.text, "source text", LIMITS.source); instant(project.createdAt, "createdAt");
  if (!Array.isArray(project.parties) || project.parties.length < 2 || project.parties.length > 8) fail("INVALID_PARTIES", "Record between two and eight declared parties.");
  const partyIds = new Set();
  for (const party of project.parties) { exactKeys(party, ["id", "name"], "party"); id(party.id, "party id"); text(party.name, "party name", 120); if (partyIds.has(party.id)) fail("DUPLICATE_ID", `Duplicate party id ${party.id}.`); partyIds.add(party.id); }
  if (!Array.isArray(project.events) || project.events.length > LIMITS.events) fail("EVENT_LIMIT", `At most ${LIMITS.events} events are supported.`);
  if (project.format === FORMAT && project.events.some(event => AMENDMENT_TYPES.has(event.type))) fail("UNSUPPORTED_FORMAT", "Amendments require the v2 project format.");
  const state = replay(project);
  if (state.obligations.size > LIMITS.obligations || state.evidence.size > LIMITS.evidence) fail("RECORD_LIMIT", "Project record limit exceeded.");
  if (new TextEncoder().encode(`${JSON.stringify(project, null, 2)}\n`).byteLength > MAX_SERIALIZED_BYTES) fail("PROJECT_SIZE", "Project exceeds the 16 MiB portable export limit.");
  return project;
}

export function appendEvent(projectInput, eventInput) {
  const project = validateProject(projectInput);
  const event = clone(eventInput);
  event.seq = project.events.length + 1;
  const citation = event.type === "obligation.added" ? event.payload?.obligation?.citation
    : event.type === "amendment.proposed" ? event.payload?.amendment?.obligation?.citation : null;
  const format = project.format === SOURCE_RANGES_FORMAT || citation?.related !== undefined
    ? SOURCE_RANGES_FORMAT : AMENDMENT_TYPES.has(event.type) ? AMENDMENT_FORMAT : project.format;
  const candidate = { ...project, format, events: [...project.events, event] };
  return validateProject(candidate);
}

export function evaluateProject(projectInput, asOf) {
  const project = validateProject(projectInput);
  instant(asOf, "asOf");
  const state = replay(project);
  if (asOf < state.lastAt) fail("HISTORICAL_EVALUATION", "Evaluation time cannot precede the latest recorded event.");
  return evaluateState(project, state, asOf);
}

function evaluateState(project, state, asOf) {
  const result = new Map();
  const evaluate = obligation => {
    if (result.has(obligation.id)) return result.get(obligation.id);
    for (const dependency of obligation.dependsOn) evaluate(state.obligations.get(dependency));
    const related = [...state.evidence.values()].filter(item => item.obligationId === obligation.id);
    const valid = related.filter(item => { const decision = state.decisions.get(item.id); return item.obligationRevision === obligation.revision && decision.acceptedAt && !decision.revoked; });
    const open = related.flatMap(item => state.decisions.get(item.id).openDisputeIds);
    const dependencyBlockers = obligation.dependsOn.filter(dep => result.get(dep)?.readiness !== "ready-for-human-review");
    const blockers = [];
    if (!valid.length) blockers.push("NO_VALID_ACCEPTED_EVIDENCE");
    if (open.length) blockers.push("OPEN_DISPUTE");
    if (dependencyBlockers.length) blockers.push("DEPENDENCY_NOT_READY");
    let deadlineState = "none";
    if (obligation.dueAt) {
      const acceptedTimes = valid.map(item => state.decisions.get(item.id).acceptedAt);
      if (acceptedTimes.length) deadlineState = acceptedTimes.some(value => value <= obligation.dueAt) ? "accepted-on-time" : "accepted-late";
      else deadlineState = asOf < obligation.dueAt ? "upcoming" : asOf === obligation.dueAt ? "due" : "overdue";
    }
    result.set(obligation.id, {
      obligationId: obligation.id,
      readiness: blockers.length ? "blocked" : "ready-for-human-review",
      blockers, dependencyBlockers, validEvidenceIds: valid.map(item => item.id), openDisputeIds: open,
      deadlineState, amountMinor: obligation.amountMinor, currency: project.currency,
      executable: false, authorization: "not-verified"
    });
    return result.get(obligation.id);
  };
  const obligations = [...state.obligations.values()].map(evaluate);
  const readyMinor = obligations.filter(item => item.readiness === "ready-for-human-review").reduce((sum, item) => sum + item.amountMinor, 0);
  return {
    asOf, obligations,
    totals: { budgetMinor: project.budgetMinor, allocatedMinor: state.allocated, readyMinor, blockedMinor: state.allocated - readyMinor, unallocatedMinor: project.budgetMinor - state.allocated, currency: project.currency, executedMinor: 0 },
    mode: "non-executing-local-simulation", executable: false, authorization: "not-verified"
  };
}

export function projectView(projectInput) {
  const project = validateProject(projectInput); const state = replay(project);
  return {
    project,
    obligations: [...state.obligations.values()],
    obligationVersions: [...state.obligationVersions.values()],
    amendments: [...state.amendments.values()].map(amendment => ({ ...clone(amendment),
      requiredPartyIds: project.parties.map(party => party.id),
      awaitingPartyIds: project.parties.filter(party => amendment.reviews.findLast(review => review.actorId === party.id)?.decision !== "accept").map(party => party.id) })),
    evidence: [...state.evidence.values()].map(item => ({ ...item, decision: clone(state.decisions.get(item.id)) })),
    disputes: [...state.disputes.entries()].map(([idValue, value]) => ({ id: idValue, ...value }))
  };
}

export function importProject(serialized) {
  if (typeof serialized !== "string" || new TextEncoder().encode(serialized).byteLength > MAX_SERIALIZED_BYTES) fail("IMPORT_SIZE", "Import must be a JSON file no larger than 16 MiB.");
  let parsed;
  try { parsed = JSON.parse(serialized); } catch { fail("INVALID_JSON", "Import is not valid JSON."); }
  return validateProject(parsed);
}

export const exportProject = project => `${JSON.stringify(validateProject(project), null, 2)}\n`;

// Resolve display names without rewriting original declarations or earlier events.
export function partyNames(project, throughSequence = Infinity) {
  const parties = structuredClone(project.parties);
  for (const event of project.events) {
    if (event.seq > throughSequence) break;
    if (event.type === "party.name-corrected") {
      const party = parties.find(p => p.id === event.payload.partyId);
      if (party) party.name = event.payload.name;
    }
  }
  return parties;
}

/** Compare a possible replacement without appending a proposal, review or adoption. */
export function previewAmendment(projectInput, candidateInput, asOf) {
  const project = validateProject(projectInput), candidate = clone(candidateInput);
  instant(asOf, "asOf");
  const state = replay(project);
  if (asOf < state.lastAt) fail("HISTORICAL_EVALUATION", "Evaluation time cannot precede the latest recorded event.");
  const candidateProject=candidate.citation?.related!==undefined?{...project,format:SOURCE_RANGES_FORMAT}:project;
  const nextAllocated = replacementAllocation(candidateProject, state.obligations, state.allocated, candidate);
  const before = evaluateState(project, state, asOf);
  const previous = clone(state.obligations.get(candidate.id));
  const proposedState = { ...state, obligations: new Map(state.obligations), allocated: nextAllocated };
  proposedState.obligations.set(candidate.id, candidate);
  const after = evaluateState(project, proposedState, asOf);
  const changed = after.obligations.filter(item => {
    const old = before.obligations.find(row => row.obligationId === item.obligationId);
    return item.obligationId === candidate.id || JSON.stringify(old) !== JSON.stringify(item);
  }).map(item => ({ before: before.obligations.find(row => row.obligationId === item.obligationId), after: item }));
  return { previous, candidate, before, after, changed,
    historicalEvidenceIds: [...state.evidence.values()].filter(item => item.obligationId === candidate.id && item.obligationRevision === previous.revision).map(item => item.id),
    baseSnapshot: exportProject(project) };
}
