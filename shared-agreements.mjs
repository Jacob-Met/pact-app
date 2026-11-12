import {createOrganizerAccess} from "./organizer-access.mjs";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile, rename, chmod } from "node:fs/promises";
import { dirname } from "node:path";
import { appendEvent, validateProject, projectView, partyNames, previewAmendment } from "./app/core.mjs";
import { previewEvidenceDecision } from "./app/decision-review.mjs";

export const sharedError=(code,message,status=400)=>Object.assign(new Error(message),{code,status});
const fail=(code,message,status=400)=>{throw sharedError(code,message,status);};
const stable=value=>Array.isArray(value)?JSON.stringify(value.map(v=>JSON.parse(stable(v)))):value&&typeof value==="object"?JSON.stringify(Object.fromEntries(Object.keys(value).sort().map(k=>[k,JSON.parse(stable(value[k]))]))):JSON.stringify(value);
const hash=value=>createHash("sha256").update(value).digest("hex");
export const historyDigest=project=>hash(stable(validateProject(project)));
const secret=()=>randomBytes(32).toString("base64url");
const clone=value=>structuredClone(value);
const allowed=new Set(["evidence.submitted","evidence.accepted","evidence.disputed","evidence.revoked","dispute.resolved","amendment.reviewed"]);
const record=({seq,...event})=>stable(event);
const base=({events,format,...project})=>stable(project);
const tokenHash=value=>typeof value==="string"&&/^[A-Za-z0-9_-]{43}$/.test(value)?hash(value):fail("ACCESS_REQUIRED","Open your invitation to continue.",401);

// The original local records are not reclassified as authenticated records.
// New invited-session actions have a separate durable receipt, tied to the
// exact party, event and agreed history. No provider/payment API is called here.
export async function createSharedAgreementStore({path,clock=()=>Date.now(),organizerCode=null}={}) {
 if(organizerCode&&!/^[A-Za-z0-9_-]{43}$/.test(organizerCode))throw Error("Organizer code must be a generated32-byte base64url secret.");
 const organizerHash=organizerCode?hash(organizerCode):null;
 let state={version:1,agreements:{},invitations:{},sessions:{}},tail=Promise.resolve();
 if(path)try{const loaded=JSON.parse(await readFile(path,"utf8"));if(loaded.version!==1)fail("SHARED_STORAGE","Unsupported shared record version.");state=loaded;for(const a of Object.values(state.agreements))validateProject(a.project);}catch(e){if(e.code!=="ENOENT")throw e;}
 async function persist(next) {
  if(!path)return;
  await mkdir(dirname(path),{recursive:true,mode:0o700});
  const temp=path+"."+randomUUID()+".tmp";
  await writeFile(temp,JSON.stringify(next),{mode:0o600});await rename(temp,path);await chmod(path,0o600);
 }
 function transaction(fn) {
  const run=tail.then(async()=>{const next=clone(state);const result=await fn(next);await persist(next);state=next;return result;});
  tail=run.catch(()=>{});return run;
 }
 async function inspect(fn){await tail;return clone(fn(state));}
 const agreement=(s,id)=>s.agreements[id]??fail("AGREEMENT_NOT_FOUND","This shared agreement is unavailable.",404);
 const view=a=>({id:a.id,ownerPartyId:a.ownerPartyId,project:a.project,digest:historyDigest(a.project),receipts:a.receipts,archivedAt:a.archivedAt??null});
 const active=a=>{if(a.archivedAt)fail("AGREEMENT_ARCHIVED","This agreement is archived. Restore it from Agreements before sharing or payment.",409);return a;};
 const requireSlot=s=>{if(Object.values(s.agreements).filter(a=>!a.archivedAt).length>=50)fail("SHARED_LIMIT","This installation already has fifty active shared agreements. Archive an agreement to make room.");};
 const endAccess=(s,id)=>{for(const collection of [s.invitations,s.sessions])for(const [key,row]of Object.entries(collection))if(row.agreementId===id)delete collection[key];};
 function session(s,value) {
  const row=s.sessions[tokenHash(value)];
  if(!row||row.expiresAt<=clock())fail("ACCESS_REQUIRED","Your review session has ended. Open a new invitation.",401);
  const a=active(agreement(s,row.agreementId));
  if(!a.project.parties.some(p=>p.id===row.partyId))fail("ACCESS_REQUIRED","This review access is no longer available.",401);
  return {row,a};
 }
 function eventFor(a,partyId,input) {
  if(!input||Object.keys(input).some(k=>!["type","payload","digest","operationId","reviewSignature"].includes(k)))fail("ACTION_FIELDS","Supply only the reviewed action and current history.");
  if(typeof input.operationId!=="string"||!/^[a-f0-9-]{36}$/.test(input.operationId))fail("OPERATION_ID","A stable review operation is required.");
  if(input.digest!==historyDigest(a.project))fail("HISTORY_CHANGED","The agreement changed. Review its current records before continuing.",409);
  if(!allowed.has(input.type))fail("ACTION_FORBIDDEN","This action is not available from an invited review.",403);
  const payload=clone(input.payload);
  if(input.type==="evidence.submitted") {
   const obligation=projectView(a.project).obligations.find(o=>o.id===payload?.evidence?.obligationId);
   if(!obligation||obligation.performerId!==partyId)fail("ACTION_FORBIDDEN","Only the assigned delivery party may submit this evidence.",403);
   if(payload.evidence.submittedBy!==partyId)fail("ACTION_FORBIDDEN","Evidence must be submitted as your invited party.",403);
  }
  const at=new Date(Math.max(clock(),Date.parse(a.project.events.at(-1)?.at??a.project.createdAt))).toISOString();
  const event={id:"shared-"+input.operationId,at,actorId:partyId,type:input.type,payload};
  const candidate=appendEvent(a.project,event);
  return {event:candidate.events.at(-1),candidate};
 }
 function reviewFor(a,event,candidate) {
  if(event.type==="amendment.reviewed") {
   const view=projectView(a.project),proposal=view.amendments.find(item=>item.id===event.payload.amendmentId);
   const previous=view.obligations.find(item=>item.id===proposal.obligation.id);
   let impact=null,applicationError=null;
   try{impact=previewAmendment(a.project,proposal.obligation,event.at);}
   catch(error){if(event.payload.decision==="accept")throw error;applicationError=error.message;}
   const review={kind:"amendment",amendmentId:proposal.id,decision:event.payload.decision,reason:proposal.reason,
    previous,candidate:proposal.obligation,applicationError,
    before:impact?.before.totals??null,after:impact?.after.totals??null,
    historicalEvidenceIds:impact?.historicalEvidenceIds??[],
    rows:impact?.changed.map(row=>({obligation:view.obligations.find(o=>o.id===row.after.obligationId),before:row.before,after:row.after}))??[]};
   return {event,candidate,digest:historyDigest(a.project),review,signature:hash(stable(review))};
  }
  const detailed=event.type==="evidence.submitted"?null:previewEvidenceDecision(a.project,event);
  const review=detailed?{rows:detailed.rows,before:detailed.before.totals,after:detailed.after.totals}:null;
  return {event,candidate,digest:historyDigest(a.project),review,signature:hash(stable(review))};
 }
 return {
  ...createOrganizerAccess({transaction,inspect,clock,organizerHash}),
  networkRead(){return inspect(s=>s.network??null);},
  networkSave(address,port){return transaction(s=>{s.network={address,port};return s.network;});},
  ownerList(){return inspect(s=>Object.values(s.agreements).map(a=>({
   id:a.id,title:a.project.title,ownerPartyId:a.ownerPartyId,records:a.project.events.length,archivedAt:a.archivedAt??null,
   parties:partyNames(a.project).map(p=>p.name),currency:a.project.currency,budgetMinor:a.project.budgetMinor,
   sourceExcerpt:a.project.source.text.replace(/\s+/gu," ").trim().slice(0,220),
   lastRecordedAt:a.project.events.at(-1)?.at??a.project.createdAt
  })).sort((a,b)=>Date.parse(b.lastRecordedAt)-Date.parse(a.lastRecordedAt)||a.title.localeCompare(b.title)));},
  open(projectInput,ownerPartyId){return transaction(s=>{
   const project=validateProject(projectInput);
   if(!project.parties.some(p=>p.id===ownerPartyId))fail("PARTY_REQUIRED","Choose your declared party.");
   const existing=Object.values(s.agreements).find(a=>a.project.id===project.id);
   if(existing){active(existing);if(base(existing.project)!==base(project))fail("AGREEMENT_CHANGED","A different agreement uses this identity.",409);return view(existing);}
   requireSlot(s);
   const id=randomUUID();const a={id,ownerPartyId,project,receipts:[],operations:{}};s.agreements[id]=a;return view(a);
  });},
  archive(id,expectedDigest){return transaction(s=>{
   const a=agreement(s,id);
   if(historyDigest(a.project)!==expectedDigest)fail("HISTORY_CHANGED","The agreement changed. Review its current records before archiving.",409);
   if(!a.archivedAt)a.archivedAt=new Date(clock()).toISOString();
   endAccess(s,id);return view(a);
  });},
  restore(id,expectedDigest){return transaction(s=>{
   const a=agreement(s,id);
   if(historyDigest(a.project)!==expectedDigest)fail("HISTORY_CHANGED","The saved agreement changed. Open its current records before restoring.",409);
   if(a.archivedAt){requireSlot(s);delete a.archivedAt;}
   return view(a);
  });},
  // Payment effects and shared decisions have one ordering. Hold the existing
  // store queue through the provider result: an action already dispatched can
  // finish, while later decisions cannot retroactively authorize that action.
  withCurrentProject(projectInput,action){
   const project=validateProject(projectInput);
   const run=tail.then(async()=>{
    const a=Object.values(state.agreements).find(a=>a.project.id===project.id);
    if(a)active(a);
    if(a&&historyDigest(a.project)!==historyDigest(project)){
     const byId=new Map(project.events.map(e=>[e.id,e])),ids=new Set(a.project.events.map(e=>e.id));
     const includesShared=base(a.project)===base(project)
      && stable(project.events.filter(e=>ids.has(e.id)).map(e=>e.id))===stable(a.project.events.map(e=>e.id))
      && a.project.events.every(e=>byId.has(e.id)&&record(byId.get(e.id))===record(e));
     if(includesShared)fail("SHARED_HISTORY_UNPUBLISHED","Your local records are not shared yet. Publish your changes from Share review before continuing with payment.",409);
     const latest=a.project.events.filter(e=>!byId.has(e.id)||record(byId.get(e.id))!==record(e)).at(-1);
     const who=partyNames(a.project).find(p=>p.id===latest?.actorId)?.name??"A party";
     const change=latest?.type==="evidence.revoked"?who+" revoked acceptance."
      :latest?.type==="evidence.disputed"?who+" disputed delivered work."
      :latest?.type==="evidence.accepted"?who+" recorded acceptance.":"Shared review records changed.";
     fail("SHARED_HISTORY_CHANGED",change+" Review the new records before payment.",409);
    }
    return action();
   });
   tail=run.catch(()=>{});return run;
  },
  ownerRead(id){return inspect(s=>view(agreement(s,id)));},
  ownerFind(projectId){return inspect(s=>{const a=Object.values(s.agreements).find(a=>a.project.id===projectId);return a?view(a):null;});},
  publish(id,projectInput,expectedDigest){return transaction(s=>{
   const a=active(agreement(s,id)),project=validateProject(projectInput);
   if(historyDigest(a.project)!==expectedDigest)fail("HISTORY_CHANGED","Receive the new shared records first.",409);
   if(base(a.project)!==base(project))fail("AGREEMENT_CHANGED","Shared base terms cannot be replaced.",409);
   const byId=new Map(project.events.map(e=>[e.id,e])),oldIds=new Set(a.project.events.map(e=>e.id));
   if(stable(project.events.filter(e=>oldIds.has(e.id)).map(e=>e.id))!==stable(a.project.events.map(e=>e.id)))fail("HISTORY_CHANGED","All shared records must remain in their existing order.",409);
   for(const e of a.project.events)if(!byId.has(e.id)||record(e)!==record(byId.get(e.id)))fail("HISTORY_CHANGED","A shared record cannot be removed or rewritten.",409);
   if(project.events.some(e=>!oldIds.has(e.id)&&e.actorId!==a.ownerPartyId))fail("PARTY_REQUIRED","Only your party's new records can be published from this workspace.",403);
   a.project=project;return view(a);
  });},
  invite(id,partyId){return transaction(s=>{
   const a=active(agreement(s,id));
   if(!a.project.parties.some(p=>p.id===partyId))fail("PARTY_REQUIRED","Choose a declared agreement party.");
   for(const [key,row] of Object.entries(s.invitations))if(row.agreementId===id&&row.partyId===partyId)delete s.invitations[key];
   for(const [key,row] of Object.entries(s.sessions))if(row.agreementId===id&&row.partyId===partyId)delete s.sessions[key];
   const token=secret(),expiresAt=clock()+2*60*60*1000;
   s.invitations[hash(token)]={agreementId:id,partyId,expiresAt};
   return {token,partyId,expiresAt};
  });},
  claim(token){return transaction(s=>{
   const key=tokenHash(token),invite=s.invitations[key];
   if(!invite||invite.expiresAt<=clock())fail("INVITATION_ENDED","This invitation has ended or was already opened. Request a new link.",401);
   const value=secret(),row={agreementId:invite.agreementId,partyId:invite.partyId,expiresAt:clock()+8*60*60*1000};
   s.sessions[hash(value)]=row;delete s.invitations[key];
   return {session:value,expiresAt:row.expiresAt};
  });},
  read(token){return inspect(s=>{const {row,a}=session(s,token);return {...view(a),partyId:row.partyId,partyName:partyNames(a.project).find(p=>p.id===row.partyId).name};});},
  preview(token,input){return inspect(s=>{
   const {row,a}=session(s,token),{event,candidate}=eventFor(a,row.partyId,input);
   return reviewFor(a,event,candidate);
  });},
  append(token,input){return transaction(s=>{
   const {row,a}=session(s,token);
   const requestHash=hash(stable(input)),previous=a.operations?.[input?.operationId];
   if(previous) {
    if(previous.partyId!==row.partyId||previous.requestHash!==requestHash)fail("OPERATION_CONFLICT","That review operation has different contents.",409);
    return {...view(a),recordedEventId:previous.eventId,partyId:row.partyId,partyName:partyNames(a.project).find(p=>p.id===row.partyId).name};
   }
   const {event,candidate}=eventFor(a,row.partyId,input);
   if(input.reviewSignature!==reviewFor(a,event,candidate).signature)fail("REVIEW_CHANGED","Review the current effect before recording this action.",409);
   a.operations??={};a.operations[input.operationId]={partyId:row.partyId,requestHash,eventId:event.id};
   a.project=candidate;a.receipts.push({eventId:event.id,partyId:row.partyId,at:event.at,method:"invited-session"});
   return {...view(a),recordedEventId:event.id,partyId:row.partyId,partyName:partyNames(a.project).find(p=>p.id===row.partyId).name};
  });},
  revoke(id,partyId){return transaction(s=>{
   agreement(s,id);
   for(const collection of [s.invitations,s.sessions])for(const [key,row]of Object.entries(collection))if(row.agreementId===id&&(!partyId||row.partyId===partyId))delete collection[key];
   return {revoked:true};
  });},
  revokeAll(){return transaction(s=>{s.invitations={};s.sessions={};return {revoked:true};});}
 };
}
