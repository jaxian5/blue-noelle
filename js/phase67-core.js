/* Phase 6/7 shared authenticated classroom selection, no public data shortcuts. */
(function(w){
 "use strict";
 const dom=id=>document.getElementById(id);
 const backend=()=>w.BNBackend?.client;
 const el=(tag,value,cls)=>{
   const node=document.createElement(tag);
   if(value!==undefined&&value!==null)node.textContent=String(value);
   if(cls)node.className=cls;
   return node;
 };
 const status=(message,state="info")=>{
   const node=dom("p67-status");node.textContent=message;node.dataset.state=state;
 };
 const read=async promise=>{
   const {data,error}=await promise;if(error)throw Error(error.message||"Request failed");
   return data;
 };
 const rpc=(name,args)=>read(backend().rpc(name,args));
 const fmt=value=>value?new Intl.DateTimeFormat("en-PH",{
   timeZone:"Asia/Manila",dateStyle:"medium",timeStyle:"short"}).format(new Date(value)):"—";
 const params=new URLSearchParams(w.location.search);
 async function init(picker){
   if(!w.BNBackend?.configured||!backend())throw Error("Supabase is unavailable.");
   const {data,error}=await backend().auth.getUser();
   if(error||!data?.user){w.location.replace("login.html");throw Error("Sign in required");}
   const memberships=await read(backend().from("ClassMembership")
     .select("class_id,role,status").eq("status","ACTIVE"));
   const active=(memberships||[]).filter(m=>m.status==="ACTIVE");
   if(!active.length)throw Error("Join an approved classroom to use this workspace.");
   const classIds=[...new Set(active.map(m=>m.class_id))];
   const classes=await read(backend().from("Class")
     .select("id,name,section").in("id",classIds));
   const select=dom(picker);select.replaceChildren();
   for(const classroom of classes||[]){
     const option=el("option",classroom.name+(classroom.section?" · "+classroom.section:""));
     option.value=classroom.id;select.append(option);
   }
   if(!classes?.length)throw Error("No approved classroom is available.");
   select.disabled=false;
   const preferred=params.get("class");
   select.value=classes.some(x=>x.id===preferred)?preferred:classes[0].id;
   const role=id=>active.find(m=>m.class_id===id)?.role||"";
   const setTheme=id=>{const currentRole=role(id);if(currentRole)w.BNTheme?.setRole(currentRole)};
   setTheme(select.value);
   return {uid:data.user.id,role,setTheme,classes,active};
 }
 function periodic(fn,ms=20000){
   const timer=w.setInterval(()=>{if(!document.hidden)void fn()},ms);
   w.addEventListener("beforeunload",()=>w.clearInterval(timer),{once:true});
   document.addEventListener("visibilitychange",()=>{if(!document.hidden)void fn()});
 }
 w.BNComm={dom,backend,el,status,read,rpc,fmt,init,periodic};
})(window);
