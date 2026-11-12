import { partyNames } from "./core.mjs";
import { appendEvent, evaluateProject, exportProject, PactError, projectView } from "./core.mjs";

const decisions = new Set(["evidence.accepted", "evidence.disputed", "evidence.revoked", "dispute.resolved"]);

// A projection uses the real replay/evaluator at one instant on both sides.
// It does not decide whether the submitted material satisfies the authored words.
export function previewEvidenceDecision(project, event) {
  if (!decisions.has(event.type)) throw new PactError("REVIEW_DECISION", "Choose an evidence decision to review.");
  const candidate = appendEvent(project, event);
  const recordedEvent = candidate.events.at(-1);
  const view = projectView(project);
  const evidenceId = event.type === "dispute.resolved"
    ? view.disputes.find(item => item.id === event.payload.disputeId)?.evidenceId
    : event.payload.evidenceId;
  const evidence = view.evidence.find(item => item.id === evidenceId);
  const obligation = view.obligationVersions.find(item => item.id === evidence.obligationId && item.revision === evidence.obligationRevision);
  const before = evaluateProject(project, recordedEvent.at);
  const after = evaluateProject(candidate, recordedEvent.at);
  const beforeById = new Map(before.obligations.map(item => [item.obligationId, item]));
  const afterById = new Map(after.obligations.map(item => [item.obligationId, item]));
  const affected = new Set([obligation.id]);
  // Amendments may connect to later-authored commitments; traverse to closure.
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of view.obligations) if (!affected.has(item.id) && item.dependsOn.some(id => affected.has(id))) {
      affected.add(item.id); changed = true;
    }
  }
  const rows = view.obligations.filter(item => affected.has(item.id)).map(item => ({
    obligation: item,
    direct: item.id === obligation.id,
    before: beforeById.get(item.id),
    after: afterById.get(item.id)
  }));
  return {
    event: recordedEvent,
    base: exportProject(project),
    candidate, evidence, obligation, rows, before, after,
    actor: partyNames(project, recordedEvent.seq - 1).find(item => item.id === recordedEvent.actorId),
    reason: recordedEvent.payload.rationale ?? recordedEvent.payload.reason,
    obligationNames: Object.fromEntries(view.obligations.map(item => [item.id, item.title]))
  };
}

function effectSignature(review) {
  return JSON.stringify({
    rows: review.rows.map(row => ({ id: row.obligation.id, before: row.before, after: row.after })),
    before: review.before.totals,
    after: review.after.totals
  });
}

// Confirmation uses its actual timestamp. If a deadline changed the result during
// review, return the refreshed projection for a second look instead of recording it.
export function commitDecisionReview(project, review, at) {
  if (exportProject(project) !== review.base) {
    throw new PactError("REVIEW_STALE", "The agreement history changed while this review was open. Cancel and review the decision again.");
  }
  const fresh = previewEvidenceDecision(project, { ...review.event, at });
  if (effectSignature(fresh) !== effectSignature(review)) return { status: "changed", review: fresh };
  return { status: "recorded", project: fresh.candidate, event: fresh.event };
}
