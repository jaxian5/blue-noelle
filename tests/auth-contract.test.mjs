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
