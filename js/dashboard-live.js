/* Live Blue Noelle dashboard. Supabase Auth + RLS are authoritative.
 * No demo logins, localStorage classwork, or unverified profile claims.
 */
(function(w){
 "use strict";
 const $=id=>document.getElementById(id);
 const db=()=>w.BNBackend?.client;
 let memberships=[],rooms=[],generation=0;
 function say(message,state="info"){$("dash-alert").textContent=message;$("dash-alert").dataset.state=state}
 function el(tag,value,cls){
   const n=document.createElement(tag);
   if(value!=null)n.textContent=String(value);
   if(cls)n.className=cls;
   return n;
 }
 function niceDate(when,opts={dateStyle:"medium",timeStyle:"short"}){
   const d=new Date(when);
   if(!Number.isFinite(d.getTime()))return "Unknown date";
   return new Intl.DateTimeFormat("en-PH",{timeZone:"Asia/Manila",...opts}).format(d);
 }
 async function query(req){const {data,error}=await req;if(error)throw error;return data||[]}
 function deadline(when){
   if(!when)return {label:"No deadline",urgency:"none"};
   const d=new Date(when);
   if(!Number.isFinite(d.getTime()))return {label:"Deadline unavailable",urgency:"none"};
   const delta=d.getTime()-Date.now();
   return {
     label: delta<0 ? "Overdue · "+niceDate(when) : niceDate(when),
     urgency: delta<0?"overdue":delta<=2*86400000?"soon":"later"
   };
 }
 function renderTasks(tasks,subjectById){
   const root=$("dash-upcoming");root.replaceChildren();
   if(!tasks.length){root.append(el("p","No open assignments in this classroom yet.","bn-empty"));return}
   const sorted=[...tasks].sort((a,b)=>{
     if(!a.deadline)return 1;
     if(!b.deadline)return -1;
     return new Date(a.deadline)-new Date(b.deadline);
   }).slice(0,6);
   for(const task of sorted){
     const row=el("article",null,"bn-task");
     row.append(el("span","▤","bn-task-symbol"));
     const info=el("div",null,"bn-task-content");
     info.append(el("div",task.name,"bn-task-title"));
     const subject=subjectById.get(task.subject_id);
     info.append(el("div",(subject?.name||"Subject")+" · "+(task.is_group?"Group":"Individual"),"bn-task-meta"));
     const due=deadline(task.deadline);
     const pill=el("span",due.label,"bn-task-deadline");pill.dataset.urgency=due.urgency;
     row.append(info,pill);root.append(row);
   }
 }
 function renderSubjects(subjects,assignments){
   const root=$("dash-subjects");root.replaceChildren();
   if(!subjects.length){root.append(el("p","No subjects created for this classroom yet.","bn-empty"));return}
   for(const subject of subjects.slice(0,7)){
     const row=el("div",null,"bn-subject-item");
     row.append(el("span","◈","bn-subject-glyph"));
     const info=el("div",null,"bn-subject-info");
     info.append(el("strong",subject.name));
     const count=assignments.filter(a=>a.subject_id===subject.id).length;
     info.append(el("span",count+" assignment"+(count===1?"":"s")));
     row.append(info);root.append(row);
   }
 }
 function resetPanel(){
   for(const id of ["dash-count-subjects","dash-count-open","dash-count-soon"])$(id).textContent="0";
   $("dash-upcoming").replaceChildren();
   $("dash-subjects").replaceChildren();
 }
 async function loadClass(id){
   const token=++generation;
   resetPanel();
   const active=memberships.find(m=>m.class_id===id&&m.status==="ACTIVE");
   if(!active||!rooms.some(r=>r.id===id)){
     say("This classroom is not among your approved memberships.","error");return;
   }
   $("dash-role").textContent=active.role;
   $("dash-admin-link").hidden=active.role!=="Admin";
   say("Loading subjects and deadlines…");
   try{
     const subjects=await query(db().from("Subject")
       .select("id,class_id,name").eq("class_id",id).is("deleted_at",null).order("name"));
     if(token!==generation)return;
     const ids=subjects.map(s=>s.id);
     const assignments=ids.length? await query(db().from("Assignment")
       .select("id,subject_id,name,description,deadline,is_group,status")
       .in("subject_id",ids).is("deleted_at",null)): [];
     if(token!==generation)return;
     const open=assignments.filter(a=>a.status==="OPEN");
     const now=Date.now();
     const dueSoon=open.filter(a=>a.deadline&&new Date(a.deadline).getTime()>=now&&new Date(a.deadline).getTime()<=now+7*86400000);
     $("dash-count-subjects").textContent=String(subjects.length);
     $("dash-count-open").textContent=String(open.length);
     $("dash-count-soon").textContent=String(dueSoon.length);
     const room=rooms.find(r=>r.id===id);
     $("dash-subtitle").textContent=(room?.name||"Your classroom")+
       (room?.section?" · "+room.section:"")+" · "+active.role+" access";
     const byId=new Map(subjects.map(s=>[s.id,s]));
     renderTasks(open,byId);
     renderSubjects(subjects,assignments);
     say("You're viewing live, class-scoped data. Last refreshed "+niceDate(new Date()),"success");
   }catch(e){if(token===generation)say("Could not load classwork: "+(e?.message||"Unknown error"),"error")}
 }
 async function init(){
   $("dash-current-date").textContent=niceDate(new Date(),{weekday:"long",month:"short",day:"numeric"});
   if(!w.BNBackend?.configured||!db()){say("Supabase isn't available. Check the connection.","error");return}
   try{
     const {data:auth,error:authError}=await db().auth.getUser();
     if(authError||!auth?.user){w.location.replace("login.html");return}
     const user=auth.user;
     const profiles=await query(db().from("User").select("full_name,account_type").eq("id",user.id));
     const name=(profiles[0]?.full_name||"").trim();
     const first=name.split(/\s+/)[0]||"there";
     $("dash-greeting").textContent="Welcome back, "+first+".";
     $("dash-avatar").textContent=(name.split(/\s+/).filter(Boolean).slice(0,2).map(p=>p[0]).join("")||"BN").toUpperCase();
     memberships=await query(db().from("ClassMembership")
       .select("class_id,role,status").eq("status","ACTIVE"));
     memberships=memberships.filter(m=>m.status==="ACTIVE");
     $("dash-count-classes").textContent=String(new Set(memberships.map(m=>m.class_id)).size);
     if(!memberships.length){
       $("dash-subtitle").textContent="Your classroom journey begins once your membership is approved.";
       say("No ACTIVE classroom membership. Visit My Account to finish enrollment.","info");
       $("dash-class").replaceChildren();
       resetPanel();return;
     }
     rooms=await query(db().from("Class")
       .select("id,name,section").in("id",[...new Set(memberships.map(m=>m.class_id))]));
     rooms=rooms.filter(r=>memberships.some(m=>m.class_id===r.id));
     if(!rooms.length){say("No accessible classrooms were found.","error");return}
     const select=$("dash-class");select.replaceChildren();
     for(const room of rooms){
       const option=el("option",room.name+(room.section?" · "+room.section:""));
       option.value=room.id;select.append(option);
     }
     select.disabled=false;select.value=rooms[0].id;
     select.addEventListener("change",()=>loadClass(select.value));
     await loadClass(select.value);
   }catch(e){say("Dashboard unavailable: "+(e?.message||"Unknown error"),"error")}
 }
 document.addEventListener("DOMContentLoaded",init);
})(window);
