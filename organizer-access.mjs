import {createHash,randomBytes,randomUUID,timingSafeEqual,scrypt} from "node:crypto";
import {promisify} from "node:util";
const derive=promisify(scrypt);
const fail=(code,message,status=400)=>{throw Object.assign(Error(message),{code,status});};
const hash=value=>createHash("sha256").update(value).digest("hex");
const secret=()=>randomBytes(32).toString("base64url");
const validSecret=value=>typeof value==="string"&&/^[A-Za-z0-9_-]{43}$/.test(value);
const same=(a,b)=>typeof a==="string"&&typeof b==="string"&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const cost={N:32768,r:8,p:1,maxmem:64*1024*1024};
const publicAccount=a=>({id:a.id,name:a.name,username:a.username,createdAt:a.createdAt,revokedAt:a.revokedAt??null});
function username(value){if(typeof value!=="string"||!/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,63}$/.test(value))fail("ORGANIZER_USERNAME","Use 3–64 letters, numbers, dots, hyphens or underscores for your username.");return value.toLowerCase();}
function password(value,user=""){
 if(typeof value!=="string"||value.length>512)fail("ORGANIZER_PASSWORD","Use a password of 15–128 characters.");
 const normalized=value.normalize("NFC"),size=[...normalized].length;
 if(size<15||size>128)fail("ORGANIZER_PASSWORD","Use a password of 15–128 characters.");
 const simple=normalized.toLowerCase();
 if(/^(.)\1+$/u.test(simple)||["passwordpassword","passwordpassword123","123456789012345","1234567890123456","qwertyuiopasdfgh","letmeinletmeinletmein",user,"pact"+user,user+"password"].includes(simple))fail("ORGANIZER_PASSWORD","Choose a less predictable password, such as several unrelated words.");
 return normalized;
}
async function passwordRecord(value,user){const normalized=password(value,user),salt=randomBytes(16).toString("hex");return {algorithm:"scrypt",...cost,salt,key:(await derive(normalized,salt,32,cost)).toString("hex")};}
const dummy={salt:"8f7d281e039fdf04c52ea6372a1b2c93",key:"0".repeat(64)};
async function matchesPassword(value,record){
 const input=typeof value==="string"&&value.length<=512?value.normalize("NFC"):"";
 const key=await derive(input,record?.salt??dummy.salt,32,cost);
 return Boolean(record)&&same(key.toString("hex"),record.key);
}
export function createOrganizerAccess({transaction,inspect,clock,organizerHash}){
 const requireEnabled=()=>{if(!organizerHash)fail("ORGANIZER_ACCESS","Organizer accounts require protected hosting.",403);};
 function accountSession(s,token){
  requireEnabled();const row=validSecret(token)?s.organizerSessions?.[hash(token)]:null;
  if(!row||row.expiresAt<=clock())fail("ORGANIZER_ACCESS","Sign in to open the organizer workspace.",401);
  if(row.credential===organizerHash)return {id:"installation",name:"Installation administrator",admin:true,expiresAt:row.expiresAt};
  const account=s.organizerAccounts?.[row.accountId];
  if(!account||account.revokedAt||row.revision!==account.revision)fail("ORGANIZER_ACCESS","Sign in to open the organizer workspace.",401);
  return {...publicAccount(account),admin:false,expiresAt:row.expiresAt};
 }
 const admin=(s,token)=>{const who=accountSession(s,token);if(!who.admin)fail("ORGANIZER_ADMIN","Use the installation administrator to manage organizer access.",403);return who;};
 function newSession(s,account=null){
  s.organizerSessions??={};
  for(const [key,row]of Object.entries(s.organizerSessions)){
   const a=s.organizerAccounts?.[row.accountId];
   if(row.expiresAt<=clock()||(row.accountId?(!a||a.revokedAt!=null||row.revision!==a.revision):row.credential!==organizerHash))delete s.organizerSessions[key];
  }
  if(Object.values(s.organizerSessions).filter(row=>account?row.accountId===account.id:!row.accountId).length>=(account?16:64))fail("ORGANIZER_SESSIONS","Too many active organizer sessions.",429);
  const session=secret(),expiresAt=clock()+8*60*60*1000;
  s.organizerSessions[hash(session)]=account?{accountId:account.id,revision:account.revision,expiresAt}:{credential:organizerHash,expiresAt};
  return {session,expiresAt};
 }
 const invalidate=(s,id)=>{for(const [key,row]of Object.entries(s.organizerSessions??{}))if(row.accountId===id)delete s.organizerSessions[key];};
 function attemptKey(kind,user){return hash(kind+":"+user);}
 function throttle(s,key){
  s.organizerAttempts??={};
  for(const [k,row]of Object.entries(s.organizerAttempts))if(row.until<=clock())delete s.organizerAttempts[k];
  if((s.organizerAttempts[key]?.failures??0)>=10)return {denied:true,limited:true};
  if(Object.keys(s.organizerAttempts).length>=1024&&!s.organizerAttempts[key])return {denied:true,limited:true};
  return null;
 }
 function denied(s,key){const row=s.organizerAttempts[key]??={failures:0,until:clock()+15*60*1000};row.failures++;return {denied:true,limited:row.failures>=10};}
 function unwrap(result){if(result.denied)fail("ORGANIZER_ACCESS",result.limited?"Too many attempts. Wait 15 minutes before trying again.":"The sign-in details did not match.",result.limited?429:401);return result;}
 function recovery(s,account){const code=secret();account.recoveryHash=hash(code);account.recoveryIssuedAt=clock();return code;}
 function invitation(s,value){
  const key=validSecret(value)?hash(value):"";
  const item=s.organizerInvitations?.[key];
  if(!item||item.expiresAt<=clock())fail("ORGANIZER_INVITATION","This organizer invitation has expired or was already used.",401);
  if(item.accountId){const a=s.organizerAccounts?.[item.accountId];if(!a||a.revokedAt)fail("ORGANIZER_INVITATION","This organizer invitation is no longer available.",401);}
  return {key,item};
 }
 return {
  organizerLogin(code){return transaction(s=>{requireEnabled();if(typeof code!=="string"||!same(hash(code),organizerHash))fail("ORGANIZER_ACCESS","That organizer access code did not match.",401);return newSession(s);});},
  organizerRead(token){return inspect(s=>accountSession(s,token));},
  organizerLogout(token){return transaction(s=>{if(validSecret(token)&&s.organizerSessions)delete s.organizerSessions[hash(token)];return {signedOut:true};});},
  organizerOptions(){return inspect(s=>({accounts:Object.values(s.organizerAccounts??{}).some(a=>!a.revokedAt)}));},
  organizerAccess(token){return inspect(s=>{const who=accountSession(s,token);return {organizer:who,accounts:who.admin?Object.values(s.organizerAccounts??{}).map(publicAccount):[],invitations:who.admin?Object.values(s.organizerInvitations??{}).filter(i=>i.expiresAt>clock()).map(({id,name,expiresAt,accountId})=>({id,name,expiresAt,reset:Boolean(accountId)})):[]};});},
  organizerInvite(token,{name,accountId}={}){
   return transaction(s=>{
    admin(s,token);s.organizerInvitations??={};s.organizerAccounts??={};
    for(const [key,item]of Object.entries(s.organizerInvitations))if(item.expiresAt<=clock()||accountId&&item.accountId===accountId)delete s.organizerInvitations[key];
    if(accountId){const a=s.organizerAccounts[accountId];if(!a||a.revokedAt)fail("ORGANIZER_ACCOUNT","That organizer is not active.",404);name=a.name;}
    if(typeof name!=="string"||!name.trim()||name.trim().length>100)fail("ORGANIZER_NAME","Enter the organizer's name, up to 100 characters.");
    if(Object.keys(s.organizerInvitations).length>=64||!accountId&&Object.values(s.organizerAccounts).filter(a=>!a.revokedAt).length+Object.values(s.organizerInvitations).filter(i=>!i.accountId).length>=64)fail("ORGANIZER_LIMIT","This installation has reached its organizer limit.");
    const invitation=secret(),id=randomUUID(),expiresAt=clock()+24*60*60*1000;
    s.organizerInvitations[hash(invitation)]={id,name:name.trim(),expiresAt,...(accountId?{accountId}:{})};
    return {id,invitation,name:name.trim(),expiresAt,reset:Boolean(accountId)};
   });
  },
  organizerCancelInvite(token,id){return transaction(s=>{admin(s,token);for(const [key,item]of Object.entries(s.organizerInvitations??{}))if(item.id===id)delete s.organizerInvitations[key];return {cancelled:true};});},
  organizerInvitation(value){return inspect(s=>{requireEnabled();const {item}=invitation(s,value);return {name:item.name,username:item.accountId?s.organizerAccounts[item.accountId].username:null,reset:Boolean(item.accountId),expiresAt:item.expiresAt};});},
  organizerEnroll({invitation:value,username:input,password:pass}={}){
   return transaction(async s=>{
    requireEnabled();const {key,item}=invitation(s,value);s.organizerAccounts??={};
    const existing=item.accountId?s.organizerAccounts[item.accountId]:null,user=existing?.username??username(input);
    if(!existing&&Object.values(s.organizerAccounts).some(a=>a.username===user))fail("ORGANIZER_USERNAME","That username is already in use.");
    const credential=await passwordRecord(pass,user),account=existing??{id:randomUUID(),name:item.name,username:user,createdAt:clock(),revision:0};
    account.password=credential;account.revision++;account.updatedAt=clock();
    s.organizerAccounts[account.id]=account;delete s.organizerInvitations[key];invalidate(s,account.id);
    delete s.organizerAttempts?.[attemptKey("password",user)];delete s.organizerAttempts?.[attemptKey("recovery",user)];
    const recoveryCode=recovery(s,account);
    return {...newSession(s,account),organizer:publicAccount(account),recoveryCode};
   });
  },
  async organizerAccountLogin({username:input,password:pass}={}){
   const user=typeof input==="string"&&input.length<=64?input.toLowerCase():"",key=attemptKey("password",user);
   return unwrap(await transaction(async s=>{
    requireEnabled();const limited=throttle(s,key);if(limited)return limited;
    const account=Object.values(s.organizerAccounts??{}).find(a=>a.username===user);
    const match=await matchesPassword(pass,account?.password);
    if(!account||account.revokedAt||!match)return denied(s,key);
    delete s.organizerAttempts[key];return {...newSession(s,account),organizer:publicAccount(account)};
   }));
  },
  organizerRevoke(token,id){return transaction(s=>{admin(s,token);const a=s.organizerAccounts?.[id];if(!a)fail("ORGANIZER_ACCOUNT","That organizer was not found.",404);a.revokedAt=clock();a.revision++;invalidate(s,id);for(const [key,i]of Object.entries(s.organizerInvitations??{}))if(i.accountId===id)delete s.organizerInvitations[key];return {revoked:true};});},
  async organizerRecover({username:input,recoveryCode:code,password:pass}={}){
   const user=typeof input==="string"&&input.length<=64?input.toLowerCase():"",key=attemptKey("recovery",user);
   return unwrap(await transaction(async s=>{
    requireEnabled();const limited=throttle(s,key);if(limited)return limited;
    const a=Object.values(s.organizerAccounts??{}).find(a=>a.username===user);
    if(!a||a.revokedAt||!validSecret(code)||!same(hash(code),a.recoveryHash))return denied(s,key);
    a.password=await passwordRecord(pass,user);a.revision++;a.updatedAt=clock();invalidate(s,a.id);
    delete s.organizerAttempts[key];delete s.organizerAttempts[attemptKey("password",user)];
    return {...newSession(s,a),organizer:publicAccount(a),recoveryCode:recovery(s,a)};
   }));
  },
  async organizerChange(token,{password:oldPassword,newPassword,replaceRecovery=false}={}){
   return unwrap(await transaction(async s=>{
    const who=accountSession(s,token);if(who.admin)fail("ORGANIZER_ACCOUNT","Use a personal organizer account for this action.");
    const a=s.organizerAccounts[who.id],attempt=attemptKey("change",a.username),limited=throttle(s,attempt);if(limited)return limited;if(!await matchesPassword(oldPassword,a.password))return denied(s,attempt);delete s.organizerAttempts[attempt];
    if(newPassword!==undefined){a.password=await passwordRecord(newPassword,a.username);a.revision++;a.updatedAt=clock();invalidate(s,a.id);}
    const recoveryCode=replaceRecovery?recovery(s,a):undefined;
    return {...(newPassword!==undefined?newSession(s,a):{}),organizer:publicAccount(a),...(recoveryCode?{recoveryCode}:{})};
   }));
  }
 };
}
