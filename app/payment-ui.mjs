import { resolveSourceReferences, sourceSectionIndex } from "./source-references.mjs";
import { citationPassages, captureSourceCitation, MAX_CITATION_PASSAGES } from "./source-citations.mjs";
import { paymentReadiness } from "./payment-readiness.mjs";
import { LIMITS, projectView, importProject } from "./core.mjs";
import { importWorkspace, isWorkspaceFormat } from "./tab-recovery.mjs";
import { mountPaymentHistory } from "./payment-history.mjs";
import { mountProposalSourceReview } from "./proposal-source-review.mjs";
import { revealWorkspaceTarget } from "./workspace-views.mjs";
import { renderCitationExcerpts, capturedSourceSections } from "./citation-view.mjs";

export function mountPaymentPanel({ getProject, getAsOf, getProposalDraft = () => "", confirmSuggestion, onSuggestion, openSourceReference, showStatus, showError }) {
  const $ = selector => document.querySelector(selector);
  const select = $("#pay-obligation");
  const originalReview=$("#pay-review"),review=document.createElement("div");
  review.id=originalReview.id;review.className=originalReview.className;
  originalReview.replaceWith(review);
  const state = $("#pay-state");
  const approval = $("#pay-approval");
  const confirm = $("#pay-capture");
  const prepare = $("#pay-prepare");
  const restore = $("#pay-restore");
  const inspect = $("#pay-status");
  const ack = $("#pay-acknowledge");
  const ask = $("#ai-suggest");
  let sourceSelectionMode = null;
  const stopLookup = $("#ai-stop");
  const manualSource = $("#ai-manual");
  const missingAttachment = document.createElement("div");
  missingAttachment.id = "ai-missing-attachment";
  missingAttachment.hidden = true;
  manualSource.before(missingAttachment);
  let failedSuggestionSnapshot = null;
  function showMissingAttachments(project, question) {
    const source = project.source.text;
    const names = new Set((question.match(/\b(?:exhibit|appendix|schedule)\s+[a-z0-9]+\b/gi) ?? [])
      .map(name => name.toLowerCase().replace(/\s+/g, " ")));
    const generic = names.size === 0;
    const referenceList = generic ? document.createElement("details") : missingAttachment;
    if (generic) {
      const summary = document.createElement("summary");
      summary.textContent = "Check referenced attachments";
      const explanation = document.createElement("p");
      explanation.textContent = "These attachment references have no matching heading in the supplied text. Open the references to check whether you need another document.";
      referenceList.append(summary, explanation);
    }
    const seen = new Set();
    for (const reference of resolveSourceReferences(source, [{ start: 0, end: source.length }])) {
      const name = reference.quote.replace(/\s+/g, " ").trim();
      const key = name.toLowerCase();
      if (!["missing", "resolved"].includes(reference.status) || (generic ? reference.status !== "missing" : !names.has(key)) || seen.has(key)) continue;
      const target = reference.status === "resolved" && reference.targets.length === 1 ? reference.targets[0] : null;
      if (reference.status === "resolved" && (!target || !openSourceReference)) continue;
      seen.add(key);
      const note = document.createElement("p");
      note.textContent = target ? "Read " + name + " in the supplied agreement to inspect its wording." : name + " is referenced in this agreement, but no matching attachment heading was found. Check the reference and obtain the attachment if it was not supplied.";
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Read " + name + (target ? "" : " reference");
      button.addEventListener("click", () => {
        if (failedSuggestionSnapshot !== JSON.stringify(getProject())) return;
        if (target) { openSourceReference(target); return; }
        const search = $("#source-find");
        search.value = reference.quote;
        search.dispatchEvent(new Event("input", { bubbles: true }));
        revealWorkspaceTarget(search);
        search.focus({ preventScroll: true });
        search.scrollIntoView({ block: "center" });
      });
      referenceList.append(note, button);
    }
    if (generic && seen.size) missingAttachment.append(referenceList);
    missingAttachment.hidden = !missingAttachment.childNodes.length;
  }
  function showRefusedSelection(project, selected) {
    const source = project.source;
    if (selected?.sourceId !== source.id || selected?.sourceRevision !== source.revision ||
        !Array.isArray(selected?.passages) || !selected.passages.length ||
        selected.passages.length > MAX_CITATION_PASSAGES) return;
    let citation;
    try {
      citation = captureSourceCitation(source, selected.passages.map(({start,end}) =>
        ({start,end,quote:source.text.slice(start,end)})));
    } catch { return; }
    const passages = citationPassages(citation);
    const details = document.createElement("details");
    details.id = "ai-selected-wording";
    const summary = document.createElement("summary");
    summary.textContent = "Read selected wording · " + passages.length + " passages";
    const explanation = document.createElement("p");
    explanation.textContent = "The lookup did not produce a proposal. Review these selected passages and any other governing conditions in the agreement.";
    const groups = capturedSourceSections(source.text, passages, sourceSectionIndex(source.text));
    summary.textContent = "Read selected wording · " + groups.length + " source sections";
    details.append(summary,explanation);
    for (const group of groups) {
      const section = document.createElement("details");
      section.className = "captured-source-passage captured-source-section";
      section.dataset.selectedSection = group.label || group.key;
      const heading = document.createElement("summary");
      const label = document.createElement("span");label.className = "captured-source-index";
      label.textContent = group.label || "Source";
      const title = document.createElement("span");title.className = "captured-source-title";
      title.textContent = group.title;
      heading.append(label,title);section.append(heading);
      const {root} = renderCitationExcerpts(document, citation, group.ranges);
      if (openSourceReference) [...root.querySelectorAll(".citation-excerpt")].forEach((node,index) => {
        const button = document.createElement("button");button.type = "button";
        button.textContent = "Read passage" + (group.ranges.length > 1 ? " " + (index + 1) : "") + " in agreement";
        button.addEventListener("click", () => {
          if (failedSuggestionSnapshot !== JSON.stringify(getProject())) return;
          openSourceReference({kind:"passage",label:group.label || String(index + 1),
            start:group.ranges[index].start,end:group.ranges[index].end});
        });
        node.prepend(button);
      });
      section.append(root);details.append(section);
    }
    missingAttachment.append(details);
    missingAttachment.hidden = false;
  }
  function showLongSourceSections(project, sections) {
    if (!openSourceReference || !Array.isArray(sections) || sections.length > 16) return;
    const indexed = sourceSectionIndex(project.source.text);
    const seen = new Set();
    for (const section of sections) {
      if (section?.kind !== "section" || !Number.isSafeInteger(section.start) || !Number.isSafeInteger(section.end)) continue;
      const target = indexed.find(item => item.label === section.label && item.start <= section.start && item.end === section.end);
      if (!target || seen.has(target.label)) continue;
      seen.add(target.label);
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Read " + target.label + " in original agreement";
      button.addEventListener("click", () => {
        if (failedSuggestionSnapshot !== JSON.stringify(getProject())) return;
        openSourceReference(target);
      });
      missingAttachment.append(button);
    }
    missingAttachment.hidden = !missingAttachment.childNodes.length;
  }
  manualSource.addEventListener("click", () => {
    const passage = $("#source-find");
    revealWorkspaceTarget(passage);
    passage.focus({ preventScroll: true });
    passage.scrollIntoView({ block: "center" });
  });
  let activeSuggestionRequest = null;
  function finishLookupControls() {
    ask.disabled = false;
    ask.removeAttribute("aria-busy");
    stopLookup.hidden = true;
  }
  function stopSuggestion(message, focus = false) {
    if (!activeSuggestionRequest) return;
    const request = activeSuggestionRequest;
    activeSuggestionRequest = null;
    request.controller.abort();
    finishLookupControls();
    label($("#ai-state"), message);
    if (focus) $("#ai-objective").focus();
  }
  stopLookup.addEventListener("click", () => stopSuggestion("Lookup stopped. Your draft was kept.", true));
  const acknowledgement = ack.closest("label");
  const receipt = document.createElement("div");
  receipt.id = "pay-receipt";
  receipt.className = "payment-receipt";
  receipt.hidden = true;
  const receiptStatus = document.createElement("p");
  receiptStatus.className = "payment-receipt-status";
  const receiptAmount = document.createElement("strong");
  receiptAmount.className = "payment-receipt-amount";
  const receiptTitle = document.createElement("p");
  receiptTitle.className = "payment-receipt-title";
  receipt.append(receiptStatus, receiptAmount, receiptTitle);
  review.before(receipt);
  const sourceDetails = document.createElement("details");
  sourceDetails.className = "payment-source-details";
  const sourceSummary = document.createElement("summary");
  sourceSummary.textContent = "Agreed clause";
  review.before(sourceDetails);
  sourceDetails.append(sourceSummary, review);
  const referenceDetails = document.createElement("details");
  referenceDetails.className = "payment-reference-details";
  const referenceSummary = document.createElement("summary");
  referenceSummary.textContent = "Payment references";
  state.before(referenceDetails);
  referenceDetails.append(referenceSummary, state);
  const historyDetails = document.createElement("details");
  historyDetails.className = "payment-history-details";
  historyDetails.open = false;
  const historySummary = document.createElement("summary");
  historySummary.textContent = "Payment history";
  const historyAnchor = document.createElement("span");
  historyDetails.append(historySummary, historyAnchor);
  referenceDetails.after(historyDetails);
  let current = null, busy = false;
  let providerState = "checking";
  const readiness = document.createElement("p");
  readiness.id = "pay-readiness";
  readiness.className = "checkout-proof";
  readiness.setAttribute("role", "status");
  sourceDetails.after(readiness);
  prepare.setAttribute("aria-describedby", "pay-readiness");
  const sharedReview = document.createElement("button");
  sharedReview.type = "button";
  sharedReview.textContent = "Review received records";
  sharedReview.hidden = true;
  sharedReview.className = "primary";
  readiness.after(sharedReview);
  sharedReview.addEventListener("click",()=>document.dispatchEvent(new Event(sharedMismatchCode==="SHARED_HISTORY_UNPUBLISHED"?"pact-open-shared-review":"pact-review-shared-records")));
  let sharedMismatch = null, sharedMismatchCode = null, sharedMismatchMessage = "";
  document.addEventListener("pact-shared-history-published",()=>{sharedMismatch=null;sharedReview.hidden=true;clearReview();paint();});
  let existingRecovery=null, focusExistingReview=false;
  const originalProofs=new Map();
  const originalLabel=document.createElement("label");
  originalLabel.textContent="Original saved agreement";
  const originalFile=document.createElement("input");
  originalFile.type="file";originalFile.accept=".json,application/json";
  originalFile.id="pay-original-agreement";originalLabel.append(originalFile);
  originalLabel.hidden=true;readiness.after(originalLabel);
  const retryExisting=document.createElement("button");
  retryExisting.type="button";retryExisting.textContent="Read existing request again";
  retryExisting.hidden=true;originalLabel.after(retryExisting);
  retryExisting.addEventListener("click",()=>execute(async()=>{if(existingRecovery)await previewExistingRecovery(existingRecovery);}));
  originalFile.addEventListener("change",()=>execute(async()=>{
    const recovery=existingRecovery,file=originalFile.files[0];
    if(!recovery||!file)return;
    if(file.size>16*1024*1024)throw new Error("Choose a saved agreement file no larger than 16 MiB.");
    const raw=await file.text(),parsed=JSON.parse(raw);
    const original=isWorkspaceFormat(parsed?.format)?importWorkspace(raw).project:importProject(raw);
    if(!original)throw new Error("This file has no saved agreement.");
    if(existingRecovery!==recovery||recovery.context!==reviewContext())return;
    recovery.originalProject=original;
    await previewExistingRecovery(recovery);
  }));
  let pendingSuggestion = null;
  const proposalReview = $("#ai-review");
  const proposalSourceReview = mountProposalSourceReview({ document });
  function clearProposal() {
    failedSuggestionSnapshot = null;
    manualSource.hidden = true;
    missingAttachment.replaceChildren();
    missingAttachment.hidden = true;
    pendingSuggestion = null;
    proposalReview.hidden = true;
    label($("#ai-review-title"), "");
    proposalSourceReview.clear();
  }
  function applySuggestion(proposal) {
    clearProposal();
    onSuggestion(proposal);
    $("#obligation-form [name=criterion]").focus();
    if (proposal.conditionCoverage) {
      label($("#ai-state"), "Selected source passages copied into your draft.");
      showStatus("Draft ready for review.");
      return;
    }
    if (proposal.sourceContextExpanded && !proposal.sourceSelectionEdited) {
      label($("#ai-state"), "The model selected a fragment. PACT retained its complete source sentence and used that wording as the draft criterion so conditions remain visible. Verify and edit before recording.");
      showStatus("Complete source context loaded for human review. No obligation was recorded.");
      return;
    }
    label($("#ai-state"), proposal.criterion
      ? "Exact quotation copied into your draft."
      : "Exact quotation found, but too long for the completion field. Write a complete criterion manually. Model requests do not record obligations.");
    showStatus("Draft ready for review.");
  }
  $("#ai-apply").addEventListener("click", () => {
    const candidate = pendingSuggestion;
    if (!candidate) return;
    const apply = () => {
      if (candidate !== pendingSuggestion || candidate.snapshot !== JSON.stringify(getProject())) {
        clearProposal();
        label($("#ai-state"), "Agreement changed. Request a new proposal for the current source.");
        return;
      }
      const criterionLimit = $("#obligation-form [name=criterion]").maxLength;
      applySuggestion(proposalSourceReview.proposal(criterionLimit > 0 ? criterionLimit : LIMITS.criterion));
    };
    if (candidate.draftSnapshot !== getProposalDraft()) confirmSuggestion(apply);
    else apply();
  });
  $("#ai-edit-question").addEventListener("click", () => {
    clearProposal();
    label($("#ai-state"), "");
    $("#ai-objective").focus();
  });
  $("#ai-keep-draft").addEventListener("click", () => {
    clearProposal();
    label($("#ai-state"), "Your draft was kept. The returned proposal was dismissed.");
    $("#obligation-form [name=criterion]").focus();
  });
  // A response belongs to the exact agreement and obligation that sent it.
  // Keep completed requests available when the operator switches back.
  const checkouts = new Map();
  const usd = minor => "$" + (minor / 100).toFixed(2);
  const label = (value, message) => { value.textContent = message; };
  async function post(path, body, signal) {
    const response = await fetch(path, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(body), ...(signal ? { signal } : {})
    });
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(result.error || result.code || "Request failed."),{code:result.code, sourceReviewSections:result.sourceReviewSections, sourceReviewSelection:result.sourceReviewSelection});
    return result;
  }
  function projectEntry() {
    const project = getProject();
    if (!project) return null;
    const id = select.value;
    return projectView(project).obligations.find(item => item.id === id) || null;
  }
  // A checkbox only reviews the exact currently selected obligation and event history.
  // Even a different evaluation instant can change deadline/readiness semantics.
  let acknowledgedContext = null;
  function reviewContext() {
    const project = getProject();
    if (!project || !projectEntry()) return null;
    try { return JSON.stringify([project, select.value, getAsOf()]); }
    catch { return null; }
  }
  function clearReview() {
    ack.checked = false;
    acknowledgedContext = null;
  }
  function requestContext(entry = projectEntry()) {
    return {
      snapshot: JSON.stringify(getProject()),
      obligationId: entry.id, title: entry.title, amountMinor: entry.amountMinor,
      key: current?.key || null
    };
  }
  function rememberCheckout(result, context) {
    if (result.obligationId !== context.obligationId || (context.key && result.key !== context.key)) {
      throw new Error("The returned checkout does not match the requested obligation. Inspect PayPal before another write.");
    }
    checkouts.set(result.key, { snapshot: context.snapshot, result });
    paint();
    if (current?.key === result.key) return true;
    const reference = (result.orderId || "unconfirmed order") + " · " + context.title +
      " · " + usd(context.amountMinor);
    if (context.snapshot === JSON.stringify(getProject())) {
      showStatus("Sandbox result kept for " + reference + ". Select that obligation to inspect it.");
    } else {
      showStatus("Sandbox result belongs to an earlier agreement history: " + reference +
        ". Read its status in previous request history; do not create a replacement order.");
    }
    return false;
  }
  async function previewExistingRecovery(recovery) {
    recovery.preview=null;recovery.retryable=false;
    try{
      const preview=await post("/api/paypal/review-preview",{
        key:recovery.key,project:JSON.parse(recovery.snapshot),asOf:recovery.asOf,
        ...(recovery.originalProject?{originalProject:recovery.originalProject}:{})
      });
      if(existingRecovery!==recovery||recovery.context!==reviewContext())return;
      if(preview.key!==recovery.key||preview.obligationId!==recovery.obligationId)
        throw new Error("The returned request does not match this commitment.");
      recovery.preview=preview;recovery.needsOriginal=false;
      if(recovery.originalProject)originalProofs.set(recovery.key,recovery.originalProject);
      recovery.message="The agreed terms and amount are unchanged. Review the current evidence and continue this existing request.";
      clearReview();focusExistingReview=true;
      historyDetails.open=false;
    }catch(cause){
      if(existingRecovery!==recovery||recovery.context!==reviewContext())return;
      if(["SHARED_HISTORY_CHANGED","SHARED_HISTORY_UNPUBLISHED"].includes(cause.code))throw cause;
      recovery.message=cause.message||"The existing request could not be read.";
      recovery.needsOriginal=["ORIGINAL_AGREEMENT_REQUIRED","ORIGINAL_AGREEMENT_MISMATCH"].includes(cause.code);
      recovery.retryable=!recovery.needsOriginal&&!["ORDER_TERMS_CHANGED","OBLIGATION_BLOCKED","PAYMENT_ALREADY_CAPTURED","OTHER_PAYMENT_REQUEST","RECONCILE_FIRST"].includes(cause.code);
      if(!recovery.needsOriginal)historyDetails.open=true;
    }
  }
  async function beginExistingRecovery(chosen=null) {
    const entry=projectEntry();if(!entry)throw new Error("Choose a commitment.");
    const context=reviewContext(),snapshot=JSON.stringify(getProject()),asOf=getAsOf();
    const saved=await post("/api/paypal/history",{project:JSON.parse(snapshot),obligationId:entry.id});
    if(context!==reviewContext())return;
    if(saved.projectId!==getProject().id||saved.obligationId!==entry.id||!Array.isArray(saved.requests))
      throw new Error("The saved requests do not match this commitment.");
    history.showRecords(saved.requests);
    const record=chosen?saved.requests.find(item=>item.key===chosen.key):saved.requests.length===1?saved.requests[0]:null;
    existingRecovery={context,snapshot,asOf,obligationId:entry.id,record,key:record?.key??null,preview:null,needsOriginal:false,retryable:false,
      message:record?"Reading the existing request…":"Choose a saved request below to inspect its current agreement review."};
    clearReview();originalFile.value="";
    if(!record){historyDetails.open=true;return;}
    if(record.state==="captured"){
      existingRecovery.message="This commitment already has a captured payment. Its completed request is available in Payment history.";
      historyDetails.open=true;return;
    }
    const remembered=checkouts.get(record.key);
    if(originalProofs.has(record.key))existingRecovery.originalProject=originalProofs.get(record.key);
    else if(remembered)existingRecovery.originalProject=JSON.parse(remembered.snapshot);
    await previewExistingRecovery(existingRecovery);
  }
  function paint() {
    if(existingRecovery&&existingRecovery.context!==reviewContext()){
      existingRecovery=null;focusExistingReview=false;originalFile.value="";
    }
    originalLabel.hidden=!existingRecovery?.needsOriginal;
    originalFile.disabled=busy;
    retryExisting.hidden=!existingRecovery?.retryable;
    retryExisting.disabled=busy;

    if(sharedMismatch && sharedMismatch!==JSON.stringify(getProject())){
      sharedMismatch=null;sharedReview.hidden=true;
    }
    if (ack.checked && (!acknowledgedContext || acknowledgedContext !== reviewContext())) clearReview();
    const entry = projectEntry();
    const snapshot = JSON.stringify(getProject());
    const previous = current;
    current = null;
    for (const saved of checkouts.values()) {
      if (saved.snapshot === snapshot && saved.result.obligationId === select.value) {
        current = saved.result;
        break;
      }
    }
    if (current) {
      label(state, "Sandbox order " + (current.orderId || "unconfirmed") + " · " + current.state +
        (current.captureId ? " · capture " + current.captureId : ". Creating an order does not collect payment."));
    } else if (previous) {
      label(state, previous.obligationId === select.value
        ? "Agreement history changed. Old checkout cannot be captured from this review."
        : "No sandbox request for this selection.");
    }
    if (entry) {
      const passages=citationPassages(entry.citation);
      review.replaceChildren(renderCitationExcerpts(document,entry.citation,passages).root);
    } else {
      label(review, "Select an exact, source-cited obligation.");
    }
    let evaluationTime = "";
    try { evaluationTime = getAsOf(); } catch {}
    const eligibility = paymentReadiness(getProject(), select.value, evaluationTime, providerState);
    label(readiness, eligibility.message);
    const canPrepare = Boolean(eligibility.eligible && ack.checked && !busy && !current);
    prepare.disabled = !canPrepare || Boolean(existingRecovery&&!existingRecovery.preview);
    ack.disabled=busy;
    restore.disabled = !entry || busy || Boolean(current);
    inspect.disabled = !current || busy;
    confirm.disabled = !current || busy || current.state !== "approved-by-payer";
    const needsApproval = current?.state === "awaiting-payer";
    receipt.hidden = !entry;
    if (entry) {
      receipt.dataset.state = current?.state || "review";
      receiptStatus.textContent = ({ captured: "Payment captured", "awaiting-payer": "Awaiting payer approval",
        "approved-by-payer": "Ready to capture", uncertain: "Check payment status",
        preparing: "Preparing payment", capturing: "Confirming capture", voided: "Payment voided" })[current?.state] || (eligibility.eligible ? "Review payment" : "Payment prerequisites");
      receiptAmount.textContent = current ? "$" + current.amount : usd(entry.amountMinor);
      const currency = document.createElement("span");
      currency.className = "payment-currency";
      currency.textContent = " USD";
      receiptAmount.append(currency);
      receiptTitle.textContent = entry ? entry.title + " · revision " + entry.revision : "";
    }
    sourceDetails.hidden = !entry;
    if (!current || previous?.key !== current.key) {
      sourceDetails.open = !current;
      if (previous?.key !== current?.key) historyDetails.open = false;
    }
    referenceDetails.hidden = !current;
    readiness.hidden = Boolean(current) || !entry || eligibility.eligible;
    acknowledgement.hidden = Boolean(current) || !entry || !eligibility.eligible;
    acknowledgement.querySelector("span").textContent = entry
      ? "I reviewed "+(citationPassages(entry.citation).length>1?"these "+citationPassages(entry.citation).length+" passages":"this clause")+" and " + usd(entry.amountMinor) + " USD." : "I reviewed this payment.";
    prepare.hidden = Boolean(current) || !entry || !eligibility.eligible;
    prepare.textContent = "Create payment request";
    restore.hidden = Boolean(current) || !entry;
    restore.textContent = "View saved payment request";
    confirm.hidden = !current || current.state !== "approved-by-payer";
    inspect.hidden = !current;
    inspect.textContent = "Refresh payment status";
    confirm.textContent = current ? "Capture $" + current.amount : "Capture payment";
    $("#provider-config").hidden = true;
    $("#checkout-heading").textContent = "Payment";
    {
      const badge = document.createElement("span");
      badge.className = "payment-sandbox-badge";
      badge.textContent = "Sandbox";
      $("#checkout-heading").append(badge);
    }
    approval.hidden = !needsApproval || !current?.approvalUrl;
    if (current?.approvalUrl) {
      approval.href = current.approvalUrl;
      approval.textContent = "Approve $" + current.amount + " with PayPal";
    } else approval.removeAttribute("href");
    const passageCount=entry?citationPassages(entry.citation).length:0;
    sourceSummary.textContent=(existingRecovery?"Current agreed":"Agreed")+(passageCount>1?" passages ("+passageCount+")":" clause");
    if(existingRecovery){
      current=null;
      const saved=existingRecovery.record;
      receipt.hidden=!saved;
      if(saved){
        receiptAmount.textContent="$"+saved.amount;
        const currency=document.createElement("span");currency.className="payment-currency";currency.textContent=" USD";receiptAmount.append(currency);
        receiptTitle.textContent=existingRecovery.preview
          ?existingRecovery.preview.currentTitle+" · revision "+saved.obligationRevision
          :"Saved request · revision "+saved.obligationRevision;
      }
      receiptStatus.textContent=saved?.state==="captured"?"Previous payment captured":existingRecovery.preview?"Review existing request":"Existing payment request";
      label(readiness,existingRecovery.message);readiness.hidden=false;
      sourceDetails.open=Boolean(existingRecovery.preview);
      acknowledgement.hidden=!existingRecovery.preview||!eligibility.eligible;
      prepare.hidden=!existingRecovery.preview||!eligibility.eligible;
      prepare.textContent="Use existing request";
      restore.hidden=true;confirm.hidden=true;approval.hidden=true;inspect.hidden=true;referenceDetails.hidden=true;
    }
    if(sharedMismatch){
      originalLabel.hidden=true;retryExisting.hidden=true;
      label(readiness,sharedMismatchMessage);
      sourceDetails.open=false;
      readiness.hidden=false;
      receiptStatus.textContent="Review changed records";
      prepare.hidden=true;confirm.hidden=true;acknowledgement.hidden=true;approval.hidden=true;
    }
    history.refresh({ busy });
  }
  function refresh() {
    const project = getProject();
    if (activeSuggestionRequest && activeSuggestionRequest.snapshot !== JSON.stringify(project)) {
      stopSuggestion("Agreement changed. The previous lookup was stopped.");
    }
    if (failedSuggestionSnapshot && failedSuggestionSnapshot !== JSON.stringify(project)) {
      clearProposal();
      label($("#ai-state"), "");
    }
    if (pendingSuggestion && pendingSuggestion.snapshot !== JSON.stringify(project)) {
      clearProposal();
      label($("#ai-state"), "Agreement changed. Previous proposal cleared.");
    }
    const selected = select.value;
    select.replaceChildren();
    const blank = new Option("Choose a source-cited obligation", "");
    select.add(blank);
    if (project) {
      for (const value of projectView(project).obligations) {
        select.add(new Option(value.title + " · revision " + value.revision + " · " + usd(value.amountMinor), value.id));
      }
    }
    if ([...select.options].some(option => option.value === selected)) select.value = selected;
    paint();
  }
  function recordSharedMismatch(cause){
    if(!["SHARED_HISTORY_CHANGED","SHARED_HISTORY_UNPUBLISHED"].includes(cause.code))return false;
    sharedMismatch=JSON.stringify(getProject());sharedMismatchCode=cause.code;sharedMismatchMessage=cause.message;
    sharedReview.textContent=cause.code==="SHARED_HISTORY_UNPUBLISHED"?"Open shared review":"Review received records";
    sharedReview.hidden=false;existingRecovery=null;clearReview();return true;
  }
  async function execute(handler) {
    if (busy) return;
    busy = true; paint();
    try { await handler(); } catch (cause) {
      if(!recordSharedMismatch(cause)){
        if(["PREVIOUS_ORDER_EXISTS","ORDER_SNAPSHOT_CHANGED"].includes(cause.code)){
          try{await beginExistingRecovery();}
          catch(error){if(!recordSharedMismatch(error))showError(error.message||"The existing request could not be read.");}
        }else showError(cause.message || "Request failed.");
      }
    }
    finally {
      busy = false;paint();
      if(sharedMismatch)sharedReview.focus({preventScroll:true});
      else if(focusExistingReview&&existingRecovery?.preview){
        focusExistingReview=false;ack.focus({preventScroll:true});receipt.scrollIntoView({block:"nearest"});
      }
    }
  }
  select.addEventListener("change", () => {
    clearReview();
    current = null;
    label(state, "No sandbox request for this selection.");
    paint();
  });
  ack.addEventListener("change", () => {
    acknowledgedContext = ack.checked ? reviewContext() : null;
    if (!acknowledgedContext) ack.checked = false;
    paint();
  });
  prepare.addEventListener("click", () => execute(async () => {
    const entry = projectEntry();
    if (!entry) throw new Error("Choose an obligation.");
    if (!ack.checked || !acknowledgedContext || acknowledgedContext !== reviewContext()) {
      clearReview();
      throw new Error("Review the current clause, amount and readiness before preparing a Sandbox order.");
    }
    const project = getProject();
    const context = requestContext(entry);
    const asOf = getAsOf();
    const eligibility = paymentReadiness(project, entry.id, asOf, providerState);
    if (!eligibility.eligible) throw new Error(eligibility.message);
    if(existingRecovery?.preview){
      const recovery=existingRecovery;
      if(recovery.context!==reviewContext())throw new Error("Review the current agreement again before continuing this request.");
      const result=await post("/api/paypal/review-existing",{
        key:recovery.key,project,asOf,reviewSignature:recovery.preview.reviewSignature,
        ...(recovery.originalProject?{originalProject:recovery.originalProject}:{}),
        confirm:"REVIEW EXISTING SANDBOX ORDER"
      });
      if(existingRecovery===recovery)existingRecovery=null;
      clearReview();
      if(rememberCheckout(result,{...context,key:recovery.key}))
        showStatus("The existing request now uses this reviewed history. Continue its payer approval or separate capture step.");
      return;
    }
    const result = await post("/api/paypal/prepare", {
      project, obligationId: entry.id, asOf, acknowledge: ack.checked
    });
    if (rememberCheckout(result, context)) {
      showStatus("Payment request ready for payer approval.");
    }
  }));
  restore.addEventListener("click", () => execute(async () => {
    const entry = projectEntry();
    if (!entry) throw new Error("Choose an obligation.");
    const project = getProject();
    const context = requestContext(entry);
    const result = await post("/api/paypal/restore", { project, obligationId: entry.id });
    if (rememberCheckout(result, context)) {
      showStatus("Saved payment request opened.");
    }
  }));
  inspect.addEventListener("click", () => execute(async () => {
    if (!current) throw new Error("Prepare or restore an order first.");
    const context = requestContext();
    const result = await post("/api/paypal/status", { key: context.key });
    if (rememberCheckout(result, context)) showStatus("PayPal status refreshed.");
  }));
  confirm.addEventListener("click", () => execute(async () => {
    if (!current || current.state !== "approved-by-payer") throw new Error("PayPal payer approval is required.");
    const context = requestContext();
    if (!window.confirm("Capture $" + current.amount + " USD in PayPal Sandbox?")) return;
    const result = await post("/api/paypal/capture", {
      key: context.key, project: getProject(), asOf: getAsOf(), confirm: "CAPTURE SANDBOX ORDER"
    });
    if (rememberCheckout(result, context) && result.state === "captured") {
      showStatus("Payment captured.");
    }
  }));
  ask.addEventListener("click", async () => {
    if (activeSuggestionRequest) return;
    const project = getProject();
    const question = $("#ai-objective").value.trim();
    if (!project || !question) {
      showError(!project ? "Start a project first." : "Enter the clause question you need help understanding.");
      return;
    }
    const snapshot = JSON.stringify(project);
    const draftSnapshot = getProposalDraft();
    const requestStartedFromButton = document.activeElement === ask;
    const request = { controller: new AbortController(), snapshot };
    activeSuggestionRequest = request;
    clearProposal();
    ask.disabled = true;
    ask.setAttribute("aria-busy", "true");
    stopLookup.hidden = false;
    label($("#ai-state"), "Finding the relevant passage…");
    try {
      const proposal = await post("/api/ai/suggest", { project, objective: question,
        ...(sourceSelectionMode ? { citationMode: sourceSelectionMode } : {}) }, request.controller.signal);
      // An old response cannot reopen review or change a newer request's controls.
      if (activeSuggestionRequest !== request) return;
      if (snapshot !== JSON.stringify(getProject())) {
        label($("#ai-state"), "Agreement changed during the model request. Proposal was discarded.");
        return;
      }
      const focusResponse = requestStartedFromButton &&
        (document.activeElement === ask || document.activeElement === document.body);
      proposalSourceReview.show(project.source.text, proposal);
      pendingSuggestion = { proposal, snapshot, draftSnapshot };
      label($("#ai-review-title"), question);
      proposalReview.hidden = false;
      label($("#ai-state"), "");
      if (focusResponse) proposalSourceReview.focusAnswer();
    } catch (cause) {
      if (activeSuggestionRequest !== request) return;
      if (snapshot !== JSON.stringify(getProject())) {
        label($("#ai-state"), "Agreement changed during the model request. Selection was discarded.");
        return;
      }
      const manualMessages = {
        AI_NOT_CONFIGURED: "Source lookup is unavailable.",
        AI_CONFIG: "Source lookup is unavailable.",
        AI_UNAVAILABLE: "Source lookup is unavailable.",
        AI_HTTP_ERROR: "Source lookup is unavailable.",
        AI_NO_MATCH: "No passage was selected.",
        AI_UNGROUNDED: "No reliable passage was returned.",
        AI_AMBIGUOUS: "The quotation appears in more than one place.",
        AI_CONTEXT_TOO_LONG: "Choose the complete passage directly."
      };
      const message = Object.hasOwn(manualMessages, cause.code) ? manualMessages[cause.code] : null;
      label($("#ai-state"), message || cause.message || "Source lookup failed.");
      if (message) {
        failedSuggestionSnapshot = snapshot;
        if (cause.code === "AI_NO_MATCH") showMissingAttachments(project, question);
        if (cause.code === "AI_CONTEXT_TOO_LONG") {
          showRefusedSelection(project, cause.sourceReviewSelection);
          showLongSourceSections(project, cause.sourceReviewSections);
        }
        manualSource.hidden = false;
        if (requestStartedFromButton && (document.activeElement === ask || document.activeElement === document.body)) manualSource.focus();
      } else showError(cause.message || "Source lookup failed.");
    } finally {
      if (activeSuggestionRequest === request) {
        activeSuggestionRequest = null;
        finishLookupControls();
      }
    }
  });
  Promise.resolve().then(async () => {
    try {
      const config = await fetch("/api/config").then(response => {
        if (!response.ok) throw new Error("Provider configuration unavailable");
        return response.json();
      });
      providerState = config.paypalConfigured === true ? "configured" : "not-configured";
      sourceSelectionMode = config.aiSourceSelection === "separate-passages" ? config.aiSourceSelection : null;
      label($("#provider-config"), "Language model: " + (config.aiConfigured ? "configured" : "not configured") +
        " · PayPal Sandbox: " + (config.paypalConfigured ? "configured" : "not configured"));
    } catch {
      providerState = "unavailable";
      label($("#provider-config"), "Provider status is unavailable; this is not proof of a successful payment.");
    }
    paint();
  });
  const history = mountPaymentHistory({
    anchor: historyAnchor, post, run: execute, showStatus,
    onReviewExisting:record=>execute(()=>beginExistingRecovery(record)),
    getContext: () => {
      const project = getProject(), entry = projectEntry();
      return project && entry ? { project, obligationId: entry.id, obligationRevision: entry.revision, amountMinor: entry.amountMinor, title: entry.title } : null;
    }
  });
  $("#pay-history-load").addEventListener("click", () => { historyDetails.open = true; });
  refresh();
  return { refresh };
}
