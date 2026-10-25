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
