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

test("canonical auth screens do not load the legacy demo login system", () => {
  for (const [path, html] of Object.entries(pages)) {
    assert.match(html, /supabase-adapter\.js/, path);
    assert.match(html, /phase1-live\.js/, path);
    assert.match(html, /auth-ui\.js/, path);
    assert.doesNotMatch(html, /(?:core|phase1-auth)\.js/, path);
    assert.doesNotMatch(html, /Test accounts|Student@2026|Moderator@2026|BN-EDUC2-2026/, path);
  }
});

test("login supports password recovery and registration points to the new account center", () => {
  assert.match(pages["pages/login.html"], /id="signin-form"/);
  assert.match(pages["pages/login.html"], /id="forgot-form"/);
  assert.match(pages["pages/login.html"], /id="change-password-form"/);
  assert.match(pages["pages/register.html"], /id="signup-form"/);
  assert.match(pages["pages/register.html"], /id="join-form"/);
  assert.match(pages["pages/account.html"], /id="memberships"/);
  assert.match(pages["pages/account.html"], /id="staff-actions"/);
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
  assert.match(core, /m\.role === "Moderator" \|\| m\.role === "Admin"/);
  assert.match(live, /bn_join_class/);
  assert.match(live, /bn_review_registration/);
  assert.doesNotMatch(core + live, /raw_user_meta_data|user_metadata\.role/);
});

test("auth call-to-action links retain readable contrast over button backgrounds", () => {
  const stylesheet = read("css/auth.css");
  const account = read("pages/account.html");
  assert.match(account, /id="join-action"[^>]+class="bn-btn bn-btn-primary"/);
  assert.match(account, /class="bn-btn bn-btn-primary" href="phase1-class-staff\.html"/);
  // Specificity (.bn-entry-content a.bn-btn-primary) beats the generic
  // .bn-entry-content a rule that formerly rendered blue-on-blue text.
  assert.match(stylesheet,
    /\.bn-entry-content a\.bn-btn-primary(?::[a-z-]+)?[^{}]*\{[^{}]*background:var\(--bn-primary\);[^{}]*color:#fff;/);
  assert.match(stylesheet,
    /\.bn-entry-content a\.bn-btn-primary:hover\{background:var\(--bn-primary-hover\)\}/);
  assert.match(stylesheet,
    /\.bn-entry-content a\.bn-btn-secondary[^{}]*\{[^{}]*color:var\(--bn-text\);/);
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

test("My Account respects the saved account type, not editable auth metadata", () => {
  const account = read("pages/account.html");
  const ui = read("js/auth-ui.js");
  assert.match(account, /id="account-type"/);
  assert.match(ui, /profile\?\.account_type === "Admin"/);
  assert.match(ui, /hasOwnedClass/);
  assert.match(ui, /isAdminAccount \? "Create my one class"/);
  assert.doesNotMatch(ui, /user_metadata\.registration_type/);
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
  assert.match(el("auth-status").textContent, /Supabase is temporarily limiting email delivery/);
  assert.equal(el("signup-confirmation").opened, false);
  assert.deepEqual(redirects, []);
});
