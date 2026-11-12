// A read-only projection of validated records. Historical titles are resolved
// through the exact obligation revision; later amendments never rewrite history.
export function buildAuditTrail(view) {
  const versions = new Map(view.obligationVersions.map(item => [item.id + "@" + item.revision, item]));
  const evidence = new Map(view.evidence.map(item => [item.id, item]));
  const amendments = new Map(view.amendments.map(item => [item.id, item]));
  const disputes = new Map(view.disputes.map(item => [item.id, item]));
  const parties = new Map(view.project.parties.map(item => [item.id, item.name]));
  return view.project.events.map(event => {
    const p = event.payload;
    const proof = event.type === "evidence.submitted" ? p.evidence
      : evidence.get(p.evidenceId ?? disputes.get(p.disputeId)?.evidenceId);
    const amendment = event.type === "amendment.proposed" ? p.amendment : amendments.get(p.amendmentId);
    const obligation = p.obligation ?? amendment?.obligation
      ?? (proof && versions.get(proof.obligationId + "@" + proof.obligationRevision));
    const actions = {
      "party.name-corrected": "Corrected party name",
      "obligation.added": "Added commitment",
      "evidence.submitted": "Submitted evidence",
      "evidence.accepted": "Recorded acceptance",
      "evidence.disputed": "Opened dispute",
      "evidence.revoked": "Revoked evidence",
      "dispute.resolved": "Resolved dispute",
      "amendment.proposed": "Proposed amendment",
      "amendment.reviewed": p.decision === "reject" ? "Recorded amendment rejection" : "Recorded amendment acceptance",
      "amendment.withdrawn": "Withdrew amendment",
      "amendment.adopted": "Applied amendment"
    };
    const actor = parties.get(event.actorId) ?? event.actorId;
    if (event.type === "party.name-corrected") parties.set(p.partyId, p.name);
    return {
      event, action: actions[event.type] ?? event.type,
      actor,
      subject: event.type === "party.name-corrected" ? p.previousName + " → " + p.name : null,
      partyId: p.partyId ?? null,
      obligation: obligation ?? null, evidence: proof ?? null, amendment: amendment ?? null,
      reason: p.rationale ?? p.reason ?? (event.type === "amendment.proposed" ? p.amendment.reason : ""),
      disputeId: p.disputeId ?? null
    };
  });
}
