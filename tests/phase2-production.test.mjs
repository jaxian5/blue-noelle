import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {Script} from "node:vm";
import {fileURLToPath} from "node:url";
import {dirname,resolve} from "node:path";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const read=p=>readFileSync(resolve(root,p),"utf8");
const dash=read("js/dashboard-live.js");
const admin=read("js/phase2-admin.js");

test("live dashboard is redesigned and no longer invokes demo identity or assignment storage",()=>{
 const html=read("pages/dashboard.html");
 assert.match(html,/css\/dashboard\.css/);
 assert.match(html,/js\/dashboard-live\.js/);
 assert.match(html,/id="dash-class"/);
 assert.match(html,/id="dash-count-open"/);
 assert.match(html,/id="dash-admin-link"/);
 assert.doesNotMatch(html,/(?:core|phase1-auth|phase2-assignments)\.js/);
 assert.doesNotMatch(html,/Juan Dela Cruz|Ana Reyes|EDUC 2 · The Teaching Profession/);
 assert.doesNotMatch(dash,/localStorage\s*\.|BN\.getCurrentUser|\.insert\(|\.update\(/);
 assert.doesNotThrow(()=>new Script(dash));
});
test("Admin workspace uses audited class-scoped RPC and never trusts client-provided roles",()=>{
 const page=read("pages/admin-classwork.html");
 assert.match(page,/js\/phase2-admin\.js/);
 assert.match(page,/id="assignment-form"/);
 assert.match(page,/id="subject-create-form"/);
 assert.match(page,/id="subject-rename-dialog"/);
 assert.match(admin,/bn_manage_classwork/);
 assert.match(admin,/p_class:classId,p_action:name,p_data:payload/);
 assert.match(admin,/eq\("role","Admin"\)\.eq\("status","ACTIVE"\)/);
 for(const x of ["subject.create","subject.rename","assignment.create","assignment.update","assignment.status"]){
  assert.ok(admin.includes(x),"Missing "+x);
 }
 assert.doesNotMatch(admin,/BN\.getCurrentUser|localStorage\s*\.|\.insert\(|\.update\(|service_role/);
 assert.doesNotThrow(()=>new Script(admin));
});
test("legacy academic routes no longer load demo accounts or browser-only assignments",()=>{
 for(const [path,to] of Object.entries({
  "pages/assignments.html":"classwork.html",
  "pages/admin-assignments.html":"admin-classwork.html",
  "pages/admin.html":"admin-classwork.html",
  "pages/moderator.html":"phase1-class-staff.html"
 })){
  const page=read(path);
  assert.match(page,new RegExp("location\\.replace\\(\\\""+to.replace(".","\\.")+"\\\"\\)"));
  assert.doesNotMatch(page,/phase1-auth\.js|phase2-assignments\.js|core\.js/);
 }
 const submission=read("pages/submission.html");
 assert.match(submission,/Phase 3/);
 assert.match(submission,/phase3-submissions\.js/);
 assert.match(read("js/phase3-submissions.js"),/auth\.getUser\(\)/);
 assert.doesNotMatch(submission,/phase2-assignments\.js|localStorage\.setItem/);
});

function fakePage(){
 let domReady=null;
 const ids=new Map();
 function element(tag="div"){
  return {tagName:tag,textContent:"",value:"",hidden:false,disabled:false,children:[],dataset:{},listeners:{},
   append(...n){this.children.push(...n)},
   appendChild(n){this.children.push(n);return n},
   replaceChildren(...n){this.children=[...n]},
   addEventListener(name,callback){this.listeners[name]=callback},
   setAttribute(name,value){this[name]=value},
   focus(){this.focused=true},scrollIntoView(){},reset(){this.value="";},
   showModal(){this.open=true},close(){this.open=false}};
 }
 const document={
  createElement:tag=>element(tag),
  getElementById:id=>{
   if(!ids.has(id))ids.set(id,element("id:"+id));
   return ids.get(id);
  },
  addEventListener:(name,callback)=>{if(name==="DOMContentLoaded")domReady=callback}
 };
 return {document,elem:document.getElementById,ready:()=>domReady()};
}
function queryBackend({role="Admin",active=true}={}){
 const calls=[],rows={
  ClassMembership:active?[{class_id:"class-1",role,status:"ACTIVE"}]:[],
  Class:[{id:"class-1",name:"Live Classroom",section:"IT-1"}],
  User:[{id:"admin-1",full_name:"Avery Sample",account_type:role}],
  Subject:[{id:"subject-1",class_id:"class-1",name:"Data Structures",created_at:"2026-10-01"}],
  Assignment:[{id:"assignment-1",subject_id:"subject-1",name:"Stack Exercise",description:"Review stacks",
    deadline:"2026-10-30T11:00:00Z",is_group:false,status:"OPEN"}]
 };
 const db={
  auth:{getUser:async()=>({data:{user:{id:"admin-1",email:"sample@example.test"}},error:null})},
  from(table){
   const constraints=[],req={table,constraints};calls.push(req);
   const q={
    select(){return q},eq(k,v){constraints.push(["eq",k,v]);return q},
    in(k,v){constraints.push(["in",k,v]);return q},
    is(k,v){constraints.push(["is",k,v]);return q},
    order(){return q},
    then(ok,err){
     let data=rows[table]||[];
     for(const [op,k,v] of constraints){
      if(op==="eq")data=data.filter(r=>r[k]===v);
      if(op==="in")data=data.filter(r=>v.includes(r[k]));
      if(op==="is")data=data.filter(r=>r[k]==null);
     }
     return Promise.resolve({data,error:null}).then(ok,err);
    }
   };
   return q;
  },
  async rpc(name,args){
   calls.push({rpc:name,args});
   if(name==="bn_manage_classwork"&&args.p_action==="subject.create"){
    rows.Subject.push({id:"subject-2",class_id:"class-1",name:args.p_data.name});
   }
   return {data:{id:"created"},error:null};
  }
 };
 return {db,calls,rows};
}
const flush=async()=>{for(let i=0;i<6;i++)await new Promise(r=>setImmediate(r))};
test("Admin can initialize production workspace and create subjects through audited RPC",async()=>{
 const p=fakePage(),b=queryBackend();
 const context={window:{BNBackend:{configured:true,client:b.db},location:{replace(){}}},document:p.document,
  Intl,Date,Number,Error};
 new Script(admin).runInNewContext(context);
 await p.ready();
 assert.match(p.elem("admin-status").textContent,/1 subject\(s\)/);
 assert.equal(p.elem("admin-workspace").hidden,false);
 assert.equal(p.elem("admin-class").disabled,false);
 p.elem("new-subject").value="Computer Networks";
 p.elem("subject-create-form").listeners.submit({preventDefault(){}});
 await flush();
 const call=b.calls.find(c=>c.rpc==="bn_manage_classwork");
 assert.equal(call.args.p_class,"class-1");
 assert.equal(call.args.p_action,"subject.create");
 assert.equal(call.args.p_data.name,"Computer Networks");
 assert.equal(p.elem("admin-subject-list").children.length,2);
});
test("Students cannot initialize the Admin editor",async()=>{
 const p=fakePage(),b=queryBackend({role:"Student",active:true});
 const context={window:{BNBackend:{configured:true,client:b.db},location:{replace(){}}},document:p.document,Intl,Date,Number,Error};
 new Script(admin).runInNewContext(context);
 await p.ready();
 assert.match(p.elem("admin-status").textContent,/ACTIVE Admin membership/);
 assert.equal(b.calls.filter(c=>c.rpc==="bn_manage_classwork").length,0);
});
test("dashboard renders real member/class/subject/assignment summaries",async()=>{
 const p=fakePage(),b=queryBackend({role:"Student",active:true});
 const context={window:{BNBackend:{configured:true,client:b.db},location:{replace(){}}},document:p.document,Intl,Date,Map,Set};
 new Script(dash).runInNewContext(context);
 await p.ready();
 assert.equal(p.elem("dash-greeting").textContent,"Welcome back, Avery.");
 assert.equal(p.elem("dash-count-classes").textContent,"1");
 assert.equal(p.elem("dash-count-subjects").textContent,"1");
 assert.equal(p.elem("dash-count-open").textContent,"1");
 assert.equal(p.elem("dash-role").textContent,"Student");
 assert.equal(p.elem("dash-admin-link").hidden,true);
 assert.equal(p.elem("dash-upcoming").children.length,1);
 assert.equal(b.calls.some(c=>c.table==="Subject"&&c.constraints.some(x=>x[1]==="class_id"&&x[2]==="class-1")),true);
});
