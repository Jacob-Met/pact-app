import { revealWorkspaceTarget } from "./workspace-views.mjs";
import { buildAuditTrail } from "./audit-trail.mjs";

function el(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = value;
  return node;
}
function button(label, action) {
  const node = el("button", "network-link", label); node.type = "button";
  node.addEventListener("click", action); return node;
}

export function mountAuditTrail(root, { revealCommitment, revealAmendment }) {
  const back = button("", () => {
    const target = returnTarget; back.hidden = true; returnTarget = null;
    revealWorkspaceTarget(target);
    target?.focus({ preventScroll: true }); target?.scrollIntoView({ block: "center" });
  });
  back.className = "audit-return"; back.hidden = true; const navigation = document.querySelector(".workspace-navigation"); if (navigation) navigation.after(back); else root.after(back);
  let returnTarget = null;
  function remember(item, event) {
    returnTarget = item; back.textContent = "Back to audit event #" + event.seq; back.hidden = false;
  }
  function revealEvidence(id) {
    const card = [...document.querySelectorAll("[data-evidence-id]")].find(node => node.dataset.evidenceId === id);
    if (!card) return false;
    for (let parent = card.parentElement; parent; parent = parent.parentElement) if (parent.tagName === "DETAILS") parent.open = true;
    revealWorkspaceTarget(card);
    card.focus({ preventScroll: true }); card.scrollIntoView({ block: "center" }); return true;
  }
  return {
    update(view) {
      back.hidden = true; returnTarget = null; root.replaceChildren();
      if (!view.project.events.length) { root.append(el("li", "muted", "No events yet.")); return; }
      for (const row of buildAuditTrail(view)) {
        const { event, obligation, evidence, amendment } = row;
        const item = el("li", "audit-entry"); item.tabIndex = -1; item.dataset.auditEvent = event.id;
        item.append(el("p", "audit-action", row.action),
          el("h3", "audit-subject", obligation ? obligation.title + " · revision " + obligation.revision : row.subject ?? "Unrecognized record"),
          el("small", "audit-attribution", "#" + event.seq + " · " + event.at + " · authored by " + row.actor));
        if (evidence) item.append(el("p", "audit-evidence", evidence.description),
          el("p", "audit-reference", "Reference: " + evidence.reference));
        if (row.reason) item.append(el("p", "audit-reason", row.reason));
        const actions = el("div", "audit-actions");
        if (evidence) actions.append(button("View evidence", () => { if (revealEvidence(evidence.id)) remember(item, event); }));
        if (amendment) actions.append(button("View amendment", () => { revealAmendment(obligation.id, amendment.id); }));
        if (obligation) actions.append(button("View current commitment", () => { if (revealCommitment(obligation.id)) remember(item, event); }));
        if (actions.children.length) item.append(actions);
        const identifiers = el("details", "audit-identifiers");
        identifiers.append(el("summary", "", "Record identifiers"));
        const list = el("dl");
        for (const [name, value] of [["Event", event.id], ["Type", event.type], ["Party", row.partyId], ["Commitment", obligation?.id],
          ["Evidence", evidence?.id], ["Dispute", row.disputeId], ["Amendment", amendment?.id]]) {
          if (value) list.append(el("dt", "", name), el("dd", "", value));
        }
        identifiers.append(list); item.append(identifiers); root.append(item);
      }
    }
  };
}
