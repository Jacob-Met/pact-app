import { sourceSectionIndex } from "./source-references.mjs";
import { mountContractDocument } from "./contract-document.mjs";
import { revealWorkspaceTarget } from "./workspace-views.mjs";
import { partyNames } from "./core.mjs";
import { formatUsdMinor } from "./ui-utils.mjs";
import { findCommitments } from "./commitment-search.mjs";
import { citationPassages, citationText } from "./source-citations.mjs";
import { renderCitationExcerpts, setCitationQuote, capturedSourceSections } from "./citation-view.mjs";

// This is a projection of validated events and an explicit evaluation.
// It never infers agreement, payment authority or readiness from prose.
export function buildObligationNetwork(view, evaluation = null) {
  const revisionAtEvent = new Map();
  const acceptanceContext = new Map();
  const proposals = new Map();
  for (const event of view.project.events) {
    if (event.type === "obligation.added") revisionAtEvent.set(event.payload.obligation.id, event.payload.obligation.revision ?? 1);
    if (event.type === "amendment.proposed") proposals.set(event.payload.amendment.id, event.payload.amendment.obligation);
    if (event.type === "amendment.adopted") {
      const changed = proposals.get(event.payload.amendmentId);
      if (changed) revisionAtEvent.set(changed.id, changed.revision);
    }
    if (event.type === "evidence.accepted") acceptanceContext.set(event.payload.evidenceId, { seq: event.seq, revisions: new Map(revisionAtEvent) });
  }
  const evaluated = new Map((evaluation?.obligations ?? []).map(item => [item.obligationId, item]));
  const byObligation = new Map();
  const revisions = new Map(view.obligations.map(item => [item.id, item.revision]));
  for (const item of view.evidence) {
    if (!byObligation.has(item.obligationId)) byObligation.set(item.obligationId, []);
    const status = item.decision.revoked ? "revoked"
      : item.decision.openDisputeIds.length ? "disputed"
      : item.decision.acceptedAt ? "accepted" : "unreviewed";
    byObligation.get(item.obligationId).push({
      id: item.id, description: item.description, reference: item.reference,
      revision: item.obligationRevision, historical: item.obligationRevision !== revisions.get(item.obligationId),
      submittedBy: item.submittedBy, acceptedAt: item.decision.acceptedAt,
      status, disputeIds: [...item.decision.openDisputeIds]
    });
  }
  const depths = new Map();
  const byId = new Map(view.obligations.map(item => [item.id, item]));
  const depthOf = item => {
    if (!depths.has(item.id)) depths.set(item.id, item.dependsOn.length ? 1 + Math.max(...item.dependsOn.map(id => depthOf(byId.get(id)))) : 0);
    return depths.get(item.id);
  };
  const parties = new Map(partyNames(view.project).map(p => [p.id, p.name]));
  return view.obligations.map((item, index) => {
    const depth = depthOf(item);
    const result = evaluated.get(item.id);
    const allEvidence = byObligation.get(item.id) ?? [];
    const evidence = allEvidence.filter(value => !value.historical);
    const historicalEvidence = allEvidence.filter(value => value.historical);
    const latestAcceptance = evidence.filter(value => value.status === "accepted")
      .map(value => acceptanceContext.get(value.id)).filter(Boolean).sort((a,b) => b.seq - a.seq)[0];
    const prerequisiteIds = new Set();
    const collect = id => { if (prerequisiteIds.has(id)) return; prerequisiteIds.add(id); for (const parent of byId.get(id)?.dependsOn ?? []) collect(parent); };
    item.dependsOn.forEach(collect);
    const changedPrerequisites = latestAcceptance ? [...prerequisiteIds].flatMap(id => {
      const before = latestAcceptance.revisions.get(id), current = byId.get(id);
      return current && before !== current.revision ? [{ id, title: current.title, before: before ?? null, after: current.revision }] : [];
    }) : [];
    const state = !result ? "unevaluated"
      : result.readiness === "ready-for-human-review" ? "ready"
      : result.openDisputeIds.length ? "disputed" : "blocked";
    return {
      id: item.id, index: index + 1, depth, title: item.title, revision: item.revision,
      amendments: (view.amendments ?? []).filter(amendment => amendment.obligation.id === item.id),
      source: citationText(item.citation), citation: item.citation,
      criterion: item.criterion, dependsOn: [...item.dependsOn],
      amountMinor: item.amountMinor, dueAt: item.dueAt,
      performerId: item.performerId,
      performer: parties.get(item.performerId) ?? item.performerId,
      reviewer: parties.get(item.reviewerId) ?? item.reviewerId,
      state, blockers: result?.blockers ?? [],
      blockingPrerequisites: result?.dependencyBlockers ?? [],
      deadlineState: result?.deadlineState ?? null,
      openDisputes: result?.openDisputeIds ?? [],
      changedPrerequisites, evidence, historicalEvidence, acceptedCount: evidence.filter(e => Boolean(e.acceptedAt) && e.status !== "revoked").length,
      evaluatedAsOf: evaluation?.asOf ?? null,
      executable: false
    };
  });
}

// A shared prerequisite can lead to the same descendant through several paths.
// Return each affected commitment once, in the authored order.
export function dependentCommitments(items, id) {
  const affected = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of items) if (!affected.has(item.id) && item.dependsOn.some(dep => affected.has(dep))) {
      affected.add(item.id); changed = true;
    }
  }
  return items.filter(item => item.id !== id && affected.has(item.id));
}

function el(tag, className, value) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (value !== undefined) element.textContent = value;
  return element;
}
function action(text, handler, className = "") {
  const element = el("button", className, text);
  element.type = "button"; element.addEventListener("click", handler);
  return element;
}
const stateNames = {
  unevaluated: "Not evaluated", blocked: "Blocked",
  disputed: "Disputed", ready: "Ready for human review"
};
const deadlineNames = {
  none: "No deadline", upcoming: "Upcoming", due: "Due now",
  overdue: "Overdue", "accepted-on-time": "Accepted on time",
  "accepted-late": "Accepted late"
};
const blockerNames = {
  NO_VALID_ACCEPTED_EVIDENCE: "No valid recorded acceptance",
  OPEN_DISPUTE: "An evidence dispute remains open",
  DEPENDENCY_NOT_READY: "Prerequisites are not ready"
};

export function mountObligationNetwork(root, sourceView, { onAmendment = () => {}, onCapture = null, hasCitation = () => false, getDraftCitation = () => null } = {}) {
  const rows = root.querySelector("#network-rows");
  const inspector = root.querySelector("#network-inspector");
  const summary = root.querySelector("#network-state-summary");
  let selectedId = null;
  let explicitSelection = false;
  let items = [];
  let visibleItems = [];
  let projectId = null;
  let sourceText = "";
  let evaluatedAt = null;
  const contract = mountContractDocument(root, id => select(id), {onCapture, hasCitation, getDraftCitation});
  const toolbar = el("div", "network-find");
  const searchLabel = el("label", "", "Find a commitment");
  const search = el("input"); search.type = "search"; search.id = "network-search";
  search.placeholder = "Clause, evidence, reference or party"; search.maxLength = 300;
  search.setAttribute("aria-controls", "network-rows"); searchLabel.append(search);
  const stateLabel = el("label", "", "Readiness");
  const stateFilter = el("select"); stateFilter.id = "network-filter";
  for (const [value, label] of [["all", "All commitments"], ...Object.entries(stateNames)]) {
    const option = el("option", "", value === "ready" ? "Ready for review" : label); option.value = value; stateFilter.append(option);
  }
  stateFilter.setAttribute("aria-controls", "network-rows"); stateLabel.append(stateFilter);
  const deadlineLabel = el("label", "", "Deadline");
  const deadlineFilter = el("select"); deadlineFilter.id = "network-deadline-filter";
  for (const [value, label] of [["all", "All deadlines"], ["attention", "Due or late"], ["upcoming", "Upcoming"], ["accepted-on-time", "Accepted on time"], ["none", "No deadline"]]) {
    const option = el("option", "", label); option.value = value; deadlineFilter.append(option);
  }
  deadlineFilter.setAttribute("aria-controls", "network-rows"); deadlineLabel.append(deadlineFilter);
  deadlineFilter.addEventListener("change", () => renderRows());
  const clear = action("Clear filters", () => { search.value = ""; stateFilter.value = "all"; deadlineFilter.value = "all"; renderRows(); search.focus(); });
  clear.id = "network-clear";
  const count = el("p", "network-find__count"); count.id = "network-result-count";
  count.setAttribute("role", "status"); count.setAttribute("aria-live", "polite");
  const filterToggle = action("Filters", () => {
    const expanded = filterToggle.getAttribute("aria-expanded") !== "true";
    filterToggle.setAttribute("aria-expanded", String(expanded));
    toolbar.classList.toggle("network-find--expanded", expanded);
  });
  filterToggle.className = "network-filter-toggle";
  filterToggle.setAttribute("aria-expanded", "false");
  filterToggle.setAttribute("aria-controls", "network-filter-options");
  const options = el("div", "network-filter-options"); options.id = "network-filter-options";
  options.append(stateLabel, deadlineLabel, clear);
  toolbar.append(searchLabel, filterToggle, options, count);

  const findTools = el("details", "network-search-tools");
  findTools.append(el("summary", "", "Find or filter"), toolbar);
  const readingTools = el("div", "network-reading-tools");
  summary.before(readingTools);
  readingTools.append(summary, findTools);
  search.addEventListener("input", () => renderRows());
  search.addEventListener("keydown", event => {
    if (event.key === "Escape" && search.value) { event.preventDefault(); search.value = ""; renderRows(); }
    if (event.key === "ArrowDown" && visibleItems.length) { event.preventDefault(); select(visibleItems[0].id, true); }
  });
  stateFilter.addEventListener("change", () => renderRows());

  function readSource(passage, onReturn, returnLabel, showRelated = false) {
    if (sourceText.slice(passage.start, passage.end) !== passage.quote) return false;
    revealWorkspaceTarget(root);
    contract.setReturnAction(onReturn, returnLabel);
    return contract.scrollSourceRange(passage, {behavior:"instant",block:"center",showRelated});
  }
  function focusSource() {
    revealWorkspaceTarget(sourceView);
    sourceView.focus({ preventScroll: true });
    sourceView.scrollIntoView({ block: "center" });
  }
  root.querySelector("#network-add")?.addEventListener("click", focusSource);

  function select(id, focusRow = false) {
    explicitSelection = true;
    selectedId = id;
    if (!visibleItems.some(item => item.id === id)) {
      search.value = ""; stateFilter.value = "all"; deadlineFilter.value = "all"; renderRows();
      count.textContent += " Filters cleared to show the linked commitment.";
    } else inspect();
    inspector.scrollIntoView({block:"start",behavior:"instant"});
    if (!focusRow) inspector.querySelector("h3")?.focus({preventScroll:true});
    if (focusRow) [...rows.querySelectorAll("[data-network-obligation]")]
      .find(button => button.dataset.networkObligation === id)?.focus({preventScroll:true});
  }
  function addEvidence(selected) {
    const form = document.querySelector("#evidence-form");
    if (!form) return;
    for (let parent = form.parentElement; parent; parent = parent.parentElement) if (parent.tagName === "DETAILS") parent.open = true;
    form.elements.obligationId.value = selected.id;
    form.elements.submittedBy.value = selected.performerId;
    revealWorkspaceTarget(form);
    form.elements.description.focus({ preventScroll: true });
    form.scrollIntoView({ block: "center" });
  }
  function reviewEvidence(id) {
    const card = [...document.querySelectorAll("[data-evidence-id]")]
      .find(element => element.dataset.evidenceId === id);
    if (!card) return;
    for (let parent = card.parentElement; parent; parent = parent.parentElement) if (parent.tagName === "DETAILS") parent.open = true;
    revealWorkspaceTarget(card);
    card.querySelector("[data-evidence-reason]")?.focus({ preventScroll: true });
    card.scrollIntoView({ block: "center" });
  }
  function relatedList(ids, label) {
    if (!ids.length) return;
    inspector.append(el("h4", "", label));
    const list = el("ul", "network-related");
    for (const id of ids) {
      const item = items.find(value => value.id === id);
      if (!item) continue;
      const li = el("li");
      li.append(action(item.title, () => select(id, true), "network-link"),
        el("span", "network-related__state", stateNames[item.state]));
      list.append(li);
    }
    inspector.append(list);
  }

  const narrow = window.matchMedia("(max-width: 800px)");
  function positionInspector() {
    const paragraph = contract.selectedParagraph();
    if(narrow.matches && paragraph) paragraph.after(inspector);
    else root.querySelector(".network-layout").append(inspector);
  }
  narrow.addEventListener("change", inspect);
  function inspect() {
    contract.select(selectedId);
    inspector.replaceChildren();
    rows.querySelectorAll("[data-network-obligation]").forEach(button => {
      const active = button.dataset.networkObligation === selectedId;
      button.setAttribute("aria-pressed", String(active));
      button.tabIndex = active ? 0 : -1;
    });
    const selected = items.find(item => item.id === selectedId);
    inspector.hidden = !selected;
    if (inspector.hidden) { positionInspector(); return; }

    const heading = el("h3", "", selected.title);
    heading.tabIndex = -1;
    const status = el("p", "network-inspector__state", stateNames[selected.state]);
    status.dataset.state = selected.state;
    const identity = el("div", "network-inspector__identity");
    identity.append(el("p", "network-selection", "COMMITMENT " + String(selected.index).padStart(2, "0")), heading);
    const amount = el("p", "network-inspector__amount", formatUsdMinor(selected.amountMinor));
    amount.append(el("span", "", "USD"));
    const header = el("div", "network-inspector__header"); header.append(identity, amount);
    inspector.append(header);
    const appliedAmendment = selected.amendments.find(item =>
      item.status === "adopted" && item.obligation.revision === selected.revision);
    if (appliedAmendment) inspector.append(action(
      "Amended · revision " + selected.revision + " · View changes",
      () => onAmendment(selected.id, appliedAmendment.id), "network-amended"));
    inspector.append(status);
    const condition = el("details", "network-condition");
    const conditionText = el("div", "network-condition__text citation-excerpt");
    setCitationQuote(document, conditionText, selected.criterion);
    condition.append(el("summary", "", "Read the complete condition"), conditionText);
    inspector.append(condition);

    const evidenceHead = el("div", "network-evidence-heading");
    evidenceHead.append(el("h4", "", "Delivery"),
      action("Add evidence", () => addEvidence(selected), "network-link"));
    const delivery = el("section", "network-delivery");
    delivery.append(evidenceHead);
    const evidence = el("ol", "network-inspector__evidence");
    if (!selected.evidence.length) evidence.append(el("li", "", "No evidence recorded."));
    for (const item of selected.evidence) {
      const li = el("li");
      const statusText = item.status === "accepted" ? "Recorded acceptance"
        : item.status === "unreviewed" ? "Needs review"
        : item.status === "disputed" ? "Disputed" : "Revoked";
      li.append(el("strong", "", statusText),
        el("p", "", item.description),
        el("small", "", item.reference),
        action("Open review", () => reviewEvidence(item.id), "network-link"));
      evidence.append(li);
    }
    delivery.append(evidence);
    inspector.append(delivery);
    if (selected.changedPrerequisites.length) {
      const notice = el("section", "network-dependency-review");
      notice.append(el("h4", "", "Prerequisites changed after this evidence was accepted"), el("p", "", "Earlier acceptance is still recorded. Check whether this deliverable still fits the revised work before relying on its readiness."));
      for (const change of selected.changedPrerequisites) notice.append(action(change.title + " · revision " + (change.before ?? "not yet recorded") + " → " + change.after, () => select(change.id, true), "network-link"));
      notice.append(el("p", "", "Use the evidence review below to record a dispute or revoke acceptance if needed; submit and review fresh evidence for updated work."));
      inspector.append(notice);
    }
    const passages=citationPassages(selected.citation);
    const sourceGroups=capturedSourceSections(sourceText,passages,sourceSectionIndex(sourceText));
    const excerpts=renderCitationExcerpts(document,selected.citation,passages);
    inspector.append(el("p","network-source-version",passages.length>1?"Agreement passages":"Agreement clause"),excerpts.root);
    excerpts.quotes.forEach((quote,index)=>{
      quote.classList.add("network-inspector__quote");
      const passage = quote.parentElement;
      const reading = el("details", "network-passage");
      const groups=sourceGroups.filter(group=>group.indices.includes(index));
      reading.dataset.sourceLabels=groups.map(group=>group.label).filter(Boolean).join(" ");
      const summary=el("summary", "");
      summary.append(el("span","network-passage__heading",groups.map(group=>
        [group.label,group.title].filter(Boolean).join(" · ")).join(" / ")),
        el("small","network-passage__number","Read passage " + (index + 1) + " of " + passages.length));
      reading.append(summary);
      passage.before(reading);
      reading.append(passage);

      quote.parentElement.append(action(passages.length>1?"Locate passage "+(index+1)+" in agreement":"Locate in agreement",()=>{
        readSource(passages[index], () => {
          contract.clearSourceRange();
          contract.setReturnAction(null);
          positionInspector();
          revealWorkspaceTarget(inspector);
          const locate = quote.parentElement.querySelector("button");
          locate?.focus({preventScroll:true});
          locate?.scrollIntoView({block:"center",behavior:"instant"});
        }, "Return to commitment", true);
      },"network-link"));
    });
    const meta = el("dl", "network-inspector__meta");
    for (const [label, value] of [
      ["Revision", String(selected.revision)],
      ["Amount", formatUsdMinor(selected.amountMinor) + " USD"],
      ["Delivery", selected.performer],
      ["Review", selected.reviewer],
      ["Deadline", selected.dueAt ? selected.dueAt.replace("T", " ").replace(".000Z", " UTC") : "Not set"]
    ]) { meta.append(el("dt", "", label), el("dd", "", value)); }
    const terms = el("details", "network-terms");
    terms.append(el("summary", "", "Terms and review parties"), meta);
    inspector.append(terms);
    const pendingAmendment = selected.amendments.find(item => item.status === "pending");
    const amendmentActions = el("div", "network-amendment-actions");
    amendmentActions.append(action(pendingAmendment ? "Review proposed revision " + pendingAmendment.obligation.revision : "Propose an amendment",
      () => onAmendment(selected.id), "network-link network-amendment-link"));
    if (selected.amendments.length) amendmentActions.append(action("Amendment history (" + selected.amendments.length + ")",
      () => onAmendment(selected.id, selected.amendments.at(-1).id), "network-link network-amendment-link"));
    terms.append(amendmentActions);
    if (selected.deadlineState && selected.deadlineState !== "none")
      inspector.append(el("p", "network-deadline", (deadlineNames[selected.deadlineState] ?? selected.deadlineState)
        + (selected.deadlineState === "accepted-late" ? ". Recorded acceptance came after the deadline. Lateness is shown separately from readiness; review the agreed terms before a payment." : "")));

    relatedList(selected.dependsOn, "Requires");
    const downstream = dependentCommitments(items, selected.id);
    relatedList(downstream.map(item => item.id), "Depends on this commitment");

    if (selected.historicalEvidence.length) {
      const history = el("details", "network-evidence-history");
      history.append(el("summary", "", "Earlier revision evidence (" + selected.historicalEvidence.length + ")"));
      const older = el("ol", "network-inspector__evidence");
      for (const item of selected.historicalEvidence) {
        const li = el("li");
        li.append(el("strong", "", "Revision " + item.revision + " · historical"),
          el("p", "", item.description),
          el("small", "", item.reference),
          action("Open historical record", () => reviewEvidence(item.id), "network-link"));
        older.append(li);
      }
      history.append(older); inspector.append(history);
    }
    if (selected.blockers.length) {
      inspector.append(el("p", "network-inspector__blockers",
        selected.blockers.map(code => blockerNames[code] ?? code).join(". ") + "."));
    } else if (selected.state === "ready") {
      inspector.append(el("p", "network-inspector__note",
        "Ready for payment review."));
    } else {
      inspector.append(el("p", "network-inspector__note",
        "Evaluate the current record to check readiness."));
    }
    if (selected.state === "ready" && selected.amountMinor > 0) {
      inspector.append(action("Review this Sandbox payment", () => {
        const chooser = document.querySelector("#pay-obligation");
        if (!chooser || ![...chooser.options].some(option => option.value === selected.id)) return;
        chooser.value = selected.id;
        chooser.dispatchEvent(new Event("change", { bubbles: true }));
        revealWorkspaceTarget(chooser);
        chooser.focus({ preventScroll: true });
        chooser.scrollIntoView({ block: "center" });
      }, "network-action network-action--payment"));
    }
    positionInspector();
  }

  function renderRows() {
      const matches = findCommitments(items, { query: search.value, state: stateFilter.value, deadline: deadlineFilter.value });
      visibleItems = matches.map(match => match.item);
      if (!visibleItems.some(item => item.id === selectedId)) selectedId = visibleItems[0]?.id ?? null;
      root.dataset.empty = String(items.length === 0);
      rows.replaceChildren();
      count.textContent = visibleItems.length + " of " + items.length + " commitments shown."

        + (deadlineFilter.value === "attention" ? " Due now, overdue, or accepted after the deadline." : "")

        + (!evaluatedAt && ((stateFilter.value !== "all" && stateFilter.value !== "unevaluated") || deadlineFilter.value !== "all") ? " Evaluate readiness to use this filter." : "");
      clear.disabled = !search.value && stateFilter.value === "all" && deadlineFilter.value === "all";
      filterToggle.textContent = [stateFilter.value !== "all" ? stateFilter.selectedOptions[0].textContent : "", deadlineFilter.value !== "all" ? deadlineFilter.selectedOptions[0].textContent : ""].filter(Boolean).join(" · ") || "Filters";

      if (!items.length) {
        const empty = el("li", "network-empty");
        empty.append(el("span", "", "Select agreement text to add the first commitment."),
          action("Go to agreement", focusSource, "network-link"));
        rows.append(empty);
      }
      if (items.length && !visibleItems.length) {
        const empty = el("li", "network-empty");
        empty.append(el("span", "", "No commitments match these filters. Your full agreement is unchanged."),
          action("Show all commitments", () => { search.value = ""; stateFilter.value = "all"; deadlineFilter.value = "all"; renderRows(); search.focus(); }, "network-link"));
        rows.append(empty);
      }
      for (const { item, context } of matches) {
        const li = el("li", "network-entry"); li.dataset.state = item.state;
        const button = action("", () => select(item.id), "network-entry__button");
        button.dataset.networkObligation = item.id;
        button.setAttribute("aria-label", "Commitment " + item.index + ", " + item.title
          + ", " + stateNames[item.state] + ", " + formatUsdMinor(item.amountMinor) + " USD"
          + (item.dueAt ? ", deadline " + item.dueAt + ", " + (deadlineNames[item.deadlineState] ?? "not evaluated") : ""));
        button.addEventListener("keydown", event => {
          const current = visibleItems.findIndex(value => value.id === item.id);
          let next = null;
          if (event.key === "ArrowDown") next = Math.min(visibleItems.length - 1, current + 1);
          if (event.key === "ArrowUp") next = Math.max(0, current - 1);
          if (event.key === "Home") next = 0;
          if (event.key === "End") next = visibleItems.length - 1;
          if (next !== null) { event.preventDefault(); select(visibleItems[next].id, true); }
        });
        const source = el("span", "network-entry__stage network-entry__source");
        source.append(el("span", "network-entry__number", String(item.index).padStart(2, "0")),
          el("strong", "network-entry__title", item.title),
          el("span", "network-entry__quote", item.source));
        const proof = el("span", "network-entry__stage");
        proof.append(el("span", "network-entry__key", "Evidence"),
          el("strong", "", item.evidence.length + " record" + (item.evidence.length === 1 ? "" : "s")),
          el("span", "network-entry__sub", item.acceptedCount + " accepted · " +
            item.evidence.filter(e => e.status === "disputed").length + " disputed"));
        const decision = el("span", "network-entry__stage");
        decision.append(el("span", "network-entry__key", "Readiness"),
          el("strong", "network-entry__status", stateNames[item.state]),
          el("span", "network-entry__sub", formatUsdMinor(item.amountMinor) + " USD"));
        if (item.dueAt) {
          const deadline = el("span", "network-entry__deadline",
            (deadlineNames[item.deadlineState] ?? "Deadline not evaluated") + " · " + item.dueAt.replace("T", " ").replace(/:00\.000Z$/, " UTC"));
          deadline.dataset.deadline = item.deadlineState ?? "unevaluated"; source.append(deadline);
        }
        if (context) source.append(el("span", "network-entry__match", context));
        button.append(source, proof, decision); li.append(button);
        const pendingDelivery = item.evidence.find(record => record.status === "unreviewed");
        if (pendingDelivery) {
          const quickReview = el("div", "network-entry__review");
          quickReview.append(el("p", "", pendingDelivery.description), action("Review delivery", () => reviewEvidence(pendingDelivery.id), "primary"));
          li.append(quickReview);
        }
        if (item.dependsOn.length) {
          const dependency = el("div", "network-entry__requires", "Requires ");
          item.dependsOn.forEach((id, index) => {
            const prerequisite = items.find(other => other.id === id);
            if (index) dependency.append(document.createTextNode(" + "));
            dependency.append(action(prerequisite?.title ?? id, () => select(id, true), "network-link"));
          });
          li.append(dependency);
        }
        rows.append(li);
      }
      inspect();
  }
  return {
    refreshDraft() {contract.refreshDraft();},
    readSource,
    reveal(id) {
      if (!items.some(item => item.id === id)) return false;
      revealWorkspaceTarget(root); select(id, true); return true;
    },
    update(view, evaluation) {
      sourceText = view.project.source.text;
      if (projectId !== view.project.id) {
        projectId = view.project.id; search.value = ""; stateFilter.value = "all"; deadlineFilter.value = "all"; selectedId = null; explicitSelection = false;
      }
      items = buildObligationNetwork(view, evaluation);
      contract.update(view, items);
      evaluatedAt = evaluation?.asOf ?? null;
      summary.textContent = evaluation
        ? items.length + " commitments · " + items.filter(item => item.state === "ready").length
          + " ready for review"
        : "Evaluate readiness to check this agreement.";
      summary.title = evaluation ? "Evaluated at " + evaluation.asOf : "";
      renderRows();
    }
  };
}
