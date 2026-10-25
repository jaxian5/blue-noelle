import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {Script} from "node:vm";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const read=path=>readFileSync(resolve(root,path),"utf8");
const auth=read("js/auth-ui.js");
const dashboard=read("js/dashboard-live.js");
const html=read("pages/dashboard.html");
const flush=async()=>{for(let n=0;n<7;n++)await new Promise(r=>setImmediate(r))};

function mockDOM(page="login"){
 const all=new Map();
 let ready=null;
 const item=(tag="div")=>({
   tag,hidden:true,disabled:false,dataset:{},listeners:{},textContent:"",value:"",
   children:[],href:"",name:"",setAttribute(k,v){this[k]=v},
   append(...nodes){this.children.push(...nodes)},
   replaceChildren(...nodes){this.children=[...nodes]},
   addEventListener(name,fn){this.listeners[name]=fn},
   querySelectorAll(){return[]},
   reset(){this.value=""}
 });
 const $=id=>{
   if(!all.has(id))all.set(id,item(id));
   return all.get(id);
 };
 const document={body:{dataset:{authPage:page}},getElementById:$,
   createElement:tag=>item(tag),
   addEventListener(name,cb){if(name==="DOMContentLoaded")ready=cb}};
 return {document,$,ready:()=>ready()};
}
test("Phase 1 visuals remain unchanged; post-login destination is the workspace",()=>{
 for(const path of ["pages/login.html","pages/register.html","pages/verify-email.html"]){
   assert.doesNotMatch(read(path),/css\/dashboard\.css|css\/workspace-pages\.css/);
 }
 const loginBlock=auth.slice(auth.indexOf("async function login()"),auth.indexOf("async function register()"));
 assert.equal((loginBlock.match(/go\("dashboard\.html"\)/g)||[]).length,3);
 assert.doesNotMatch(loginBlock,/go\("account\.html"\)/);
 assert.match(read("pages/account.html"),/id="memberships"/);
});
test("an existing signed-in user skips the login directory and enters dashboard",async()=>{
 const p=mockDOM(),redirects=[];
 const db={auth:{getUser:async()=>({data:{user:{id:"user1"}},error:null})}};
 const w={BNBackend:{configured:true,client:db},BNLivePhase1:{ready:()=>true},location:{
   search:"",replace:target=>redirects.push(target)
 }};
 new Script(auth).runInNewContext({window:w,document:p.document,URLSearchParams,localStorage:{removeItem(){}}});
 await p.ready();
 assert.equal(redirects[0],"dashboard.html");
});
test("a successful password sign-in goes directly to dashboard",async()=>{
 const p=mockDOM(),redirects=[];
 let signedIn=false;
 const db={auth:{getUser:async()=>({data:{user:signedIn?{id:"new1"}:null},error:null})}};
 const w={BNBackend:{configured:true,client:db},BNLivePhase1:{
   ready:()=>true,async signIn(){signedIn=true;}
 },location:{search:"",replace:target=>redirects.push(target)}};
 new Script(auth).runInNewContext({window:w,document:p.document,URLSearchParams,localStorage:{removeItem(){}}});
 await p.ready();
 p.$("signin-email").value="person@example.test";
 p.$("signin-password").value="example-password";
 p.$("signin-form").listeners.submit({preventDefault(){}});
 await flush();
 assert.equal(redirects[0],"dashboard.html");
 assert.equal(p.$("signin-password").value,"");
});
function classroomBackend({secondaryRole="Student"}={}){
 const calls=[],user={id:"user1"};
 const rows={
   User:[{id:"user1",full_name:"Alex Example",account_type:"Student"}],
   ClassMembership:[
     {class_id:"classA",role:"Admin",status:"ACTIVE"},
     {class_id:"classB",role:secondaryRole,status:"ACTIVE"}],
   Class:[{id:"classA",name:"Networks",section:"1"},{id:"classB",name:"Algorithms",section:"2"}],
   Subject:[{id:"subjectA",class_id:"classA",name:"Security"},
     {id:"subjectB",class_id:"classB",name:"Algorithms"}],
   Assignment:[
     {id:"assignmentA",subject_id:"subjectA",name:"Audit report",status:"OPEN",created_at:"2026-10-20T00:00:00Z"},
     {id:"assignmentB",subject_id:"subjectB",name:"Stack worksheet",status:"OPEN",created_at:"2026-10-21T00:00:00Z"}]
 };
 return {calls,db:{
  auth:{getUser:async()=>({data:{user},error:null}),signOut:async()=>({error:null})},
  from(table){
   const conditions=[];
   calls.push({table,conditions});
   const q={
     select(){return q},
     eq(k,v){conditions.push(row=>row[k]===v);return q},
     in(k,v){conditions.push(row=>v.includes(row[k]));return q},
     is(k,v){conditions.push(row=>row[k]==null);return q},
     order(){return q},
     then(resolve,reject){
       const data=(rows[table]||[]).filter(row=>conditions.every(fn=>fn(row)));
       return Promise.resolve({data,error:null}).then(resolve,reject);
     }
   };return q;
  },
  async rpc(name,args){
   calls.push({rpc:name,args});
   if(name==="bn_class_directory")return {data:[
      {full_name:"Student One",status:"ACTIVE",role:"Student"},
      {full_name:"Student Two",status:"PENDING",role:"Student"}],error:null};
   if(name==="bn_p3_details")return {data:[],error:null};
   return {data:[],error:null};
  }
 }};
}
test("dashboard switches Admin and Student workspaces by ACTIVE class membership",async()=>{
 const p=mockDOM("dashboard"),backend=classroomBackend(),redirects=[];
 const w={BNBackend:{configured:true,client:backend.db},
   location:{replace:target=>redirects.push(target)}};
 new Script(dashboard).runInNewContext({window:w,document:p.document,Intl,Date,Number,Map,Set,Promise});
 await p.ready();
 assert.equal(p.document.body.dataset.workspace,"admin");
 assert.equal(p.$("dash-admin-panel").hidden,false);
 assert.equal(p.$("dash-student-panel").hidden,true);
 assert.equal(p.$("dash-admin-link").hidden,false);
 assert.equal(p.$("dash-admin-students").textContent,"1");
 assert.equal(p.$("dash-admin-assignments").children.length,1);
 assert.equal(p.$("dash-pending-count").textContent,"1 awaiting review");
 p.$("dash-class").value="classB";
 p.$("dash-class").listeners.change();
 await flush();
 assert.equal(p.document.body.dataset.workspace,"student");
 assert.equal(p.$("dash-admin-panel").hidden,true);
 assert.equal(p.$("dash-student-panel").hidden,false);
 assert.equal(p.$("dash-admin-link").hidden,true);
 assert.equal(p.$("dash-role").textContent,"Student");
 assert.equal(p.$("dash-upcoming").children.length,1);
 assert.ok(p.$("dash-upcoming").children[0].children.some(n=>
   (n.children||[]).some(child=>child.href==="submission.html?assignment=assignmentB")));
 assert.equal(redirects.length,0);
 assert.equal(backend.calls.some(c=>c.rpc==="bn_p3_details"&&c.args.p_assignment==="assignmentB"),true);
});
test("post-login pages share a navigation and do not resurrect demo identities",()=>{
 for(const path of ["pages/classwork.html","pages/admin-classwork.html","pages/submission.html"]){
   const page=read(path);
   assert.match(page,/workspace-pages\.css/);
   assert.match(page,/href="dashboard\.html"/);
   assert.doesNotMatch(page,/phase1-auth\.js|core\.js|phase2-assignments\.js/);
 }
 assert.match(html,/id="dash-admin-panel"/);
 assert.match(html,/id="dash-student-panel"/);
 assert.match(html,/id="dash-signout"/);
 assert.match(html,/id="dash-class"/);
 assert.doesNotMatch(dashboard,/localStorage|service_role|getPublicUrl/);
 assert.doesNotThrow(()=>new Script(dashboard));
});

test("Moderator sees staff tools without treating other Students' files as own",async()=>{
 const p=mockDOM("dashboard"),backend=classroomBackend({secondaryRole:"Moderator"});
 const w={BNBackend:{configured:true,client:backend.db},location:{replace(){}}};
 new Script(dashboard).runInNewContext({window:w,document:p.document,Intl,Date,Number,Map,Set,Promise});
 await p.ready();
 p.$("dash-class").value="classB";
 p.$("dash-class").listeners.change();
 await flush();
 assert.equal(p.$("dash-role").textContent,"Moderator");
 assert.equal(p.$("dash-admin-link").hidden,true);
 assert.equal(p.$("dash-staff-link").hidden,false);
 assert.match(p.$("dash-student-accent-title").textContent,/Review without rewriting/);
 assert.equal(backend.calls.filter(c=>c.rpc==="bn_p3_details").length,0);
});
