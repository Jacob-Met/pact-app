import {AMENDMENT_TERM_FIELDS,renderAmendmentComparison} from "./amendment-terms.mjs";
import { sourceSelection, findSourceText, sourceSearchPassage, sourcePassages, sourceSentencePassages } from "./source-passages.mjs";
import { citationPassages, captureSourceCitation } from "./source-citations.mjs";
import { citationLocation, setCitationQuote } from "./citation-view.mjs";
import { buildAuditTrail } from "./audit-trail.mjs";
import { LIMITS, partyNames } from "./core.mjs";
import { appendEvent, exportProject, previewAmendment, projectView } from "./core.mjs";
import { formatUsdMinor, formatUtcControl, parseUtcControl } from "./ui-utils.mjs";

const amount = value => {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim())) throw new Error("Use dollars with at most two decimal places.");
  const [whole, fraction = ""] = value.trim().split(".");
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(result)) throw new Error("The amount is too large.");
  return result;
};
const moneyInput = value => String(Math.floor(value / 100)) + "." + String(value % 100).padStart(2, "0");
const readiness = row => row.readiness === "ready-for-human-review" ? "Ready for human review" : "Blocked";
const effectKey = impact => JSON.stringify([impact.before.totals, impact.after.totals, impact.changed]);

export function mountAmendments({ document, getProject, createEvent, onCommit, onDraftChange = () => {} }) {
  const el = (tag, className = "", text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const button = (text, handler, className = "") => {
    const node = el("button", className, text); node.type = "button";
    node.addEventListener("click", handler); return node;
  };
  // The existing recovery/workspace exporter owns persistence. No second storage silo.
  const draftForm = el("form"); draftForm.id = "amendment-draft-form"; draftForm.hidden = true;
  const draftState = el("input"); draftState.name = "state"; draftForm.append(draftState);
  const dialog = el("dialog", "amendment-dialog"); dialog.id = "amendment-dialog";
  dialog.setAttribute("aria-labelledby", "amendment-heading");
  document.body.append(draftForm, dialog);
  let snapshot = null, obligationId = null, returnFocus = null, preview = null, timer = null;
  const currentTime = () => new Date().toISOString();
  const projectKey = project => JSON.stringify([project.id, project.createdAt, project.source]);
  const name = id => partyNames(getProject()).find(party => party.id === id)?.name ?? id;
  const title = id => projectView(getProject()).obligations.find(item => item.id === id)?.title ?? id;

  function drafts() {
    if (!draftState.value) return [];
    const value = JSON.parse(draftState.value);
    if (!value || value.format !== "pact-amendment-drafts/v1" || !Array.isArray(value.items)) throw new Error("The saved amendment draft could not be read. Its text was kept; discard it explicitly to start again.");
    return value.projectKey === projectKey(getProject()) ? value.items : [];
  }
  function saveDraft(values, baseRevision) {
    const items = drafts().filter(item => item.obligationId !== obligationId);
    items.push({ obligationId, baseRevision, values });
    draftState.value = JSON.stringify({ format:"pact-amendment-drafts/v1", projectKey:projectKey(getProject()), items });
    onDraftChange();
  }
  function dropDraft() {
    const items = drafts().filter(item => item.obligationId !== obligationId);
    draftState.value = items.length ? JSON.stringify({ format:"pact-amendment-drafts/v1", projectKey:projectKey(getProject()), items }) : "";
    onDraftChange();
  }
  function error(message) {
    const box = dialog.querySelector("#amendment-error");
    box.textContent = message; box.hidden = false; box.focus();
  }
  function attempt(action) {
    const box = dialog.querySelector("#amendment-error"); if (box) box.hidden = true;
    try { return action(); } catch (cause) { error(cause.message); return undefined; }
  }
  function unchanged() {
    if (snapshot !== exportProject(getProject())) throw new Error("The agreement changed while this sheet was open. Close and reopen it to review the current record. Your amendment draft was kept.");
  }
  function record(type, actorId, payload) {
    unchanged();
    const event = createEvent(type, actorId, payload);
    const next = appendEvent(getProject(), event);
    onCommit(next, event);
    snapshot = exportProject(next);
    return event;
  }
  function shell(heading, context) {
    clearTimeout(timer); dialog.replaceChildren(); preview = null;
    const header = el("header", "amendment-header");
    const top = el("div", "amendment-heading-row");
    const h = el("h2", "", heading); h.id = "amendment-heading";
    top.append(h, button("Close", () => dialog.close(), "amendment-close"));
    header.append(top, el("p", "amendment-context", context));
    const box = el("p", "amendment-error"); box.id = "amendment-error"; box.hidden = true;
    box.tabIndex = -1; box.setAttribute("role", "alert");
    const effects = el("section", "amendment-impact"); effects.id = "amendment-impact";
    effects.setAttribute("aria-live", "polite");
    const body = el("div", "amendment-body"); body.id = "amendment-body";
    dialog.append(header, box, effects, body);
    return body;
  }
  function showImpact(impact) {
    const root = dialog.querySelector("#amendment-impact"); root.replaceChildren();
    const ready = el("strong", "amendment-impact-total", "If applied: " + formatUsdMinor(impact.before.totals.readyMinor) + " ready → " + formatUsdMinor(impact.after.totals.readyMinor));
    root.append(ready, el("p", "", "Active allocation " + formatUsdMinor(impact.before.totals.allocatedMinor) + " → " + formatUsdMinor(impact.after.totals.allocatedMinor) + ". " + impact.historicalEvidenceIds.length + " earlier evidence record" + (impact.historicalEvidenceIds.length === 1 ? "" : "s") + " will remain in history; none will satisfy the revised commitment."));
    const list = el("ul", "amendment-impact-list");
    for (const item of impact.changed) {
      const label = item.after.obligationId === impact.candidate.id ? impact.candidate.title : title(item.after.obligationId);
      list.append(el("li", "", label + ": " + readiness(item.before) + " → " + readiness(item.after)));
    }
    root.append(list);
    if (impact.after.obligations.some(item => item.openDisputeIds.length)) root.append(el("p", "amendment-warning", "Open disputes remain open. Applying new terms does not resolve them."));
  }
  const fields = AMENDMENT_TERM_FIELDS;
  function comparison(previous, candidate, controls = null, shownFields = fields, labels = ["Current", "Proposed"]) {
    return renderAmendmentComparison({document,previous,candidate,controls,shownFields,labels,
      parties:partyNames(getProject()),obligations:projectView(getProject()).obligations});
  }
  function select(nameValue, values, selected) {
    const node = el("select"); node.name = nameValue; node.id = "amendment-" + nameValue;
    for (const [value,label] of values) { const option=el("option","",label); option.value=value; node.append(option); }
    node.value = selected; return node;
  }
  function label(text, control) { const node=el("label","amendment-field",text); node.append(control); return node; }
  function input(field, value, type="text", maxLength=1000) {
    const node=el("input"); node.name=field; node.id="amendment-"+field; node.value=value; node.type=type; node.maxLength=maxLength;
    return node;
  }
  function readForm(form) {
    const data = new FormData(form), values = Object.fromEntries(data);
    values.dependsOn = data.getAll("dependsOn");
    // A textarea normalizes line endings; source coordinates retain the original bytes.
    const source=getProject().source.text;
    const passages=values.citationPassages?JSON.parse(values.citationPassages):
      [{start:Number(values.citationStart),end:Number(values.citationEnd),quote:values.citationQuote}];
    if(!Array.isArray(passages))throw new Error("The saved source passages could not be read.");
    values.citationPassages=passages.map(passage=>{
      const {start,end}=passage,quote=source.slice(start,end);
      return Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&start>=0&&end>start&&end<=source.length&&
        quote.replace(/\r\n?/g,"\n")===passage.quote.replace(/\r\n?/g,"\n")?{start,end,quote}:passage;
    });
    values.citationQuote=values.citationPassages[0]?.quote??"";
    return values;
  }
  function candidateFrom(values, previous) {
    return { ...previous, revision:previous.revision+1, title:values.title.trim(), criterion:values.criterion.trim(),
      amountMinor:amount(values.amount), performerId:values.performerId, reviewerId:values.reviewerId,
      dueAt:parseUtcControl(values.dueAt, { optional:true }), dependsOn:values.dependsOn,
      citation:captureSourceCitation(getProject().source,values.citationPassages) };
  }
  function history(body, view) {
    const entries=view.amendments.filter(item=>item.obligation.id===obligationId);
    if (!entries.length) return;
    const details=el("details","amendment-history"); details.append(el("summary","","Previous proposals ("+entries.length+")"));
    const list=el("ol");
    for (const item of [...entries].reverse()) {
      const li=el("li");
      li.append(button("Revision "+item.obligation.revision+" · "+item.status+" · "+name(item.proposedBy),()=>attempt(()=>renderReview(item.id)),"amendment-text-button"),
        el("small","",item.proposedAt));
      list.append(li);
    }
    details.append(list); body.append(details);
  }

  function renderEditor() {
    const project=getProject(), view=projectView(project), previous=view.obligations.find(item=>item.id===obligationId);
    if (!previous) throw new Error("The commitment is no longer present.");
    const pending=view.amendments.find(item=>item.obligation.id===obligationId&&item.status==="pending");
    if (pending) return renderReview(pending.id);
    const body=shell("Propose an amendment",previous.title+" · Revision "+previous.revision+" stays active while the proposed terms are reviewed.");
    const saved=drafts().find(item=>item.obligationId===obligationId);
    const defaults={title:previous.title,criterion:previous.criterion,amount:moneyInput(previous.amountMinor),
      performerId:previous.performerId,reviewerId:previous.reviewerId,dueAt:previous.dueAt?formatUtcControl(previous.dueAt):"",
      dependsOn:[...previous.dependsOn],citationStart:String(previous.citation.start),citationEnd:String(previous.citation.end),citationQuote:previous.citation.quote,
      citationPassages:citationPassages(previous.citation),reason:"",proposedBy:previous.performerId};
    const restored=saved?.baseRevision===previous.revision?saved.values:null;
    const values=restored?{...defaults,...restored}:defaults;
    if(restored&&!Object.hasOwn(restored,"citationPassages"))values.citationPassages=[
      {start:Number(restored.citationStart),end:Number(restored.citationEnd),quote:restored.citationQuote}];
    if (saved&&saved.baseRevision!==previous.revision) body.append(el("p","amendment-warning","A draft for an earlier revision was kept in this tab. The editor below starts from the current revision; recording or discarding this draft replaces that older draft."));
    const form=el("form"); form.id="amendment-form";
    const controls=field=>{
      let node;
      if (field==="citation") {
        const group=el("div","amendment-citation-editor"),list=el("div","amendment-citation-parts");
        let passages=values.citationPassages.map(passage=>({...passage}));
        const savedPassages=input("citationPassages",JSON.stringify(passages),"hidden");
        const firstStart=input("citationStart",values.citationStart,"hidden"),firstEnd=input("citationEnd",values.citationEnd,"hidden");
        group.append(list,savedPassages,firstStart,firstEnd);
        const persist=()=>{saveDraft(readForm(form),previous.revision);update();};
        const draw=()=>{
          list.replaceChildren();savedPassages.value=JSON.stringify(passages);
          firstStart.value=String(passages[0]?.start??0);firstEnd.value=String(passages[0]?.end??0);
          if(!passages.length){
            list.append(el("p","","No source passages selected."),input("citationQuote","","hidden"));
          }
          passages.forEach((passage,index)=>{
            const part=el("div","amendment-citation-part");part.dataset.passageIndex=String(index);
            const heading=el("div","amendment-citation-heading");
            const location=el("small","citation-location",citationLocation({sourceRevision:project.source.revision},passage,index,passages.length));
            const remove=button("Remove passage",()=>attempt(()=>{passages.splice(index,1);draw();persist();}),"amendment-text-button amendment-remove-passage");
            remove.setAttribute("aria-label","Remove source passage "+(index+1));
            heading.append(location,remove);
            const quote=setCitationQuote(document,el("blockquote","amendment-citation-quote"),passage.quote);
            quote.setAttribute("aria-label","Proposed exact source passage "+(index+1));
            part.append(heading,quote);
            if(!index)part.append(input("citationQuote",passage.quote,"hidden"));
            list.append(part);
          });
        };
        draw();
        const include=selected=>{
          if(!selected?.quote.trim())throw new Error("Select a passage from this agreement first.");
          passages=citationPassages(captureSourceCitation(project.source,[...passages,{start:selected.start,end:selected.end,quote:selected.quote}]));
          draw();persist();
        };
        const details=el("details","amendment-source-picker");details.append(el("summary","","Add a source passage"));
        const search=el("input");search.type="search";search.id="amendment-source-find";search.setAttribute("aria-label","Find in agreement");
        search.placeholder="Find in agreement";
        const found=el("p","amendment-source-found");found.setAttribute("aria-live","polite");
        const foundQuote=el("blockquote","amendment-source-found-quote");foundQuote.hidden=true;
        const navigation=el("div","amendment-source-search-actions");
        let matches=[],matchIndex=0,selected=null;
        const paragraphs=sourcePassages(project.source.text),sentences=sourceSentencePassages(project.source.text);
        const previousMatch=button("Previous",()=>{matchIndex=(matchIndex+matches.length-1)%matches.length;showMatch();});
        const nextMatch=button("Next",()=>{matchIndex=(matchIndex+1)%matches.length;showMatch();});
        previousMatch.setAttribute("aria-label","Previous source match");nextMatch.setAttribute("aria-label","Next source match");
        const addFound=button("Add found passage",()=>attempt(()=>include(selected)),"amendment-text-button");addFound.id="amendment-source-add-found";
        function showMatch(){
          selected=matches[matchIndex]?sourceSearchPassage(project.source.text,matches[matchIndex],{passages:paragraphs,sentences}):null;
          found.textContent=matches.length?(matchIndex+1)+" of "+matches.length+" matches":search.value.trim()?"No matching words.":"";
          setCitationQuote(document,foundQuote,selected?.quote??"");foundQuote.hidden=!selected;
          previousMatch.hidden=nextMatch.hidden=matches.length<2;addFound.disabled=!selected;
        }
        search.addEventListener("input",()=>{matches=findSourceText(project.source.text,search.value);matchIndex=0;showMatch();});
        navigation.append(previousMatch,nextMatch,addFound);
        const custom=el("details","amendment-source-custom");custom.append(el("summary","","Select a custom passage"));
        const source=el("textarea");source.id="amendment-source-text";source.value=project.source.text;source.readOnly=true;source.rows=7;
        source.setAttribute("aria-label","Agreement source; select the exact passage");
        const capture=button("Add selected passage",()=>attempt(()=>include(sourceSelection(project.source.text,source.selectionStart,source.selectionEnd))),"amendment-text-button");
        capture.id="amendment-source-add-selection";
        custom.append(source,capture);details.append(search,found,foundQuote,navigation,custom);group.append(details);showMatch();return group;
      }
      if(field==="dependsOn") {
        const group=el("div","amendment-dependencies");
        for(const other of view.obligations.filter(item=>item.id!==previous.id)) {
          const check=input("dependsOn",other.id,"checkbox");check.removeAttribute("id");check.checked=values.dependsOn.includes(other.id);
          group.append(label(other.title,check));
        }
        if(!group.childNodes.length)group.append(el("span","","No other commitments."));
        return group;
      }
      if(field==="performerId"||field==="reviewerId") node=select(field,partyNames(project).map(p=>[p.id,p.name]),values[field]);
      else if(field==="criterion"){node=el("textarea");node.name=field;node.id="amendment-"+field;node.rows=4;node.maxLength=LIMITS.criterion;node.value=values[field];node.required=true;}
      else if(field==="amountMinor"){node=input("amount",values.amount);node.inputMode="decimal";node.required=true;}
      else if(field==="dueAt"){node=input(field,values.dueAt,"datetime-local");node.step="0.001";}
      else {node=input(field,values[field],"text",160);node.required=true;}
      node.setAttribute("aria-label","Proposed "+fields.find(x=>x[0]===field)[1].toLowerCase());
      return node;
    };
    form.append(comparison(previous,{...previous,revision:previous.revision+1},controls));
    const reason=el("textarea");reason.name="reason";reason.id="amendment-reason";reason.maxLength=1000;reason.rows=3;reason.required=true;reason.value=values.reason;
    const author=select("proposedBy",partyNames(project).map(p=>[p.id,p.name]),values.proposedBy);
    form.append(label("Reason for the proposed change",reason),label("Recorded proposer",author),
      el("p","amendment-local-note","Party labels record what the local operator reports. They do not authenticate identity or consent. The source document is retained unchanged."));
    const footer=el("footer","amendment-actions");
    const submit=el("button","primary","Record proposal");submit.type="submit";submit.id="amendment-propose";
    footer.append(submit,button("Discard draft",()=>attempt(()=>{dropDraft();renderEditor();})));
    form.append(footer);body.append(form);history(body,view);
    const update=()=>{
      const values=readForm(form);
      try {
        const candidate=candidateFrom(values,previous);
        preview=previewAmendment(getProject(),candidate,currentTime());showImpact(preview);
        for(const [field] of fields) form.querySelector('[data-term="'+field+'"]').classList.toggle("amendment-changed",JSON.stringify(previous[field])!==JSON.stringify(candidate[field]));
      } catch(cause) {
        preview=null;
        dialog.querySelector("#amendment-impact").textContent=cause.code==="NO_AMENDMENT"?"Edit the terms below to compare the effect of the replacement.":"Complete the proposed terms to see their effect: "+cause.message;
      }
    };
    form.addEventListener("input",()=>attempt(()=>{saveDraft(readForm(form),previous.revision);clearTimeout(timer);timer=setTimeout(()=>attempt(update),120);}));
    form.addEventListener("change",()=>attempt(()=>{saveDraft(readForm(form),previous.revision);update();}));
    form.addEventListener("submit",event=>{
      event.preventDefault();attempt(()=>{
        clearTimeout(timer);unchanged();
        const values=readForm(form),candidate=candidateFrom(values,previous);
        previewAmendment(getProject(),candidate,currentTime());
        const event=createEvent("amendment.proposed",values.proposedBy,{amendment:{id:"amendment-"+crypto.randomUUID(),baseRevision:previous.revision,obligation:candidate,reason:values.reason.trim()}});
        const next=appendEvent(getProject(),event);onCommit(next,event);snapshot=exportProject(next);dropDraft();renderReview(event.payload.amendment.id);
      });
    });
    attempt(update);dialog.scrollTop=0;
  }

  function renderReview(amendmentId) {
    const project=getProject(),view=projectView(project),item=view.amendments.find(value=>value.id===amendmentId);
    if(!item)throw new Error("The proposal is no longer present.");
    obligationId=item.obligation.id;
    const previous=view.obligationVersions.find(value=>value.id===obligationId&&value.revision===item.baseRevision);
    const pending=item.status==="pending";
    const recorded = buildAuditTrail(view).filter(row => row.amendment?.id === amendmentId);
    const body=shell(pending?"Review proposed revision "+item.obligation.revision:"Amendment "+item.status,
      item.obligation.title+" · Proposed by "+(recorded.find(row=>row.event.type==="amendment.proposed")?.actor ?? name(item.proposedBy))+" · "+item.proposedAt);
    const changedFields=fields.filter(([field])=>JSON.stringify(previous[field])!==JSON.stringify(item.obligation[field]));
    const unchangedFields=fields.filter(([field])=>JSON.stringify(previous[field])===JSON.stringify(item.obligation[field]));
    const columnLabels=pending?["Current","Proposed"]:item.status==="adopted"?["Previous","Applied"]:["Before proposal","Not applied"];
    body.append(el("p","amendment-reason-text",item.reason),comparison(previous,item.obligation,null,changedFields,columnLabels));
    const unchangedTerms=el("details","amendment-unchanged");
    unchangedTerms.append(el("summary","","Unchanged source and terms ("+unchangedFields.length+")"));
    unchangedTerms.append(comparison(previous,item.obligation,null,unchangedFields,columnLabels));
    if(unchangedFields.length)body.append(unchangedTerms);
    if(pending) {
      try { preview=previewAmendment(project,item.obligation,currentTime());showImpact(preview); }
      catch(cause){dialog.querySelector("#amendment-impact").textContent="This proposal cannot be applied: "+cause.message;}
    } else {
      dialog.querySelector("#amendment-impact").textContent=item.status==="adopted"
        ?"Applied to the local record by "+(recorded.find(row=>row.event.type==="amendment.adopted")?.actor ?? name(item.closedBy))+" on "+item.closedAt+". Earlier evidence remains in history."
        :"The proposed terms were not applied. Current commitments were preserved.";
    }
    const reviews=el("section","amendment-reviews");reviews.append(el("h3","","Declared reviews"));
    const list=el("ul");
    for(const party of partyNames(project)) {
      const partyReviews=recorded.filter(row=>row.event.type==="amendment.reviewed"&&row.event.actorId===party.id).map(row=>({...row.event.payload,at:row.event.at,actor:row.actor}));
      const review=partyReviews.at(-1);
      const li=el("li");li.append(el("strong","",review?.actor ?? party.name),el("span","",review
        ?(review.decision==="accept"?"Accepted proposal":"Rejected proposal")+" · "+review.at:"No review recorded"));
      if(review)li.append(el("p","",review.reason));
      if(partyReviews.length>1){
        const earlier=el("details");earlier.append(el("summary","","Earlier stated review"));
        for(const prior of partyReviews.slice(0,-1))earlier.append(el("p","",prior.actor+" · "+prior.decision+" · "+prior.at+" · "+prior.reason));
        li.append(earlier);
      }
      list.append(li);
    }
    reviews.append(list,el("p","amendment-local-note","These are locally attributed statements, not verified signatures. Each review refers to this exact proposal."));
    const allReviewed=pending&&item.awaitingPartyIds.length===0;
    let foldedReviews=null;
    if(allReviewed){
      body.append(el("p","amendment-review-summary","Recorded acceptance: "+partyNames(project).map(party=>party.name).join(" · ")));
      foldedReviews=el("details","amendment-review-history");
      foldedReviews.append(el("summary","","Read stated reasons and review history"),reviews);
    }else body.append(reviews);
    if(pending) {
      {
        const form=el("form");form.id="amendment-review-form";
        const actor=select("reviewActor",partyNames(project).map(party=>[party.id,party.name+(item.awaitingPartyIds.includes(party.id)?" — awaiting review":" — acceptance recorded")]),item.awaitingPartyIds[0]||project.parties[0].id);
        const reason=el("textarea");reason.name="reviewReason";reason.id="amendment-reviewReason";reason.rows=2;reason.maxLength=1000;reason.required=true;
        form.append(label("Whose stated review are you recording?",actor),label("Stated review reason",reason));
        const actions=el("div","amendment-actions");
        const accept=el("button","primary","Record acceptance of proposal");accept.type="submit";accept.id="amendment-accept";
        const reject=button("Reject proposal",()=>attempt(()=>{
          if(!reason.value.trim())throw new Error("Enter the party's stated review reason.");
          record("amendment.reviewed",actor.value,{amendmentId,decision:"reject",reason:reason.value.trim()});renderReview(amendmentId);
        }),"danger");reject.id="amendment-reject";
        const updateReviewAction=()=>{accept.disabled=!item.awaitingPartyIds.includes(actor.value);};
        actor.addEventListener("change",updateReviewAction);updateReviewAction();
        if(!allReviewed)actions.append(accept);actions.append(reject);form.append(actions);
        form.addEventListener("submit",event=>{event.preventDefault();attempt(()=>{
          record("amendment.reviewed",actor.value,{amendmentId,decision:"accept",reason:reason.value.trim()});renderReview(amendmentId);
          dialog.querySelector("#amendment-reviewActor, #amendment-apply-ack")?.focus();
        });});
        if(allReviewed){const reconsider=el("details","amendment-reconsider");reconsider.append(el("summary","","Record an objection before applying"),form);body.append(reconsider);}
        else body.append(form);
      }
      if(allReviewed) {
        const footer=el("section","amendment-apply");
        footer.append(el("h3","","All declared reviews recorded"),el("p","","Applying revision "+item.obligation.revision+" replaces the active terms. Submit fresh evidence for the revised commitment. Existing Sandbox requests retain their original terms; no request is cancelled or refunded."));
        const applicationActor=select("applyActor",partyNames(project).map(party=>[party.id,party.name]),item.proposedBy);
        footer.append(label("Record application by",applicationActor));
        const ack=input("applyAck","","checkbox");ack.id="amendment-apply-ack";
        const apply=button("Apply revision "+item.obligation.revision+" to local record",()=>attempt(()=>{
          if(!ack.checked)throw new Error("Review the replacement and its consequences before applying it.");
          unchanged();
          const current=previewAmendment(getProject(),item.obligation,currentTime());
          if(!preview||effectKey(current)!==effectKey(preview)) {
            renderReview(amendmentId);error("Readiness changed while this sheet was open. Review the updated effects before applying the revision.");return;
          }
          record("amendment.adopted",applicationActor.value,{amendmentId});renderReview(amendmentId);
        }),"primary");apply.id="amendment-apply";apply.disabled=true;
        ack.addEventListener("change",()=>{apply.disabled=!ack.checked||!preview;});
        footer.append(label("I reviewed the replacement and the need for fresh evidence.",ack),apply);body.append(footer);
      }
      const withdrawal=el("details","amendment-withdrawal");withdrawal.append(el("summary","","Withdraw this proposal"));
      const reason=el("input");reason.id="amendment-withdraw-reason";reason.maxLength=1000;reason.placeholder="Reason stated by "+name(item.proposedBy);
      const withdraw=button("Record withdrawal by "+name(item.proposedBy),()=>attempt(()=>{
        record("amendment.withdrawn",item.proposedBy,{amendmentId,reason:reason.value.trim()});renderReview(amendmentId);
      }),"danger");withdraw.id="amendment-withdraw";
      withdrawal.append(label("Withdrawal reason",reason),withdraw);body.append(withdrawal);
    } else body.append(button("Propose another amendment",()=>attempt(renderEditor),"amendment-text-button"));
    if(foldedReviews)body.append(foldedReviews);
    history(body,view);dialog.scrollTop=0;
  }

  dialog.addEventListener("close",()=>{
    clearTimeout(timer);
    if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});
    else document.querySelector("#network-inspector button")?.focus({preventScroll:true});
  });
  return {
    open(id, amendmentId=null) {
      returnFocus=document.activeElement;obligationId=id;snapshot=exportProject(getProject());
      const view=projectView(getProject()),pending=view.amendments.find(item=>item.obligation.id===id&&item.status==="pending");
      shell("Amend commitment","Review the current record before changing it.");
      if(!dialog.open)dialog.showModal();
      attempt(()=>amendmentId||pending?renderReview(amendmentId||pending.id):renderEditor());
      if (!dialog.contains(document.activeElement)) dialog.querySelector("button")?.focus();
    },
    clearDrafts(){ draftState.value=""; }
  };
}
