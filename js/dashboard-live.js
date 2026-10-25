/* Blue Noelle authenticated workspace: Student study view / Admin operations view.
 * Identity comes from Supabase Auth; class-scoped ACTIVE membership and RLS/RPC
 * determine what can be displayed or performed. Never infer authority from a URL,
 * editable profile metadata, or a client-side role toggle.
 */
(function(w){
 "use strict";
 const $=id=>document.getElementById(id);
 const db=()=>w.BNBackend?.client;
 const PH="Asia/Manila";
 let memberships=[],rooms=[],generation=0;
 function say(message,state="info"){
   $("dash-alert").textContent=message;
   $("dash-alert").dataset.state=state;
 }
 function el(tag,value,cls){
   const n=document.createElement(tag);
   if(value!=null)n.textContent=String(value);
   if(cls)n.className=cls;
   return n;
 }
 function text(id,value){$(id).textContent=String(value)}
 function niceDate(when,opts={dateStyle:"medium",timeStyle:"short"}){
   const d=new Date(when);
   if(!Number.isFinite(d.getTime()))return "Unknown date";
   return new Intl.DateTimeFormat("en-PH",{timeZone:PH,...opts}).format(d);
 }
 async function query(req){
   const {data,error}=await req;
   if(error)throw error;
   return data||[];
 }
 function deadline(when){
   if(!when)return {label:"No deadline",urgency:"none"};
   const d=new Date(when),millis=d.getTime();
   if(!Number.isFinite(millis))return {label:"Deadline unavailable",urgency:"none"};
   const delta=millis-Date.now();
   return {label:(delta<0?"Overdue · ":"")+niceDate(when),
     urgency:delta<0?"overdue":delta<=2*86400000?"soon":"later"};
 }
 function orderDeadlines(a,b){
   if(!a.deadline)return 1;
   if(!b.deadline)return -1;
   return new Date(a.deadline)-new Date(b.deadline);
 }
 function renderSubjects(subjects,assignments){
   const root=$("dash-subjects");root.replaceChildren();
   if(!subjects.length){
     root.append(el("p","No subjects yet. Your Admin will publish classwork here.","bn-empty"));
     return;
   }
   for(const subject of subjects.slice(0,7)){
     const row=el("div",null,"bn-subject-item");
     row.append(el("span","◇","bn-subject-glyph"));
     const info=el("div",null,"bn-subject-info");
     info.append(el("strong",subject.name));
     const count=assignments.filter(a=>a.subject_id===subject.id).length;
     info.append(el("span",count+" assignment"+(count===1?"":"s")));
     row.append(info);root.append(row);
   }
 }
 function stateOf(details){
   if(!Array.isArray(details)||!details.length)return "not started";
   const sub=details[0];
   if(sub.status==="SUBMITTED")return "submitted";
   if(sub.status==="DRAFT")return "draft";
   return "not started";
 }
 function renderTasks(tasks,subjectById,states){
   const root=$("dash-upcoming");root.replaceChildren();
   if(!tasks.length){
     root.append(el("p","Your classroom has no open assignments right now. Enjoy the clear desk.","bn-empty"));
     return;
   }
   for(const task of tasks){
     const row=el("article",null,"bn-task");
     row.append(el("span","▤","bn-task-symbol"));
     const info=el("div",null,"bn-task-content");
     const link=el("a",task.name,"bn-task-title");
     link.href="submission.html?assignment="+encodeURIComponent(task.id);
     info.append(link);
     const subject=subjectById.get(task.subject_id);
     info.append(el("div",(subject?.name||"Subject")+" · "+(task.is_group?"Group":"Individual"),"bn-task-meta"));
     const submissionState=states.get(task.id)||"unavailable";
     const status=el("span",submissionState==="unavailable"?"Submission status unavailable":submissionState,"bn-task-status");
     status.dataset.state=submissionState;
     info.append(status);
     const due=deadline(task.deadline);
     const pill=el("span",due.label,"bn-task-deadline");
     pill.dataset.urgency=due.urgency;
     row.append(info,pill);
     root.append(row);
   }
 }
 function renderAdminAssignments(items,subjectById){
   const root=$("dash-admin-assignments");root.replaceChildren();
   if(!items.length){
     root.append(el("p","No assignments created yet. Start with a subject, then publish your first task.","bn-empty"));
     return;
   }
   for(const item of items.slice(0,7)){
     const row=el("article",null,"bn-task");
     row.append(el("span","✎","bn-task-symbol"));
     const info=el("div",null,"bn-task-content");
     info.append(el("strong",item.name,"bn-task-title"));
     const subject=subjectById.get(item.subject_id);
     info.append(el("div",(subject?.name||"Subject")+" · "+(item.is_group?"Group":"Individual")+" · "+item.status,"bn-task-meta"));
     const actions=el("div",null,"bn-task-actions");
     const edit=el("a","Edit","bn-text-link");edit.href="admin-classwork.html#assignment-title";
     const review=el("a","Review submissions ↗","bn-text-link");review.href="submission.html?assignment="+encodeURIComponent(item.id);
     actions.append(edit,review);
     info.append(actions);
     const pill=el("span",deadline(item.deadline).label,"bn-task-deadline");
     row.append(info,pill);root.append(row);
   }
 }
 function renderRoster(rows){
   const box=$("dash-admin-members");box.replaceChildren();
   const students=rows.filter(r=>r.role==="Student"&&r.status==="ACTIVE");
   text("dash-admin-students",students.length);
   const pending=rows.filter(r=>r.status==="PENDING");
   text("dash-pending-count",pending.length?pending.length+" awaiting review":"No pending requests");
   if(!students.length){
     box.append(el("p","No active Students in this classroom yet.","bn-empty"));
     return;
   }
   for(const person of students.slice(0,4)){
     const row=el("div",null,"bn-subject-item");
     const initials=(person.full_name||"Student").split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join("").toUpperCase();
     row.append(el("span",initials,"bn-roster-avatar"));
     const info=el("div",null,"bn-subject-info");
     info.append(el("strong",person.full_name||"Student"));
     info.append(el("span","ACTIVE STUDENT"));
     row.append(info);box.append(row);
   }
 }
 function resetPanel(){
   for(const id of ["dash-count-subjects","dash-count-open","dash-count-soon"])text(id,0);
   for(const id of ["dash-upcoming","dash-subjects","dash-admin-assignments","dash-admin-members"])$(id).replaceChildren();
   text("dash-admin-students","—");text("dash-pending-count","Checking requests…");
 }
 function setSpotlight({label,title,body,href,action}){
   text("dash-highlight-label",label);
   text("dash-highlight-title",title);
   text("dash-highlight-body",body);
   const link=$("dash-highlight-link");
   link.href=href;
   link.textContent=action+" ↗";
 }
 async function getMyStatuses(tasks){
   // At most six guarded requests. Failure must never appear as "not submitted."
   const out=new Map();
   const results=await Promise.allSettled(tasks.map(task=>db().rpc("bn_p3_details",{p_assignment:task.id})));
   results.forEach((result,i)=>{
     if(result.status!=="fulfilled"||result.value.error){
       out.set(tasks[i].id,"unavailable");
       return;
     }
     out.set(tasks[i].id,stateOf(result.value.data));
   });
   return out;
 }
 async function loadClass(id){
   const token=++generation;
   resetPanel();
   const active=memberships.find(m=>m.class_id===id&&m.status==="ACTIVE");
   const room=rooms.find(r=>r.id===id);
   if(!active||!room){
     say("This classroom is not among your approved memberships.","error");
     $("dash-student-panel").hidden=true;$("dash-admin-panel").hidden=true;return;
   }
   const admin=active.role==="Admin";
   const staff=admin||active.role==="Moderator";
   if(document.body)document.body.dataset.workspace=admin?"admin":"student";
   text("dash-role",active.role);
   text("dash-user-role",active.role+" · ACTIVE");
   text("dash-eyebrow",admin?"ADMIN COMMAND CENTER":"YOUR STUDENT WORKSPACE");
   $("dash-admin-link").hidden=!admin;
   $("dash-staff-link").hidden=!staff;
   $("dash-operations-link").hidden=!staff;
   $("dash-student-panel").hidden=admin;
   $("dash-admin-panel").hidden=!admin;
   const className=room.name+(room.section?" · "+room.section:"");
   text("dash-subtitle",admin?"Manage "+className+" with clarity and confidence.":className+" · Keep your coursework within reach.");
   const primary=$("dash-primary-link");
   primary.href=admin?"admin-classwork.html":"classwork.html";
   primary.textContent=admin?"Manage classwork ↗":"Browse classwork ↗";
   const hero=$("dash-hero-link");
   hero.href=primary.href;
   hero.textContent=admin?"Manage your classroom ↗":"Explore classwork ↗";
   setSpotlight(admin?{
     label:"ADMIN PRIORITIES",title:"Make the next class easier.",
     body:"Create assignments, review submissions and handle membership requests from one workspace.",
     href:"admin-classwork.html",action:"Manage classwork"
   }:{
     label:"YOUR NEXT STEP",title:"A clearer way to keep up.",
     body:"Open an assignment to upload, submit, and keep track of every version of your work.",
     href:"classwork.html",action:"Open assignments"
   });
   say("Loading "+(admin?"class management":"assignments and submission status")+"…");
   try{
     const subjects=await query(db().from("Subject")
       .select("id,class_id,name").eq("class_id",id).is("deleted_at",null).order("name"));
     if(token!==generation)return;
     const ids=subjects.map(s=>s.id);
     const assignments=ids.length?await query(db().from("Assignment")
       .select("id,subject_id,name,description,deadline,is_group,status,created_at")
       .in("subject_id",ids).is("deleted_at",null)): [];
     if(token!==generation)return;
     const open=assignments.filter(a=>a.status==="OPEN");
     const now=Date.now();
     const dueSoon=open.filter(a=>a.deadline&&new Date(a.deadline).getTime()>=now&&new Date(a.deadline).getTime()<=now+7*86400000);
     text("dash-count-subjects",subjects.length);
     text("dash-count-open",open.length);
     text("dash-count-soon",dueSoon.length);
     const byId=new Map(subjects.map(s=>[s.id,s]));
     if(admin){
       const recent=[...assignments].sort((a,b)=>String(b.created_at||"").localeCompare(String(a.created_at||"")));
       renderAdminAssignments(recent,byId);
       try{
         const directory=await query(db().rpc("bn_class_directory",{p_class:id}));
         if(token!==generation)return;
         if(Array.isArray(directory))renderRoster(directory);
         else throw Error("Unexpected directory response");
       }catch(_){
         if(token!==generation)return;
         text("dash-admin-students","—");
         text("dash-pending-count","Member summary unavailable");
         $("dash-admin-members").append(el("p","Unable to load the roster. Open Member requests to try again.","bn-empty"));
       }
     }else{
       renderSubjects(subjects,assignments);
       const tasks=[...open].sort(orderDeadlines).slice(0,6);
       // Render immediately, then enrich with submission states when RPCs resolve.
       renderTasks(tasks,byId,new Map());
       const states=await getMyStatuses(tasks);
       if(token!==generation)return;
       renderTasks(tasks,byId,states);
     }
     if(token!==generation)return;
     say("Viewing live, class-scoped data · Updated "+niceDate(new Date()),"success");
   }catch(e){
     if(token===generation)say("Could not load classroom data: "+(e?.message||"Unknown error"),"error");
   }
 }
 async function init(){
   text("dash-current-date",niceDate(new Date(),{weekday:"long",month:"short",day:"numeric"}));
   $("dash-menu").addEventListener("click",()=>{
     const aside=$("dash-sidebar"),open=aside.dataset.open==="true";
     aside.dataset.open=String(!open);
     $("dash-menu").setAttribute("aria-expanded",String(!open));
   });
   $("dash-signout").addEventListener("click",async()=>{
     $("dash-signout").disabled=true;
     try{
       const {error}=await db().auth.signOut();
       if(error)throw error;
       w.location.replace("login.html");
     }catch(e){
       say("Unable to sign out: "+(e?.message||"Try again."),"error");
       $("dash-signout").disabled=false;
     }
   });
   if(!w.BNBackend?.configured||!db()){
     say("Supabase is unavailable. Check your network connection.","error");return;
   }
   try{
     const {data:auth,error}=await db().auth.getUser();
     if(error||!auth?.user){w.location.replace("login.html");return}
     const user=auth.user;
     const profiles=await query(db().from("User").select("full_name,account_type").eq("id",user.id));
     const name=(profiles[0]?.full_name||"").trim();
     const first=name.split(/\s+/)[0]||"there";
     text("dash-greeting","Welcome back, "+first+".");
     text("dash-user-name",name||"Your account");
     text("dash-avatar",(name.split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join("")||"BN").toUpperCase());
     memberships=await query(db().from("ClassMembership").select("class_id,role,status").eq("status","ACTIVE"));
     memberships=memberships.filter(m=>m.status==="ACTIVE");
     text("dash-count-classes",new Set(memberships.map(m=>m.class_id)).size);
     if(!memberships.length){
       if(document.body)document.body.dataset.workspace="unassigned";
       $("dash-class").replaceChildren(el("option","No approved classrooms"));
       $("dash-class").disabled=true;
       $("dash-student-panel").hidden=true;$("dash-admin-panel").hidden=true;
       text("dash-role","Not enrolled");
       text("dash-subtitle","Your account is ready. Classroom access begins after approval.");
       setSpotlight({
         label:"LET'S GET YOU SET UP",
         title:"Your classroom is one step away.",
         body:"Admin accounts can create their owned class; Students join with a private invite and await approval.",
         href:"register.html",action:"Continue enrollment"
       });
       $("dash-primary-link").href="register.html";
       $("dash-primary-link").textContent="Continue enrollment ↗";
       $("dash-hero-link").href="register.html";
       $("dash-hero-link").textContent="Continue enrollment ↗";
       say("No ACTIVE classroom yet. Complete membership setup or await your class officer's approval.");
       return;
     }
     const ids=[...new Set(memberships.map(m=>m.class_id))];
     rooms=await query(db().from("Class").select("id,name,section").in("id",ids));
     rooms=rooms.filter(r=>ids.includes(r.id));
     if(!rooms.length){say("Approved classroom records could not be found.","error");return}
     const picker=$("dash-class");picker.replaceChildren();
     for(const room of rooms){
       const opt=el("option",room.name+(room.section?" · "+room.section:""));
       opt.value=room.id;picker.append(opt);
     }
     picker.disabled=false;picker.value=rooms[0].id;
     picker.addEventListener("change",()=>loadClass(picker.value));
     await loadClass(picker.value);
   }catch(e){
     say("Your workspace could not be opened: "+(e?.message||"Unknown error"),"error");
   }
 }
 document.addEventListener("DOMContentLoaded",init);
})(window);
