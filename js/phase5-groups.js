/* Phase 5: class-scoped group organization and compiled version manifests.
 * All mutations go through existing audited Phase 3 RPC. Staff-only manifest
 * is computed by guarded Phase 5 RPC. Never read private tables directly. */
(function(w){
 "use strict";
 const $=id=>document.getElementById(id);
 const db=()=>w.BNBackend?.client;
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 let memberships=[],rooms=[],assignments=[],groupData=[],roster=[],role="",active=null,requestId=0,busy=false;
 function node(tag,text,cls){
   const el=document.createElement(tag);
   if(text!==undefined&&text!==null)el.textContent=String(text);
   if(cls)el.className=cls;return el;
 }
 function status(s,state="info"){$("p5-status").textContent=s;$("p5-status").dataset.state=state}
 async function query(call){const {data,error}=await call;if(error)throw error;return data}
 async function rpc(name,args){return query(db().rpc(name,args))}
 function formatTime(t){if(!t)return "Not submitted";return new Intl.DateTimeFormat("en-PH",{
   timeZone:"Asia/Manila",dateStyle:"medium",timeStyle:"short"}).format(new Date(t))}
 function setBusy(on){
   busy=on;
   for(const id of ["p5-refresh","p5-preview","p5-export","p5-create-form",
       "p5-build-pdf","p5-build-zip","p5-history-refresh"]){
     const e=$(id);if(!e)continue;
     for(const c of id==="p5-create-form"?e.querySelectorAll("input,button"): [e])c.disabled=on;
   }
   for(const b of $("p5-group-list").querySelectorAll("button,select"))b.disabled=on;
 }
 async function perform(operation,success){
   if(busy)return;
   setBusy(true);
   try{await operation();status(success,"success")}
   catch(e){status(e?.message||"Unable to complete request.","error")}
   finally{setBusy(false)}
 }
 function selectedAssignment(){const id=$("p5-assignment").value;return assignments.find(a=>a.id===id)||null}
 function currentRole(){return memberships.find(m=>m.class_id===$("p5-class").value)?.role||""}
 function groupCall(action,gid=null,uid=null,name=null){
   return rpc("bn_p3_groups",{
     p_assignment:active.id,p_action:action,p_group:gid,p_member:uid,p_name:name
   });
 }
 function drawGroups(){
   const root=$("p5-group-list");root.replaceChildren();
   $("p5-group-count").textContent=groupData.length+" group"+(groupData.length===1?"":"s");
   if(!groupData.length){root.append(node("p","No groups yet. An Admin can create the first team.","bn-muted"));return}
   const allocated=new Set(groupData.flatMap(g=>(g.members||[]).map(m=>m.user_id)));
   const available=roster.filter(s=>!allocated.has(s.id));
   for(const group of groupData){
     const box=node("article",null,"p5-group");
     box.append(node("h3",group.name));
     if(group.locked)box.append(node("p","🔒 Membership locked after submission began.","bn-muted"));
     const members=group.members||[];
     if(!members.length)box.append(node("p","No assigned Students.","bn-muted"));
     for(const member of members){
       const row=node("div",null,"p5-member");
       row.append(node("span",member.name||"Student"));
       if(role==="Admin"&&!group.locked){
         const btn=node("button","Remove","bn-btn bn-btn-secondary");
         btn.type="button";btn.addEventListener("click",()=>perform(async()=>{
           if(!w.confirm("Remove this Student from "+group.name+"?"))return;
           await groupCall("remove_member",group.id,member.user_id);
           await reloadGroups();
         },"Membership updated."));
         row.append(btn);
       }
       box.append(row);
     }
     if(role==="Admin"&&!group.locked&&available.length){
       const controls=node("div",null,"p5-group-controls");
       const pick=node("select");pick.setAttribute("aria-label","Add Student to "+group.name);
       for(const student of available){
         const option=node("option",student.name||"Student");option.value=student.id;pick.append(option);
       }
       const btn=node("button","Add Student","bn-btn bn-btn-primary");btn.type="button";
       btn.addEventListener("click",()=>perform(async()=>{
         await groupCall("add_member",group.id,pick.value);
         await reloadGroups();
       },"Student assigned."));
       controls.append(pick,btn);box.append(controls);
     }
     root.append(box);
   }
 }
 async function reloadGroups(){
   if(!active?.is_group){groupData=[];roster=[];drawGroups();return}
   const wanted=active.id,turn=requestId,viewerRole=role;
   const g=await rpc("bn_p5_groups_read",{p_assignment:wanted});
   const r=viewerRole==="Admin"?await rpc("bn_p3_groups",{
     p_assignment:wanted,p_action:"roster"}):[];
   if(turn!==requestId||active?.id!==wanted||role!==viewerRole)return;
   groupData=Array.isArray(g)?g:[];roster=Array.isArray(r)?r:[];
   drawGroups();
 }
 function drawManifest(data){
   const list=$("p5-compilation");list.replaceChildren();
   if(!data?.entries?.length){list.append(node("p","No completed submitted versions for this assignment.","bn-muted"));return}
   for(const entry of data.entries){
     const card=node("article",null,"p5-entry");
     card.append(node("strong",entry.group_name||entry.student_name||"Student submission"));
     card.append(node("small","Version "+entry.version+" · Submitted "+formatTime(entry.submitted_at)+(entry.late?" · Late":"")));
     if(!entry.files?.length)card.append(node("p","No READY file metadata.","bn-muted"));
     else{
       const ul=node("ul");
       for(const f of entry.files)ul.append(node("li",f.name+" ("+Math.ceil(f.size/1024)+" KiB)"));
       card.append(ul);
     }
     list.append(card);
   }
 }
 async function preview(doExport=false){
   if(!active||!["Admin","Moderator"].includes(role))throw Error("Staff access required.");
   const manifest=await rpc("bn_p5_compilation",{p_assignment:active.id,p_export:doExport});
   drawManifest(manifest);
   if(doExport){
     const json=JSON.stringify(manifest,null,2);
     const url=URL.createObjectURL(new Blob([json],{type:"application/json"}));
     try{
       const a=node("a");a.href=url;a.download="blue-noelle-compilation-"+active.id+".json";
       document.body.append(a);a.click();a.remove();
     }finally{w.setTimeout(()=>URL.revokeObjectURL(url),1500)}
   }
   return manifest;
 }
 // An Edge Function generates the bytes. Never compile private files in a
 // public browser or persist sensitive Storage paths or role state.
 async function invokeCompilation(body){
   const {data,error}=await db().functions.invoke("bn-phase5-compilation",{body});
   if(error){
     let reason=error.message||"Compilation service is unavailable.";
     try{
       const payload=await error.context?.json();
       if(payload?.error)reason=payload.error;
     }catch(_){}
     throw Error(reason);
   }
   return data;
 }
 function renderHistory(rows){
   const container=$("p5-history");container.replaceChildren();
   if(!rows?.length){
     container.append(node("p","No private compilation files have been generated yet.","bn-muted"));
     return;
   }
   for(const exportRow of rows){
     const card=node("article",null,"p5-history-row");
     const info=node("div",null,"p5-history-info");
     const extension=String(exportRow.format||"").toUpperCase();
     info.append(node("strong",extension+" · "+formatTime(exportRow.created_at)));
     info.append(node("small",exportRow.status+" · "+
       exportRow.source_count+" source file"+(exportRow.source_count===1?"":"s")+
       (exportRow.size?" · "+(exportRow.size/1024/1024).toFixed(2)+" MiB":"")));
     if(exportRow.sha256)info.append(node("code","SHA-256: "+exportRow.sha256,"p5-history-hash"));
     if(exportRow.status==="FAILED")info.append(node("small","Generation failed. "+(exportRow.error_code||"Please retry.")));
     card.append(info);
     if(exportRow.status==="READY"){
       const action=node("button","Download "+extension,"bn-btn bn-btn-secondary");
       action.type="button";
       action.addEventListener("click",()=>{void perform(async()=>{
         const data=await invokeCompilation({action:"download",id:exportRow.id});
         if(!(data instanceof Blob))throw Error("Unexpected file response from compilation service.");
         if(data.size!==Number(exportRow.size))throw Error("Generated file size has changed.");
         const url=URL.createObjectURL(data);
         try{
           const a=node("a");
           a.href=url;
           a.download=String(exportRow.filename||"blue-noelle-compilation."+exportRow.format)
             .replace(/[^A-Za-z0-9._-]/g,"_");
           document.body.append(a);a.click();a.remove();
         }finally{w.setTimeout(()=>URL.revokeObjectURL(url),30000)}
       },"Private compilation downloaded.");});
       card.append(action);
     }
     container.append(card);
   }
 }
 async function loadHistory(){
   if(!active||!["Admin","Moderator"].includes(role))return;
   const assignmentId=active.id,turn=requestId;
   const history=await rpc("bn_p5_export_history",{p_assignment:assignmentId});
   if(turn===requestId&&active?.id===assignmentId)
     renderHistory(Array.isArray(history)?history:[]);
 }
 async function generate(format){
   if(!active||!["Admin","Moderator"].includes(role))
     throw Error("ACTIVE classroom staff access required.");
   if(!["pdf","zip"].includes(format))throw Error("Choose PDF or ZIP.");
   const assignmentId=active.id;
   $("p5-build-status").textContent="Preparing private "+format.toUpperCase()+
     " compilation from verified submitted versions…";
   try{
     const result=await invokeCompilation({action:"build",assignment_id:assignmentId,format});
     if(!result||result.status!=="READY")throw Error("Compilation did not finish successfully.");
     if(active?.id===assignmentId){
       $("p5-build-status").textContent=format.toUpperCase()+" ready: "+
         result.file_count+" files, "+(result.size/1024/1024).toFixed(2)+" MiB.";
       await loadHistory();
     }
   }catch(e){
     $("p5-build-status").textContent="Generation failed: "+(e.message||"Unknown error");
     await loadHistory().catch(()=>{});
     throw e;
   }
 }
 async function loadSelected(){
   const mine=++requestId;
   active=selectedAssignment();
   if(!active){$("p5-content").hidden=true;return}
   role=currentRole();
   $("p5-content").hidden=false;
   $("p5-student").hidden=role!=="Student";
   $("p5-staff").hidden=!["Admin","Moderator"].includes(role);
   $("p5-generated").hidden=!["Admin","Moderator"].includes(role);
   $("p5-history").replaceChildren();
   $("p5-create-form").hidden=role!=="Admin"||!active.is_group;
   $("p5-group-list").replaceChildren();
   $("p5-compilation").replaceChildren();
   $("p5-group-count").textContent="—";
   $("p5-assignment-name").textContent=active.name;
   $("p5-assignment-meta").textContent=(active.is_group?"Group assignment":"Individual assignment")+" · "+active.status;
   $("p5-submission-link").href="submission.html?assignment="+encodeURIComponent(active.id);
   try{
     if(role==="Student"){
       const result=active.is_group?await rpc("bn_p3_my_group",{p_assignment:active.id}):null;
       if(mine!==requestId)return;
       $("p5-student-group").textContent=!active.is_group?
         "Individual assignment. No group required.":result?.name||"You have not been assigned to a group yet.";
     }else{
       if(active.is_group)await reloadGroups();
       else{$("p5-group-list").append(node("p","Individual assignments do not use groups.","bn-muted"));}
       if(mine!==requestId)return;
       const manifest=await preview(false);
       if(mine!==requestId)return;
       await loadHistory();
       if(mine!==requestId)return;
       status("Loaded "+manifest.count+" verified submitted version"+(manifest.count===1?"":"s")+".","success");
     }
   }catch(e){
     if(mine===requestId)status("Unable to load Phase 5: "+(e?.message||"Request failed"),"error");
   }
 }
 async function loadAssignments(){
   const turn=++requestId;
   const id=$("p5-class").value;
   active=null;$("p5-content").hidden=true;
   if(!id)return;
   role=currentRole();w.BNTheme?.setRole(role||"Student");
   const subjects=await query(db().from("Subject").select("id").eq("class_id",id).is("deleted_at",null));
   assignments=(subjects?.length?await query(db().from("Assignment")
     .select("id,name,is_group,status,subject_id").in("subject_id",subjects.map(x=>x.id))
     .is("deleted_at",null)):[])||[];
   if(turn!==requestId||id!==$("p5-class").value)return;
   assignments.sort((a,b)=>a.name.localeCompare(b.name));
   const picker=$("p5-assignment"),preferred=new URLSearchParams(w.location.search).get("assignment");
   picker.replaceChildren();
   if(!assignments.length){
     const option=node("option","No assignments");option.value="";picker.append(option);
     picker.disabled=true;status("No assignments available in this classroom.");return;
   }
   for(const assignment of assignments){
     const option=node("option",assignment.name+(assignment.is_group?" · Group":" · Individual"));
     option.value=assignment.id;picker.append(option);
   }
   picker.disabled=false;
   picker.value=assignments.some(a=>a.id===preferred)?preferred:assignments[0].id;
   await loadSelected();
 }
 async function load(){
   if(!w.BNBackend?.configured||!db()){status("Supabase is unavailable.","error");return}
   try{
     const {data,error}=await db().auth.getUser();
     if(error||!data?.user){w.location.replace("login.html");return}
     memberships=(await query(db().from("ClassMembership")
       .select("class_id,role,status").eq("status","ACTIVE")))||[];
     if(!memberships.length){status("Join an approved class to use groups and compilation.","error");return}
     const ids=[...new Set(memberships.map(m=>m.class_id))];
     rooms=(await query(db().from("Class").select("id,name,section").in("id",ids)))||[];
     const picker=$("p5-class");picker.replaceChildren();
     for(const room of rooms){
       const option=node("option",room.name+(room.section?" · "+room.section:""));
       option.value=room.id;picker.append(option);
     }
     if(!rooms.length)throw Error("No approved classrooms are visible.");
     picker.disabled=false;
     const preferred=new URLSearchParams(w.location.search).get("class");
     picker.value=rooms.some(r=>r.id===preferred)?preferred:rooms[0].id;
     await loadAssignments();
   }catch(e){status("Unable to open Phase 5: "+(e?.message||"Request failed"),"error")}
 }
 document.addEventListener("DOMContentLoaded",()=>{
   $("p5-class").addEventListener("change",()=>{void loadAssignments().catch(e=>status(e.message,"error"))});
   $("p5-assignment").addEventListener("change",()=>{void loadSelected()});
   $("p5-refresh").addEventListener("click",()=>{void loadSelected()});
   $("p5-create-form").addEventListener("submit",e=>{
     e.preventDefault();void perform(async()=>{
       if(role!=="Admin"||!active?.is_group)throw Error("Only Admins manage assignment groups.");
       const value=$("p5-group-name").value.trim();
       if(value.length<2||value.length>120)throw Error("Enter a group name between 2 and 120 characters.");
       await groupCall("create",null,null,value);
       $("p5-group-name").value="";
       await reloadGroups();
     },"Group created.");
   });
   $("p5-preview").addEventListener("click",()=>{void perform(()=>preview(false),"Compilation preview refreshed.")});
   $("p5-export").addEventListener("click",()=>{void perform(()=>preview(true),"Verified manifest exported.")});
   $("p5-build-pdf").addEventListener("click",()=>{
     void perform(()=>generate("pdf"),"Private PDF compilation generated.");
   });
   $("p5-build-zip").addEventListener("click",()=>{
     void perform(()=>generate("zip"),"Private ZIP compilation generated.");
   });
   $("p5-history-refresh").addEventListener("click",()=>{
     void perform(()=>loadHistory(),"Private compilation history refreshed.");
   });
   void load();
 });
})(window);
