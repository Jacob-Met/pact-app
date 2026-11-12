const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
export function mountOrganizerAccess(){
 if(location.protocol!=="https:")return;
 const trigger=el("button","Organizer access");trigger.id="organizer-access-open";trigger.type="button";trigger.hidden=true;document.querySelector(".masthead").append(trigger);
 const style=el("link");style.rel="stylesheet";style.href="/organizer-access.css";document.head.append(style);
 const dialog=el("dialog",undefined,"organizer-access");dialog.setAttribute("aria-label","Organizer access");document.body.append(dialog);
 let data=null,pending=false,notice="",link=null,recovery=null,confirmId=null,nameDraft="";
 async function api(action,input){const response=await fetch("/organizer/"+action,{method:input?"POST":"GET",headers:input?{"content-type":"application/json"}:undefined,body:input?JSON.stringify(input):undefined});const result=await response.json();if(!response.ok)throw Error(result.error||"Access could not be updated.");return result;}
 async function read(){data=await api("status");trigger.hidden=false;trigger.textContent=data.organizer.admin?"Organizer access":data.organizer.name;trigger.setAttribute("aria-label","Organizer access: "+data.organizer.name);}
 const button=(text,fn,cls="")=>{const b=el("button",text,cls);b.type="button";b.disabled=pending;b.addEventListener("click",fn);return b;};
 const field=(form,label,name,type="text",autocomplete="off")=>{const wrap=el("label",label),input=el("input");input.name=name;input.type=type;input.autocomplete=autocomplete;input.required=true;wrap.append(input);form.append(wrap);return input;};
 async function action(fn){
  if(pending)return;pending=true;notice="";for(const b of dialog.querySelectorAll("button"))b.disabled=true;
  try{await fn();await read();render();}catch(error){notice=error.message;const status=dialog.querySelector(".organizer-access-notice");if(status)status.textContent=notice;}
  finally{pending=false;for(const b of dialog.querySelectorAll("button"))b.disabled=false;}
 }
 function downloadRecovery(){if(!recovery)return;const value="PACT organizer recovery\nUsername: "+data.organizer.username+"\nRecovery code: "+recovery+"\n\nKeep private. This code can replace your password and can be used once.\n";const url=URL.createObjectURL(new Blob([value],{type:"text/plain"})),a=el("a");a.href=url;a.download="pact-recovery-"+data.organizer.username+".txt";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 function render(){
  dialog.replaceChildren();const head=el("header",undefined,"organizer-access-head");head.append(el("h2","Organizer access"),button("Close",()=>dialog.close()));dialog.append(head);
  if(!data)return;
  const who=data.organizer;dialog.append(el("p",who.name+(who.username?" · "+who.username:""),"organizer-access-self"));
  if(who.admin){
   const form=el("form");form.className="organizer-invite-form";const name=field(form,"New organizer’s name","name");name.maxLength=100;name.value=nameDraft;name.addEventListener("input",()=>nameDraft=name.value);
   form.append(el("p","Organizers can manage this installation’s agreements and Sandbox payment reviews.","organizer-access-help"));
   const submit=el("button","Create organizer invitation","primary");submit.type="submit";submit.disabled=pending;form.append(submit);
   form.addEventListener("submit",event=>{event.preventDefault();const value=name.value;void action(async()=>{link=await api("invite",{name:value});nameDraft="";notice="Invitation created.";});});dialog.append(form);
   if(link){const section=el("section",undefined,"organizer-private-link");section.append(el("h3",(link.reset?"Password reset for ":"Invitation for ")+link.name));
    const label=el("label","Private one-use link"),input=el("input");input.readOnly=true;input.value=link.url;input.setAttribute("aria-label","Private organizer link");label.append(input);section.append(label);
    section.append(button("Copy link",async()=>{try{await navigator.clipboard.writeText(link.url);notice="Link copied.";}catch{input.select();notice="Select and copy the link.";}dialog.querySelector(".organizer-access-notice").textContent=notice;}));
    if(link.reset)section.append(el("p","Using this link replaces the password and ends earlier sessions.","organizer-access-help"));
    dialog.append(section);
   }
   const list=el("section",undefined,"organizer-account-list");list.append(el("h3","Organizers"));
   if(!data.accounts.length)list.append(el("p","No personal organizer accounts yet."));
   for(const account of data.accounts){const row=el("div",undefined,"organizer-account-row");row.dataset.organizerId=account.id;
    const identity=el("div");identity.append(el("strong",account.name),el("span",account.username,"organizer-username"));row.append(identity);
    if(account.revokedAt!==null)row.append(el("span","Access revoked","organizer-access-help"));
    else if(confirmId===account.id){const confirmation=el("div",undefined,"organizer-revoke-confirm");confirmation.append(el("p",account.name+" will be signed out and lose organizer access."));
     confirmation.append(button("Revoke access",()=>void action(async()=>{await api("revoke",{id:account.id});confirmId=null;link=null;notice="Access revoked for "+account.name+".";}),"danger"),button("Keep access",()=>{confirmId=null;render();}));row.append(confirmation);
    }else{const actions=el("div",undefined,"actions");actions.append(button("Reset password",()=>void action(async()=>{link=await api("invite",{accountId:account.id});notice="Private reset link created.";})),button("Revoke access",()=>{confirmId=account.id;render();dialog.querySelector(".organizer-revoke-confirm button")?.focus();},"danger"));row.append(actions);}
    list.append(row);
   }dialog.append(list);
   if(data.invitations.length){const pendingList=el("details");pendingList.append(el("summary","Pending invitations ("+data.invitations.length+")"));
    for(const item of data.invitations){const row=el("div",undefined,"organizer-pending-row");row.append(el("span",item.name+(item.reset?" · password reset":"")),button("Cancel invitation",()=>void action(async()=>{await api("cancel-invitation",{id:item.id});if(link?.id===item.id)link=null;notice="Invitation cancelled.";})));pendingList.append(row);}dialog.append(pendingList);}
  }else{
   const passwordDetails=el("details");passwordDetails.append(el("summary","Change password"));const form=el("form");form.id="organizer-password-change";
   field(form,"Current password","password","password","current-password");const next=field(form,"New password","newPassword","password","new-password");next.minLength=15;const confirm=field(form,"Repeat new password","confirm","password","new-password");confirm.minLength=15;
   const submit=el("button","Change password","primary");submit.type="submit";form.append(submit);form.addEventListener("submit",event=>{event.preventDefault();if(next.value!==confirm.value){dialog.querySelector(".organizer-access-notice").textContent="The two passwords do not match.";confirm.focus();return;}const input={password:form.elements.password.value,newPassword:next.value};void action(async()=>{await api("change",input);notice="Password changed. Earlier sessions have ended.";});});passwordDetails.append(form);dialog.append(passwordDetails);
   const recoveryDetails=el("details");recoveryDetails.append(el("summary","Replace recovery code"));const recoverForm=el("form");recoverForm.id="organizer-recovery-change";field(recoverForm,"Current password","password","password","current-password");
   recoverForm.append(el("p","A new recovery code replaces the one you saved earlier.","organizer-access-help"));const save=el("button","Generate new recovery code","primary");save.type="submit";recoverForm.append(save);
   recoverForm.addEventListener("submit",event=>{event.preventDefault();const input={password:recoverForm.elements.password.value,replaceRecovery:true};void action(async()=>{const result=await api("change",input);recovery=result.recoveryCode;notice="Save your new recovery code privately.";});});recoveryDetails.append(recoverForm);dialog.append(recoveryDetails);
   if(recovery){const section=el("section",undefined,"organizer-private-recovery");section.append(el("h3","Your new recovery code"),el("code",recovery),button("Save recovery code",downloadRecovery,"primary"));dialog.append(section);}
  }
  const status=el("p",notice,"organizer-access-notice");status.setAttribute("role","status");status.setAttribute("aria-live","polite");dialog.append(status);
  dialog.append(button("Sign out",()=>void action(async()=>{await api("logout",{});location.replace("/");})));
 }
 dialog.addEventListener("close",()=>{recovery=null;link=null;confirmId=null;dialog.replaceChildren();});
 trigger.addEventListener("click",()=>{notice="";data=null;render();dialog.showModal();void action(async()=>{});});
 void read().catch(()=>{trigger.hidden=true;});
}
