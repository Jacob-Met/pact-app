import {mountContractDocument} from "./contract-document.mjs";
import {AMENDMENT_TERM_FIELDS,renderAmendmentComparison} from "./amendment-terms.mjs";
import {renderEvidenceFile,deliveryReferenceUrl} from "./evidence-file.mjs";
import {projectView,partyNames,previewAmendment} from "./core.mjs";
import {formatUsdMinor} from "./ui-utils.mjs";
import {citationPassages} from "./source-citations.mjs";
import {renderCitationExcerpts,setCitationQuote} from "./citation-view.mjs";
import {mountSourceReferences} from "./source-references-ui.mjs";
const $=s=>document.querySelector(s),content=$("#shared-content"),message=$("#shared-message"),dialog=$("#shared-confirm");
let state=null,selected=null,selectedProposal=null,pending=null,busy=false;const notes=new Map();
const DRAFT_KEY="pact.invited-review-drafts.v1";let draftIdentity=null;
function saveNotes(){
 if(!state)return;
 try{
  if(!notes.size){sessionStorage.removeItem(DRAFT_KEY);return;}
  const entries=[...notes],raw=JSON.stringify({identity:JSON.stringify([state.id,state.partyId]),notes:entries});
  if(entries.length>500||raw.length>1_000_000)throw Error("Draft limit");
  sessionStorage.setItem(DRAFT_KEY,raw);
 }catch{message.textContent="This draft could not be saved for reload. Keep this tab open while you finish.";}
}
function restoreNotes(){
 const identity=JSON.stringify([state.id,state.partyId]);if(identity===draftIdentity)return;
 notes.clear();draftIdentity=identity;
 try{
  const raw=sessionStorage.getItem(DRAFT_KEY);if(!raw)return;
  if(raw.length>1_000_000)throw Error("Draft limit");
  const stored=JSON.parse(raw);
  if(stored?.identity!==identity||!Array.isArray(stored.notes)||stored.notes.length>500)throw Error("Different review");
  for(const entry of stored.notes){
   if(!Array.isArray(entry)||entry.length!==2||typeof entry[0]!=="string"||entry[0].length>160||typeof entry[1]!=="string"||entry[1].length>1000)throw Error("Invalid draft");
   notes.set(entry[0],entry[1]);
  }
 }catch{notes.clear();try{sessionStorage.removeItem(DRAFT_KEY);}catch{}}
}
function writeNote(key,value){if(value)notes.set(key,value);else notes.delete(key);saveNotes();}
function clearRecordedNote(request){
 restoreNotes();
 const key=request.type==="amendment.reviewed"?"amendment:"+request.payload.amendmentId:request.payload.evidenceId;
 if(key){notes.delete(key);saveNotes();}
}
function clearReviewDraft(){notes.clear();draftIdentity=null;try{sessionStorage.removeItem(DRAFT_KEY);}catch{}}

const uuid=()=>{const a=crypto.getRandomValues(new Uint8Array(16));a[6]=(a[6]&15)|64;a[8]=(a[8]&63)|128;const s=[...a].map(x=>x.toString(16).padStart(2,"0")).join("");return s.slice(0,8)+"-"+s.slice(8,12)+"-"+s.slice(12,16)+"-"+s.slice(16,20)+"-"+s.slice(20);};
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const button=(label,fn,cls="")=>{const b=el("button",label,cls);b.type="button";b.addEventListener("click",()=>void fn());return b;};
let sourceContext=null;
function closeSourceContext(){sourceContext?.close();}
function showSourceContext(obligation,origin,initialPassage=null){
 closeSourceContext();
 const panel=el("dialog",undefined,"shared-source-dialog");panel.setAttribute("aria-label","Original agreement");
 const toolbar=el("div",undefined,"shared-source-toolbar"),heading=el("h2","Original agreement");
 const actions=el("div",undefined,"actions"),body=el("div",undefined,"shared-source-body");
 const reader=mountContractDocument(body,()=>panel.close());
 // Keep the wording being read in view when a window resize reflows the document.
 // Tracking the visible paragraph also respects scrolling away from the citation.
 let readingAnchor=null,readingWidth=0;
 const readingTop=()=>Math.max(body.getBoundingClientRect().top,body.querySelector(".contract-reader-search")?.getBoundingClientRect().bottom||0);
 const rememberReading=()=>{
  if(!panel.open||Math.abs(body.clientWidth-readingWidth)>.5)return;
  const top=readingTop();
  const mark=body.querySelector(".contract-reference-focus"),markRect=mark?.getClientRects()[0];
  if(markRect&&markRect.top>=top-1&&markRect.top<=top+48){readingAnchor={node:mark,fraction:0,offset:Math.max(16,markRect.top-top)};return;}
  for(const node of body.querySelectorAll(".contract-clause")){
   const rect=node.getBoundingClientRect();
   if(rect.height&&rect.bottom>top){readingAnchor={node,fraction:(top-rect.top)/rect.height};break;}
  }
 };
 const readingResize=new ResizeObserver(()=>{
  const width=body.clientWidth;if(!panel.open||!width)return;
  if(readingWidth&&Math.abs(width-readingWidth)>.5&&readingAnchor?.node.isConnected){
   const rect=readingAnchor.node.getBoundingClientRect();
   body.scrollTop+=rect.top+rect.height*readingAnchor.fraction-readingTop()-(readingAnchor.offset||0);
  }
  readingWidth=width;rememberReading();
 });
 body.addEventListener("scroll",rememberReading,{passive:true});readingResize.observe(body);

 const source=state.project.source.text,referenceHost=el("nav",undefined,"shared-source-references");
 const enclosingHost=el("span",undefined,"shared-source-enclosing");
 const referenceMenu=el("details",undefined,"shared-source-reference-menu"),referenceSummary=el("summary","References");
 const referenceList=el("div",undefined,"shared-source-reference-list");
 referenceList.append(enclosingHost,referenceHost);referenceMenu.append(referenceSummary,referenceList);
 const refreshReferenceMenu=()=>{
  const count=referenceList.querySelectorAll("button,.source-reference-note").length;
  referenceSummary.textContent="References ("+count+")";referenceMenu.hidden=!count;
 };
 const references=mountSourceReferences({document,host:referenceHost,onTarget:target=>{
  referenceMenu.open=false;
  heading.textContent=target.kind[0].toUpperCase()+target.kind.slice(1)+" "+target.label;
  references.update(source,[target]);references.showEnclosing(source,target,enclosingHost);refreshReferenceMenu();
  if(!reader.scrollSourceRange(target,{behavior:"instant",block:"start"}))restoreCitation();
  else {const first=body.querySelector(".contract-reference-focus")?.getClientRects()[0];if(first)body.scrollTop+=first.top-readingTop()-16;rememberReading();}
 }});
 if(state.project.source.file)actions.append(button("Original file",()=>{const file=body.querySelector(".contract-source-file");file?.scrollIntoView({block:"start",behavior:"instant"});file?.querySelector("summary")?.focus({preventScroll:true});}));
 const passages=citationPassages(obligation.citation);
 let passageChoice=null;
 const restoreCitation=passage=>{
  referenceMenu.open=false;reader.clearSourceRange();heading.textContent="Original agreement";enclosingHost.replaceChildren();
   if(passageChoice)passageChoice.value=String(Math.max(0,passages.findIndex(item=>item.start===passage?.start&&item.end===passage?.end)));
  references.update(source,passage?[passage]:passages);refreshReferenceMenu();
  if(passage||passages[0])reader.scrollPassage(passage||passages[0],{behavior:"instant",block:"start"});else reader.scrollSelected({behavior:"instant"});
 };
 if(passages.length>1){
  passageChoice=el("select",undefined,"shared-source-passage");passageChoice.setAttribute("aria-label","Choose agreed passage in original");
  passages.forEach((passage,index)=>{const option=el("option","Passage "+(index+1)+" of "+passages.length);option.value=String(index);passageChoice.append(option);});
  passageChoice.addEventListener("change",()=>restoreCitation(passages[Number(passageChoice.value)]));
  actions.append(passageChoice);
 }
 else actions.append(button("Back to cited clause",()=>restoreCitation()));
 actions.append(button("Return to review",()=>panel.close()));
 toolbar.append(heading,actions,referenceMenu);panel.append(toolbar,body);document.body.append(panel);
 reader.update({project:state.project},[obligation]);reader.select(obligation.id);
 references.update(source,passages);refreshReferenceMenu();
 panel.addEventListener("close",()=>{readingResize.disconnect();reader.destroy();panel.remove();if(sourceContext===panel)sourceContext=null;if(origin?.isConnected)origin.focus({preventScroll:true});},{once:true});
 sourceContext=panel;panel.showModal();
 requestAnimationFrame(()=>{if(initialPassage)restoreCitation(initialPassage);else {reader.scrollSelected({behavior:"instant"});body.querySelector(".contract-citation[aria-pressed=true]")?.focus({preventScroll:true});}});
}
function sourceContextButton(obligation){
 const open=button("View original agreement",()=>showSourceContext(obligation,open),"shared-source-open");
 return open;
}
function terms(view,previous,candidate,changedOnly=true,labels=["Current","Proposed"]){
 const shownFields=changedOnly?AMENDMENT_TERM_FIELDS.filter(([field])=>JSON.stringify(previous[field])!==JSON.stringify(candidate[field])):AMENDMENT_TERM_FIELDS;
 return renderAmendmentComparison({document,previous,candidate,parties:partyNames(state.project),obligations:view.obligations,shownFields,labels});
}
function amendmentImpact(root,review){
 if(review.applicationError){root.append(el("p",review.applicationError,"shared-reference"));return;}
 root.append(el("p","If applied: "+formatUsdMinor(review.before.readyMinor)+" → "+formatUsdMinor(review.after.readyMinor)+" ready for payment review","shared-proposal-impact"));
 root.append(el("p","Allocation "+formatUsdMinor(review.before.allocatedMinor)+" → "+formatUsdMinor(review.after.allocatedMinor),"shared-reference"));
 const list=el("ul");
 for(const row of review.rows)list.append(el("li",row.obligation.title+": "+(row.before.readiness==="blocked"?"Blocked":"Ready for review")+" → "+(row.after.readiness==="blocked"?"Blocked":"Ready for review")));
 if(review.rows.length>1)root.append(list);
 if(review.historicalEvidenceIds.length)root.append(el("p","The new revision needs fresh delivery evidence.","shared-reference"));
}
function renderProposal(view,proposal){
 const previous=view.obligationVersions.find(o=>o.id===proposal.obligation.id&&o.revision===proposal.baseRevision);
 const parties=partyNames(state.project),partyName=id=>parties.find(p=>p.id===id)?.name??id;
 const columns=proposal.status==="pending"?["Current","Proposed"]:proposal.status==="adopted"?["Previous","Applied"]:["Before proposal","Not applied"];
 content.append(button("Back to deliveries",()=>{selectedProposal=null;render();}),el("h1",proposal.obligation.title),
  el("p",(proposal.status==="pending"?"Proposed revision ":"Revision ")+proposal.obligation.revision+" · "+(proposal.status==="pending"?partyName(proposal.proposedBy):proposal.status),"shared-amount"),
  el("p",proposal.reason,"shared-criterion"),terms(view,previous,proposal.obligation,true,columns));
 const all=el("details",undefined,"shared-all-terms");all.append(el("summary","All agreement terms"),terms(view,previous,proposal.obligation,false,columns));content.append(all,sourceContextButton(proposal.obligation));
 let preview=null;
 if(proposal.status==="pending"){
  try{
   const at=new Date(Math.max(Date.now(),Date.parse(state.project.events.at(-1)?.at??state.project.createdAt))).toISOString();
   const impact=previewAmendment(state.project,proposal.obligation,at);
   preview={before:impact.before.totals,after:impact.after.totals,historicalEvidenceIds:impact.historicalEvidenceIds,
    rows:impact.changed.map(row=>({...row,obligation:view.obligations.find(o=>o.id===row.after.obligationId)}))};
   const panel=el("section",undefined,"shared-proposal-effects");amendmentImpact(panel,preview);content.append(panel);
  }catch(e){content.append(el("p",e.message,"shared-reference"));}
 }
 const reviews=el("ul",undefined,"shared-party-reviews");
 for(const party of parties){
  const review=proposal.reviews.findLast(r=>r.actorId===party.id);
  const row=el("li");
  if(review){const detail=el("details");detail.append(el("summary",party.name+" · "+(review.decision==="accept"?"Accepted proposal":"Rejected proposal")),el("p",review.reason));row.append(detail);}
  else row.textContent=party.name+" · Awaiting review";
  reviews.append(row);
 }
 content.append(reviews);
 if(proposal.status!=="pending"){content.append(el("p",proposal.status==="adopted"?"This revision was applied.":proposal.status==="rejected"?"This proposal was rejected. Its terms were not applied.":"This proposal was withdrawn.","shared-proposal-impact"));return;}
 content.append(el("p","Current terms stay active until the organizer applies the reviewed proposal.","shared-reference"));
 const key="amendment:"+proposal.id,label=el("label","Your review reason"),reason=el("textarea");
 reason.rows=3;reason.maxLength=1000;reason.value=notes.get(key)||"";reason.setAttribute("aria-label","Reason for proposed revision");reason.addEventListener("input",()=>writeNote(key,reason.value));label.append(reason);content.append(label);
 const actions=el("div",undefined,"actions");
 if(!proposal.reviews.some(r=>r.actorId===state.partyId)){
  const accept=button("Accept proposal",()=>prepare("amendment.reviewed",{amendmentId:proposal.id,decision:"accept",reason:reason.value},"Accept proposed revision "+proposal.obligation.revision+"?"),"primary");accept.disabled=!preview;actions.append(accept);
 }
 actions.append(button("Reject proposal",()=>prepare("amendment.reviewed",{amendmentId:proposal.id,decision:"reject",reason:reason.value},"Reject proposed revision "+proposal.obligation.revision+"?")));
 content.append(actions);
}
async function api(path,input){const response=await fetch("/shared/"+path,{method:input?"POST":"GET",credentials:"same-origin",headers:input?{"content-type":"application/json"}:undefined,body:input?JSON.stringify(input):undefined});const result=await response.json();if(!response.ok){if(response.status===401||response.status===403){clearReviewDraft();closeSourceContext();state=null;content.replaceChildren();dialog.close();}throw Object.assign(new Error(result.error||"Review unavailable."),{code:result.code,status:response.status});}return result;}
async function load(){state=await api("state");render();}
function render(){
 closeSourceContext();restoreNotes();
 const view=projectView(state.project),assigned=view.obligations.filter(o=>o.performerId===state.partyId||o.reviewerId===state.partyId);
 const choices=assigned.length?assigned:view.obligations;selected=choices.some(o=>o.id===selected)?selected:choices[0]?.id;
 $("#shared-person").textContent=state.partyName;document.title=state.project.title+" — PACT review";
 content.replaceChildren();content.append(el("p",state.project.title,"shared-project"));
 const proposal=view.amendments.find(a=>a.id===selectedProposal);
 if(proposal){renderProposal(view,proposal);return;}
 selectedProposal=null;
 const proposed=view.amendments.filter(a=>a.status==="pending");
 if(proposed.length){
  const section=el("section",undefined,"shared-proposals");section.append(el("h2","Proposed changes"));
  for(const a of proposed){const open=button(a.obligation.title+" · revision "+a.obligation.revision,()=>{selectedProposal=a.id;render();});open.dataset.amendmentId=a.id;section.append(open);}
  content.append(section);
 }
 const past=view.amendments.filter(a=>a.status!=="pending");
 if(past.length){
  const history=el("details",undefined,"shared-proposal-history");history.append(el("summary","Past proposals"));
  for(const a of past)history.append(button(a.obligation.title+" · "+a.status,()=>{selectedProposal=a.id;render();}));
  content.append(history);
 }
 if(!choices.length){content.append(el("h1","No commitments to review yet."));return;}
 if(choices.length>1){const label=el("label","Commitment"),select=el("select");select.setAttribute("aria-label","Choose a commitment");for(const o of choices){const option=el("option",o.title);option.value=o.id;option.selected=o.id===selected;select.append(option);}select.addEventListener("change",()=>{selected=select.value;render();});label.append(select);content.append(label);}
 const o=choices.find(x=>x.id===selected);
 const heading=el("h1",o.title);
 content.append(heading);
 const passages=citationPassages(o.citation);
 const clause=el("details",undefined,"shared-clause");clause.open=false;
 const excerpts=renderCitationExcerpts(document,o.citation,passages);
 passages.forEach((passage,index)=>{
  const open=button("Read in original",()=>showSourceContext(o,open,passage),"shared-passage-open");
  open.setAttribute("aria-label","Read passage "+(index+1)+" in original agreement");
  open.dataset.sharedPassage=String(index+1);
  excerpts.quotes[index].before(open);
 });
 clause.append(el("summary",passages.length>1?"Agreed passages ("+passages.length+")":"Agreed clause"),excerpts.root);
 const sourceActions=el("nav",undefined,"shared-source-actions");sourceActions.setAttribute("aria-label","Agreement source");
 const readPassages=button(passages.length>1?"Agreed passages ("+passages.length+")":"Agreed passage",()=>{
  clause.open=true;clause.scrollIntoView({block:"start",behavior:"instant"});clause.querySelector("summary").focus({preventScroll:true});
 });
 readPassages.dataset.sharedSourceEntry="passages";
 sourceActions.append(readPassages,sourceContextButton(o));
 clause.append(button("Back to completion criterion",()=>{heading.scrollIntoView({block:"start",behavior:"instant"});readPassages.focus({preventScroll:true});},"shared-criterion-return"));
 content.append(sourceActions,setCitationQuote(document,el("p","","shared-criterion"),o.criterion),el("p",formatUsdMinor(o.amountMinor)+" · revision "+o.revision,"shared-amount"),clause);
 const proofs=view.evidence.filter(e=>e.obligationId===o.id&&e.obligationRevision===o.revision);
 for(const proof of proofs){
  const section=el("section",undefined,"shared-proof");section.dataset.evidenceId=proof.id;
  const status=proof.decision.revoked?"Withdrawn":proof.decision.openDisputeIds.length?"Changes requested":proof.decision.acceptedAt?"Accepted":"Awaiting review";
  section.append(el("span",status,"shared-decision"),el("h2",proof.description));
  const referenceUrl=deliveryReferenceUrl(proof.reference);
  if(referenceUrl){const link=el("a","Open delivered material","shared-reference");link.href=referenceUrl;link.target="_blank";link.rel="noopener noreferrer";link.title=referenceUrl;section.append(link,el("p",new URL(referenceUrl).hostname,"shared-reference"));}
  else section.append(el("p",proof.reference,"shared-reference"));
  const fileReview=renderEvidenceFile(proof,{compact:true,preview:true});if(fileReview)section.append(fileReview);
  if(o.reviewerId===state.partyId&&!proof.decision.revoked){
   const label=el("label","Review note"),reason=el("textarea");reason.rows=3;reason.maxLength=1000;reason.value=notes.get(proof.id)||"";reason.setAttribute("aria-label","Review note for "+proof.description);reason.addEventListener("input",()=>writeNote(proof.id,reason.value));label.append(reason);section.append(label);
   const actions=el("div",undefined,"actions");
   if(!proof.decision.acceptedAt)actions.append(button("Accept work",()=>prepare("evidence.accepted",{evidenceId:proof.id,rationale:reason.value},"Accept "+o.title+"?"),"primary"));
   actions.append(button("Request changes",()=>prepare("evidence.disputed",{evidenceId:proof.id,disputeId:"dispute-"+uuid(),reason:reason.value},"Request changes to "+o.title+"?")));
   section.append(actions);
  }
  content.append(section);
 }
 if(!proofs.length)content.append(el("p","Delivery is awaiting evidence.","shared-reference"));
 if(o.performerId===state.partyId){
  const form=el("form",undefined,"shared-delivery");form.append(el("h2","Submit delivery"));
  const description=el("textarea");description.rows=3;description.required=true;description.maxLength=1000;
  const ref=el("input");ref.required=true;ref.maxLength=1000;ref.placeholder="File name or delivery reference";
  const dlabel=el("label","What did you deliver?"),rlabel=el("label","Reference");dlabel.append(description);rlabel.append(ref);
  form.append(dlabel,rlabel);const submit=el("button","Review delivery","primary");submit.type="submit";form.append(submit);
  form.addEventListener("submit",event=>{event.preventDefault();void prepare("evidence.submitted",{evidence:{id:"evidence-"+uuid(),obligationId:o.id,obligationRevision:o.revision,submittedBy:state.partyId,description:description.value,reference:ref.value}},"Submit "+o.title+"?");});content.append(form);
 }
 content.append(button("Refresh agreement",async()=>{try{await load();message.textContent="Agreement refreshed.";}catch(e){message.textContent=e.message;}}));
}
async function prepare(type,payload,title){
 if(busy)return;busy=true;message.textContent="";
 try{
  const input={operationId:uuid(),digest:state.digest,type,payload};
  const preview=await api("preview",input);pending={...input,reviewSignature:preview.signature};
  $("#shared-confirm-title").textContent=title;const body=$("#shared-confirm-body");body.replaceChildren();
  body.append(el("p",payload.rationale||payload.reason||payload.evidence?.description||""));
  if(preview.review?.kind==="amendment"){
   body.append(terms(projectView(state.project),preview.review.previous,preview.review.candidate));amendmentImpact(body,preview.review);
   body.append(el("p",payload.decision==="accept"?"Record your acceptance of this exact proposal. Current terms remain active.":"Record your rejection. Current terms remain active."));
  }else if(preview.review){
   body.append(el("p",formatUsdMinor(preview.review.before.readyMinor)+" → "+formatUsdMinor(preview.review.after.readyMinor)+" ready for payment review"));
   const list=el("ul");for(const row of preview.review.rows)list.append(el("li",row.obligation.title+": "+(row.before.readiness==="blocked"?"Blocked":"Ready for review")+" → "+(row.after.readiness==="blocked"?"Blocked":"Ready for review")));body.append(list);
  }else if(payload.evidence)body.append(el("p",payload.evidence.reference));
  $("#shared-record").textContent=type==="amendment.reviewed"?(payload.decision==="accept"?"Confirm proposal acceptance":"Confirm rejection"):type==="evidence.accepted"?"Confirm acceptance":type==="evidence.disputed"?"Request changes":"Submit delivery";
  $("#shared-confirm-status").textContent="";dialog.showModal();
 }catch(e){message.textContent=e.message;if(e.status===409)try{await load();}catch{}}finally{busy=false;}
}
$("#shared-cancel").addEventListener("click",()=>dialog.close());
dialog.addEventListener("close",()=>{pending=null;});
$("#shared-record").addEventListener("click",async()=>{
 if(busy||!pending)return;busy=true;$("#shared-record").disabled=true;
 const request=pending;
 try{state=await api("record",request);clearRecordedNote(request);dialog.close();render();message.textContent="Your review was recorded.";}
 catch(e){
  $("#shared-confirm-status").textContent=e.message;
  try{
   const observed=await api("state");
   if(observed.receipts.some(r=>r.eventId==="shared-"+request.operationId&&r.partyId===observed.partyId)){state=observed;clearRecordedNote(request);dialog.close();render();message.textContent="Your review was recorded.";}
   else if(e.status===409){state=observed;dialog.close();render();message.textContent=e.message;}
  }catch{}
 }finally{busy=false;$("#shared-record").disabled=false;}
});
async function begin(){
 try{
  const token=new URLSearchParams(location.hash.slice(1)).get("invite");
  if(token){history.replaceState(null,"",location.pathname);await api("claim",{token});}
  await load();message.textContent="";
 }catch(e){message.textContent=e.message;content.replaceChildren();}
}
void begin();
