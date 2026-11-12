import { citationPassages } from "./source-citations.mjs";
import { commitDecisionReview, previewEvidenceDecision } from "./decision-review.mjs";
import { formatUsdMinor } from "./ui-utils.mjs";
import { renderCitationExcerpts } from "./citation-view.mjs";

const labels = {
  "evidence.accepted": { title: "Review acceptance", action: "Record acceptance" },
  "evidence.disputed": { title: "Review dispute", action: "Record dispute" },
  "evidence.revoked": { title: "Review revocation", action: "Revoke evidence" },
  "dispute.resolved": { title: "Review dispute resolution", action: "Resolve dispute" }
};
const readiness = state => state.readiness === "ready-for-human-review" ? "Ready for human review" : "Blocked";
const deadlines = {
  none: "", upcoming: "Deadline upcoming", due: "Deadline reached", overdue: "Deadline passed",
  "accepted-on-time": "Acceptance on time", "accepted-late": "Acceptance after deadline"
};

export function mountDecisionReview({ document, getProject, createEvent, onCommit }) {
  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const dialog = make("dialog", "decision-review");
  dialog.id = "decision-review";
  dialog.setAttribute("aria-labelledby", "decision-review-title");
  dialog.setAttribute("aria-describedby", "decision-review-scope");
  const header = make("header", "decision-review-header");
  const title = make("h2"); title.id = "decision-review-title"; title.tabIndex = -1;
  const scope = make("p", "", "Review the authored criterion and the submitted material before recording a local decision.");
  scope.id = "decision-review-scope";
  const headline = make("p", "decision-review-headline");
  const permanence = make("p", "decision-review-permanence");
  permanence.textContent = "Permanent revocation. A replacement requires a new evidence record.";
  permanence.hidden = true;
  header.append(title, headline, scope, permanence);
  const body = make("div", "decision-review-body");
  const error = make("p", "decision-review-error"); error.id = "decision-review-error";
  error.setAttribute("role", "alert"); error.tabIndex = -1; error.hidden = true;
  const footer = make("footer", "decision-review-footer");
  const acknowledgement = make("label", "decision-review-ack");
  const check = make("input"); check.type = "checkbox"; check.id = "decision-review-ack";
  acknowledgement.append(check, make("span", "", "I intend to record that this evidence satisfies the completion criterion above."));
  const actions = make("div", "decision-review-actions");
  const cancel = make("button", "", "Cancel"); cancel.type = "button"; cancel.id = "decision-review-cancel";
  const confirm = make("button", "primary"); confirm.type = "button"; confirm.id = "decision-review-confirm";
  actions.append(cancel, confirm);
  footer.append(acknowledgement, actions);
  dialog.append(header, body, error, footer);
  document.body.append(dialog);

  let review = null;
  let returnFocus = null;
  let returnEvidenceId = null;

  function blockers(state, names) {
    const parts = [];
    if (state.blockers.includes("NO_VALID_ACCEPTED_EVIDENCE")) parts.push("No valid recorded acceptance");
    if (state.blockers.includes("OPEN_DISPUTE")) parts.push("Open dispute");
    if (state.blockers.includes("DEPENDENCY_NOT_READY")) {
      parts.push("Waiting for " + state.dependencyBlockers.map(id => names[id] ?? id).join(", "));
    }
    return parts.join("; ");
  }

  function renderReview(value) {
    const label = labels[value.event.type];
    title.textContent = label.title + ": " + value.obligation.title;
    headline.replaceChildren(make("strong", "", formatUsdMinor(value.before.totals.readyMinor) + " → " + formatUsdMinor(value.after.totals.readyMinor)),
      make("span", "", "illustrative value ready for human review"));
    const newlyReady = value.rows.filter(row => row.before.readiness !== row.after.readiness && row.after.readiness === "ready-for-human-review");
    const newlyBlocked = value.rows.filter(row => row.before.readiness !== row.after.readiness && row.after.readiness === "blocked");
    const consequences = [];
    if (newlyReady.length) consequences.push(newlyReady.length + (newlyReady.length === 1 ? " obligation becomes ready: " : " obligations become ready: ") + newlyReady.map(row => row.obligation.title).join("; ") + ".");
    if (newlyBlocked.length) consequences.push(newlyBlocked.length + (newlyBlocked.length === 1 ? " obligation becomes blocked: " : " obligations become blocked: ") + newlyBlocked.map(row => row.obligation.title).join("; ") + ".");
    scope.textContent = consequences.join(" ") || "No obligations change readiness. The detailed comparison remains below.";
    permanence.hidden = value.event.type !== "evidence.revoked";
    body.replaceChildren(); error.hidden = true;
    check.checked = false;
    acknowledgement.hidden = value.event.type !== "evidence.accepted";
    confirm.disabled = !acknowledgement.hidden;
    confirm.className = value.event.type === "evidence.revoked" || value.event.type === "evidence.disputed" ? "danger" : "primary";
    confirm.textContent = label.action + " as " + value.actor.name;
    const proof = make("div", "decision-review-proof");
    const criterion = make("section");
    criterion.append(make("h3", "", "Completion criterion"), make("p", "decision-review-criterion", value.obligation.criterion));
    const passages=citationPassages(value.obligation.citation);
    criterion.append(make("h4", "", "Cited agreement text"),
      renderCitationExcerpts(document,value.obligation.citation,passages).root);
    if (value.obligation.revision > 1) criterion.append(make("p", "decision-review-provenance",
      "This citation is retained from the agreement. The recorded amendment sets the terms and reviewer for commitment revision " + value.obligation.revision + "."));
    const evidence = make("section");
    evidence.append(make("h3", "", "Submitted evidence"), make("p", "decision-review-evidence", value.evidence.description),
      make("p", "decision-review-reference", "Reference: " + value.evidence.reference));
    proof.append(criterion, evidence);
    body.append(proof);
    const decision = make("section", "decision-review-record");
    decision.append(make("h3", "", "Decision to record"), make("p", "decision-review-actor", "Attributed to " + value.actor.name),
      make("p", "decision-review-reason", value.reason));
    body.append(decision);
    if (value.event.type === "evidence.revoked") {
      body.append(make("p", "decision-review-terminal", "Revocation is permanent in this record. This evidence cannot be accepted again. Submit new evidence if you need a replacement."));
    }
    const effects = make("section", "decision-review-effects");
    effects.append(make("h3", "", "Effect on these obligations"));
    const headings = make("div", "decision-review-row-head");
    headings.append(make("span", "", "Obligation"), make("span", "", "Before"), make("span", "", "After this decision"));
    headings.setAttribute("aria-hidden", "true");
    effects.append(headings);
    const list = make("ul", "decision-review-rows"); list.id = "decision-review-effects";
    for (const row of value.rows) {
      const item = make("li", "decision-review-row");
      item.dataset.obligationId = row.obligation.id;
      const name = make("div", "decision-review-row-name");
      name.append(make("strong", "", row.obligation.title), make("span", "", formatUsdMinor(row.obligation.amountMinor)),
        make("small", "", row.direct ? "This evidence" : "Dependent obligation"));
      item.append(name);
      for (const [when, state] of [["Before", row.before], ["After this decision", row.after]]) {
        const cell = make("div", "decision-review-state");
        cell.append(make("span", "decision-review-mobile-label", when),
          make("strong", state.readiness === "ready-for-human-review" ? "decision-ready" : "decision-blocked", readiness(state)));
        const reason = blockers(state, value.obligationNames);
        if (reason) cell.append(make("small", "", reason));
        if (state.deadlineState !== "none") cell.append(make("small", "", deadlines[state.deadlineState]));
        item.append(cell);
      }
      list.append(item);
    }
    effects.append(list, make("small", "decision-review-time", "Both sides evaluated at " + value.after.asOf));
    body.append(effects, make("p", "decision-review-limit", "This records a local decision. It does not verify delivery, authenticate the named person or authorize a payment."));
  }

  check.addEventListener("change", () => { if (review?.event.type === "evidence.accepted") confirm.disabled = !check.checked; });
  cancel.addEventListener("click", () => dialog.close("cancel"));
  dialog.addEventListener("close", () => {
    review = null;
    const fallback = returnEvidenceId
      ? document.querySelector('[data-evidence-id="' + returnEvidenceId + '"]')
      : null;
    if (returnFocus?.isConnected) returnFocus.focus();
    else fallback?.focus({ preventScroll: true });
    returnFocus = null; returnEvidenceId = null;
  });
  confirm.addEventListener("click", () => {
    if (!review || (review.event.type === "evidence.accepted" && !check.checked)) return;
    try {
      const result = commitDecisionReview(getProject(), review, new Date().toISOString());
      if (result.status === "changed") {
        review = result.review; renderReview(review);
        error.textContent = "Time changed the projected result while you reviewed. Check the updated effects before recording.";
        error.hidden = false; error.focus(); return;
      }
      review = null;
      dialog.close("recorded");
      onCommit(result.project, result.event);
    } catch (failure) {
      error.textContent = failure.message;
      error.hidden = false; confirm.disabled = true; error.focus();
    }
  });

  return {
    open(type, actorId, payload) {
      const value = previewEvidenceDecision(getProject(), createEvent(type, actorId, payload));
      review = value;
      returnFocus = document.activeElement;
      returnEvidenceId = value.evidence.id;
      renderReview(value);
      dialog.returnValue = "";
      dialog.showModal();
      dialog.scrollTop = 0;
      title.focus({ preventScroll: true });
    }
  };
}
