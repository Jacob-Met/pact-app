import { sourceEnclosingSection, sourceSectionIndex } from "./source-references.mjs";
import { setCitationQuote, capturedSourceSections, subtractCapturedPassages } from "./citation-view.mjs";
import {mountOrganizerAccess} from "./organizer-access-ui.mjs";
import { mountAgreementFile } from "./agreement-file-ui.mjs";
import { mountSharedReviews } from "./shared-owner.mjs";
import { mountWorkspaceViews, revealWorkspaceTarget } from "./workspace-views.mjs";
import { mountEvidenceFile, renderEvidenceFile, deliveryReferenceUrl } from './evidence-file.mjs';
import { LIMITS, partyNames, appendEvent, createProject, evaluateProject, exportProject, importProject, MAX_SERIALIZED_BYTES, projectView } from "./core.mjs";
import { mountSourcePassages, sourceSelection, sourceViewRange } from "./source-passages.mjs";
import { mountSourceReferences } from "./source-references-ui.mjs";
import { captureSourceCitation, citationPassages, citationPassagesText, citationText, citationDraftFields, citationFromDraft } from "./source-citations.mjs";
import { formatUsdMinor, formatUtcControl, parseUtcControl } from "./ui-utils.mjs";
import { mountPaymentPanel } from "./payment-ui.mjs";
import { mountObligationNetwork } from "./obligation-network.mjs";
import { mountRecovery, captureDrafts, restoreDrafts } from "./recovery-ui.mjs";
import { exportWorkspace, importWorkspace, isWorkspaceFormat, MAX_RECOVERY_BYTES } from "./tab-recovery.mjs";
import { declaredParties } from "./participants.mjs";
import { mountDecisionReview } from "./decision-review-ui.mjs";
import { buildAuditTrail } from "./audit-trail.mjs";
import { mountAuditTrail } from "./audit-trail-ui.mjs";
import { mountAmendments } from "./amendment-ui.mjs";
import { exportReadableReview } from "./review-export.mjs";
import { importReviewCopy } from "./import-review.mjs";
import { previewHistoryMerge, commitHistoryMerge } from "./history-merge.mjs";

const $ = selector => document.querySelector(selector);
const obligationNetwork = mountObligationNetwork($("#obligation-network"), $("#source-view"), {
  onAmendment: (id, amendmentId) => amendments.open(id, amendmentId),
  getDraftCitation: () => {
    // A stale or invalid draft never paints as captured source; its ordinary
    // validation/recovery path still owns refusal and keeps the draft intact.
    try { return readCapturedCitation(); } catch { return null; }
  },
  hasCitation: () => Boolean($("#obligation-form").elements.citationQuote.value),
  onCapture: (range, options) => run(() => {
    if (range.sourceId !== project.source.id || range.sourceRevision !== project.source.revision)
      throw Error("The agreement changed. Select its current wording again.");
    captureSource({start:range.start, end:range.end, quote:range.quote}, {...options, focusTitle:false});
    revealWorkspaceTarget($("#obligation-form"));
    const form = $("#obligation-form");
    form.tabIndex = -1;
    form.focus({preventScroll:true});
    form.scrollIntoView({block:"start",behavior:"instant"});
    return true;
  })
});
const passagePicker = mountSourcePassages({ document, mountReferences:mountSourceReferences, searchScope:sourceEnclosingSection, sourceView: $("#source-view"), hasCitation: () => Boolean($("#obligation-form").elements.citationQuote.value), onCapture: (range, options) => run(() => captureSource(range, options)) });
document.addEventListener("pact-drafts-restored", () => {
  const form = $("#obligation-form");
  paintCitation(readCapturedCitation());
  showCriterion({reading:true});
  if (project) {
    try { lastEvaluation = evaluateProject(project, parseUtcControl($("#evaluate-form [name=asOf]").value)); }
    catch { lastEvaluation = null; }
    render();
  }
});
const criterionField = $("#obligation-form [name=criterion]");
const criterionReadingView = $("#criterion-reading"), criterionMode = $("#criterion-mode");
let criterionReading = false;
criterionField.maxLength = LIMITS.criterion;
function showCriterion({reading = criterionReading, focus = false, reset = false} = {}) {
  const hasWording = Boolean(criterionField.value.trim());
  criterionReading = Boolean(reading && hasWording);
  criterionField.hidden = criterionReading;
  criterionReadingView.hidden = !criterionReading;
  criterionMode.hidden = !hasWording;
  criterionMode.textContent = criterionReading ? "Edit wording" : "Read criterion";
  if (criterionReading) {
    setCitationQuote(document, criterionReadingView, criterionField.value);
    if (reset) criterionReadingView.scrollTop = 0;
  } else { criterionReadingView.replaceChildren(); fitCriterion(); }
  if (focus) {
    (criterionReading ? criterionReadingView : criterionField).focus();
    if (!criterionReading) { criterionField.setSelectionRange(0,0); criterionField.scrollTop=0; }
  }
}
criterionMode.addEventListener("click", () => showCriterion({reading:!criterionReading,focus:true}));
criterionField.addEventListener("invalid", () => showCriterion({reading:false}));
function fitCriterion() {
  if (!criterionField.clientWidth) return;
  criterionField.style.height = "auto";
  criterionField.style.height = Math.min(420, criterionField.scrollHeight + 2) + "px";
}
criterionField.addEventListener("input", () => showCriterion({reading:false}));
let criterionWidth = 0;
new ResizeObserver(([entry]) => {
  if (entry.contentRect.width !== criterionWidth) { criterionWidth = entry.contentRect.width; fitCriterion(); }
}).observe(criterionField);
const evidenceFile = mountEvidenceFile($("#evidence-form"));
const auditTrail = mountAuditTrail($("#audit-list"), { revealCommitment: id => obligationNetwork.reveal(id), revealAmendment: (id, amendmentId) => amendments.open(id, amendmentId) });
const setup = $("#setup");
const workbench = $("#workbench");
const workspaceViews = mountWorkspaceViews(workbench);
const statusBox = $("#status");
const errorBox = $("#error");
const dialog = $("#confirm-dialog");
let project = null;
let lastEvaluation = null;
let importToken = 0;
let pendingAction = null;
let recoveryPanel = null;
let sampleBaseline = null;
const SAMPLE_ID = "project-1794334484011";
function isPristineSample() {
  return Boolean(sampleBaseline && project?.id === SAMPLE_ID && exportProject(project) === sampleBaseline.project && JSON.stringify(captureDrafts(document)) === sampleBaseline.drafts);
}
let sharedReviewPanel = null;

function show(box, message) {
  box.textContent = message;
  box.hidden = false;
  if (box === errorBox) box.focus?.();
}
function clearMessages() { statusBox.hidden = true; errorBox.hidden = true; }
function run(action) {
  clearMessages();
  try { return action(); } catch (error) { show(errorBox, `${error.code ? `${error.code}: ` : ""}${error.message}`); return undefined; }
  finally { recoveryPanel?.save(); }
}
function now() { return new Date().toISOString(); }
function moneyToMinor(value) {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim())) throw new Error("Amounts must use dollars with at most two decimal places.");
  const [whole, fraction = ""] = value.trim().split(".");
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(amount)) throw new Error("Amount is too large.");
  return amount;
}
const dollars = formatUsdMinor;
const partyName = partyId => partyNames(project).find(p => p.id === partyId)?.name ?? partyId;
const eventId = () => `event-${project.events.length + 1}-${Date.now()}`;
const recordId = prefix => `${prefix}-${project.events.length + 1}-${Date.now()}`;
function add(type, actorId, payload) {
  const at = now();
  project = appendEvent(project, { id: eventId(), seq: 0, at, actorId, type, payload });
  lastEvaluation = null;
  $("#evaluate-form [name=asOf]").value = formatUtcControl(at);
  render();
}
function el(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = value;
  return node;
}
function button(label, onClick, className = "") {
  const node = el("button", className, label); node.type = "button"; node.addEventListener("click", onClick); return node;
}
function options(select, values, placeholder) {
  const selected = select.value;
  select.replaceChildren();
  if (placeholder) { const option = el("option", "", placeholder); option.value = ""; select.append(option); }
  values.forEach(({ value, label }) => { const option = el("option", "", label); option.value = value; select.append(option); });
  if ([...select.options].some(option => option.value === selected)) select.value = selected;
}

function resetProjectDrafts() {
  captureHistory.length = 0;
  $("#ai-objective").value = "";
  passagePicker.reset();
  $("#obligation-form").reset(); $("#evidence-form").reset();
  amendments.clearDrafts();
  $("#dependency-options").replaceChildren(); $("#evidence-list").replaceChildren();
  const form = $("#obligation-form"); form.elements.citationStart.value = ""; form.elements.citationEnd.value = ""; form.elements.citationQuote.value = ""; form.elements.citationRelated.value = "";
  paintCitation(null);
  showCriterion({reading:false});
}

function setDefaultActors() {
  if (!project) return;
  const reviewer = $("#obligation-form [name=reviewerId]");
  const submitter = $("#evidence-form [name=submittedBy]");
  if (project.parties[1]) reviewer.value = project.parties[1].id;
  submitter.value = project.parties[0].id;
}

function switchProject(next) {
  project = next; lastEvaluation = null; resetProjectDrafts();
  if (project) {
    const latest = project.events.at(-1)?.at ?? project.createdAt;
    const asOf = new Date(Math.max(Date.now(), new Date(latest).valueOf())).toISOString();
    $("#evaluate-form [name=asOf]").value = formatUtcControl(asOf);
    lastEvaluation = evaluateProject(project, asOf);
  }
  render();
  setDefaultActors();
  recoveryPanel?.changedProject();
}

function confirmAction({ title, copy, confirmLabel, action, saveWorkspace = false, destructive = true, recordRows = [] }) {
  pendingAction = action; dialog.returnValue = "";
  $("#dialog-confirm").classList.toggle("danger", destructive);
  $("#dialog-confirm").classList.toggle("primary", !destructive);
  $("#dialog-save-workspace").hidden = !saveWorkspace;
  $("#dialog-title").textContent = title; $("#dialog-copy").textContent = copy; $("#dialog-confirm").textContent = confirmLabel;
  let history = $("#dialog-history-review");
  if (!history) {
    history = el("ol", "dialog-history-review"); history.id = "dialog-history-review";
    history.setAttribute("aria-label", "Incoming records");
    $("#dialog-copy").after(history);
  }
  history.replaceChildren(); history.hidden = !recordRows.length;
  for (const row of recordRows) {
    const item = el("li", "audit-entry");
    item.append(el("p", "audit-action", row.action),
      el("h3", "audit-subject", row.obligation?.title ?? row.subject ?? "Agreement record"),
      el("small", "audit-attribution", row.actor + " · " + new Intl.DateTimeFormat(undefined, {dateStyle:"medium",timeStyle:"short",timeZone:"UTC"}).format(new Date(row.event.at)) + " UTC"));
    if (row.evidence) item.append(el("p", "audit-evidence", row.evidence.description),
      el("p", "audit-reference", row.evidence.reference));
    if (row.reason) item.append(el("p", "audit-reason", row.reason));
    if (row.event.type === "obligation.added" || row.amendment) {
      item.append(el("p", "audit-evidence", row.obligation.criterion),
        el("p", "audit-reference", dollars(row.obligation.amountMinor) + " · revision " + row.obligation.revision));
    }
    history.append(item);
  }

  dialog.showModal();
}
function render() {
  sharedReviewPanel?.refresh();
  if (!project) { setup.hidden = false; workbench.hidden = true; paymentPanel?.refresh(); return; }
  setup.hidden = true; workbench.hidden = false;
  const view = projectView(project);
  const firstCommitment = view.obligations.length === 0;
  const evaluateButton = $("#evaluate-form button");
  evaluateButton.textContent = lastEvaluation ? "Refresh" : "Evaluate readiness";
  evaluateButton.classList.toggle("primary", !lastEvaluation);
  workbench.dataset.authoring = String(firstCommitment);
  $("#obligation-network").hidden = false;
  $(".evidence-panel").hidden = firstCommitment;
  $(".evaluation-details").hidden = firstCommitment;
  $(".audit-panel").hidden = firstCommitment;
  $("#dependency-field").hidden = firstCommitment;
  $("#authoring-heading").textContent = firstCommitment ? "Add the first commitment" : "Add another commitment";
  $("#project-title").textContent = project.title;
  $("#sample-label").hidden = project.id !== SAMPLE_ID;
  $("#project-meta").textContent = `${partyNames(project).map(p => p.name).join(" · ")} · Budget ${dollars(project.budgetMinor)}`;
  $("#source-view").value = project.source.text;
  passagePicker.update(project.source.text);
  let corrections = $("#party-corrections");
  if (!corrections) { corrections = el("details"); corrections.id = "party-corrections"; $("#project-meta").after(corrections); }
  const correctionDrafts = new Map([...corrections.querySelectorAll("form")].filter(form => form.dataset.projectId === project.id).map(form => [form.dataset.partyId, {base:form.dataset.originalName, name:form.querySelectorAll("input")[0].value, reason:form.querySelectorAll("input")[1].value}]));
  corrections.replaceChildren(el("summary", "", "Correct a party name"), el("p", "muted", "Record a spelling or display-name correction for the same party. This does not replace a participant, verify identity, or change payment authorization. Original names and prior events remain recorded."));
  for (const party of partyNames(project)) {
    const form = el("form"); form.dataset.projectId = project.id; form.dataset.partyId = party.id; form.dataset.originalName = party.name; const draft = correctionDrafts.get(party.id); const preserve = draft?.base === party.name; const label = el("label", "", `${party.id} · ${party.name}`);
    const name = el("input"); name.value = preserve ? draft.name : party.name; name.required = true; name.maxLength = 120; name.setAttribute("aria-label", `Corrected name for ${party.id}`); label.append(name);
    const reasonLabel = el("label", "", "Reason for correction"); const reason = el("input"); reason.required = true; reason.maxLength = 1000; reason.value = preserve ? draft.reason : ""; reasonLabel.append(reason);
    const submit = el("button", "", "Review name correction"); submit.type = "submit"; form.append(label, reasonLabel, submit);
    form.addEventListener("submit", event => { event.preventDefault(); confirmAction({title:"Record party name correction?", copy:`${party.name} → ${name.value.trim()}. ${reason.value.trim()}. The stable identity ${party.id}, obligations and evidence remain unchanged. This is a local authored correction, not verified consent.`, confirmLabel:"Record correction", action:()=>run(()=>add("party.name-corrected",party.id,{partyId:party.id,previousName:party.name,name:name.value.trim(),reason:reason.value.trim()}))}); });
    corrections.append(form);
  }
  const partyValues = partyNames(project).map(p => ({ value: p.id, label: p.name }));
  options($("#obligation-form [name=performerId]"), partyValues);
  options($("#obligation-form [name=reviewerId]"), partyValues);
  options($("#evidence-form [name=submittedBy]"), partyValues);
  options($("#evidence-form [name=obligationId]"), view.obligations.map(o => ({ value: o.id, label: o.title })), view.obligations.length ? "Choose an obligation" : "Add an obligation first");

  const dependencies = $("#dependency-options"); const checked = new Set([...dependencies.querySelectorAll("input:checked")].map(input => input.value)); dependencies.replaceChildren();
  if (!view.obligations.length) dependencies.append(el("span", "muted", "No earlier obligations yet."));
  view.obligations.forEach(item => {
    const label = el("label"); const input = document.createElement("input"); input.type = "checkbox"; input.name = "dependsOn"; input.value = item.id; input.checked = checked.has(item.id);
    label.append(input, document.createTextNode(item.title)); dependencies.append(label);
  });

  renderEvidence(view);
  renderObligations(view);
  obligationNetwork.update(view, lastEvaluation);
  auditTrail.update(view);
  paymentPanel?.refresh();
  workspaceViews.update(view);
}

function renderEvidence(view) {
  const submitterNames = new Map(buildAuditTrail(view).filter(row => row.event.type === "evidence.submitted").map(row => [row.evidence.id, row.actor]));
  const list = $("#evidence-list"); const drafts = new Map([...list.querySelectorAll("[data-evidence-reason]")].map(input => [input.dataset.evidenceReason, input.value])); const actors = new Map([...list.querySelectorAll("[data-evidence-actor]")].map(input => [input.dataset.evidenceActor, input.value])); list.replaceChildren(); list.className = view.evidence.length ? "stack" : "stack empty";
  if (!view.evidence.length) { list.append(el("p", "", "No evidence recorded.")); return; }
  view.evidence.forEach(item => {
    const card = el("article", "card"); card.dataset.evidenceId = item.id; card.tabIndex = -1; const head = el("div", "card-head");
    const obligation = view.obligationVersions.find(o => o.id === item.obligationId && o.revision === item.obligationRevision);
    const historical = view.obligations.find(o => o.id === item.obligationId).revision !== item.obligationRevision;
    card.classList.toggle("evidence-historical", historical);
    const title = el("h3", "", `${obligation.title} · revision ${item.obligationRevision}`);
    if (historical) card.append(el("p", "muted", "Historical evidence. This record does not satisfy the current revision; unresolved disputes still need an explicit resolution."));
    const state = item.decision.revoked ? "revoked" : item.decision.openDisputeIds.length ? "disputed" : item.decision.acceptedAt ? "ready" : "blocked";
    const stateText = item.decision.revoked ? "Revoked" : item.decision.openDisputeIds.length ? "Disputed" : item.decision.acceptedAt ? "Recorded acceptance" : "Unreviewed";
    head.append(title, el("span", `badge ${state}`, stateText)); card.append(head);
    card.append(el("p", "", item.description));
    const referenceUrl = deliveryReferenceUrl(item.reference);
    if (referenceUrl) {
      const link = el("a", "delivery-reference", "Open delivered material");
      link.href = referenceUrl; link.target = "_blank"; link.rel = "noopener noreferrer";
      link.title = referenceUrl;
      card.append(link, el("p", "muted", new URL(referenceUrl).hostname));
    } else card.append(el("p", "muted", `Reference: ${item.reference}`));
    card.append(el("p", "muted", `Submitted by ${submitterNames.get(item.id) ?? item.submittedBy} · Review by ${partyName(obligation.reviewerId)}`));
    const fileCard = renderEvidenceFile(item, { compact: true }); if (fileCard) card.append(fileCard);
    const reasonLabel = el("label", "", "Decision reason"); const reason = document.createElement("textarea"); reason.rows = 2; reason.maxLength = 1000; reason.placeholder = "Explain this recorded decision"; reason.dataset.evidenceReason = item.id; reason.value = drafts.get(item.id) ?? ""; reasonLabel.append(reason); card.append(reasonLabel);
    const actorLabel = el("label", "", "Actor for dispute or revocation"); const actor = document.createElement("select"); actor.dataset.evidenceActor = item.id; partyNames(project).forEach(party => { const option = el("option", "", party.name); option.value = party.id; actor.append(option); }); actor.value = actors.get(item.id) ?? obligation.reviewerId; actorLabel.append(actor); card.append(actorLabel);
    const actions = el("div", "mini-actions");
    const reasonFeedback = el("p", "decision-reason-feedback");
    reasonFeedback.id = "evidence-reason-error-" + list.children.length;
    reasonFeedback.hidden = true; reasonFeedback.setAttribute("role", "alert");
    reason.setAttribute("aria-required", "true");
    reasonLabel.after(reasonFeedback);
    const clearReasonFeedback = () => {
      reason.removeAttribute("aria-invalid"); reason.removeAttribute("aria-describedby");
      reasonFeedback.hidden = true; reasonFeedback.textContent = "";
    };
    reason.addEventListener("input", () => { if (reason.value.trim()) clearReasonFeedback(); });
    const act = (type, actorId, payload) => run(() => {
      const explanation = reason.value.trim();
      if (!explanation) {
        reasonFeedback.textContent = "Enter a reason for this decision.";
        reasonFeedback.hidden = false;
        reason.setAttribute("aria-invalid", "true");
        reason.setAttribute("aria-describedby", reasonFeedback.id);
        reason.focus();
        return;
      }
      clearReasonFeedback();
      decisionReview.open(type, actorId, { ...payload,
        ...(type === "evidence.accepted" ? { rationale: explanation } : { reason: explanation }) });
    });
    if (!historical && !item.decision.acceptedAt && !item.decision.revoked) actions.append(button("Review acceptance", () => act("evidence.accepted", obligation.reviewerId, { evidenceId: item.id }), "primary"));
    if (!item.decision.revoked) actions.append(button("Record dispute…", () => act("evidence.disputed", actor.value, { evidenceId: item.id, disputeId: recordId("dispute") }), "danger"));
    if (!item.decision.revoked) actions.append(button("Revoke evidence…", () => act("evidence.revoked", actor.value, { evidenceId: item.id }), "danger"));
    item.decision.openDisputeIds.forEach(disputeId => {
      const dispute = view.disputes.find(d => d.id === disputeId);
      actions.append(button(`Resolve dispute as ${partyName(dispute.openedBy)}…`, () => act("dispute.resolved", dispute.openedBy, { disputeId })));
    });
    const secondary = el("details", "delivery-other-decisions");
    secondary.append(el("summary", "", "Dispute or revoke this evidence"), actorLabel);
    for (const action of [...actions.children]) if (action.classList.contains("danger")) secondary.append(action);
    card.append(actions);
    if (secondary.querySelector("button")) card.append(secondary);
    list.append(card);
  });
}

function blockerText(item, view) {
  const values = [];
  if (item.blockers.includes("NO_VALID_ACCEPTED_EVIDENCE")) values.push("no valid recorded acceptance");
  if (item.blockers.includes("OPEN_DISPUTE")) values.push(`open dispute: ${item.openDisputeIds.map(id => { const dispute = view.disputes.find(entry => entry.id === id); const event = project.events.find(entry => entry.type === "evidence.disputed" && entry.payload.disputeId === id); return dispute ? `${partyName(dispute.openedBy)} — ${event?.payload.reason || id}` : id; }).join("; ")}`);
  if (item.blockers.includes("DEPENDENCY_NOT_READY")) values.push(`dependencies not ready: ${item.dependencyBlockers.map(id => view.obligations.find(obligation => obligation.id === id)?.title || id).join(", ")}`);
  return values.join("; ") || "none";
}
function renderObligations(view) {
  const list = $("#obligation-list"); list.replaceChildren(); list.className = view.obligations.length ? "stack" : "stack empty";
  const summary = $("#summary"); summary.replaceChildren(); summary.hidden = !lastEvaluation;
  if (!view.obligations.length) { summary.hidden = true; list.append(el("p", "", "Add a cited obligation to begin.")); return; }
  const evalMap = new Map((lastEvaluation?.obligations ?? []).map(item => [item.obligationId, item]));
  view.obligations.forEach(item => {
    const result = evalMap.get(item.id); const card = el("article", "card"); const head = el("div", "card-head");
    head.append(el("h3", "", item.title), el("span", `badge ${result?.readiness === "ready-for-human-review" ? "ready" : "blocked"}`, result ? (result.readiness === "ready-for-human-review" ? "Ready for human review" : "Blocked") : "Not evaluated")); card.append(head);
    card.append(el("p", "", item.criterion), el("p", "quote", `“${citationText(item.citation)}”`), el("p", "muted", `${partyName(item.performerId)} → review by ${partyName(item.reviewerId)} · ${dollars(item.amountMinor)} illustrative amount`));
    card.append(el("p", "muted", item.dependsOn.length ? `Depends on: ${item.dependsOn.map(id => view.obligations.find(obligation => obligation.id === id)?.title || id).join(", ")}` : "No dependencies."));
    if (result) card.append(el("p", "", `Evaluated at ${lastEvaluation.asOf}. Blockers: ${blockerText(result, view)}. Authored deadline: ${item.dueAt ?? "none"}. Deadline condition: ${result.deadlineState}. Executable: no.`));
    list.append(card);
  });
  if (lastEvaluation) {
    [["Ready for review", dollars(lastEvaluation.totals.readyMinor)],["Blocked", dollars(lastEvaluation.totals.blockedMinor)],["Unallocated", dollars(lastEvaluation.totals.unallocatedMinor)],["Executed", dollars(0)]].forEach(([label, value]) => { const metric = el("div", "metric"); metric.append(el("strong", "", value), el("span", "", label)); summary.append(metric); });
  }
}

const agreementFile = mountAgreementFile({ document });

$("#setup-form").addEventListener("submit", event => {
  event.preventDefault(); run(() => {
    if (agreementFile.pending()) throw Error("Use or cancel the imported text before opening the agreement.");
    const data = new FormData(event.currentTarget);
    const createdAt = now();
    switchProject(createProject({ id: `project-${Date.now()}`, title: data.get("title").trim(), sourceText: data.get("source"), sourceFile: agreementFile.sourceFile(), budgetMinor: moneyToMinor(data.get("budget")), currency: "USD", createdAt, parties: declaredParties(data.get("performer"), data.get("reviewer"), data.get("additionalParties")) }));
    show(statusBox, "Agreement saved. Select a passage to create its first commitment.");
    $("#source-view").focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "auto" });
  });
});

function readCapturedCitation() {
  if (!project) return null;
  const form = $("#obligation-form");
  return citationFromDraft(project.source, Object.fromEntries(
    ["citationStart", "citationEnd", "citationQuote", "citationRelated"].map(name => [name, form.elements[name]?.value ?? ""])));
}
const captureHistory = [];
let criterionReplacement = null;
function canUndoCriterionReplacement() {
  return Boolean(criterionReplacement && project && criterionReplacement.projectId === project.id
    && criterionReplacement.source === project.source.text && criterionReplacement.revision === project.source.revision
    && criterionReplacement.after === $("#obligation-form").elements.criterion.value);
}
function refreshCriterionReplacement() {
  if (!canUndoCriterionReplacement()) criterionReplacement = null;
  $("#undo-criterion-source").hidden = !criterionReplacement;
}
criterionField.addEventListener("input", refreshCriterionReplacement);
$("#undo-criterion-source").addEventListener("click", () => run(() => {
  if (!canUndoCriterionReplacement()) throw Error("The criterion changed; its earlier wording cannot be restored here.");
  const before = criterionReplacement.before; criterionReplacement = null;
  criterionField.value = before;
  criterionField.dispatchEvent(new Event("input", {bubbles:true}));
  showCriterion({reading:false,focus:true});
}));
function canUndoCapture() {
  const last = captureHistory.at(-1);
  return Boolean(last && project && last.projectId === project.id && last.source === project.source.text && last.revision === project.source.revision && JSON.stringify(readCapturedCitation()) === JSON.stringify(last.after));
}
function setCapturedCitation(citation, {remember = true} = {}) {
  if (remember) {
    const before = readCapturedCitation();
    if (JSON.stringify(before) !== JSON.stringify(citation)) {
      if (!canUndoCapture()) captureHistory.length = 0;
      captureHistory.push({projectId:project.id, source:project.source.text, revision:project.source.revision, before, after:citation});
      if(captureHistory.length > 10) captureHistory.shift();
    }
  }
  const form = $("#obligation-form");
  for (const [name, value] of Object.entries(citationDraftFields(citation))) form.elements[name].value = value;
}

$("#undo-source-capture").addEventListener("click",()=>run(()=>{
  if (!canUndoCapture()) throw Error("The source draft changed; its earlier capture cannot be restored here.");
  const previous = captureHistory.pop().before;
  setCapturedCitation(previous,{remember:false}); paintCitation(previous);
  $("#citation-details").open = Boolean(previous);
}));
function paintCitation(selected) {
  refreshCriterionReplacement();
  obligationNetwork.refreshDraft();
  $("#undo-source-capture").hidden = !canUndoCapture();
  const details = $("#citation-details"), content = $("#citation-quote");
  details.hidden = !selected; details.open = false; content.replaceChildren(); content.scrollTop = 0;
  if (!selected) { passagePicker.reset(); $("#citation-preview").textContent = "No citation selected."; return; }
  const passages = citationPassages(selected);
  const groups = capturedSourceSections(project.source.text, passages, sourceSectionIndex(project.source.text));
  const readingOrder = [...groups.filter(group=>!group.definitions),...groups.filter(group=>group.definitions)];
  for (const group of readingOrder) {
    const section=el("details","captured-source-passage captured-source-section");
    section.dataset.capturedSection=group.key;
    section.dataset.sourceLabel=group.label;
    if(group.definitions)section.classList.add("captured-definitions");
    const summary=el("summary","");
    summary.append(el("span","captured-source-index",group.label||"Source"),
      el("span","captured-source-title",group.title));
    section.append(summary);
    const reading=el("div","captured-source-reading");reading.tabIndex=0;
    reading.setAttribute("aria-label","Captured wording: "+group.title);
    const actions=el("div","captured-source-actions");
    group.ranges.forEach((range,index)=>{
      if(index)reading.append(el("p","citation-gap","…"));
      const quote=setCitationQuote(document,el("blockquote",""),range.quote,[],{before:project.source.text.slice(0,range.start)});
      quote.dataset.capturedStart=String(range.start);quote.dataset.capturedEnd=String(range.end);
      reading.append(quote);
      const original=button("Read in complete agreement",()=>run(()=>{
        if(!obligationNetwork.readSource(range,()=>{
          revealWorkspaceTarget(section);details.open=true;section.open=true;
          original.focus({preventScroll:true});section.scrollIntoView({block:"start",behavior:"instant"});
        }))throw Error("This captured wording no longer matches the agreement.");
      }),"quiet");
      const originalIndex=group.indices.find(i=>passages[i].start>=range.start&&passages[i].start<range.end);
      if(originalIndex!==undefined)original.dataset.capturedOriginal=String(originalIndex);
      original.dataset.capturedRead=String(range.start);
      (group.ranges.length===1?actions:reading).append(original);
    });
    section.append(reading);
    if(groups.length>1){
      const first=button("Start criterion here",()=>run(()=>copyCapturedCriterion(null,group.ranges)),"quiet");
      first.dataset.criterionFirst=String(group.ranges[0].start);
      first.title="Copy all captured wording, starting with this section.";
      actions.append(first);
    }
    const remove=button("Remove "+(group.label||"captured wording"),()=>run(()=>{
      const remaining=subtractCapturedPassages(passages,group.ranges);
      const citation=remaining.length?captureSourceCitation(project.source,remaining):null;
      setCapturedCitation(citation);paintCitation(citation);details.open=Boolean(citation);
    }),"quiet");
    remove.dataset.removeCapturedSection=group.key;
    actions.append(remove);section.append(actions);content.append(section);
  }
  if (groups.every(group=>group.label)) $("#citation-preview").textContent = "Captured wording from "+groups.length+(groups.length===1?" section.":" sections.");
  else $("#citation-preview").textContent = passages.length===1?"Source wording captured.":passages.length+" source selections captured.";
  if(passages.length===1)passagePicker.selectRange(selected.start,selected.end);
  passagePicker.refresh?.();
}

function captureSource(chosen, { append = false, focusTitle = true } = {}) {
  const source = $("#source-view");
  const selected = chosen ?? sourceSelection(project.source.text, source.selectionStart, source.selectionEnd);
  if (!selected?.quote.trim()) throw new Error("Select a non-empty passage in the agreement source first.");
  const prior = append ? readCapturedCitation() : null;
  const citation = captureSourceCitation(project.source, [...citationPassages(prior), selected]);
  setCapturedCitation(citation);
  paintCitation(citation); if (focusTitle) $("#obligation-form").elements.title.focus();
}
$("#capture").addEventListener("click", () => run(captureSource));
function copyCapturedCriterion(firstStart = null, firstRanges = null) {
  const citation=readCapturedCitation(),passages=citationPassages(citation);
  const first=firstStart===null?-1:passages.findIndex(passage=>passage.start===firstStart);
  if(firstStart!==null&&first<0)throw new Error("That source passage is no longer captured.");
  const ordered=firstRanges?[...firstRanges,...subtractCapturedPassages(passages,firstRanges)]:first<0?passages:[passages[first],...passages.filter((_,index)=>index!==first)];
  const form = $("#obligation-form"), quote = citationPassagesText(ordered), field = form.elements.criterion;
  if (!quote) throw new Error("Capture a source passage before copying its wording.");
  if (field.maxLength >= 0 && quote.length > field.maxLength)
    throw new Error("This captured source has " + quote.length.toLocaleString() + " characters. Keep its citation and write a completion criterion within " + field.maxLength.toLocaleString() + " characters.");
  const before = field.value;
  field.value = quote;
  field.dispatchEvent(new Event("input", { bubbles: true }));
  if (before !== quote) criterionReplacement = {projectId:project.id, source:project.source.text, revision:project.source.revision, before, after:quote};
  refreshCriterionReplacement();
  showCriterion({reading:true,focus:true,reset:true});
  recoveryPanel?.save();
}
$("#copy-source-criterion").addEventListener("click", () => run(() => copyCapturedCriterion()));

$("#obligation-form").addEventListener("submit", event => {
  event.preventDefault(); run(() => {
    const form = event.currentTarget; const data = new FormData(form); const citation = readCapturedCitation();
    if (!citation) throw new Error("Capture an exact source selection before adding the obligation.");
    const obligation = { id: recordId("obligation"), revision: 1, title: data.get("title").trim(), criterion: data.get("criterion").trim(), citation, performerId: data.get("performerId"), reviewerId: data.get("reviewerId"), dependsOn: data.getAll("dependsOn"), dueAt: parseUtcControl(data.get("dueAt"), { optional: true }), amountMinor: moneyToMinor(data.get("amount")) };
    add("obligation.added", obligation.performerId, { obligation });
    captureHistory.length = 0; form.reset(); passagePicker.reset(); form.elements.citationStart.value = ""; form.elements.citationEnd.value = ""; form.elements.citationQuote.value = ""; form.elements.citationRelated.value = ""; if (project.parties[1]) form.elements.reviewerId.value = project.parties[1].id; paintCitation(null); showCriterion({reading:false});
    show(statusBox, "Cited commitment added. Add evidence or another commitment; readiness has not been evaluated.");
    const addedRow = [...$("#network-rows").querySelectorAll("[data-network-obligation]")]
      .find(button => button.dataset.networkObligation === obligation.id);
    if (addedRow) { revealWorkspaceTarget(addedRow); addedRow.click(); addedRow.focus({ preventScroll: true }); addedRow.scrollIntoView({ block: "nearest" }); }
  });
});

$("#evidence-form").addEventListener("submit", event => {
  event.preventDefault(); run(() => {
    const data = new FormData(event.currentTarget); const submittedBy = data.get("submittedBy");
    const activeObligation = projectView(project).obligations.find(item => item.id === data.get("obligationId"));
    if (!activeObligation) throw new Error("Choose a current commitment for this evidence.");
    const evidence = { id: recordId("evidence"), obligationId: activeObligation.id, obligationRevision: activeObligation.revision, submittedBy, description: data.get("description").trim(), reference: data.get("reference").trim() };
    const fingerprint = evidenceFile.draft(); if (fingerprint) evidence.fileFingerprint = fingerprint;
    add("evidence.submitted", submittedBy, { evidence }); event.currentTarget.reset();
    const card = [...document.querySelectorAll("[data-evidence-id]")].find(node => node.dataset.evidenceId === evidence.id);
    revealWorkspaceTarget(card); card?.focus();
    show(statusBox, "Unreviewed evidence note added. It is not accepted or authenticated by default.");
  });
});

$("#evaluate-form").addEventListener("submit", event => {
  event.preventDefault(); clearMessages(); lastEvaluation = null; render();
  run(() => { const value = new FormData(event.currentTarget).get("asOf"); lastEvaluation = evaluateProject(project, parseUtcControl(value)); render(); show(statusBox, "Readiness recomputed from the complete local audit history. No payment was authorized or executed."); });
});
$("#evaluate-form [name=asOf]").addEventListener("input", () => { if (lastEvaluation) { lastEvaluation = null; render(); show(statusBox, "Evaluation time changed. Previous readiness results were cleared."); } });

for (const button of document.querySelectorAll("[data-save-workspace]")) button.addEventListener("click", () => run(() => {
  const blob = new Blob([exportWorkspace({ project, drafts: captureDrafts(document) })], { type: "application/json" });
  const url = URL.createObjectURL(blob), anchor = document.createElement("a");
  try { anchor.href = url; anchor.download = (project?.id ?? "unfinished-agreement") + ".pact-workspace.json"; anchor.click(); }
  finally { setTimeout(() => URL.revokeObjectURL(url), 0); }
  show(statusBox, "Workspace file requested, including unfinished authoring drafts. Payment consent is not saved. Keep this file private.");
}));
document.querySelector(".project-more").addEventListener("click", event => {
  const button = event.target.closest("button");
  if (button) {
    event.currentTarget.open = false;
    if (button.id === "export" || button.id === "export-review") event.currentTarget.querySelector("summary").focus();
  }
});
$("#export").addEventListener("click", () => run(() => {
  const blob = new Blob([exportProject(project)], { type: "application/json" }); const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
  try { anchor.href = url; anchor.download = `${project.id}.json`; anchor.click(); } finally { setTimeout(() => URL.revokeObjectURL(url), 0); }
  show(statusBox, "Export requested. The file contains agreement text and evidence notes; share it carefully.");
}));

$("#export-review").addEventListener("click", () => run(() => {
  const html = exportReadableReview(project, parseUtcControl($("#evaluate-form [name=asOf]").value));
  const blob = new Blob([html], { type: "text/html;charset=utf-8" }), url = URL.createObjectURL(blob), anchor = document.createElement("a");
  try { anchor.href = url; anchor.download = project.id + "-review.html"; anchor.click(); }
  finally { setTimeout(() => URL.revokeObjectURL(url), 0); }
  show(statusBox, "Readable review requested. Open the HTML file in any browser; it includes private agreement text and evidence, but no verified consent or payment state.");
}));

function openImport() { $("#import-file").click(); }
$("#import-open").addEventListener("click", openImport); $("#import-open-active").addEventListener("click", openImport);
$("#import-file").addEventListener("change", async event => {
  const file = event.target.files[0]; event.target.value = ""; if (!file) return;
  const token = ++importToken;
  try {
    if (file.size > MAX_RECOVERY_BYTES) throw new Error("Import exceeds the supported workspace size.");
    const raw = await file.text(), format = JSON.parse(raw)?.format;
    const snapshot = isWorkspaceFormat(format) ? importWorkspace(raw) : null;
    const candidate = snapshot ? snapshot.project : importProject(raw); if (token !== importToken) return;
    const apply = () => {
      switchProject(candidate);
      if (snapshot) restoreDrafts(document, snapshot.drafts, candidate);
      recoveryPanel?.save();
      show(statusBox, snapshot ? "Workspace opened. Review restored drafts before recording." : "Validated project imported. Project files contain recorded events, not unfinished drafts.");
    };
    const hasSetupDraft = $("#setup-form").dataset.sourceImport === "true" || [...$("#setup-form").elements].some(field => "defaultValue" in field && field.value !== field.defaultValue);
    if ((!project && !hasSetupDraft) || isPristineSample()) { apply(); return; }
    let merge = null;
    if (project && candidate) {
      try { merge = previewHistoryMerge(project, candidate); } catch {}
    }
    if (merge) {
      confirmAction({
        title: "Bring both copies together?",
        copy: "Add " + merge.added + (merge.added === 1 ? " collaborator record for " : " collaborator records for ") + merge.commitments.join(", ") + ". Keep all " + project.events.length + " current records and your unfinished drafts.",
        confirmLabel: "Add collaborator records",
        destructive: false,
        recordRows: buildAuditTrail(projectView(candidate)).filter(row => merge.incomingEventIds.includes(row.event.id)),
        saveWorkspace: true,
        action: () => run(() => {
          const combined = commitHistoryMerge(project, candidate, merge);
          const drafts = captureDrafts(document, project);
          switchProject(combined);
          restoreDrafts(document, drafts, combined);
          recoveryPanel?.save();
          show(statusBox, merge.added + " collaborator records added. Both histories are preserved.");
        })
      });
    } else {
      confirmAction({ ...importReviewCopy(project, candidate, Boolean(snapshot)), action: apply, saveWorkspace: true });
    }

  } catch (error) { if (token === importToken) show(errorBox, `Import refused. Current work was preserved. ${error.code ? `${error.code}: ` : ""}${error.message}`); }
});
// Capture the submitted decision before close queues its asynchronous event.
// A previous cancelled dialog must never consume a newly opened action.
dialog.addEventListener("submit", event => {
  event.preventDefault();
  const value = event.submitter?.value ?? "";
  const action = pendingAction;
  pendingAction = null;
  dialog.close(value);
  if (value === "confirm" && action) run(action);
});
dialog.addEventListener("close", () => {
  if (!dialog.open) pendingAction = null;
});
$("#reset").addEventListener("click", () => {
  ++importToken;
  const start = () => { $("#setup-form").reset(); switchProject(null); $("#setup-form [name=title]").focus(); };
  if (isPristineSample()) { start(); return; }
  confirmAction({ title: "Start a new agreement?", copy: "Save workspace first to keep this agreement and unfinished drafts.", confirmLabel: "Start new agreement", action: start, saveWorkspace: true });
});
$("#new-agreement").addEventListener("click", () => $("#reset").click());


const paymentPanel = mountPaymentPanel({
  openSourceReference: target => {
    revealWorkspaceTarget($("#source-find"));
    passagePicker.openReference(target);
  },
  getProject: () => project,
  getAsOf: () => parseUtcControl($("#evaluate-form [name=asOf]").value),
  showStatus: message => show(statusBox, message),
  showError: message => show(errorBox, message),
  getProposalDraft: () => {
    const form = $("#obligation-form"), source = $("#source-view");
    return JSON.stringify([
      ...["title", "criterion", "citationStart", "citationEnd", "citationQuote", "citationRelated"].map(name => form.elements[name].value),
      source.selectionStart, source.selectionEnd, ...passagePicker.selection()
    ]);
  },
  confirmSuggestion: action => confirmAction({
    title: "Replace the current draft?",
    copy: "Replace its title, completion criterion and source selection with the returned proposal?",
    confirmLabel: "Replace draft", action
  }),
  onSuggestion: proposal => {
    const form = $("#obligation-form");
    form.elements.title.value = proposal.title;
    form.elements.criterion.value = proposal.criterion;
    form.elements.criterion.setSelectionRange(0, 0);
    form.elements.criterion.scrollTop = 0;
    setCapturedCitation(proposal);
    paintCitation(proposal);
    showCriterion({reading:true,reset:true});
    $("#source-view").focus();
    const view = sourceViewRange(project.source.text, proposal.start, proposal.end);
    if (view) $("#source-view").setSelectionRange(view.start, view.end);
    passagePicker.selectRange(proposal.start, proposal.end);
    recoveryPanel?.save();
  }
});

const decisionReview = mountDecisionReview({
  document, getProject: () => project,
  createEvent: (type, actorId, payload) => ({ id: eventId(), seq: 0, at: now(), actorId, type, payload }),
  onCommit: (next, event) => {
    project = next; lastEvaluation = null;
    $("#evaluate-form [name=asOf]").value = formatUtcControl(event.at);
    render(); recoveryPanel?.save();
    show(statusBox, "Reviewed decision recorded. Evaluate readiness to refresh the agreement.");
  }
});

const amendments = mountAmendments({
  document, getProject: () => project,
  createEvent: (type, actorId, payload) => ({ id: eventId(), seq: 0, at: now(), actorId, type, payload }),
  onDraftChange: () => recoveryPanel?.save(),
  onCommit: (next, event) => {
    project = next; lastEvaluation = evaluateProject(next, event.at);
    $("#evaluate-form [name=asOf]").value = formatUtcControl(event.at);
    render(); recoveryPanel?.save();
    show(statusBox, event.type === "amendment.adopted"
      ? "Revised commitment recorded. Submit evidence for its current revision; earlier evidence and Sandbox requests remain in history."
      : "Amendment record saved. Current terms stay active until a reviewed proposal is applied.");
  }
});

render();
recoveryPanel = mountRecovery({ document, getProject: () => project, setProject: switchProject });
const recoveryStatus = recoveryPanel.start();
const initialWorkspaceDraft = JSON.stringify(captureDrafts(document));
if (recoveryStatus === "empty") {
  const initialDraft = JSON.stringify(captureDrafts(document));
  fetch("/sample-agreement.json").then(response => {
    if (!response.ok) throw Error("The sample agreement could not be opened.");
    return response.text();
  }).then(raw => {
    // A late response must never replace a project, file import or typed setup.
    if (project || importToken || $("#setup-form").dataset.sourceImport === "true" || JSON.stringify(captureDrafts(document)) !== initialDraft) return;
    const sample = importProject(raw);
    if (sample.id !== SAMPLE_ID) throw Error("The sample agreement is not recognized.");
    switchProject(sample);
    lastEvaluation = evaluateProject(sample, now());
    render();
    sampleBaseline = { project: exportProject(sample), drafts: JSON.stringify(captureDrafts(document)) };
    recoveryPanel.save();
  }).catch(error => show(errorBox, error.message));
}
recoveryPanel.start();

sharedReviewPanel = mountSharedReviews({
  getProject: () => project,
  offerSaved: () => recoveryStatus === "empty" && (isPristineSample() || (!project && !importToken && JSON.stringify(captureDrafts(document)) === initialWorkspaceDraft)),
  newAgreement: () => $("#new-agreement").click(),
  receive: candidate => run(() => {
    if(isPristineSample() || (!project && JSON.stringify(captureDrafts(document)) === initialWorkspaceDraft)){switchProject(candidate);show(statusBox,"Shared agreement opened.");return;}
    if(!project){confirmAction({title:"Open this shared agreement?",copy:"Save workspace first to keep your unfinished agreement.",confirmLabel:"Open agreement",saveWorkspace:true,action:()=>run(()=>switchProject(candidate))});return;}
    if (exportProject(project) === exportProject(candidate)) {
      show(statusBox, "Your workspace already has these records."); return;
    }
    let merged = null;
    try { merged = previewHistoryMerge(project, candidate); } catch {}
    const original = exportProject(project);
    const incomingIds = new Set(candidate.events.filter(e => !project.events.some(local => local.id === e.id)).map(e => e.id));
    confirmAction({
      ...importReviewCopy(project, candidate, false),
      title: merged ? "Bring shared records into this workspace?" : "Review received agreement",
      copy: merged ? "Keep your local records and drafts, and add the shared records shown below." : importReviewCopy(project, candidate, false).copy,
      confirmLabel: merged ? "Add shared records" : "Receive this history",
      destructive: !merged,
      recordRows: buildAuditTrail(projectView(candidate)).filter(row => incomingIds.has(row.event.id)),
      saveWorkspace: true,
      action: () => run(() => {
        if (exportProject(project) !== original) throw new Error("The workspace changed. Review the shared records again.");
        const next = merged ? commitHistoryMerge(project, candidate, merged) : candidate;
        const drafts = captureDrafts(document);
        switchProject(next); restoreDrafts(document, drafts, next);
        // Draft restoration must not move the evaluation clock behind a newly
        // received event; authored text and later selected times remain intact.
        const clock = $("#evaluate-form [name=asOf]");
        const latest = Date.parse(next.events.at(-1)?.at ?? next.createdAt);
        const selected = Date.parse(clock.value + (/Z$/.test(clock.value) ? "" : "Z"));
        if (!Number.isFinite(selected) || selected < latest) clock.value = formatUtcControl(new Date(Math.max(Date.now(),latest)).toISOString());
        lastEvaluation = evaluateProject(next, parseUtcControl(clock.value));
        render();
        show(statusBox, "Shared records received. Your unfinished drafts are preserved.");
      })
    });
  })
});

mountOrganizerAccess();
