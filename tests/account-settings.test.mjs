import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {Script} from "node:vm";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const read=p=>readFileSync(resolve(root,p),"utf8");
const controller=read("js/account-settings.js"),page=read("pages/account.html");
const sql=read("supabase/migrations/20261025231200_account_settings_private_avatars.sql");
const flush=async()=>{for(let i=0;i<8;i++)await new Promise(r=>setImmediate(r))};

function fixture({active=true,admin=false}={}){
 const dom=new Map(),calls=[],refs=[];
 let ready;
 const element=(tag="div")=>({
  tag,disabled:false,hidden:false,value:"",textContent:"",dataset:{},listeners:{},
  children:[],files:[],src:"",addEventListener(name,cb){this.listeners[name]=cb},
  setAttribute(k,v){this[k]=v},removeAttribute(k){delete this[k]},
  append(...n){this.children.push(...n)},replaceChildren(...n){this.children=[...n]},
  reset(){this.value="";this.files=[]}
 });
 const $=id=>{if(!dom.has(id))dom.set(id,element(id));return dom.get(id)};
 const document={getElementById:$,createElement:element,
   addEventListener(name,fn){if(name==="DOMContentLoaded")ready=fn}};
 const user={id:"author-uuid",email:"student@example.test"};
 const profile={id:user.id,full_name:"Taylor Student",account_type:admin?"Admin":"Student"};
 const memberships=active?[{class_id:"class-1",role:admin?"Admin":"Student",status:"ACTIVE"}]:[];
 const bucket={
   async download(path){calls.push(["download",path]);return {data:new Blob(["avatar"]),error:null}},
   async upload(path,file,opts){calls.push(["upload",path,opts]);return {data:{path},error:null}},
   async remove(paths){calls.push(["remove",paths]);return {error:null}}
 };
 const db={
  auth:{
   async getUser(){return {data:{user},error:null}},
   async signInWithPassword(args){calls.push(["verify-password",args]);return {error:null}},
   async updateUser(args){calls.push(["change-password",args]);return {data:{user},error:null}},
   async signOut(){calls.push(["signout"]);return {error:null}}
  },
  storage:{from(name){assert.equal(name,"bn-avatars");return bucket}},
  from(table){
   assert.ok(["User","ClassMembership"].includes(table));
   const params={};calls.push(["table",table,params]);
   const q={
    select(){return q},
    eq(k,v){params[k]=v;return q},
    update(data){calls.push(["update-profile",data]);if(data.full_name)profile.full_name=data.full_name;return q},
    single(){return Promise.resolve({data:{...profile},error:null})},
    then(ok,fail){return Promise.resolve({data:memberships,error:null}).then(ok,fail)}
   };return q;
  }
 };
 const redirects=[];
 const URL={
  createObjectURL(){refs.push("created");return "blob:test"},
  revokeObjectURL(x){refs.push(["revoked",x])}
 };
 const window={BNBackend:{configured:true,client:db},location:{replace(x){redirects.push(x)},reload(){}},addEventListener(){}};
 new Script(controller).runInNewContext({window,document,URL,Blob,Set,Error,console});
 return {$,calls,refs,redirects,ready:()=>ready(),profile};
}

test("homepage only shows Sign in and Create account, never direct class dashboard",()=>{
 const home=read("index.html");
 assert.doesNotMatch(home,/class="bn-btn[^"]*"[^>]*>Class dashboard<\/a>/i);
 assert.match(home,/href="pages\/login\.html"/);
 assert.match(home,/href="pages\/register\.html"/);
});
test("login keeps Phase 1 visual but forces fresh dashboard-targeting controller",()=>{
 const html=read("pages/login.html");
 const auth=read("js/auth-ui.js");
 assert.match(html,/auth-ui\.js\?v=20261026-postlogin/);
 const code=auth.slice(auth.indexOf("async function login()"),auth.indexOf("async function register()"));
 assert.match(code,/go\("dashboard\.html"\)/);
 assert.doesNotMatch(code,/go\("account\.html"\)/);
});
test("ACTIVE membership shows personal settings without enrollment directory",async()=>{
 const x=fixture();
 await x.ready();
 assert.equal(x.$("settings-workspace").hidden,false);
 assert.equal(x.$("account-onboarding").hidden,true);
 assert.equal(x.$("profile-display-name").textContent,"Taylor Student");
 assert.equal(x.$("account-email").textContent,"student@example.test");
 assert.match(x.$("account-type").textContent,/Student · 1 approved classroom/);
 assert.deepEqual(x.calls.find(c=>c[0]==="download").slice(0,2),["download","author-uuid/avatar"]);
});
test("without an ACTIVE membership, show enrollment or pending review instead",async()=>{
 const x=fixture({active:false,admin:true});
 await x.ready();
 assert.equal(x.$("settings-workspace").hidden,true);
 assert.equal(x.$("account-onboarding").hidden,false);
 assert.match(x.$("join-action").textContent,/Create your classroom/);
 assert.match(x.$("member-count").textContent,/No classroom membership/);
});
test("name editing uses only authenticated User full_name with own ID",async()=>{
 const x=fixture();
 await x.ready();
 x.$("profile-full-name").value="A Different Name";
 await x.$("profile-name-form").listeners.submit({preventDefault(){}});
 assert.equal(x.$("profile-display-name").textContent,"A Different Name");
 const op=x.calls.find(c=>c[0]==="update-profile");
 assert.deepEqual(Object.keys(op[1]),["full_name"]);
 const cols=x.calls.find(c=>c[0]==="table"&&c[1]==="User"&&c[2].id==="author-uuid");
 assert.ok(cols);
});
test("password update verifies current credentials before changing and clears fields",async()=>{
 const x=fixture();await x.ready();
 x.$("profile-current-password").value="current-good";
 x.$("profile-new-password").value="different-new-pass";
 x.$("profile-confirm-password").value="different-new-pass";
 await x.$("profile-password-form").listeners.submit({preventDefault(){}});
 assert.deepEqual(x.calls.filter(c=>c[0]==="verify-password").length,1);
 assert.equal(x.calls.filter(c=>c[0]==="change-password").length,1);
 assert.equal(x.$("profile-current-password").value,"");
 assert.equal(x.$("profile-new-password").value,"");
 assert.equal(x.redirects.length,0);
});
test("private image upload uses owner-only stable key, then supports removal",async()=>{
 const x=fixture();await x.ready();
 const file={type:"image/png",size:12,name:"avatar.png"};
 x.$("profile-photo-file").files=[file];
 await x.$("profile-photo-form").listeners.submit({preventDefault(){}});
 const request=x.calls.find(c=>c[0]==="upload");
 assert.equal(request[1],"author-uuid/avatar");
 assert.equal(request[2].upsert,true);
 assert.equal(request[2].contentType,"image/png");
 await x.$("profile-photo-remove").listeners.click();
 assert.equal(x.calls.find(c=>c[0]==="remove")[1][0],"author-uuid/avatar");
});
test("reject oversized or unsupported photos and preserve private bucket rules",async()=>{
 const x=fixture();await x.ready();
 x.$("profile-photo-file").files=[{type:"image/svg+xml",size:120,name:"malware.svg"}];
 await x.$("profile-photo-form").listeners.submit({preventDefault(){}});
 assert.equal(x.calls.filter(c=>c[0]==="upload").length,0);
 assert.match(sql,/false,2097152/);
 assert.match(sql,/bn-avatars/);
 assert.match(sql,/auth\.uid\(\)/);
 assert.match(sql,/UPDATE\(full_name\)/);
 assert.doesNotMatch(sql,/GRANT UPDATE\(account_type\)|GRANT UPDATE ON public\."User"/);
});
