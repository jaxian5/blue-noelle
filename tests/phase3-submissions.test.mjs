import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {Script} from "node:vm";
import {fileURLToPath} from "node:url";
import {dirname,resolve} from "node:path";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const read=p=>readFileSync(resolve(root,p),"utf8");
const page=read("pages/submission.html");
const js=read("js/phase3-submissions.js");
test("Phase 3 has a real authenticated upload and version page, no demo shortcuts",()=>{
 assert.match(page,/id="sub-upload-form"/);
 assert.match(page,/id="sub-final-submit"/);
 assert.match(page,/id="sub-history"/);
 assert.match(page,/id="group-management"/);
 assert.match(page,/phase3-submissions\.js/);
 assert.match(read("js/phase2-classwork.js"),/submission\.html\?assignment=/);
 assert.match(read("js/phase2-admin.js"),/submission\.html\?assignment=/);
 assert.doesNotMatch(page,/phase2-assignments\.js|phase1-auth\.js|core\.js/);
 assert.doesNotMatch(js,/\blocalStorage\s*\.|\bservice_role\b|storage\.from\(BUCKET\)\.getPublicUrl/);
 assert.match(js,/bn_p3_prepare/);
 assert.match(js,/bn_p3_finish_file/);
 assert.match(js,/bn_p3_submit/);
 assert.match(js,/bn_p3_cancel_file/);
 assert.match(js,/bn_p3_details/);
 assert.match(js,/bn_p3_groups/);
 assert.match(js,/\.storage\.from\(BUCKET\)\.upload\(/);
 assert.match(js,/\.storage\.from\(BUCKET\)\.download\(/);
 assert.match(js,/upsert:false/);
 assert.doesNotThrow(()=>new Script(js));
});
function fixture({session=true,role="Student",group=false,assignmentStatus="OPEN"}={}){
 let ready,redirect;
 const map=new Map();
 const elem=(tag="div")=>({
  tag,textContent:"",value:"",disabled:false,hidden:false,dataset:{},style:{},files:[],children:[],listeners:{},
  append(...nodes){this.children.push(...nodes)},
  appendChild(n){this.children.push(n)},
  replaceChildren(...nodes){this.children=[...nodes]},
  addEventListener(event,listener){this.listeners[event]=listener},
  setAttribute(name,value){this[name]=value},
  focus(){},remove(){},reset(){this.files=[];this.value=""},
  click(){},scrollIntoView(){}
 });
 const $=id=>{
  if(!map.has(id)){
   const el=elem("id:"+id);
   el.hidden=["sub-assignment","student-area","staff-area","group-management","sub-draft-panel","sub-progress","group-notice"].includes(id);
   map.set(id,el);
  }
  return map.get(id);
 };
 const document={
  getElementById:$,createElement:tag=>elem(tag),
  addEventListener(name,cb){if(name==="DOMContentLoaded")ready=cb;},
  body:{append(){}}
 };
 const rows={
  Assignment:{id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",subject_id:"subj",
    name:"Classwork",description:"Secure uploads",status:assignmentStatus,
    is_group:group,deadline:null,required_file_types:[],max_file_size_bytes:41943040},
  Subject:{id:"subj",class_id:"class1",name:"Data Structures"},
  Class:{id:"class1",name:"BSIT 1",section:"A"},
  ClassMembership:[{role,status:"ACTIVE"}]
 };
 const calls=[],files=[];
 let details=[];
 const db={
  auth:{getUser:async()=>({data:{user:session?{id:"member1"}:null},error:null})},
  from(table){
   const q={
    select(){return q},eq(){return q},
    maybeSingle:async()=>({data:rows[table],error:null}),
    single:async()=>({data:rows[table],error:null}),
    then(resolve,reject){return Promise.resolve({data:rows[table],error:null}).then(resolve,reject)}
   };return q;
  },
  async rpc(name,args){
   calls.push({name,args});
   if(name==="bn_p3_details")return {data:details,error:null};
   if(name==="bn_p3_my_group")return {data:group?{id:"group1",name:"Group One"}:null,error:null};
   if(name==="bn_p3_groups")return {data:[],error:null};
   if(name==="bn_p3_prepare")return {data:{
     bucket:"bn-submissions",storage_key:"private/uuid-key",version_id:"version1",
     file_id:"file1",submission_id:"submission1"
   },error:null};
   if(name==="bn_p3_finish_file"){
     files.push({name:"document.pdf",state:"READY",key:"private/uuid-key"});
     details=[{student_id:"member1",status:"DRAFT",id:"submission1",
       versions:[{id:"version1",number:1,state:"UPLOADING",files}]}];
     return {data:{ready:true},error:null};
   }
   if(name==="bn_p3_submit"){
     details=[{student_id:"member1",id:"submission1",status:"SUBMITTED",versions:[{
       id:"version1",number:1,state:"READY",files
     }]}];
     return {data:{version:1,late:false},error:null};
   }
   return {data:{cancelled:true},error:null};
  },
  storage:{from(bucket){
    assert.equal(bucket,"bn-submissions");
    return {
     upload:async(key,file,options)=>{
       calls.push({upload:key,file,options});
       return {data:{path:key},error:null};
     },
     download:async()=>({data:new Blob(["x"]),error:null}),
     remove:async()=>({data:[],error:null})
    };
  }}
 };
 const context={
  window:{BNBackend:{configured:true,client:db},location:{
    search:"?assignment=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    replace:p=>redirect=p
  }},
  document,Date,Intl,URLSearchParams,URL,Number,Math,Array,Error,Set,
  setTimeout:()=>0
 };
 new Script(js).runInNewContext(context);
 return {ready:()=>ready(),$,
  get redirect(){return redirect},
  calls,get details(){return details},set details(v){details=v}};
}
const flush=async()=>{for(let i=0;i<7;i++)await new Promise(r=>setImmediate(r))};
test("signed-out users cannot load submission data",async()=>{
 const x=fixture({session:false});
 await x.ready();
 assert.equal(x.redirect,"login.html");
 assert.equal(x.calls.length,0);
});
test("Student sees live assignment and can upload a private version then submit it",async()=>{
 const x=fixture();
 await x.ready();
 assert.match(x.$("sub-status").textContent,/Private submission workspace/);
 assert.equal(x.$("student-area").hidden,false);
 assert.equal(x.$("staff-area").hidden,true);
 x.$("sub-files").files=[{name:"document.pdf",type:"application/pdf",size:1024}];
 x.$("sub-upload-form").listeners.submit({preventDefault(){}});
 await flush();
 const prep=x.calls.find(c=>c.name==="bn_p3_prepare");
 const upload=x.calls.find(c=>c.upload);
 const finish=x.calls.find(c=>c.name==="bn_p3_finish_file");
 assert.equal(prep.args.p_bytes,1024);
 assert.equal(upload.options.upsert,false);
 assert.equal(upload.options.contentType,"application/pdf");
 assert.ok(finish);
 assert.equal(x.$("sub-draft-panel").hidden,false);
 x.$("sub-final-submit").dataset.submission="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
 x.$("sub-final-submit").dataset.version="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
 x.$("sub-final-submit").listeners.click();
 await flush();
 assert.ok(x.calls.find(c=>c.name==="bn_p3_submit"));
 assert.match(x.$("sub-status").textContent,/submitted successfully/);
});
test("Closed assignment disables Student uploads",async()=>{
 const x=fixture({assignmentStatus:"CLOSED"});
 await x.ready();
 assert.equal(x.$("sub-files").disabled,true);
 assert.equal(x.$("sub-upload").disabled,true);
});
test("Staff role can view versions but not Student upload widget",async()=>{
 const x=fixture({role:"Moderator",group:true});
 await x.ready();
 assert.equal(x.$("student-area").hidden,true);
 assert.equal(x.$("staff-area").hidden,false);
 assert.equal(x.$("group-management").hidden,true);
 assert.ok(x.calls.find(c=>c.name==="bn_p3_details"));
});
test("Admin role loads audited group management list and Student roster",async()=>{
 const x=fixture({role:"Admin",group:true});
 await x.ready();
 assert.equal(x.$("group-management").hidden,false);
 assert.ok(x.calls.find(c=>c.name==="bn_p3_groups"&&c.args.p_action==="roster"));
});

test("Two submitted versions retain their independent historical timestamps",async()=>{
  const x=fixture();
  await x.ready();
  x.details=[{
    id:"submission1",student_id:"member1",status:"SUBMITTED",
    submitted_at:"2026-11-02T10:00:00Z",
    versions:[
      {id:"v2",number:2,state:"READY",created_at:"2026-11-02T09:00:00Z",
        submitted_at:"2026-11-02T10:00:00Z",deadline_at_submission:"2026-11-02T11:00:00Z",files:[]},
      {id:"v1",number:1,state:"READY",created_at:"2026-10-29T09:00:00Z",
        submitted_at:"2026-10-29T10:00:00Z",deadline_at_submission:"2026-10-29T09:00:00Z",files:[]}
    ]
  }];
  x.$("sub-refresh").listeners.click();
  await flush();
  const versions=x.$("sub-history").children.filter(n=>n.className==="bn-sub-version");
  assert.equal(versions.length,2);
  assert.match(versions[0].children.map(n=>n.textContent).join(" "),/Submitted Nov 2, 2026/);
  assert.match(versions[1].children.map(n=>n.textContent).join(" "),/Submitted Oct 29, 2026/);
  assert.ok(versions[1].children.some(n=>/LATE/.test(n.textContent)));
  assert.ok(!versions[0].children.some(n=>/LATE/.test(n.textContent)));
});
