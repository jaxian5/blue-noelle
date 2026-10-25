import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {Script} from "node:vm";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const read=p=>readFileSync(resolve(root,p),"utf8");
const page=read("pages/verify-email.html");
const ui=read("js/verify-email.js");
const adapter=read("js/phase1-live.js");

test("dedicated OTP screen provides eight usable code inputs",()=>{
  assert.match(page,/data-auth-page="verify-email"/);
  assert.match(page,/id="otp-email"/);
  assert.match(page,/id="otp-form"/);
  assert.match(page,/id="otp-resend-timer"/);
  assert.match(page,/id="otp-complete"/);
  assert.match(page,/verify-email\.js/);
  assert.equal((page.match(/class="bn-otp-digit"/g)||[]).length,8);
  assert.match(page,/autocomplete="one-time-code"/);
  assert.doesNotMatch(page,/phase1-auth\.js|core\.js/);
  assert.match(read("css/auth.css"),/grid-template-columns:repeat\(8,/);
  assert.doesNotThrow(()=>new Script(ui));
  assert.doesNotThrow(()=>new Script(adapter));
});

test("signup OTP uses Supabase Auth rather than homemade code storage",()=>{
  assert.match(adapter,/async verifySignupCode\(email,token\)/);
  assert.match(adapter,/auth\.verifyOtp\(\{/);
  assert.match(adapter,/type:"email"/);
  assert.match(adapter,/auth\.resend\(\{/);
  assert.match(adapter,/type:"signup"/);
  assert.match(ui,/api\(\)\.verifySignupCode\(email,token\)/);
  assert.match(ui,/api\(\)\.resendSignupCode\(email\)/);
  assert.match(ui,/api\(\)\.signOut\(\)/);
  assert.match(read("js/auth-ui.js"),/bn_pending_confirmation_email/);
  assert.doesNotMatch(ui,/setItem\([^\n]*(?:token|password|role)/i);
});

test("live signup OTP adapter checks code length, type and resend call",async()=>{
  let verified,resent;
  const client={auth:{
    verifyOtp:async args=>{verified=args;return {data:{user:{id:"test"},session:null},error:null}},
    resend:async args=>{resent=args;return {data:{},error:null}}
  }};
  const w={BNBackend:{configured:true,client},location:{href:"https://example.test/pages/verify-email.html"}};
  new Script(adapter).runInNewContext({window:w,URL});
  await assert.rejects(w.BNLivePhase1.verifySignupCode("user@example.com","1234567"),/eight-digit/);
  await assert.rejects(w.BNLivePhase1.verifySignupCode("user@example.com","ABCDEFGH"),/eight-digit/);
  await assert.rejects(w.BNLivePhase1.verifySignupCode("user@example.com","123456789"),/eight-digit/);
  const result=await w.BNLivePhase1.verifySignupCode("user@example.com","12345678");
  assert.equal(result.user.id,"test");
  assert.equal(verified.type,"email");
  assert.equal(verified.token,"12345678");
  assert.equal(verified.email,"user@example.com");
  await w.BNLivePhase1.resendSignupCode("user@example.com");
  assert.equal(resent.type,"signup");
  assert.equal(resent.email,"user@example.com");
});

function fixture({withPending=false,fail=false}={}){
  const map=new Map();
  const elem=id=>{
    if(!map.has(id))map.set(id,{
      value:"",hidden:id==="otp-complete",disabled:false,textContent:"",dataset:{},listeners:{},
      addEventListener(event,callback){this.listeners[event]=callback},
      focus(){this.focused=true}
    });
    return map.get(id);
  };
  const slots=Array.from({length:8},(_,i)=>elem("digit"+i));
  let ready,verifyCalls=0,signOutCalls=0,resendCalls=0;
  const now=Date.now();
  let stored=withPending?JSON.stringify({email:"student@example.test",at:now,nextResendAt:now+60000}):null;
  const storage={
    getItem(){return stored},
    setItem(_key,value){stored=value},
    removeItem(){stored=null}
  };
  const api={
    ready:()=>true,
    async verifySignupCode(email,token){
      verifyCalls++;
      assert.equal(email,"student@example.test");
      assert.equal(token,"12345678");
      if(fail)throw Object.assign(Error("Token has expired"),{code:"otp_expired"});
      return {user:{id:"verified"},session:{access_token:"test-session"}};
    },
    async signOut(){signOutCalls++},
    async resendSignupCode(email){resendCalls++; assert.equal(email,"student@example.test")}
  };
  const document={
    getElementById:elem,
    querySelectorAll:()=>slots,
    addEventListener(event,callback){if(event==="DOMContentLoaded")ready=callback}
  };
  const context={window:{BNLivePhase1:api},document,sessionStorage:storage,
    setInterval:()=>1,clearInterval:()=>{},Date};
  new Script(ui).runInNewContext(context);
  return {ready,elem,slots,get calls(){return {verifyCalls,signOutCalls,resendCalls,stored}}};
}

test("successful verification clears temporary hint and returns to password sign in",async()=>{
  const x=fixture({withPending:true});
  await x.ready();
  assert.equal(x.elem("otp-email").value,"student@example.test");
  [..."12345678"].forEach((ch,i)=>x.slots[i].value=ch);
  x.elem("otp-form").listeners.submit({preventDefault(){}});
  for(let i=0;i<4;i++)await new Promise(done=>setImmediate(done));
  assert.equal(x.calls.verifyCalls,1);
  assert.equal(x.calls.signOutCalls,1);
  assert.equal(x.calls.stored,null);
  assert.equal(x.elem("otp-form").hidden,true);
  assert.equal(x.elem("otp-complete").hidden,false);
});

test("expired code remains on screen and cannot produce false success",async()=>{
  const x=fixture({withPending:true,fail:true});
  await x.ready();
  [..."12345678"].forEach((ch,i)=>x.slots[i].value=ch);
  x.elem("otp-form").listeners.submit({preventDefault(){}});
  for(let i=0;i<4;i++)await new Promise(done=>setImmediate(done));
  assert.equal(x.calls.verifyCalls,1);
  assert.equal(x.calls.signOutCalls,0);
  assert.equal(x.elem("otp-complete").hidden,true);
  assert.match(x.elem("auth-status").textContent,/expired/);
});
