/* Blue Noelle Phase 2 production Admin workspace.
 * Database RPC checks ACTIVE Admin class membership and logs each mutation.
 * Browser-side checks are UX only, not the authorization boundary.
 */
(function(w){
 "use strict";
 const $=id=>document.getElementById(id);
 const db=()=>w.BNBackend?.client;
 let classId=null, classes=[],subjects=[],assignments=[],busy=false;
 const node=(tag,text,className)=>{
   const el=document.createElement(tag);
   if(text!==undefined&&text!==null)el.textContent=String(text);
   if(className)el.className=className;
   return el;
 };
 const emit=(message,state="info")=>{
   $("admin-status").textContent=message;$("admin-status").dataset.state=state;
 };
 function dateLocal(iso){
   if(!iso)return "";
   const d=new Date(iso);
   return Number.isFinite(d.getTime())
     ? new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16)
     : "";
 }
 function deadlineLabel(iso){
   if(!iso)return "No deadline";
   const d=new Date(iso);
   if(!Number.isFinite(d.getTime()))return "Deadline unavailable";
   return "Due "+new Intl.DateTimeFormat("en-PH",{timeZone:"Asia/Manila",dateStyle:"medium",timeStyle:"short"}).format(d);
 }
 async function fetchData(query){
   const {data,error}=await query;
   if(error)throw error;
   return data||[];
 }
 async function action(name,payload){
   if(!classId)throw Error("Choose a classroom.");
   const {data,error}=await db().rpc("bn_manage_classwork",{
     p_class:classId,p_action:name,p_data:payload
   });
   if(error)throw error;
   return data;
 }
 async function guard(job){
   if(busy)return;
   busy=true;
   try{await job()}catch(e){emit(e?.message||"Unable to save classwork.","error");}
   finally{busy=false;}
 }
 async function refresh(){
   subjects=await fetchData(db().from("Subject")
     .select("id,class_id,name,created_by,created_at").eq("class_id",classId)
     .is("deleted_at",null).order("name"));
   const ids=subjects.map(s=>s.id);
   assignments=ids.length ? await fetchData(db().from("Assignment")
     .select("id,subject_id,name,description,instructions,deadline,is_group,required_file_types,max_file_size_bytes,status,created_at")
     .in("subject_id",ids).is("deleted_at",null).order("created_at",{ascending:false})) : [];
   renderSubjects();renderAssignments();fillSubjectOptions();
   $("admin-workspace").hidden=false;
   emit("Classwork loaded: "+subjects.length+" subject(s), "+assignments.length+
     " assignment(s). All changes are audited.","success");
 }
 function renderSubjects(){
   const root=$("admin-subject-list");
   root.replaceChildren();
   $("subject-count").textContent=subjects.length+" subject"+(subjects.length===1?"":"s");
   if(!subjects.length){
     root.appendChild(node("p","No subjects yet. Create one to organize your classwork.","bn-admin-empty"));
     return;
   }
   for(const item of subjects){
     const row=node("div",null,"bn-admin-record");
     const info=node("div");
     info.append(node("h3",item.name));
     info.append(node("p","Subject · "+assignments.filter(a=>a.subject_id===item.id).length+" assignments"));
     const edit=node("button","Rename","bn-btn bn-btn-secondary");
     edit.type="button";
     edit.addEventListener("click",()=>{
       $("rename-subject-id").value=item.id;
       $("rename-subject-name").value=item.name;
       $("subject-rename-dialog").showModal();
       $("rename-subject-name").focus();
     });
     row.append(info,edit);
     root.append(row);
   }
 }
 function fillSubjectOptions(selected=null){
   const picker=$("assignment-subject");
   const previous=selected||picker.value;
   picker.replaceChildren();
   if(!subjects.length){
     const option=node("option","Create a subject first");option.value="";
     picker.append(option);picker.disabled=true;
     $("new-assignment").disabled=true;
   }else{
     picker.disabled=false;$("new-assignment").disabled=false;
     for(const subject of subjects){
       const option=node("option",subject.name);option.value=subject.id;picker.append(option);
     }
     if(subjects.some(s=>s.id===previous))picker.value=previous;
   }
 }
 function editAssignment(item){
   $("assignment-form").hidden=false;
   $("assignment-form-title").textContent="Edit assignment";
   $("assignment-submit").textContent="Save changes";
   $("assignment-id").value=item.id;
   fillSubjectOptions(item.subject_id);
   $("assignment-name").value=item.name;
   $("assignment-description").value=item.description||"";
   $("assignment-instructions").value=item.instructions||"";
   $("assignment-deadline").value=dateLocal(item.deadline);
   $("assignment-type").value=item.is_group?"group":"individual";
   $("assignment-file-types").value=(item.required_file_types||[]).join(", ");
   $("assignment-max-mib").value=item.max_file_size_bytes
     ?Math.ceil(item.max_file_size_bytes/1048576):"";
   $("assignment-form").scrollIntoView({behavior:"smooth",block:"start"});
   $("assignment-name").focus();
 }
 function startAssignment(){
   if(!subjects.length){emit("Create a subject before adding assignments.","error");return}
   $("assignment-form").reset();
   $("assignment-id").value="";
   $("assignment-form-title").textContent="Create assignment";
   $("assignment-submit").textContent="Create assignment";
   fillSubjectOptions();
   $("assignment-form").hidden=false;
   $("assignment-name").focus();
 }
 function renderAssignments(){
   const root=$("admin-assignment-list");root.replaceChildren();
   if(!assignments.length){
     root.append(node("p","No assignments yet. Create your first one when subjects are ready.","bn-admin-empty"));
     return;
   }
   for(const item of assignments){
     const row=node("article",null,"bn-admin-record");
     const info=node("div");
     info.append(node("h3",item.name));
     const subject=subjects.find(x=>x.id===item.subject_id);
     info.append(node("p",(subject?.name||"Subject")+" · "+
       (item.is_group?"Group":"Individual")+" · "+deadlineLabel(item.deadline)));
     const controls=node("div",null,"bn-admin-record-actions");
     const status=node("select");
     status.setAttribute("aria-label","Assignment status for "+item.name);
     for(const value of ["OPEN","CLOSED","ARCHIVED"]){
       const option=node("option",value);option.value=value;status.append(option);
     }
     status.value=item.status;
     const save=node("button","Set status","bn-btn bn-btn-secondary");
     save.type="button";save.addEventListener("click",()=>guard(async()=>{
       if(status.value===item.status)return;
       await action("assignment.status",{id:item.id,status:status.value});
       await refresh();
     }));
     const edit=node("button","Edit","bn-btn bn-btn-secondary");
     edit.type="button";edit.addEventListener("click",()=>editAssignment(item));
     controls.append(status,save,edit);row.append(info,controls);root.append(row);
   }
 }
 async function init(){
   if(!w.BNBackend?.configured||!db()){
     emit("Supabase is not configured. Check your connection.","error");return;
   }
   try{
     const {data:user,error:authError}=await db().auth.getUser();
     if(authError||!user?.user){w.location.replace("login.html");return;}
     const memberships=await fetchData(db().from("ClassMembership")
       .select("class_id,role,status").eq("role","Admin").eq("status","ACTIVE"));
     if(!memberships.length){
       emit("This page requires an ACTIVE Admin membership. Return to My Account.","error");return;
     }
     classes=await fetchData(db().from("Class")
       .select("id,name,section").in("id",memberships.map(x=>x.class_id)));
     classes=classes.filter(x=>memberships.some(m=>m.class_id===x.id));
     if(!classes.length){emit("No authorized classroom could be loaded.","error");return;}
     const picker=$("admin-class");picker.replaceChildren();
     for(const room of classes){
       const opt=node("option",room.name+(room.section?" · "+room.section:""));
       opt.value=room.id;picker.append(opt);
     }
     picker.disabled=false;classId=classes[0].id;picker.value=classId;
     picker.addEventListener("change",()=>guard(async()=>{
       const next=picker.value;
       if(!classes.some(x=>x.id===next)){emit("Unauthorized classroom selection.","error");return}
       classId=next;$("assignment-form").hidden=true;await refresh();
     }));
     $("subject-create-form").addEventListener("submit",event=>{
       event.preventDefault();
       guard(async()=>{
         const name=$("new-subject").value.trim();
         if(!name)throw Error("Enter a subject name.");
         await action("subject.create",{name});
         $("subject-create-form").reset();await refresh();
       });
     });
     $("subject-rename-form").addEventListener("submit",event=>{
       event.preventDefault();
       guard(async()=>{
         await action("subject.rename",{
           id:$("rename-subject-id").value,name:$("rename-subject-name").value.trim()
         });
         $("subject-rename-dialog").close();await refresh();
       });
     });
     $("rename-cancel").addEventListener("click",()=>$("subject-rename-dialog").close());
     $("new-assignment").addEventListener("click",startAssignment);
     $("assignment-cancel").addEventListener("click",()=>$("assignment-form").hidden=true);
     $("assignment-form").addEventListener("submit",event=>{
       event.preventDefault();
       guard(async()=>{
         const raw=$("assignment-deadline").value;
         const deadline=raw?new Date(raw):null;
         if(deadline&&!Number.isFinite(deadline.getTime()))throw Error("Invalid deadline.");
         const types=$("assignment-file-types").value.split(",").map(s=>s.trim()).filter(Boolean);
         const max=$("assignment-max-mib").value;
         const payload={
           subject_id:$("assignment-subject").value,
           name:$("assignment-name").value.trim(),
           description:$("assignment-description").value,
           instructions:$("assignment-instructions").value,
           deadline:deadline?deadline.toISOString():null,
           is_group:$("assignment-type").value==="group",
           required_file_types:types,
           max_file_size_bytes:max?Number(max)*1048576:null
         };
         if(!payload.subject_id)throw Error("Select a subject.");
         if(!payload.name)throw Error("Enter an assignment title.");
         const id=$("assignment-id").value;
         if(id)payload.id=id;
         await action(id?"assignment.update":"assignment.create",payload);
         $("assignment-form").hidden=true;$("assignment-form").reset();
         await refresh();
       });
     });
     await refresh();
   }catch(error){emit("Unable to initialize classwork: "+(error?.message||"Unknown error"),"error");}
 }
 document.addEventListener("DOMContentLoaded",init);
})(window);
