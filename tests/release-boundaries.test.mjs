import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = path => readFileSync(resolve(root, path), "utf8");

test("release docs distinguish merged Phase 2/3 code from owner acceptance", () => {
  const home = read("README.md");
  const p2 = read("docs/PHASE2-PRODUCTION-2026-10-25.md");
  const p3 = read("docs/PHASE3-PRODUCTION-2026-10-25.md");
  for (const text of [home, p2]) {
    assert.match(text, /merged into `main`|merged into `main` through/i);
    assert.match(text, /acceptance/i);
  }
  assert.match(p3, /merged into `main`/);
  assert.match(p3, /file-byte upload\/download/i);
  assert.match(home, /email deliverability is on operational hold/i);
  assert.doesNotMatch(home, /frontend requires PR merge|Phase 3 private submissions \(in review\)|OTP verification upgrade \(pending deployment\)/i);
});

test("production routes never load local demo identities or role JSON", () => {
  const pages = [
    "index.html","pages/login.html","pages/register.html","pages/verify-email.html",
    "pages/account.html","pages/dashboard.html","pages/classwork.html",
    "pages/admin-classwork.html","pages/submission.html",
    "pages/class-operations.html","pages/phase1-class-staff.html"
  ];
  for (const path of pages) {
    const html = read(path);
    assert.doesNotMatch(html, /<script[^>]+src=["'][^"']*\/(?:core\.js|phase1-auth\.js|phase2-assignments\.js)/i, path);
    assert.doesNotMatch(html, /(?:src|href)=["'][^"']*data\/roles\.json/i, path);
  }
});

test("legacy import screen cannot bypass audited Subject and Assignment RPCs", () => {
  const importer = read("pages/import-local-data.html");
  const operations = read("pages/class-operations.html");
  assert.match(importer, /Legacy classwork importer retired/);
  assert.doesNotMatch(importer, /migrate-local\.js|\.insert\(|bn_phase2_assignments/);
  assert.doesNotMatch(operations, /href=["']import-local-data\.html["']/);
  const admin = read("js/phase2-admin.js");
  assert.match(admin, /bn_manage_classwork/);
  assert.doesNotMatch(admin, /\.from\(["'](?:Subject|Assignment)["']\)\s*\.insert\(/);
});

test("submission UI uses private bucket download rather than public file URLs", () => {
  const code = read("js/phase3-submissions.js");
  const doc = read("docs/storage-spec.md");
  assert.match(code, /\.storage\.from\(BUCKET\)\.download\(/);
  assert.match(code, /bn_p3_prepare/);
  assert.doesNotMatch(code, /\.getPublicUrl\(/);
  assert.doesNotMatch(code, /\bservice_role\s*[:=]/);
  assert.match(doc, /Supabase Storage bucket/);
  assert.match(doc, /Live file-byte acceptance remains outstanding/i);
});
