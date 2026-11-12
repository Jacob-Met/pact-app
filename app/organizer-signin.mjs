const q=s=>document.querySelector(s),message=q("#organizer-message");
let invitation=location.pathname==="/organizer-activate"?location.hash.slice(1):"",recovery=null;
const sections=["signin-entry","enroll-entry","recover-entry","recovery-saved"];
function show(id){for(const name of sections)q("#"+name).hidden=name!==id;message.textContent="";q("#"+id+" input")?.focus();}
async function api(action,input){const response=await fetch("/organizer/"+action,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(input)});const value=await response.json();if(!response.ok)throw Error(value.error||"The request did not complete.");return value;}
function recoveryReady(result){
 recovery={username:result.organizer.username,code:result.recoveryCode};show("recovery-saved");
 q("#recovery-identity").textContent=result.organizer.name+" · "+result.organizer.username;
 q("#recovery-value").textContent=result.recoveryCode;
 for(const input of document.querySelectorAll('input[type="password"]'))input.value="";
 invitation="";history.replaceState(null,"","/organizer-activate");q("#recovery-download").focus();
}
function submit(form,action){form.addEventListener("submit",async event=>{
 event.preventDefault();const button=form.querySelector('[type="submit"]');if(button.disabled)return;
 if(form.elements.confirm&&form.elements.password.value!==form.elements.confirm.value){message.textContent="The two passwords do not match.";form.elements.confirm.focus();return;}
 button.disabled=true;message.textContent="Working…";
 try{await action(form);}catch(error){message.textContent=error.message;}finally{button.disabled=false;}
});}
submit(q("#organizer-signin"),async form=>{await api("login",{code:form.elements.code.value});form.elements.code.value="";location.replace("/");});
submit(q("#account-signin"),async form=>{await api("account-login",{username:form.elements.username.value,password:form.elements.password.value});form.elements.password.value="";location.replace("/");});
submit(q("#account-enroll"),async form=>recoveryReady(await api("enroll",{invitation,username:form.elements.username.value,password:form.elements.password.value})));
submit(q("#account-recover"),async form=>recoveryReady(await api("recover",{username:form.elements.username.value,recoveryCode:form.elements.recoveryCode.value.trim(),password:form.elements.password.value})));
q("#recover-open").addEventListener("click",()=>{show("recover-entry");q("#recover-username").value=q("#account-username").value;});
q("#recover-cancel").addEventListener("click",()=>show("signin-entry"));
q("#recovery-download").addEventListener("click",()=>{if(!recovery)return;const url=URL.createObjectURL(new Blob(["PACT organizer recovery\nUsername: "+recovery.username+"\nRecovery code: "+recovery.code+"\n\nKeep this code private. It can replace your password and can be used once.\n"],{type:"text/plain"}));const a=document.createElement("a");a.href=url;a.download="pact-recovery-"+recovery.username+".txt";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
q("#recovery-continue").addEventListener("click",()=>{recovery=null;q("#recovery-value").textContent="";location.replace("/");});
q("#organizer-signin button").disabled=false;
if(invitation){show("enroll-entry");q("#account-enroll button").disabled=true;try{
 const item=await api("invitation",{invitation});q("#enroll-name").textContent=item.name;
 if(item.reset){q("#enroll-heading").textContent="Reset your organizer password";q("#enroll-username").value=item.username;q("#enroll-username").readOnly=true;q("#account-enroll button").textContent="Reset password";}
 q("#account-enroll button").disabled=false;
}catch(error){message.textContent=error.message;}}
else{try{const response=await fetch("/organizer/options"),options=await response.json();q("#account-signin").hidden=!options.accounts;q("#installation-entry").open=!options.accounts;(options.accounts?q("#account-username"):q("#organizer-code")).focus();}catch{q("#organizer-code").focus();}}
