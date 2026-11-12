import {sendStaticAsset} from "./static-asset.mjs";
import { pdfAssets } from "./app/vendor/pdfjs/assets.mjs";
import { createServer, request } from "node:http";
import { networkInterfaces } from "node:os";
import { readFile } from "node:fs/promises";
import { createSharedAgreementStore, sharedError } from "./shared-agreements.mjs";
const root=new URL("./app/",import.meta.url);
const assets=new Map([...pdfAssets.filter(name=>name!=="LICENSE").map(name=>["/vendor/pdfjs/"+name,"vendor/pdfjs/"+name]),["/review","shared-review.html"],["/shared-review.mjs","shared-review.mjs"],["/shared-review.css","shared-review.css"],
 ...["source-citations.mjs","citation-view.mjs","amendment-terms.mjs","amendment.css","core.mjs","decision-review.mjs","evidence-file.mjs","source-identity.mjs","source-hash.mjs","source-hash-worker.mjs","ui-utils.mjs","styles.css","contract-document.css","contract-document.mjs","source-passages.mjs","source-references.mjs","source-references-ui.mjs","vendor/source-serif/SourceSerif4.ttf","vendor/manrope/Manrope.ttf","source-file-review.mjs","source-file-diff.worker.mjs","source-file-diff.mjs", "source-dom-selection.mjs","agreement-file.mjs","agreement-word.mjs","agreement-word.worker.mjs","agreement-word-text.mjs","vendor/officeparser/officeparser.browser.slim.mjs"].map(x=>["/"+x,x]),
 ...["sha2.js","utils.js","_u64.js","_md.js"].map(x=>["/vendor/noble-hashes/"+x,"vendor/noble-hashes/"+x])]);
const fail=(code,message,status=400)=>{throw sharedError(code,message,status);};
const privateAddress=ip=>/^10\./.test(ip)||/^192\.168\./.test(ip)||/^172\.(1[6-9]|2\d|3[01])\./.test(ip)||/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip);
export function privateReviewAddresses(interfaces=networkInterfaces) {
 const list=[];
 for(const [name,rows]of Object.entries(interfaces()))for(const row of rows??[])
  if(row.family==="IPv4"&&!row.internal&&privateAddress(row.address)&&!list.some(x=>x.address===row.address))list.push({address:row.address,name});
 return list.sort((a,b)=>Number(a.address.startsWith("100."))-Number(b.address.startsWith("100."))||a.name.localeCompare(b.name)||a.address.localeCompare(b.address));
}
function json(res,status,body,headers={}) {
 res.writeHead(status,{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff","referrer-policy":"no-referrer","content-security-policy":"default-src 'none'",...headers});
 res.end(JSON.stringify(body));
}
async function body(req) {
 if((req.headers["content-type"]??"").split(";")[0].trim()!=="application/json")fail("CONTENT_TYPE","Use application/json.",415);
 let bytes=0;const chunks=[];
 for await(const chunk of req){bytes+=chunk.length;if(bytes>1048576)fail("REQUEST_TOO_LARGE","Shared request exceeds 1 MiB.",413);chunks.push(chunk);}
 let result;try{result=JSON.parse(Buffer.concat(chunks).toString("utf8"));}catch{fail("INVALID_JSON","Supply a JSON object.");}
 if(!result||typeof result!=="object"||Array.isArray(result))fail("INVALID_JSON","Supply a JSON object.");
 return result;
}
const error=(res,e)=>json(res,Number.isInteger(e.status)?e.status:400,{code:e.code??"INVALID_REQUEST",error:e.code?e.message:"The request could not be applied."});
const localHost=value=>{try{return ["localhost","127.0.0.1","[::1]"].includes(new URL("http://"+value).hostname);}catch{return false;}};

export async function createSharedReviewCoordinator({path,preferredPort=4174,interfaces=networkInterfaces,externalOrigin=null,organizerCode=null,organizerPort=null}={}) {
 if(externalOrigin){
  const parsed=new URL(externalOrigin);
  if(parsed.protocol!=="https:"||parsed.origin!==externalOrigin||parsed.username||parsed.password)throw Error("Hosted review requires an exact HTTPS origin.");
 }
 if(organizerCode&&(!externalOrigin||!Number.isInteger(organizerPort)||organizerPort<1||organizerPort>65535))throw Error("Hosted organizer requires HTTPS and a separate local port.");
 const store=await createSharedAgreementStore({path,organizerCode});
 let server=null,origin=null,tail=Promise.resolve(),reviewsEnabled=true;
 const status=()=>({enabled:Boolean(server)&&reviewsEnabled,organizer:Boolean(organizerCode),origin,hosted:Boolean(externalOrigin),addresses:externalOrigin?[]:privateReviewAddresses(interfaces)});
 const cookieName=()=> "pact_review_"+(new URL(origin).port||"443");
 const cookie=req=>(req.headers.cookie??"").split(";").map(v=>v.trim()).find(v=>v.startsWith(cookieName()+"="))?.slice(cookieName().length+1)??"";
 const ownerCookieName=()=> "pact_organizer_"+(new URL(origin).port||"443");
 const ownerCookie=req=>(req.headers.cookie??"").split(";").map(v=>v.trim()).find(v=>v.startsWith(ownerCookieName()+"="))?.slice(ownerCookieName().length+1)??"";
 async function forwardOwner(req,res){
  if(!["GET","HEAD","POST"].includes(req.method))fail("METHOD","Method not allowed.",405);
  if(req.method==="POST"&&req.headers.origin!==origin)fail("ORIGIN","Use your organizer workspace.",403);
  await store.organizerRead(ownerCookie(req));
  const host="127.0.0.1:"+organizerPort;
  const headers={host};
  if(req.headers["content-type"])headers["content-type"]=req.headers["content-type"];
  if(req.method==="POST")headers.origin="http://"+host;
  const upstream=request({hostname:"127.0.0.1",port:organizerPort,path:req.url,method:req.method,headers,timeout:120000},response=>{
   res.writeHead(response.statusCode,{...response.headers,"cache-control":"no-store"});response.pipe(res);
  });
  upstream.on("timeout",()=>upstream.destroy());
  upstream.on("error",()=>{if(res.destroyed)return;if(!res.headersSent)json(res,503,{code:"ORGANIZER_UNAVAILABLE",error:"The organizer workspace is temporarily unavailable."});else res.destroy();});
  // A source question is already uploaded before the author stops waiting.
  // Only this read-only lookup follows the downstream response disconnect.
  if(req.method==="POST"&&new URL(req.url,origin).pathname==="/api/ai/suggest")
   res.once("close",()=>{if(!res.writableEnded)upstream.destroy();});
  req.on("aborted",()=>upstream.destroy());req.pipe(upstream);
 }
 function exclusive(action){const run=tail.then(action);tail=run.catch(()=>{});return run;}
 function createGuestServer() {
  return createServer(async(req,res)=>{
   try {
    if(!origin||req.headers.host!==new URL(origin).host)fail("HOST","Review host mismatch.",403);
    const pathname=new URL(req.url,origin).pathname;
    if(organizerCode&&pathname.startsWith("/organizer/")){
     if(req.method==="GET"&&pathname==="/organizer/options"){json(res,200,await store.organizerOptions());return;}
     if(req.method==="GET"&&pathname==="/organizer/status"){json(res,200,await store.organizerAccess(ownerCookie(req)));return;}
     if(req.method!=="POST")fail("ROUTE","Route not found.",404);
     if(req.headers.origin!==origin)fail("ORIGIN","Use your organizer sign-in page.",403);
     const input=await body(req);
     if(pathname==="/organizer/login"){
      const result=await store.organizerLogin(input.code);
      json(res,200,{ok:true},{"set-cookie":ownerCookieName()+"="+result.session+"; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800"});
     }else if(pathname==="/organizer/logout"){
      await store.organizerLogout(ownerCookie(req));
      json(res,200,{ok:true},{"set-cookie":ownerCookieName()+"=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0"});
     }else{
      let result;
      if(pathname==="/organizer/account-login")result=await store.organizerAccountLogin(input);
      else if(pathname==="/organizer/enroll")result=await store.organizerEnroll(input);
      else if(pathname==="/organizer/recover")result=await store.organizerRecover(input);
      else if(pathname==="/organizer/invitation")result=await store.organizerInvitation(input.invitation);
      else if(pathname==="/organizer/invite"){result=await store.organizerInvite(ownerCookie(req),input);result.url=origin+"/organizer-activate#"+result.invitation;delete result.invitation;}
      else if(pathname==="/organizer/cancel-invitation")result=await store.organizerCancelInvite(ownerCookie(req),input.id);
      else if(pathname==="/organizer/revoke")result=await store.organizerRevoke(ownerCookie(req),input.id);
      else if(pathname==="/organizer/change")result=await store.organizerChange(ownerCookie(req),input);
      else fail("ROUTE","Route not found.",404);
      const headers={};
      if(result.session){headers["set-cookie"]=ownerCookieName()+"="+result.session+"; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800";delete result.session;}
      json(res,200,result,headers);
     }
     return;
    }
    if(pathname==="/shared/health"&&req.method==="GET"){json(res,200,{service:"pact-invited-review",access:"invitation"});return;}
    if(pathname.startsWith("/shared/")) {
     if(!reviewsEnabled)fail("REVIEW_PAUSED","Invited reviews are paused. Contact the organizer.",401);
     if(pathname==="/shared/state"&&req.method==="GET"){json(res,200,await store.read(cookie(req)));return;}
     if(req.method!=="POST")fail("ROUTE","Route not found.",404);
     if(req.headers.origin!==origin)fail("ORIGIN","Open this action from the invited review.",403);
     const input=await body(req);
     if(pathname==="/shared/claim"){
      const result=await store.claim(input.token);
      json(res,200,{ok:true},{"set-cookie":cookieName()+"="+result.session+"; Path=/shared; HttpOnly; SameSite=Strict; Max-Age=28800"+(externalOrigin?"; Secure":"")});
     } else if(pathname==="/shared/preview")json(res,200,await store.preview(cookie(req),input));
     else if(pathname==="/shared/record")json(res,200,await store.append(cookie(req),input));
     else fail("ROUTE","Route not found.",404);
     return;
    }
    let file=assets.get(pathname);
    if(organizerCode&&["/organizer-signin.mjs","/organizer-signin.css"].includes(pathname))file=pathname.slice(1);
    if(organizerCode&&pathname==="/organizer-activate")file="organizer-signin.html";
    if(organizerCode&&(pathname==="/"||pathname==="/index.html")){
     try{await store.organizerRead(ownerCookie(req));await forwardOwner(req,res);return;}
     catch(e){if(e.status!==401)throw e;file="organizer-signin.html";}
    }else if(organizerCode&&!file){await forwardOwner(req,res);return;}
    if(req.method!=="GET"&&req.method!=="HEAD")fail("ROUTE","Route not found.",404);
    if(!file)fail("ROUTE","Route not found.",404);
    const data=await readFile(new URL(file,root));
    const type=file.endsWith(".html")?"text/html; charset=utf-8":file.endsWith(".css")?"text/css; charset=utf-8":file.endsWith(".ttf")?"font/ttf":/\.(mjs|js)$/.test(file)?"text/javascript; charset=utf-8":"application/octet-stream";
    sendStaticAsset(req,res,{path:pathname,type,body:data,policy:"default-src 'self'; img-src 'self' blob:; media-src blob:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"});
   }catch(e){error(res,e);}
  });
 }
 async function listen(address,port){
  const next=createGuestServer();
  await new Promise((resolve,reject)=>{next.once("error",reject);next.listen(port,address,()=>{next.off("error",reject);resolve();});});
  server=next;origin=externalOrigin||"http://"+address+":"+next.address().port;
  try{await new Promise((resolve,reject)=>{
   const check=request({hostname:address,port:next.address().port,path:"/review",headers:{host:new URL(origin).host},timeout:2000},response=>{response.resume();response.on("end",()=>response.statusCode===200?resolve():reject(Error("Unavailable")));});
   check.on("timeout",()=>check.destroy(Error("Timeout")));check.on("error",reject);check.end();
  });}
  catch{await close();fail("NETWORK_UNREACHABLE","This network address cannot receive reviews. Choose another private network.");}
 }
 async function close(){
  const current=server;server=null;origin=null;
  if(current?.listening)await new Promise((resolve,reject)=>{current.close(e=>e?reject(e):resolve());current.closeIdleConnections();current.closeAllConnections();});
 }
 if(externalOrigin)await listen("127.0.0.1",preferredPort);
 return {
  status,
  withPaymentReview(project,action){return store.withCurrentProject(project,action);},
  async shutdown(){await exclusive(close);},
  async handleOwner(req,res){
   const url=new URL(req.url,"http://localhost");
   if(!url.pathname.startsWith("/api/collaboration/"))return false;
   try {
    if(!localHost(req.headers.host)||!["127.0.0.1","::1","::ffff:127.0.0.1"].includes(req.socket.remoteAddress))fail("OWNER_ONLY","Use the organizer on this computer.",403);
    if(req.method==="GET"&&url.pathname==="/api/collaboration/status") {
     json(res,200,{...status(),agreements:await store.ownerList(),agreement:url.searchParams.get("project")?await store.ownerFind(url.searchParams.get("project")):null});return true;
    }
    if(req.method!=="POST")fail("ROUTE","Route not found.",404);
    if(req.headers.origin!=="http://"+req.headers.host)fail("ORIGIN","Use the organizer's own browser tab.",403);
    const input=await body(req),action=url.pathname.slice("/api/collaboration/".length);
    let result;
    if(action==="start")result=await exclusive(async()=>{
     if(externalOrigin){if(!server)await listen("127.0.0.1",preferredPort);reviewsEnabled=true;return status();}
     if(!privateReviewAddresses(interfaces).some(a=>a.address===input.address))fail("NETWORK","Choose a private address assigned to this computer.");
     if(server){if(new URL(origin).hostname!==input.address)fail("NETWORK_ACTIVE","Stop sharing before changing network.",409);return status();}
     const remembered=await store.networkRead();
     const retained=remembered?.address===input.address&&Number.isInteger(remembered.port)&&remembered.port>0;
     try{await listen(input.address,retained?remembered.port:preferredPort);}
     catch(e){
      if(e.code==="EADDRINUSE"&&!retained&&preferredPort!==0)await listen(input.address,0);
      else if(e.code==="EADDRINUSE"&&retained)fail("REVIEW_PORT_BUSY","The saved review address is in use. Close the other listener before reopening these invitations.",409);
      else throw e;
     }
     try{await store.networkSave(input.address,server.address().port);}catch(e){await close();throw e;}
     return status();
    });
    else if(action==="stop")result=await exclusive(async()=>{await store.revokeAll();if(externalOrigin)reviewsEnabled=false;else await close();return status();});
    else if(action==="open")result=await store.open(input.project,input.ownerPartyId);
    else if(action==="receive")result=await store.ownerRead(input.id);
    else if(action==="archive")result=await store.archive(input.id,input.digest);
    else if(action==="restore")result=await store.restore(input.id,input.digest);
    else if(action==="publish")result=await store.publish(input.id,input.project,input.digest);
    else if(action==="invite"){
     if(!server||!reviewsEnabled)fail("NETWORK_REQUIRED","Enable private-network reviews first.",409);
     const invitation=await store.invite(input.id,input.partyId);
     result={partyId:invitation.partyId,expiresAt:invitation.expiresAt,url:origin+"/review#invite="+invitation.token};
    } else if(action==="revoke")result=await store.revoke(input.id,input.partyId);
    else fail("ROUTE","Route not found.",404);
    json(res,200,result);
   }catch(e){error(res,e);}
   return true;
  }
 };
}
