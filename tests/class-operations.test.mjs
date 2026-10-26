import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {Script} from "node:vm";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const read=path=>readFileSync(resolve(root,path),"utf8");
const html=read("pages/class-operations.html");
const ui=read("js/class-operations-ui.js");
const api=read("js/class-operations.js");
const sql=read("supabase/migrations/20261026015109_class_operations_least_privilege_and_audit.sql");
async function flush(){for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve))}

function makeDOM(){
 const named=new Map();
 function element(tag="div"){
   const el={tagName:tag.toUpperCase(),id:"",className:"",textContent:"",value:"",dataset:{},
     disabled:false,hidden:false,children:[],listeners:{},attrs:{},lastElementChild:null,
     addEventListener(evt,cb){this.listeners[evt]=cb},
     setAttribute(name,value){this.attrs[name]=value},
     appendChild(child){this.children.push(child);this.lastElementChild=child;
       if(this.tagName==="SELECT"&&!this.value)this.value=child.value;return child},
     append(...kids){for(const kid of kids)this.appendChild(kid)},
     replaceChildren(...kids){this.children=[...kids];this.lastElementChild=kids.at(-1)||null;
       if(this.tagName==="SELECT")this.value=kids[0]?.value||""},
     insertRow(){const row=element("tr");this.appendChild(row);return row},
     insertCell(){const td=element("td");this.appendChild(td);return td},
     querySelectorAll(sel){if(sel==="input,select,button")return this.fields;return []},
     reset(){this.resetCount=(this.resetCount||0)+1}
   };
   return el;
 }
 const $=id=>{
   if(!named.has(id))named.set(id,element("div"));
   const result=named.get(id);result.id=id;return result;
 };
 for(const id of ["slot-form","exception-form"]){
   const form=$(id);
   form.fields=[element("input"),element("select"),element("button")];
   form.data={};
 }
 let onReady;
 const document={getElementById:$,createElement:element,
   addEventListener(evt,fn){if(evt==="DOMContentLoaded")onReady=fn}};
 return {$,document,ready:()=>onReady()};
}
function fixture({role="Admin",oneFailure=false,memberStatus="ACTIVE"}={}){
 const dom=makeDOM(),calls=[],alerts=[];
 const roster=[
  {membership_id:"m-owner",full_name:"Class Owner",role:"Admin",status:"ACTIVE"},
  {membership_id:"m-student",full_name:"A Student",role:"Student",status:memberStatus}
 ];
 const backend={
   ready(){return true},
   async memberships(){calls.push("memberships");return [{class_id:"room-1",role,status:"ACTIVE"}]},
   async classes(){calls.push("classes");return [{id:"room-1",name:"Data Structures 1",section:"1-1"}]},
   async directory(){calls.push("directory");return roster},
   async slots(){calls.push("slots");return [
     {id:"slot-1",day_of_week:1,start_local:"08:00:00",end_local:"10:00:00",label:"Programming"}
   ]},
   async exceptions(){calls.push("exceptions");if(oneFailure)throw Error("Simulated exception service outage");return []},
   async createSlot(data){calls.push(["createSlot",data]);return {id:"new-slot"}},
   async deleteSlot(id,classId){calls.push(["deleteSlot",id,classId]);return {id}},
   async createException(data){calls.push(["createException",data]);return {id:"new-exception"}},
   async deleteException(id,classId){calls.push(["deleteException",id,classId]);return {id}},
   async review(id,decision){calls.push(["review",id,decision])},
   async updateMember(...args){calls.push(["updateMember",...args])}
 };
 const w={BNClassOps:backend,BNTheme:{setRole(v){calls.push(["theme",v])}},confirm(){return true}};
 function FormData(form){return {get(name){return form.data[name]??""}}}
 new Script(ui).runInNewContext({window:w,document:dom.document,FormData,Set,Map,Promise,Number,String,Error,Array});
 return {w,backend,calls,dom,alerts,load:async()=>{dom.ready();await flush()}};
}

test("operations page uses a single external controller with no demo directory",()=>{
 assert.match(html,/class-operations-ui\.js/);
 assert.match(html,/id="ops-class"/);
 assert.match(html,/id="ops-refresh"/);
 assert.match(html,/id="ops-role"/);
 assert.match(html,/name="replacement_start_local"/);
 assert.match(html,/name="replacement_end_local"/);
 assert.match(html,/workspace-shell\.js/);
 assert.doesNotMatch(html,/Account session|const memberships=await BNClassOps/);
 assert.doesNotThrow(()=>new Script(ui));
 assert.doesNotThrow(()=>new Script(api));
});

test("Admin sees readable rooms, roster and working schedule controls",async()=>{
 const x=fixture();await x.load();
 assert.equal(x.dom.$("ops-class").value,"room-1");
 assert.match(x.dom.$("ops-class").children[0].textContent,/Data Structures 1/);
 assert.match(x.dom.$("ops-role").textContent,/Admin/);
 assert.equal(x.dom.$("slot-form").fields.every(f=>!f.disabled),true);
 assert.equal(x.dom.$("member-rows").children.length,2);
 assert.equal(x.dom.$("slot-rows").children.length,1);
 assert.equal(x.dom.$("member-rows").children[0].children.at(-1).textContent,"Protected class owner");
 assert.match(x.dom.$("ops-message").textContent,/Asia\/Manila/);
});

test("Moderator can review pending members but cannot modify the schedule",async()=>{
 const x=fixture({role:"Moderator",memberStatus:"PENDING"});await x.load();
 assert.equal(x.dom.$("slot-form").fields.every(f=>f.disabled),true);
 assert.equal(x.dom.$("exception-form").fields.every(f=>f.disabled),true);
 assert.match(x.dom.$("ops-role").textContent,/Moderator/);
 const student=x.dom.$("member-rows").children[1];
 const actions=student.children.at(-1).children[0];
 assert.equal(actions.children.length,2);
 assert.equal(actions.children[0].textContent,"Approve");
 actions.children[0].listeners.click();await flush();
 assert.ok(x.calls.some(c=>Array.isArray(c)&&c[0]==="review"&&c[1]==="m-student"&&c[2]===true));
});

test("Partial exception-service outage preserves member and schedule views and shows error",async()=>{
 const x=fixture({oneFailure:true});await x.load();
 assert.equal(x.dom.$("member-rows").children.length,2);
 assert.equal(x.dom.$("slot-rows").children.length,1);
 assert.equal(x.dom.$("exception-rows").children.length,1);
 assert.match(x.dom.$("ops-message").textContent,/exceptions: Simulated exception service outage/);
 assert.equal(x.dom.$("ops-message").dataset.state,"error");
});

test("Schedule form validates and submits only scoped Admin data",async()=>{
 const x=fixture();await x.load();
 const form=x.dom.$("slot-form");form.data={
  day_of_week:"2",start_local:"10:30",end_local:"11:45",label:"System Architecture"
 };
 form.listeners.submit({preventDefault(){},target:form});await flush();
 assert.ok(x.calls.some(c=>Array.isArray(c)&&c[0]==="createSlot"&&c[1].class_id==="room-1"
   &&c[1].label==="System Architecture"&&c[1].day_of_week===2));
 const before=x.calls.filter(c=>Array.isArray(c)&&c[0]==="createSlot").length;
 form.data.start_local="16:00";form.data.end_local="11:00";
 form.listeners.submit({preventDefault(){},target:form});await flush();
 assert.equal(x.calls.filter(c=>Array.isArray(c)&&c[0]==="createSlot").length,before);
 assert.match(x.dom.$("ops-message").textContent,/end time must be later/i);
});

test("Rescheduled exception requires both replacement times",async()=>{
 const x=fixture();await x.load();
 const form=x.dom.$("exception-form");
 form.data={exception_date:"2026-11-09",kind:"rescheduled",note:"Moved"};
 form.listeners.submit({preventDefault(){},target:form});await flush();
 assert.equal(x.calls.filter(c=>Array.isArray(c)&&c[0]==="createException").length,0);
 assert.match(x.dom.$("ops-message").textContent,/require replacement/i);
 form.data.replacement_start_local="13:00";form.data.replacement_end_local="15:00";
 form.listeners.submit({preventDefault(){},target:form});await flush();
 assert.ok(x.calls.some(c=>Array.isArray(c)&&c[0]==="createException"
   &&c[1].replacement_start_local==="13:00"&&c[1].class_id==="room-1"));
});

test("Schedule API uses session, audited RLS tables and verified deletions",()=>{
 assert.match(api,/auth\.getUser\(\)/);
 assert.match(api,/\.eq\("class_id",id\(classId\)\)\.select\("id"\)/);
 assert.match(api,/rows\.length!==1/);
 assert.match(api,/bn_review_registration/);
 assert.match(api,/bn_update_member/);
 assert.doesNotMatch(api,/service_role|localStorage|raw_user_meta_data/);
 assert.match(sql,/REVOKE TRUNCATE, TRIGGER, REFERENCES/);
 assert.match(sql,/bn_schedule_slot_audit/);
 assert.match(sql,/bn_schedule_exception_audit/);
 assert.match(sql,/INSERT INTO public\."AuditLog"/);
});
