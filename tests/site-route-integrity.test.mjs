import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync,existsSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const canonical=[
 "index.html","pages/login.html","pages/register.html",
 "pages/verify-email.html","pages/dashboard.html","pages/account.html","pages/class-clock.html",
 "pages/classwork.html","pages/admin-classwork.html","pages/submission.html",
 "pages/phase1-class-staff.html","pages/class-operations.html"
];
test("canonical pages do not reference missing local href/src assets",()=>{
 let checked=0;
 for(const page of canonical){
   const html=readFileSync(resolve(root,page),"utf8");
   for(const [,raw] of html.matchAll(/\b(?:href|src)=["']([^"']+)["']/gi)){
     if(/^(?:https?:|data:|mailto:|tel:|\/|#|javascript:)/i.test(raw))continue;
     const clean=raw.split(/[?#]/)[0];
     if(!clean)continue;
     const path=resolve(root,dirname(page),clean);
     assert.ok(path.startsWith(root+"/"),"Local path escapes repository: "+page+" → "+raw);
     assert.ok(existsSync(path),"Missing local asset: "+page+" → "+raw);
     checked++;
   }
 }
 assert.ok(checked>=100,"Local link coverage unexpectedly decreased: "+checked);
});
test("canonical pages load only production controllers and never local demo authentication",()=>{
 for(const page of canonical.filter(p=>p.startsWith("pages/"))){
   const html=readFileSync(resolve(root,page),"utf8");
   assert.doesNotMatch(html,/<script[^>]+src=["'][^"']*\/(?:core|phase1-auth|phase2-assignments)\.js/i,page);
 }
 const ops=readFileSync(resolve(root,"pages/class-operations.html"),"utf8");
 assert.match(ops,/class-operations-ui\.js/);
 assert.match(ops,/workspace-shell\.js/);
});
