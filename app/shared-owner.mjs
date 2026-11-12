import {partyNames} from "./core.mjs";
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
export function mountSharedReviews({getProject,receive,offerSaved=()=>false,newAgreement=()=>{}}) {
 const trigger=el("button","Share review");trigger.type="button";trigger.hidden=true;
 document.querySelector(".project-more-actions").append(trigger);
 const agreementTriggers=[document.querySelector(".project-files"),document.querySelector("#setup .section-head")].map(parent=>{const b=el("button","Agreements","shared-agreements-open");b.type="button";b.hidden=true;if(parent.classList.contains("project-files"))parent.prepend(b);else parent.append(b);return b;});
 const style=el("link");style.rel="stylesheet";style.href=new URL("./shared-review.css",import.meta.url).href;document.head.append(style);
 const dialog=el("dialog",undefined,"shared-owner");dialog.setAttribute("aria-label","Shared agreement review");document.body.append(dialog);
 const content=el("div"),footer=el("div",undefined,"actions");
 const close=el("button","Close");close.type="button";close.addEventListener("click",()=>dialog.close());
 footer.append(close);dialog.append(content,footer);
 let available=false,data=null,pending=false,notice="",link=null,selectedAddress="",selectedParty="",savedQuery="",mode="share",savedScope="active",archiveTarget=null;
 const refresh=()=>{trigger.disabled=!getProject()&&!data?.agreements?.length;trigger.hidden=!available;for(const b of agreementTriggers){b.hidden=!available;b.disabled=!available;}};
 async function api(action,input){const response=await fetch("/api/collaboration/"+action,{method:input?"POST":"GET",headers:input?{"content-type":"application/json"}:undefined,body:input?JSON.stringify(input):undefined});const result=await response.json();if(!response.ok)throw new Error(result.error||"Sharing is unavailable.");return result;}
 const button=(text,fn,cls="")=>{const b=el("button",text,cls);b.type="button";b.disabled=pending;b.addEventListener("click",()=>void action(fn));return b;};
 const select=(label,rows,value,onchange)=>{const wrap=el("label",label),node=el("select");for(const row of rows){const o=el("option",row.name);o.value=row.id;o.selected=row.id===value;node.append(o);}node.disabled=pending;node.addEventListener("change",()=>onchange(node.value));wrap.append(node);return wrap;};
 async function read(){data=await api("status?project="+encodeURIComponent(getProject()?.id??""));available=true;refresh();}
 async function action(fn){
  if(pending)return;pending=true;notice="";render();
  try{await fn();await read();}catch(e){notice=e.message;try{await read();}catch{}}
  finally{pending=false;render();}
 }
 function render(){
  const project=getProject();content.replaceChildren();
  for(const child of [...footer.children])if(child!==close)child.remove();
  if(archiveTarget){
   content.append(el("h2","Archive "+archiveTarget.project.title+"?"),el("p","Its records stay saved. Current invitations and review sessions end, and it cannot be used for payment while archived. You can restore it when an active slot is available."));
   if(notice)content.append(el("p",notice,"shared-owner-status"));
   const actions=el("div",undefined,"actions");
   actions.append(button("Keep active",async()=>{archiveTarget=null;}),button("Archive agreement",async()=>{await api("archive",{id:archiveTarget.id,digest:archiveTarget.digest});archiveTarget=null;link=null;mode="agreements";notice="Agreement archived. Its records remain in Archived agreements.";},"primary"));
   content.append(actions);return;
  }
  content.append(el("h2",mode==="agreements"?"Open agreement":project?.title??"Share review"));
  if(data?.agreements?.length){
   const saved=el("details",undefined,"shared-saved-agreements");saved.append(el("summary","Shared agreements"));
   if(mode==="agreements"||!data.agreement)saved.open=true;if(mode==="agreements"){saved.classList.add("shared-arrival-list");saved.querySelector("summary").hidden=true;}
   const find=el("label","Find an agreement"),query=el("input");query.type="search";query.placeholder="Title or party";query.value=savedQuery;query.className="shared-saved-search";find.append(query);
   const count=el("p",undefined,"shared-saved-count");count.setAttribute("role","status");
   const list=el("div",undefined,"shared-saved-list");
   const results=()=>{
    const words=savedQuery.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
    const scoped=data.agreements.filter(row=>savedScope==="archived"?Boolean(row.archivedAt):!row.archivedAt);
    const rows=scoped.filter(row=>{const text=[row.title,...(row.parties??[])].join(" ").toLocaleLowerCase();return words.every(word=>text.includes(word));});
    list.replaceChildren();count.textContent=words.length?rows.length+" of "+scoped.length+" agreements":scoped.length+(savedScope==="archived"?" archived agreements":" active agreements · newest record first");
    for(const row of rows){
     const item=el("div",undefined,"shared-saved-row");item.dataset.sharedAgreementId=row.id;
     const info=el("div",undefined,"shared-saved-info");info.append(el("strong",row.title,"shared-saved-title"));
     if(row.parties?.length)info.append(el("p",row.parties.join(" · "),"shared-saved-parties"));
     if(row.sourceExcerpt)info.append(el("p",row.sourceExcerpt,"shared-saved-excerpt"));
     const meta=[];
     if(Number.isSafeInteger(row.budgetMinor)&&row.currency)meta.push(new Intl.NumberFormat(undefined,{style:"currency",currency:row.currency}).format(row.budgetMinor/100)+" budget");
     if(row.lastRecordedAt){const at=new Date(row.lastRecordedAt);if(Number.isFinite(at.getTime()))meta.push("Last record "+new Intl.DateTimeFormat(undefined,{dateStyle:"medium",timeStyle:"short"}).format(at));}
     if(meta.length)info.append(el("p",meta.join(" · "),"shared-saved-meta"));
     const actions=el("div",undefined,"shared-saved-actions");
     actions.append(button(row.archivedAt?"Open saved copy":"Open agreement",async()=>{const latest=await api("receive",{id:row.id});dialog.close();receive(latest.project);}));
     if(row.archivedAt)actions.append(button("Restore",async()=>{const latest=await api("receive",{id:row.id});await api("restore",{id:row.id,digest:latest.digest});notice="Agreement restored. Create a new invitation when ready.";}));
     else actions.append(button("Archive",async()=>{archiveTarget=await api("receive",{id:row.id});}));
     item.append(info,actions);
     list.append(item);
    }
    if(!rows.length)list.append(el("p",words.length?"No agreements match. Try a title or party name.":savedScope==="archived"?"No archived agreements.":"No active agreements.","shared-saved-empty"));
   };
   query.addEventListener("input",()=>{savedQuery=query.value;results();});results();saved.append(select("Saved agreements",[{id:"active",name:"Active agreements"},{id:"archived",name:"Archived agreements"}],savedScope,value=>{savedScope=value;results();}),find,count,list);
   content.append(saved);
  }
  if(mode==="agreements"){
   if(!data?.agreements?.length)content.append(el("p",pending?"Opening agreements…":"No shared agreements yet."));
   if(notice){const status=el("p",notice,"shared-owner-status");status.setAttribute("role","status");content.append(status);}
   footer.prepend(button("New agreement",async()=>{dialog.close();newAgreement();}));return;
  }
  if(!project)return;
  const parties=partyNames(project);if(!selectedParty||!parties.some(p=>p.id===selectedParty))selectedParty=parties[0]?.id;
  if(!selectedAddress)selectedAddress=data?.addresses?.[0]?.address??"";
  if(!data?.enabled){
   if(data?.hosted||data?.addresses?.length){
    if(data.addresses?.length>1)content.append(select("Private network",data.addresses.map(a=>({id:a.address,name:a.name+" · "+a.address})),selectedAddress,v=>selectedAddress=v));
    content.append(button("Enable invited reviews",async()=>{await api("start",{address:selectedAddress});notice="Invited reviews are ready.";},"primary"));
   }else content.append(el("p","Connect this computer to your private network to invite reviewers."));
  }
  if(data?.agreement?.archivedAt){
   const a=data.agreement;
   content.append(el("p","This agreement is archived. Its history is preserved; restore it before inviting reviewers or payment.","shared-owner-status"),button("Restore agreement",async()=>{await api("restore",{id:a.id,digest:a.digest});notice="Agreement restored. Earlier invitations remain retired.";},"primary"));
  }else if(data?.enabled&&!data.agreement){
   content.append(select("Your party",parties,selectedParty,v=>selectedParty=v));
   content.append(button("Start shared review",async()=>{await api("open",{project:getProject(),ownerPartyId:selectedParty});notice="Choose the party to invite.";},"primary"));
  }else if(data?.agreement){
   const a=data.agreement;
   content.append(el("p","Your party: "+(parties.find(p=>p.id===a.ownerPartyId)?.name??a.ownerPartyId),"shared-owner-status"));
   const inviteParties=parties.filter(p=>p.id!==a.ownerPartyId);
   if(!inviteParties.some(p=>p.id===selectedParty))selectedParty=inviteParties[0]?.id;
   if(inviteParties.length&&data?.enabled){
    content.append(select("Invite a reviewer",inviteParties,selectedParty,v=>{selectedParty=v;link=null;render();}));
    content.append(button("Create invitation",async()=>{link=await api("invite",{id:a.id,partyId:selectedParty});notice="Share this one-use link with the named party. Earlier access for this party has ended.";},"primary"));
    if(link){
     const label=el("label","Invitation link"),field=el("input");field.readOnly=true;field.value=link.url;field.className="shared-invitation";field.setAttribute("aria-label","Private invitation link");label.append(field);content.append(label);
     content.append(button("Copy invitation",async()=>{try{await navigator.clipboard.writeText(link.url);notice="Invitation copied.";}catch{field.select();notice="Select and copy the invitation link.";} }));
    }
   }
   const actions=el("div",undefined,"actions");
   actions.append(button("Review received records",async()=>{const latest=await api("receive",{id:a.id});dialog.close();receive(latest.project);}),
    button("Publish my changes",async()=>{await api("publish",{id:a.id,project:getProject(),digest:a.digest});notice="Your records are shared.";document.dispatchEvent(new Event("pact-shared-history-published"));}));
   content.append(actions,el("p",a.receipts.length+(a.receipts.length===1?" invited review recorded":" invited reviews recorded"),"shared-owner-status"));
   if(inviteParties.length)content.append(button("End this party’s access",async()=>{await api("revoke",{id:a.id,partyId:selectedParty});link=null;notice="Access ended for this party.";}));
   content.append(button("Archive agreement",async()=>{archiveTarget=await api("receive",{id:a.id});}));
  }
  if(notice){const p=el("p",notice,"shared-owner-status");p.setAttribute("role","status");content.append(p);}
  const bottom=el("div",undefined,"actions");
  if(data?.enabled)bottom.append(button("Stop network sharing",async()=>{await api("stop",{});link=null;notice="Sharing stopped. Recorded work is preserved.";}));
  if(data?.organizer&&location.protocol==="https:")bottom.append(button("Sign out",async()=>{
   const response=await fetch("/organizer/logout",{method:"POST",headers:{"content-type":"application/json"},body:"{}"});
   if(!response.ok)throw Error("Sign-out did not complete.");location.replace("/");
  }));
  footer.prepend(...bottom.childNodes);
 }
 const open=(nextMode="share")=>{mode=typeof nextMode==="string"?nextMode:"share";dialog.setAttribute("aria-label",mode==="agreements"?"Open saved agreement":"Shared agreement review");link=null;notice="";savedQuery="";savedScope="active";archiveTarget=null;if(!dialog.open)dialog.showModal();void action(async()=>{}).then(()=>{if(dialog.open&&mode==="agreements")dialog.querySelector(".shared-saved-search")?.focus();});};
 trigger.addEventListener("click",open);for(const b of agreementTriggers)b.addEventListener("click",()=>open("agreements"));
 document.addEventListener("pact-open-agreements",()=>open("agreements"));
 document.addEventListener("pact-open-shared-review",open);
 document.addEventListener("pact-review-shared-records",()=>void (async()=>{
  if(pending)return;
  pending=true;notice="";
  try{
   await read();
   if(!data?.agreement)throw new Error("This agreement has no shared records on this computer.");
   const latest=await api("receive",{id:data.agreement.id});
   receive(latest.project);
  }catch(error){
   notice=error.message;
   if(!dialog.open)dialog.showModal();
  }finally{pending=false;render();}
 })());
 void read().then(()=>{if(data?.organizer&&location.protocol==="https:"&&data.agreements?.length&&offerSaved()&&!document.querySelector("dialog[open]"))open("agreements");}).catch(()=>{available=false;refresh();});
 return {refresh};
}
