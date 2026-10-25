import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {Script} from "node:vm";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const read=path=>readFileSync(resolve(root,path),"utf8");
const page=read("pages/classwork.html");
const code=read("js/phase2-classwork.js");

test("Phase 2 canonical viewer uses Supabase Auth and no local demo state",()=>{
 assert.match(page,/href="\.\.\/css\/classwork\.css"/);
 assert.match(page,/js\/supabase-adapter\.js/);
 assert.match(page,/js\/phase2-classwork\.js/);
 assert.match(page,/id="classwork-class"/);
 assert.match(page,/id="classwork-subjects"/);
 assert.match(read("pages/account.html"),/href="classwork\.html"/);
 assert.doesNotMatch(page,/(?:phase1-auth|core|phase2-assignments)\.js/);
 assert.doesNotMatch(code,/\blocalStorage\b|bn_phase2_assignments|\bBN\.getCurrentUser/);
 assert.doesNotMatch(code,/\.insert\(|\.update\(|\.delete\(/);
 assert.doesNotThrow(()=>new Script(code));
});
function fixture({session=true,members=[{class_id:"class-A",role:"Student",status:"ACTIVE"}]}={}){
 const elements=new Map();
 function el(id){
  if(!elements.has(id)){
   elements.set(id,{
     value:"",textContent:"",dataset:{},hidden:id==="classwork-content",
     disabled:id==="classwork-class",children:[],listeners:{},
     addEventListener(name,fn){this.listeners[name]=fn},
     append(...items){this.children.push(...items)},
     appendChild(item){this.children.push(item);return item},
     replaceChildren(...items){this.children=[...items]},
   });
  }
  return elements.get(id);
 }
 let ready;
 const document={
   createElement:tag=>{const n=el("anon-"+Math.random());n.tagName=tag;return n},
   getElementById:el,
   addEventListener(event,fn){if(event==="DOMContentLoaded")ready=fn;}
 };
 const queries=[];
 const rows={
   "ClassMembership":members.filter(m=>m.status==="ACTIVE"),
   "Class":[{id:"class-A",name:"Class A",section:"A"},{id:"class-B",name:"Class B",section:"B"}],
   "Subject":[{id:"subject-A",class_id:"class-A",name:"Data Structures",created_at:"2026-10-01"}],
   "Assignment":[{id:"assignment-A",subject_id:"subject-A",name:"Stacks and Queues",
     description:"Answer the worksheet",instructions:"Submit your answers",
     deadline:"2026-10-30T14:00:00Z",is_group:false,status:"OPEN"}]
 };
 const db={
   auth:{getUser:async()=>({data:{user:session?{id:"student-A"}:null},error:null})},
   from(table){
     const req={table,filters:[],order:null};
     queries.push(req);
     const chain={
       select(columns){req.columns=columns;return this},
       eq(key,value){req.filters.push({op:"eq",key,value});return this},
       is(key,value){req.filters.push({op:"is",key,value});return this},
       in(key,value){req.filters.push({op:"in",key,value});return this},
       order(key,options){req.order={key,options};return this},
       then(resolve,reject) {
         let data=rows[table]??[];
         for(const f of req.filters){
           if(f.op==="eq")data=data.filter(row=>row[f.key]===f.value);
           if(f.op==="in")data=data.filter(row=>f.value.includes(row[f.key]));
           if(f.op==="is")data=data.filter(row=>row[f.key]==null);
         }
         return Promise.resolve({data,error:null}).then(resolve,reject);
       }
     };
     return chain;
   }
 };
 const redirects=[];
 const window={
   BNBackend:{configured:true,client:db},
   location:{replace:p=>redirects.push(p)}
 };
 const context={document,window,Date,Intl};
 new Script(code).runInNewContext(context);
 return {ready,el,queries,redirects,context};
}
test("verified ACTIVE member sees only class-scoped Subject and Assignment queries",async()=>{
 const t=fixture();
 await t.ready();
 assert.deepEqual(t.redirects,[]);
 const membership=t.queries.find(q=>q.table==="ClassMembership");
 assert.equal(membership.filters.some(f=>f.key==="status"&&f.value==="ACTIVE"),true);
 const subjects=t.queries.find(q=>q.table==="Subject");
 assert.equal(subjects.filters.some(f=>f.op==="eq"&&f.key==="class_id"&&f.value==="class-A"),true);
 const assignments=t.queries.find(q=>q.table==="Assignment");
 assert.equal(assignments.filters.some(f=>f.op==="in"&&f.key==="subject_id"&&f.value.includes("subject-A")),true);
 assert.equal(t.el("classwork-content").hidden,false);
 assert.match(t.el("classwork-status").textContent,/1 subject\(s\) and 1 assignment\(s\)/);
 const content=t.el("classwork-subjects").children;
 assert.equal(content.length,1);
 assert.equal(content[0].children[0].textContent,"Data Structures");
 assert.equal(content[0].children[1].children[0].children[0].children[0].textContent,"Stacks and Queues");
});
test("signed-out visitors redirect to canonical Sign In before reading classwork",async()=>{
 const t=fixture({session:false});
 await t.ready();
 assert.deepEqual(t.redirects,["login.html"]);
 assert.equal(t.queries.length,0);
});
test("no ACTIVE membership blocks all classroom reads",async()=>{
 const t=fixture({members:[{class_id:"class-B",role:"Student",status:"PENDING"}]});
 await t.ready();
 assert.equal(t.queries.filter(q=>q.table==="Class").length,0);
 assert.equal(t.queries.filter(q=>q.table==="Subject").length,0);
 assert.match(t.el("classwork-status").textContent,/ACTIVE classroom membership/);
});
test("manipulated class picker cannot request a non-member classroom",async()=>{
 const t=fixture();
 await t.ready();
 const before=t.queries.length;
 t.el("classwork-class").value="class-B";
 await t.el("classwork-class").listeners.change();
 assert.equal(t.queries.length,before);
 assert.match(t.el("classwork-status").textContent,/not part of your active memberships/);
});
