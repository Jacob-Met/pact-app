import test from "node:test";
import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {mkdtemp,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createSharedAgreementStore} from "../shared-agreements.mjs";
test("organizer sessions survive restart but expire, sign out and lose access on code rotation",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"pact-organizer-session-")),path=join(dir,"shared.json");
 const code=randomBytes(32).toString("base64url");let now=1000;
 try{
  let store=await createSharedAgreementStore({path,organizerCode:code,clock:()=>now});
  await assert.rejects(store.organizerLogin("wrong"),e=>e.status===401);
  const first=await store.organizerLogin(code);await store.organizerRead(first.session);
  const disk=await readFile(path,"utf8");assert.equal(disk.includes(code),false);assert.equal(disk.includes(first.session),false);
  store=await createSharedAgreementStore({path,organizerCode:code,clock:()=>now});
  await store.organizerRead(first.session);
  now+=8*60*60*1000;await assert.rejects(store.organizerRead(first.session),e=>e.status===401);
  const second=await store.organizerLogin(code);await store.organizerLogout(second.session);
  await assert.rejects(store.organizerRead(second.session),e=>e.status===401);
  const third=await store.organizerLogin(code);
  store=await createSharedAgreementStore({path,organizerCode:randomBytes(32).toString("base64url"),clock:()=>now});
  await assert.rejects(store.organizerRead(third.session),e=>e.status===401);
  await assert.rejects(store.organizerLogin(code),e=>e.status===401);
 }finally{await rm(dir,{recursive:true,force:true});}
});
