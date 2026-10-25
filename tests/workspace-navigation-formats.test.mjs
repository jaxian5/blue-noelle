import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {Script} from "node:vm";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const read=p=>readFileSync(resolve(root,p),"utf8");
const admin=read("js/phase2-admin.js"),shell=read("js/workspace-shell.js");
const adminPage=read("pages/admin-classwork.html");
const paths=["classwork","admin-classwork","submission","phase1-class-staff","class-operations","account"];

test("all six secondary pages load one shared authenticated sidebar",()=>{
 for(const page of paths){
  const html=read("pages/"+page+".html");
  assert.match(html,/workspace-shell\.css/,page);
  assert.match(html,/workspace-shell\.js\?v=20261026-nav/,page);
  assert.doesNotMatch(html,/core\.js|phase1-auth\.js|phase2-assignments\.js/);
 }
 assert.match(shell,/getUser\(\)/);
 assert.match(shell,/from\("ClassMembership"\)/);
 assert.match(shell,/\.eq\("status","ACTIVE"\)/);
 assert.match(shell,/a\.hidden=a\.dataset\.role==="admin"\?!admin:!staff/);
 assert.match(shell,/oldHeader\.remove\(\)/);
 assert.match(shell,/content\.append\(topbar\(\),main\)/);
 assert.match(shell,/aria-expanded/);
 assert.match(shell,/w\.location\.replace\("login\.html"\)/);
 assert.doesNotThrow(()=>new Script(shell));
});

test("dashboard and secondary pages have corresponding navigation choices",()=>{
 const overview=read("pages/dashboard.html");
 const styles=read("css/workspace-shell.css");
 for(const route of ["dashboard.html","classwork.html","admin-classwork.html","phase1-class-staff.html","class-operations.html","account.html"]){
  assert.ok(shell.includes('href:"'+route+'"'));
  assert.ok(overview.includes('href="'+route+'"'),route);
 }
 assert.match(styles,/\.bn-shared-app \.bn-workspace-sidebar/);
 assert.match(styles,/\.bn-shared-app \.bn-topbar/);
 assert.match(styles,/max-width:750px/);
 assert.match(styles,/bn-workspace-sidebar\[data-open=true\]/);
 assert.match(overview,/Profile &amp; security/);
});

test("MIME picker is native collapsible checkbox UI, not a comma-separated text field",()=>{
 assert.match(adminPage,/<details id="assignment-format-picker"/);
 assert.match(adminPage,/<summary>/);
 assert.match(adminPage,/id="assignment-format-count"/);
 assert.match(adminPage,/id="assignment-formats-clear"/);
 assert.match(adminPage,/id="assignment-legacy-options"/);
 assert.doesNotMatch(adminPage,/Required MIME types \(comma separated\)/);
 const vals=[...adminPage.matchAll(/name="assignment-file-format" value="([^"]+)"/g)].map(m=>m[1]);
 assert.equal(new Set(vals).size,vals.length);
 assert.ok(vals.length>=10);
 assert.ok(vals.includes("application/pdf"));
 assert.ok(vals.includes("image/jpeg"));
 assert.ok(vals.includes("application/vnd.openxmlformats-officedocument.wordprocessingml.document"));
 assert.match(admin,/required_file_types:types/);
 assert.match(admin,/const types=formatSelection\(\)/);
 assert.doesNotMatch(admin,/\.value\.split\(","\)/);
});

test("selection restores predefined and legacy MIME types, clears and counts accurately",()=>{
 const ids=new Map(),known=[
    "application/pdf","image/jpeg","text/plain"
 ].map(value=>({value,checked:false,name:"assignment-file-format"}));
 function element(tag="div"){
  return {tagName:tag,children:[],value:"",checked:false,hidden:false,open:false,
   append(...items){this.children.push(...items)},
   replaceChildren(...items){this.children=[...items]}};
 }
 const $=id=>{
  if(!ids.has(id))ids.set(id,element());
  return ids.get(id);
 };
 const legacy=$("assignment-legacy-options");
 $("assignment-file-types").querySelectorAll=()=>{
  const existing=legacy.children.map(label=>label.children[0]);
  return [...known,...existing];
 };
 const document={getElementById:$,createElement:element,addEventListener(){}};
 const window={};
 const src=admin.replace(' document.addEventListener("DOMContentLoaded",init);',
  ' w.__formats={restoreFormatSelection,formatSelection,updateFormatSummary};');
 new Script(src).runInNewContext({window,document,Set,Array,String,Intl,Date,Error,Object,Number});
 window.__formats.restoreFormatSelection(["application/pdf","application/x-special-class-file"]);
 assert.deepEqual([...window.__formats.formatSelection()],
   ["application/pdf","application/x-special-class-file"]);
 assert.equal($("assignment-format-count").textContent,"2 formats selected");
 assert.equal($("assignment-legacy-formats").hidden,false);
 assert.equal(legacy.children.length,1);
 assert.equal($("assignment-format-picker").open,false);
 window.__formats.restoreFormatSelection([]);
 assert.deepEqual([...window.__formats.formatSelection()],[]);
 assert.equal($("assignment-format-count").textContent,"All supported formats");
 assert.equal($("assignment-legacy-formats").hidden,true);
});
