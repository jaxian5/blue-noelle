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
const paths=["class-clock","classwork","admin-classwork","submission","phase1-class-staff","class-operations","account"];

test("all authenticated secondary pages load one shared sidebar",()=>{
 for(const page of paths){
  const html=read("pages/"+page+".html");
  assert.match(html,/workspace-shell\.css/,page);
  assert.match(html,/workspace-shell\.js\?v=20261026-phase4/,page);
  assert.doesNotMatch(html,/<script[^>]+src=["\x27][^"\x27]*\/(?:core|phase1-auth|phase2-assignments)\.js/i);
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
 for(const route of ["dashboard.html","class-clock.html","classwork.html","admin-classwork.html","phase1-class-staff.html","class-operations.html","account.html"]){
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
  return {tagName:tag,children:[],dataset:{},value:"",checked:false,hidden:false,open:false,
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
 // Editing the same legacy assignment twice must never lose its MIME restriction.
 window.__formats.restoreFormatSelection(["application/pdf","application/x-special-class-file"]);
 assert.deepEqual([...window.__formats.formatSelection()],
   ["application/pdf","application/x-special-class-file"]);
 assert.equal(legacy.children.length,1);

 window.__formats.restoreFormatSelection([]);
 assert.deepEqual([...window.__formats.formatSelection()],[]);
 assert.equal($("assignment-format-count").textContent,"All supported formats");
 assert.equal($("assignment-legacy-formats").hidden,true);
});

test("shared sidebar actually mounts and Admin/Student permissions follow authenticated memberships",async()=>{
 function makeElement(tag){
   const el={tagName:tag.toLowerCase(),parentNode:null,children:[],listeners:{},
    className:"",dataset:{},hidden:false,attributes:{},
    classList:{add(name){el.className+=" "+name}},
    setAttribute(k,v){el.attributes[k]=String(v)},
    append(...nodes){for(const n of nodes){n.parentNode=el;el.children.push(n)}},
    prepend(...nodes){for(const n of nodes){n.parentNode=el}el.children.unshift(...nodes)},
    remove(){
      if(el.parentNode){const i=el.parentNode.children.indexOf(el);if(i>=0)el.parentNode.children.splice(i,1)}
      el.parentNode=null;
    },
    replaceWith(newNode){
      if(el.parentNode){const i=el.parentNode.children.indexOf(el);
        if(i>=0){el.parentNode.children[i]=newNode;newNode.parentNode=el.parentNode}}
      el.parentNode=null;
    },
    querySelector(sel){
      const match=n=>sel==="main"?n.tagName==="main":sel===".bn-header"?n.className==="bn-header":false;
      const stack=[...el.children];
      while(stack.length){const n=stack.shift();if(match(n))return n;stack.unshift(...(n.children||[]))}
      return null;
    },
    addEventListener(k,v){el.listeners[k]=v}
   };return el;
 }
 const app=makeElement("div");app.className="bn-app";
 const header=makeElement("header");header.className="bn-header";
 const main=makeElement("main");main.className="bn-main";
 app.append(header,main);
 let onReady;
 const all=(root)=>[root,...root.children.flatMap(all)];
 const get=id=>all(app).find(n=>n.id===id);
 const document={
   createElement:makeElement,
   createTextNode:txt=>({tagName:"#text",textContent:txt,children:[]}),
   querySelector:sel=>sel===".bn-app"?app:null,
   querySelectorAll:sel=>sel===".bn-unified-sidebar [data-role]"
     ?all(app).filter(n=>n.dataset?.role):[],
   getElementById:get,
   addEventListener(event,fn){if(event==="DOMContentLoaded")onReady=fn}
 };
 function check(role){
   const rows=[{role,status:"ACTIVE",class_id:"class-1"}];
   const db={
     auth:{getUser:async()=>({data:{user:{id:"person-1",email:"person@example.test"}},error:null}),
       signOut:async()=>({error:null})},
     from(table){
       const result=table==="User"?[{full_name:"Sample Person"}]:rows;
       const request={select(){return request},eq(){return request},limit(){return request},
         then(ok,fail){return Promise.resolve({data:result,error:null}).then(ok,fail)}};
       return request;
     }
   };
   return db;
 }
 const window={location:{pathname:"/pages/classwork.html",replace(){}},
   BNBackend:{configured:true,client:check("Admin")},addEventListener(){}};
 new Script(shell).runInNewContext({window,document,Intl,Date,Promise,URL:undefined});
 onReady();
 for(let n=0;n<8;n++)await new Promise(ok=>setImmediate(ok));
 assert.match(app.children[0].className,/bn-workspace-sidebar/);
 assert.match(app.children[1].className,/bn-workspace-main/);
 assert.equal(app.children[1].children[1],main);
 assert.equal(header.parentNode,null);
 assert.equal(get("classwork-admin-link").hidden,false);
 const nav=all(app).find(n=>n.href==="classwork.html"&&n.tagName==="a");
 assert.equal(nav.attributes["aria-current"],"page");
 get("shell-menu").listeners.click();
 assert.equal(get("shell-sidebar").dataset.open,"true");
 assert.equal(get("shell-menu").attributes["aria-expanded"],"true");
});

test("Phase 3 file picker reflects assignment format restrictions but retains upload validation",()=>{
 const source=read("js/phase3-submissions.js");
 assert.match(source,/\$\("sub-files"\)\.accept=allowed\.join\(","\)/);
 assert.match(source,/allowed\.length&&!allowed\.includes\(mime\)/);
 assert.match(source,/bn_p3_prepare/);
});
