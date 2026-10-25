import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Script } from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = path => readFileSync(resolve(root, path), "utf8");
const pages = Object.fromEntries(
  ["pages/login.html", "pages/register.html", "pages/account.html"].map(p => [p, read(p)])
);
const core = read("js/auth-ui.js");
const live = read("js/phase1-live.js");

test("canonical public auth screens retain original Phase 1 controllers", () => {
  for (const path of ["pages/login.html", "pages/register.html"]) {
    const html=pages[path];
    assert.match(html, /supabase-adapter\.js/, path);
    assert.match(html, /phase1-live\.js/, path);
    assert.match(html, /auth-ui\.js/, path);
    assert.doesNotMatch(html, /(?:core|phase1-auth)\.js/, path);
  }
  const account=pages["pages/account.html"];
  assert.match(account, /account-settings\.js/);
  assert.match(account, /account-settings\.css/);
  assert.doesNotMatch(account, /phase1-live\.js|auth-ui\.js/);
});

test("login supports password recovery and registration points to the new account center", () => {
  assert.match(pages["pages/login.html"], /id="signin-form"/);
  assert.match(pages["pages/login.html"], /id="forgot-form"/);
  assert.match(pages["pages/login.html"], /id="change-password-form"/);
  assert.match(pages["pages/register.html"], /id="signup-form"/);
  assert.match(pages["pages/register.html"], /id="join-form"/);
  assert.match(pages["pages/account.html"], /id="memberships"/);
  assert.match(pages["pages/account.html"], /id="settings-workspace"/);
  assert.match(pages["pages/account.html"], /id="account-onboarding"/);
  assert.match(read("index.html"), /href="pages\/login\.html"/);
  assert.match(read("index.html"), /href="pages\/register\.html"/);
});

test("every UI element referenced from auth controller exists in a canonical page", () => {
  const ids = new Set([...Object.values(pages).join("\n").matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
  for (const [, id] of core.matchAll(/\$\("([^"]+)"\)/g)) {
    assert.ok(ids.has(id), "Missing element " + id);
  }
});

test("older preview pages redirect, and Class Operations no longer prompts for another password", () => {
  assert.match(read("pages/phase1-onboarding.html"), /location\.replace\("register\.html"\)/);
  assert.match(read("pages/supabase-auth.html"), /location\.replace\("login\.html"\)/);
  const ops = read("pages/class-operations.html");
  assert.doesNotMatch(ops, /supabase-login-form|supabase-password|supabase-logout/);
  assert.match(ops, /href="login\.html"/);
});

test("new screens and controllers have valid JavaScript syntax", () => {
  for (const path of ["js/auth-ui.js", "js/phase1-live.js"]) {
    assert.doesNotThrow(() => new Script(read(path), { filename: path }));
  }
  for (const [path, html] of Object.entries(pages)) {
    for (const [, source] of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
      assert.doesNotThrow(() => new Script(source, { filename: path }));
    }
  }
});

test("authorization uses real class membership status, not role in editable user metadata", () => {
  assert.match(core, /m\.status === "ACTIVE"/);
  assert.match(read("js/account-settings.js"), /m\.role==="Moderator"/);
  assert.match(live, /bn_join_class/);
  assert.match(live, /bn_review_registration/);
  assert.doesNotMatch(core + live, /raw_user_meta_data|user_metadata\.role/);
});

test("Phase 1 auth link contrast remains and profile settings uses its own stylesheet", () => {
 const stylesheet=read("css/auth.css");
 const account=pages["pages/account.html"];
 const settings=read("css/account-settings.css");
 assert.match(stylesheet, /\.bn-entry-content a\.bn-btn-primary/);
 assert.match(account, /class="bn-settings-primary/);
 assert.match(settings, /\.bn-settings-primary\{/);
 assert.match(settings, /background:#2562cd;color:#fff/);
});

test("registration presents Student and Admin paths without instant client-side elevation", () => {
  const registration = read("pages/register.html");
  const ui = read("js/auth-ui.js");
  const service = read("js/phase1-live.js");
  assert.match(registration, /name="registration-type" value="Student" checked/);
  assert.match(registration, /name="registration-type" value="Admin"/);
  assert.match(registration, /id="create-form"/);
  assert.match(registration, /id="join-form"/);
  assert.match(ui, /profile\?\.account_type === "Admin"/);
  assert.match(ui, /create-section/);
  assert.match(ui, /api\(\)\.createClass/);
  assert.match(service, /registration_type:registrationType/);
  assert.match(service, /bn_create_owned_class/);
});

test("My Account is for personal settings, with enrollment only before ACTIVE membership", () => {
 const account=pages["pages/account.html"];
 const controller=read("js/account-settings.js");
 assert.match(account, /id="profile-password-form"/);
 assert.match(account, /id="profile-photo-form"/);
 assert.match(account, /id="profile-name-form"/);
 assert.match(account, /id="account-onboarding"[^>]+hidden/);
 assert.match(account, /id="settings-workspace" hidden/);
 assert.doesNotMatch(account, /id="student-notice"|id="staff-actions"/);
 assert.match(controller, /m\.status==="ACTIVE"/);
 assert.match(controller, /profile\.account_type==="Admin"/);
 assert.doesNotMatch(controller, /user_metadata\.registration_type|service_role/);
 assert.doesNotThrow(()=>new Script(controller));
});

test("versioned SQL enforces one owned class with a private transaction", () => {
  const path = "supabase/migrations/20261025043228_multiclass_account_types_and_one_owned_class.sql";
  const sql = read(path);
  assert.match(sql, /create unique index if not exists bn_one_owned_class_per_admin/i);
  assert.match(sql, /bn_private\.guard_owner_membership/);
  assert.match(sql, /bn_private\.create_owned_class_impl/);
  assert.match(sql, /email_confirmed_at is not null/);
  assert.match(sql, /registration_type'='Admin'/);
  assert.match(sql, /bn_create_owned_class\(p_name text,p_section text default null\)/);
  assert.match(sql, /revoke execute on function public\.bn_create_owned_class/);
});


test("registration confirmation popup exists and is accessible", () => {
  const registration = read("pages/register.html");
  assert.match(registration, /<dialog id="signup-confirmation"/);
  assert.match(registration, /aria-labelledby="signup-confirm-title"/);
  assert.match(registration, /aria-describedby="signup-confirm-description"/);
  assert.match(registration, /id="signup-confirm-description"/);
  assert.match(registration, /Enter verification code/);
  assert.match(registration, /id="signup-confirm-continue" class="bn-signup-dialog-link" href="verify-email\.html"/);
  assert.match(core, /confirmation\.showModal\(\)/);
  assert.match(core, /go\(confirmationDestination\)/);
});

test("successful Student/Admin signup opens email OTP verification", async () => {
  for (const registrationType of ["Student", "Admin"]) {
    const elements = new Map();
    const fakeElement = id => {
      if (!elements.has(id)) elements.set(id, {
        value: "", textContent: "", hidden: false, dataset: {}, listeners: {},
        open: false, resets: 0,
        addEventListener(event, listener) { this.listeners[event] = listener; },
        querySelectorAll() { return []; },
        reset() { this.resets += 1; },
        showModal() { this.open = true; },
        close() { this.open = false; this.listeners.close?.(); },
      });
      return elements.get(id);
    };
    let ready;
    const document = {
      body: { dataset: { authPage: "register" } },
      addEventListener(event, listener) { if (event === "DOMContentLoaded") ready = listener; },
      getElementById: fakeElement,
      querySelector() { return { value: registrationType }; },
    };
    const redirects = [];
    const calls = [];
    const api = {
      ready: () => true,
      async signUp(...args) { calls.push(args); return { session: null }; },
    };
    const window = {
      BNLivePhase1: api,
      BNBackend: { client: { auth: { getUser: async () => ({ data: { user: null }, error: null }) } } },
      location: { href: "https://example.test/pages/register.html", replace(path) { redirects.push(path); } },
    };
    const context = { window, document, localStorage: { removeItem() {} } };
    new Script(core).runInNewContext(context);
    await ready();
    fakeElement("signup-password").value = "SomeUniquePassword1!";
    fakeElement("signup-confirm").value = "SomeUniquePassword1!";
    fakeElement("signup-name").value = "Test Person";
    fakeElement("signup-email").value = "test@example.test";
    fakeElement("signup-form").listeners.submit({ preventDefault() {} });
    for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.length, 1);
    assert.equal(calls[0][3], registrationType);
    assert.equal(fakeElement("signup-confirmation").open, true);
    assert.match(fakeElement("signup-confirm-title").textContent, /Check your email/);
    assert.equal(redirects.length, 0, "User should be able to read the popup before redirect");
    fakeElement("signup-confirmation").close();
    assert.equal(redirects[0], "verify-email.html");
  }
});

test("unsuccessful signup shows an error without a confirmation popup or redirect", async () => {
  const elements = new Map();
  const el = id => {
    if (!elements.has(id)) elements.set(id, {
      value:"",textContent:"",hidden:false,dataset:{},listeners:{},
      addEventListener(event,cb){this.listeners[event]=cb},
      querySelectorAll(){return[]}
    });
    return elements.get(id);
  };
  let ready;
  const document = {
    body:{dataset:{authPage:"register"}},
    addEventListener(_e,cb){ready=cb},
    getElementById:el,
    querySelector(){return {value:"Student"}}
  };
  const redirects=[];
  const window={
    BNLivePhase1:{ready:()=>true,signUp:async()=>{throw Error("Signup denied")}},
    BNBackend:{client:{auth:{getUser:async()=>({data:{user:null},error:null})}}},
    location:{replace:p=>redirects.push(p)}
  };
  new Script(core).runInNewContext({window,document,localStorage:{removeItem(){}}});
  await ready();
  el("signup-password").value="012345678";
  el("signup-confirm").value="012345678";
  el("signup-form").listeners.submit({preventDefault(){}});
  for(let i=0;i<4;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.match(el("auth-status").textContent,/Signup denied/);
  assert.equal(redirects.length,0);
});


test("signup alert uses a prominent centered dialog and BLUE text link instead of a filled button", () => {
  const html = read("pages/register.html");
  const css = read("css/auth.css");
  const dialog = html.match(/<dialog id="signup-confirmation"[\s\S]*?<\/dialog>/)?.[0];
  assert.ok(dialog, "Missing confirmation dialog");
  assert.match(dialog, /aria-modal="true"/);
  assert.match(dialog, /Enter verification code/);
  assert.match(dialog, /class="bn-signup-dialog-link"/);
  assert.doesNotMatch(dialog, /bn-primary-action/);
  assert.match(css, /\.bn-signup-dialog\s*\{[\s\S]*?position:fixed;/);
  assert.match(css, /\.bn-signup-dialog\s*\{[\s\S]*?inset:0;/);
  assert.match(css, /\.bn-signup-dialog\s*\{[\s\S]*?width:min\(550px,/);
  assert.match(css, /\.bn-entry-content \.bn-signup-dialog \.bn-signup-dialog-link[\s\S]*?color:#1d4ed8;/);
  assert.match(css, /\.bn-signup-dialog::backdrop\{/);
});

test("email sending quota errors explain retry without showing signup confirmation dialog", async () => {
  const elements = new Map();
  const el = id => {
    if (!elements.has(id)) elements.set(id, {
      value: "", textContent: "", hidden: false, dataset: {}, listeners: {}, opened: false,
      addEventListener(event, listener) { this.listeners[event] = listener; },
      querySelectorAll() { return []; },
      showModal() { this.opened = true; }
    });
    return elements.get(id);
  };
  let ready;
  const document = {
    body: { dataset: { authPage: "register" } },
    addEventListener(_event, callback) { ready = callback; },
    getElementById: el,
    querySelector() { return { value: "Student" }; }
  };
  const redirects = [];
  const limitError = Object.assign(new Error("email rate limit exceeded"), { code: "over_email_send_rate_limit" });
  const window = {
    BNLivePhase1: { ready: () => true, signUp: async () => { throw limitError; } },
    BNBackend: { client: { auth: { getUser: async () => ({ data: { user: null }, error: null }) } } },
    location: { replace: path => redirects.push(path) }
  };
  new Script(core).runInNewContext({ window, document, localStorage: { removeItem() {} } });
  await ready();
  el("signup-password").value = "LongPassword2026";
  el("signup-confirm").value = "LongPassword2026";
  el("signup-form").listeners.submit({ preventDefault() {} });
  for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve));
  assert.match(el("auth-status").textContent, /Email delivery is temporarily limited/);
  assert.equal(el("signup-confirmation").opened, false);
  assert.deepEqual(redirects, []);
});


test("signup and verification pages offer safe existing-account recovery without an email existence lookup", () => {
  const register = read("pages/register.html");
  const verify = read("pages/verify-email.html");
  const login = read("pages/login.html");
  const controller = read("js/auth-ui.js");
  assert.match(register, /Already have a Blue Noelle account\?/);
  assert.match(register, /Already registered\? Sign In/);
  assert.match(register, /Forgot password/);
  assert.match(verify, /already confirmed, a new signup code may not be sent/);
  assert.match(verify, /Try signing in/);
  assert.match(login, /Verify Email or request another code/);
  assert.match(controller, /An account may already exist for this email/);
  assert.match(controller, /A successful signup response does not always mean a new email was sent/);
  assert.doesNotMatch(controller, /from\(["']User["']\).*eq\(["']email["']/);
});

test("repeated signup response is not described as a guaranteed email delivery", async () => {
  const elements = new Map();
  const fakeElement = id => {
    if (!elements.has(id)) elements.set(id, {
      value:"",textContent:"",hidden:false,dataset:{},listeners:{},open:false,
      addEventListener(event,listener){this.listeners[event]=listener},
      querySelectorAll(){return []},
      reset(){},
      showModal(){this.open=true},
      close(){this.open=false;this.listeners.close?.()}
    });
    return elements.get(id);
  };
  let ready;
  const document = {
    body:{dataset:{authPage:"register"}},
    addEventListener(event,callback){if(event==="DOMContentLoaded")ready=callback},
    getElementById:fakeElement,
    querySelector(){return {value:"Student"}}
  };
  const redirects=[];
  const window = {
    BNLivePhase1:{ready:()=>true,signUp:async()=>({user:{identities:[]},session:null})},
    BNBackend:{client:{auth:{getUser:async()=>({data:{user:null},error:null})}}},
    location:{href:"https://example.test/pages/register.html",replace:p=>redirects.push(p)}
  };
  new Script(core).runInNewContext({window,document,localStorage:{removeItem(){}}});
  await ready();
  fakeElement("signup-password").value="SomeUniquePassword1!";
  fakeElement("signup-confirm").value="SomeUniquePassword1!";
  fakeElement("signup-email").value="existing@example.test";
  fakeElement("signup-name").value="Existing Account";
  fakeElement("signup-form").listeners.submit({preventDefault(){}});
  for(let i=0;i<4;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(fakeElement("signup-confirmation").open,true);
  assert.match(fakeElement("signup-confirm-description").textContent,/Already registered\?/);
  assert.match(fakeElement("auth-status").textContent,/If this is a new account/);
  assert.doesNotMatch(fakeElement("signup-confirm-description").textContent,/We sent a six-digit/);
  assert.equal(redirects.length,0);
});

test("explicit duplicate and unverified errors present recovery paths", () => {
  const controller=read("js/auth-ui.js");
  const verify=read("js/verify-email.js");
  assert.match(controller, /user_already_exists/);
  assert.match(controller, /email_not_confirmed/);
  assert.match(verify, /Request accepted\. If this email is awaiting verification/);
  assert.doesNotMatch(verify, /A new verification code was requested\./);
});


test("signup renders distinct existing-account and unverified alerts ONLY for explicit Supabase errors", async () => {
 for(const scenario of [
   {code:"user_already_exists",title:"Email already registered",href:"login.html",label:/Continue to Sign-In/},
   {code:"email_not_confirmed",title:"Email not verified",href:"verify-email.html",label:/Enter verification code/}
 ]){
   const elements=new Map();
   const elem=id=>{
     if(!elements.has(id))elements.set(id,{
       value:"",textContent:"",hidden:false,dataset:{},listeners:{},open:false,
       addEventListener(name,fn){this.listeners[name]=fn;},
       querySelectorAll(){return[];},
       reset(){},
       showModal(){this.open=true;},
       close(){this.open=false;this.listeners.close?.();}
     });
     return elements.get(id);
   };
   let ready; const redirects=[];
   const document={
     body:{dataset:{authPage:"register"}},
     addEventListener(name,fn){if(name==="DOMContentLoaded")ready=fn;},
     getElementById:elem,
     querySelector(){return {value:"Student"}}
   };
   const window={
     BNLivePhase1:{
       ready:()=>true,
       signUp:async()=>{throw Object.assign(Error(scenario.code),{code:scenario.code})}
     },
     BNBackend:{client:{auth:{getUser:async()=>({data:{user:null},error:null})}}},
     location:{href:"https://example.test/pages/register.html",replace:path=>redirects.push(path)}
   };
   new Script(core).runInNewContext({window,document,sessionStorage:{setItem(){}},localStorage:{removeItem(){}}});
   await ready();
   elem("signup-email").value="example@example.test";
   elem("signup-name").value="Example";
   elem("signup-password").value="ValidPassword1!";
   elem("signup-confirm").value="ValidPassword1!";
   elem("signup-form").listeners.submit({preventDefault(){}});
   for(let i=0;i<4;i++)await new Promise(resolve=>setImmediate(resolve));
   assert.equal(elem("signup-confirmation").open,true);
   assert.equal(elem("signup-confirm-title").textContent,scenario.title);
   assert.equal(elem("signup-confirm-continue").href,scenario.href);
   assert.match(elem("signup-continue-label").textContent,scenario.label);
   assert.equal(redirects.length,0);
   elem("signup-confirmation").close();
   assert.equal(redirects[0],scenario.href);
 }
});

test("password sign-in surfaces an email-unverified alert when Supabase rejects confirmation",async()=>{
 const els=new Map();
 const elem=id=>{
   if(!els.has(id))els.set(id,{
     value:"",textContent:"",hidden:false,dataset:{},listeners:{},opened:false,
     addEventListener(n,cb){this.listeners[n]=cb},
     querySelectorAll(){return[]},
     showModal(){this.opened=true},
   });
   return els.get(id);
 };
 let ready;
 const document={
   body:{dataset:{authPage:"login"}},
   addEventListener(n,cb){if(n==="DOMContentLoaded")ready=cb},
   getElementById:elem,
 };
 const redirects=[];
 const window={
   BNLivePhase1:{ready:()=>true,signIn:async()=>{throw Object.assign(Error("Email not confirmed"),{code:"email_not_confirmed"})}},
   BNBackend:{client:{auth:{getUser:async()=>({data:{user:null},error:null})}}},
   location:{search:"",href:"https://example.test/pages/login.html",replace:path=>redirects.push(path)}
 };
 new Script(core).runInNewContext({window,document,URLSearchParams,URL,localStorage:{removeItem(){}}});
 await ready();
 elem("signin-email").value="unverified@example.test";
 elem("signin-password").value="PrivatePassword1!";
 elem("signin-form").listeners.submit({preventDefault(){}});
 for(let i=0;i<4;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(elem("login-unverified-alert").opened,true);
 assert.equal(elem("signin-password").value,"");
 assert.deepEqual(redirects,[]);
 assert.match(read("pages/login.html"),/id="login-unverified-title">Email not verified/);
 assert.match(read("pages/login.html"),/href="verify-email.html" class="bn-signup-dialog-link"/);
});

test("auth dialogs do not add a public email lookup or treat synthetic successful signups as confirmed accounts",()=>{
 const register=read("pages/register.html");
 const login=read("pages/login.html");
 assert.match(register,/id="signup-confirm-secondary"/);
 assert.match(register,/id="signup-confirm-footnote"/);
 assert.match(login,/id="login-unverified-alert"/);
 assert.match(core,/A successful signup response does not always mean a new email was sent/);
 assert.doesNotMatch(core,/from\(["']User["']\)\.select\([^\n]*email/);
 assert.doesNotMatch(core,/checkEmailExists|emailExists|lookupEmail/i);
});
