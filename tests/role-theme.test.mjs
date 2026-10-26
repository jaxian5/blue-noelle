import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {Script} from "node:vm";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const read=path=>readFileSync(resolve(root,path),"utf8");
const source=read("js/theme.js");
const css=read("css/theme.css");

function harness({saved=null,systemDark=false}={}){
 let ready,change,stored=saved;
 const tags=[],rootEl={dataset:{},style:{}};
 const make=tag=>{
   const el={tagName:tag.toUpperCase(),dataset:{},attrs:{},children:[],listeners:{},
     append(...nodes){this.children.push(...nodes)},
     setAttribute(k,v){this.attrs[k]=v},
     querySelector(sel){return this.children.find(e=>sel===".bn-theme-icon"&&e.className==="bn-theme-icon"||sel===".bn-theme-label"&&e.className==="bn-theme-label")||null},
     addEventListener(type,callback){this.listeners[type]=callback}
   };
   tags.push(el);return el;
 };
 const document={
   documentElement:rootEl,
   body:{append(el){this.child=el}},
   querySelectorAll(selector){return selector==="[data-theme-toggle]"?tags.filter(e=>Object.hasOwn(e.dataset,"themeToggle")):[]},
   querySelector(selector){return selector.includes(".bn-top-actions")?this.host:null},
   createElement:make,
   addEventListener(name,handler){if(name==="DOMContentLoaded")ready=handler},
   host:{prepend(element){this.child=element}}
 };
 const window={
  localStorage:{getItem(){return stored},setItem(k,v){stored=v}},
  matchMedia(){return {matches:systemDark,addEventListener(_,fn){change=fn}}},
  setTimeout(fn){fn()}
 };
 new Script(source).runInNewContext({window,document,Set,String,Object});
 return {document,window,root:rootEl,ready:()=>ready(),getSaved:()=>stored,systemChanged:()=>change?.()};
}
test("theme script parses and initializes without a page flash",()=>{
 assert.doesNotThrow(()=>new Script(source));
 const p=harness({systemDark:true});
 assert.equal(p.root.dataset.theme,"dark");
 assert.equal(p.root.style.colorScheme,"dark");
 p.ready();
 assert.equal(p.document.host.child.attrs["aria-pressed"],"true");
 assert.match(p.document.host.child.attrs["aria-label"],/light mode/);
});
test("light/dark toggle persists ONLY color mode across navigations",()=>{
 const p=harness({saved:"light",systemDark:true});
 p.ready();
 assert.equal(p.root.dataset.theme,"light");
 p.document.host.child.listeners.click();
 assert.equal(p.root.dataset.theme,"dark");
 assert.equal(p.getSaved(),"dark");
 p.document.host.child.listeners.click();
 assert.equal(p.root.dataset.theme,"light");
 assert.equal(p.getSaved(),"light");
 const q=harness({saved:p.getSaved(),systemDark:true});
 assert.equal(q.root.dataset.theme,"light");
 assert.doesNotMatch(source,/localStorage.*setItem.*role|service_role|user_metadata/);
});
test("palette reflects classroom roles and protected Developer flag",()=>{
 const p=harness();p.ready();
 for(const role of ["Student","Moderator","Admin"]){
  p.window.BNTheme.setRole(role);
  assert.equal(p.root.dataset.role,role.toLowerCase());
 }
 p.root.dataset.developer="true";
 p.window.BNTheme.setRole("Student");
 assert.equal(p.root.dataset.role,"developer");
 p.root.dataset.developer="false";
 p.window.BNTheme.setRole("Developer",{isDeveloper:true});
 assert.equal(p.root.dataset.role,"developer");
});
test("invalid stored setting is ignored and OS preference wins without explicit choice",()=>{
 const p=harness({saved:"neon",systemDark:true});
 assert.equal(p.root.dataset.theme,"dark");
 p.window.BNTheme.setMode("neon");
 assert.equal(p.getSaved(),"neon");
 assert.equal(p.root.dataset.theme,"dark");
});
test("every canonical entry and signed-in view loads early theme and final override CSS",()=>{
 const paths=["index.html","pages/login.html","pages/register.html",
   "pages/verify-email.html","pages/dashboard.html","pages/account.html",
   "pages/classwork.html","pages/admin-classwork.html","pages/submission.html",
   "pages/phase1-class-staff.html","pages/class-operations.html"];
 for(const path of paths){
  const page=read(path);
  const js=page.indexOf("js/theme.js");
  const cssLoc=page.indexOf("css/theme.css");
  const end=page.toLowerCase().indexOf("</head>");
  assert.ok(js>=0&&js<cssLoc&&cssLoc<end,path);
  assert.equal((page.match(/js\/theme\.js/g)||[]).length,1,path);
  assert.equal((page.match(/css\/theme\.css/g)||[]).length,1,path);
 }
});
test("four role palettes cover sidebar and whole dark UI, not merely hero",()=>{
 for(const role of ["student","moderator","admin","developer"]){
  assert.match(css,new RegExp('html\\[data-role="'+role+'"\\]'));
 }
 for(const element of [".bn-workspace-sidebar",".bn-settings-sidebar",".bn-hero",
   ".bn-topbar",".bn-settings-card",".bn-card",".bn-sub-panel",
   ".bn-admin-form",".bn-format-picker",".bn-entry",".bn-landing"]){
   assert.ok(css.includes(element),"Missing coverage "+element);
 }
 assert.match(css,/html\[data-theme="dark"\]/);
 assert.match(css,/color-scheme/);
 assert.match(css,/--role-sidebar-a/);
 assert.match(css,/--ui-page:#0c1423/);
});
test("authenticated scripts do not derive palette from user-editable metadata",()=>{
 const dash=read("js/dashboard-live.js");
 const shell=read("js/workspace-shell.js");
 const acc=read("js/account-settings.js");
 const classroom=read("js/phase2-classwork.js");
 const submissions=read("js/phase3-submissions.js");
 assert.match(dash,/select\("full_name,account_type,is_developer"\)/);
 assert.match(shell,/select\("full_name,is_developer"\)/);
 assert.match(acc,/select\("id,full_name,account_type,is_developer"\)/);
 assert.match(dash,/setRole\(active\.role\)/);
 assert.match(classroom,/setRole\(membership\.role\)/);
 assert.match(submissions,/setRole\(role\)/);
 for(const code of [dash,shell,acc]){
   assert.doesNotMatch(code,/user_metadata\.role|localStorage\.role|service_role/);
 }
});
