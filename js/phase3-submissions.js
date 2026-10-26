/* Phase 3: real private Storage uploads and class-scoped submission history.
 * Supabase's guarded RPCs, private bucket and RLS are the authority.
 * No demo identities, service keys, localStorage, or public URLs.
 */
(function(w){
 "use strict";
 const $=id=>document.getElementById(id);
 const db=()=>w.BNBackend?.client;
 const BUCKET="bn-submissions",MAX=41943040;
 let assignment=null,room=null,role=null,currentGroup=null,submissions=[],groups=[],roster=[],busy=false;
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 function make(tag,text,cls){
  const n=document.createElement(tag);
  if(text!==undefined&&text!==null)n.textContent=String(text);
  if(cls)n.className=cls;return n;
 }
 function report(message,state="info"){
  $("sub-status").textContent=message;$("sub-status").dataset.state=state;
 }
 function date(when){
  if(!when)return "No deadline";
  const d=new Date(when);
  if(!Number.isFinite(d.getTime()))return "Unknown date";
  return new Intl.DateTimeFormat("en-PH",{timeZone:"Asia/Manila",dateStyle:"medium",timeStyle:"short"}).format(d);
 }
 const dateWord=(val)=>val?date(val):"Not yet";
 async function query(req){
  const {data,error}=await req;
  if(error)throw error;
  return data;
 }
 async function rpc(name,args){return query(db().rpc(name,args))}
 async function withBusy(fn){
  if(busy)return;busy=true;
  for(const id of ["sub-upload","sub-final-submit"]){if($(id))$(id).disabled=true}
  try{await fn()}catch(e){report(e?.message||"Request failed. Try again.","error")}
  finally{busy=false;for(const id of ["sub-upload","sub-final-submit"]){if($(id))$(id).disabled=false}}
 }
 async function download(file){
  if(file.state!=="READY"||!file.key)throw Error("This file has not finished uploading.");
  const {data,error}=await db().storage.from(BUCKET).download(file.key);
  if(error)throw error;
  const u=URL.createObjectURL(data);
  const link=document.createElement("a");
  link.href=u;link.download=file.name||"blue-noelle-file";
  link.rel="noopener";document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(u),30000);
 }
 function fileItem(file,allowCancel=false){
  const row=make("div",null,"bn-sub-file");
  const text=make("div",null,"bn-sub-file-info");
  text.append(make("strong",file.name||"Attachment"));
  text.append(make("small",(Math.ceil(Number(file.size||0)/1024))+" KiB · "+(file.mime||"Unknown type")+" · "+file.state));
  row.append(text);
  if(file.state==="READY"&&file.key){
   const button=make("button","Download","bn-btn bn-btn-secondary");
   button.type="button";button.addEventListener("click",()=>withBusy(async()=>{await download(file)}));
   row.append(button);
  }else if(file.state==="PENDING"&&file.key&&allowCancel){
   const button=make("button","Discard unfinished","bn-btn bn-btn-secondary");
   button.type="button";button.addEventListener("click",()=>withBusy(async()=>{
     // Remove the pending object, if one was written, before retiring metadata.
     const result=await db().storage.from(BUCKET).remove([file.key]);
     if(result.error && !/not found/i.test(result.error.message||""))throw result.error;
     await rpc("bn_p3_cancel_file",{p_file:file.id});
     await refresh();report("Unfinished file discarded.","success");
   }));
   row.append(button);
  }
  return row;
 }
 function ownSubmission(){
  return submissions.find(s=>s.student_id||s.group_id)||null;
 }
 function latestDraft(sub){
  if(!sub||sub.status!=="DRAFT")return null;
  return (sub.versions||[]).find(v=>v.state==="UPLOADING")||null;
 }
 function renderVersion(v,allowCancel=false){
  const wrap=make("article",null,"bn-sub-version");
  const line=make("div");
  line.append(make("h4","Version "+v.number));
  line.append(make("span",v.state,"bn-sub-mini"));
  wrap.append(line);
  wrap.append(make("p","Created "+dateWord(v.created_at)));
  if(v.submitted_at){
    const late=v.deadline_at_submission&&new Date(v.submitted_at)>new Date(v.deadline_at_submission);
    wrap.append(make("p","Submitted "+dateWord(v.submitted_at)+(late?" · LATE":""),"bn-sub-hint"));
  }
  const files=v.files||[];
  if(!files.length)wrap.append(make("p","No uploaded files yet."));
  for(const f of files)wrap.append(fileItem(f,allowCancel));
  return wrap;
 }
 function renderStudent(){
  const sub=ownSubmission(),draft=latestDraft(sub);
  const history=$("sub-history");history.replaceChildren();
  if(!sub){history.append(make("p","Nothing uploaded yet.","bn-sub-empty"))}
  else{
   const summary=make("p",(sub.status==="SUBMITTED"?"Last submitted: "+dateWord(sub.submitted_at):
     "Current status: "+sub.status)+" · "+(sub.versions||[]).length+" version(s)","bn-sub-hint");
   history.append(summary);
   for(const v of sub.versions||[])history.append(renderVersion(v,v.state==="UPLOADING"));
  }
  $("sub-draft-panel").hidden=!draft;
  $("sub-draft-files").replaceChildren();
  if(draft){
   for(const f of draft.files||[])$("sub-draft-files").append(fileItem(f,true));
   const files=draft.files||[];
   const ready=files.some(f=>f.state==="READY")&&files.every(f=>f.state==="READY");
   $("sub-final-submit").disabled=!ready;
   $("sub-final-submit").dataset.version=draft.id;
   $("sub-final-submit").dataset.submission=sub.id;
  }
 }
 function renderStaff(){
  const root=$("staff-submissions");root.replaceChildren();
  if(!submissions.length){root.append(make("p","No submissions have been started yet.","bn-sub-empty"));return}
  const sort=[...submissions].sort((a,b)=>String(b.submitted_at||b.created_at).localeCompare(String(a.submitted_at||a.created_at)));
  for(const sub of sort){
   const panel=make("article",null,"bn-sub-version");
   panel.append(make("h4",sub.student_name||sub.group_name||"Student submission"));
   const due=sub.deadline_at_submission&&sub.submitted_at&&new Date(sub.submitted_at)>new Date(sub.deadline_at_submission);
   panel.append(make("p",sub.status+" · "+(sub.submitted_at?"Submitted "+date(sub.submitted_at):"Not submitted")+(due?" · LATE":"")));
   for(const v of sub.versions||[]){
    if(v.state==="READY")panel.append(renderVersion(v));
   }
   root.append(panel);
  }
 }
 function renderGroups(){
  const root=$("group-list");root.replaceChildren();
  if(!groups.length){root.append(make("p","Create a group, then assign active Students.","bn-sub-empty"));return}
  for(const group of groups){
   const box=make("div",null,"bn-sub-group");box.append(make("h4",group.name));
   const memberIds=new Set((group.members||[]).map(x=>x.user_id));
   for(const person of group.members||[]){
     const row=make("div",null,"bn-sub-file");
     row.append(make("span",person.name||person.user_id));
     const btn=make("button","Remove","bn-btn bn-btn-secondary");
     btn.type="button";btn.addEventListener("click",()=>withBusy(async()=>{
       await groupAction("remove_member",group.id,person.user_id);
       await loadGroups();report("Group member removed.","success");
     }));
     row.append(btn);box.append(row);
   }
   const available=roster.filter(person=>!groups.some(g=>(g.members||[]).some(m=>m.user_id===person.id)));
   if(available.length){
     const controls=make("div",null,"bn-sub-inline");
     const select=make("select");select.setAttribute("aria-label","Add Student to "+group.name);
     for(const person of available){
       const opt=make("option",person.name||person.id);opt.value=person.id;select.append(opt);
     }
     const button=make("button","Add Student","bn-btn bn-btn-primary");
     button.type="button";button.addEventListener("click",()=>withBusy(async()=>{
       await groupAction("add_member",group.id,select.value);
       await loadGroups();report("Student assigned to group.","success");
     }));
     controls.append(select,button);box.append(controls);
   }else box.append(make("p","No additional unassigned active Students.","bn-sub-hint"));
   root.append(box);
  }
 }
 async function groupAction(action,groupId=null,memberId=null,name=null){
  return rpc("bn_p3_groups",{p_assignment:assignment.id,p_action:action,
   p_group:groupId,p_member:memberId,p_name:name});
 }
 async function loadGroups(){
  groups=await groupAction("list");
  roster=await groupAction("roster");
  renderGroups();
 }
 async function refresh(){
  submissions=await rpc("bn_p3_details",{p_assignment:assignment.id});
  if(role==="Student")renderStudent();else renderStaff();
 }
 async function upload(event){
  event.preventDefault();
  await withBusy(async()=>{
   if(role!=="Student"||assignment.status!=="OPEN")throw Error("This assignment does not accept uploads.");
   if(assignment.is_group&&!currentGroup)throw Error("An Admin must assign you to a group first.");
   const selected=Array.from($("sub-files").files||[]);
   if(!selected.length)throw Error("Choose one or more files.");
   if(selected.length>12)throw Error("Select no more than 12 files per version.");
   const existing=latestDraft(ownSubmission());
   if(existing&&(existing.files||[]).length+selected.length>12)throw Error("Version has reached the 12 file limit.");
   const allowed=assignment.required_file_types||[];
   const maximum=Math.min(Number(assignment.max_file_size_bytes)||MAX,MAX);
   for(const file of selected){
    const mime=(file.type||"application/octet-stream").toLowerCase();
    if(!file.size||file.size>maximum)throw Error(file.name+" exceeds the allowed file size.");
    if(allowed.length&&!allowed.includes(mime))throw Error(file.name+" is not an accepted file type.");
   }
   $("sub-progress").hidden=false;
   const meter=$("sub-meter"),progress=$("sub-progress-text");
   let version=existing?.id||null;
   for(let i=0;i<selected.length;i++){
    const file=selected[i],mime=(file.type||"application/octet-stream").toLowerCase();
    progress.textContent="Uploading "+(i+1)+" of "+selected.length+": "+file.name;
    const prepared=await rpc("bn_p3_prepare",{p_assignment:assignment.id,p_filename:file.name,
      p_mime:mime,p_bytes:file.size,p_version:version});
    version=prepared.version_id;
    let written=false;
    try{
     const {error}=await db().storage.from(BUCKET).upload(prepared.storage_key,file,{
       contentType:mime,upsert:false,cacheControl:"0"
     });
     if(error)throw error;written=true;
     await rpc("bn_p3_finish_file",{p_file:prepared.file_id});
    }catch(e){
     if(written){
       const removed=await db().storage.from(BUCKET).remove([prepared.storage_key]);
       if(removed.error)throw Error("Upload verification failed, and cleanup also failed: "+removed.error.message);
     }
     await rpc("bn_p3_cancel_file",{p_file:prepared.file_id});
     throw e;
    }
    meter.style.width=Math.round((i+1)/selected.length*100)+"%";
   }
   $("sub-upload-form").reset();
   await refresh();
   progress.textContent="Uploaded "+selected.length+" file(s) to a private draft version.";
   report("Your files are stored privately. Review the draft and select Submit this version.","success");
  });
 }
 async function submit(){
  await withBusy(async()=>{
   const btn=$("sub-final-submit");
   if(!uuid.test(btn.dataset.submission||"")||!uuid.test(btn.dataset.version||"")){
     throw Error("No completed draft version selected.");
   }
   const result=await rpc("bn_p3_submit",{p_submission:btn.dataset.submission,p_version:btn.dataset.version});
   await refresh();
   report("Version "+result.version+" submitted successfully"+(result.late?" (late)":"")+".","success");
  });
 }
 async function init(){
  const assignmentId=new URLSearchParams(w.location.search).get("assignment");
  if(!uuid.test(assignmentId||"")){
   report("Select an assignment from Classwork to view its submissions.","error");return;
  }
  if(!w.BNBackend?.configured||!db()){report("Supabase is unavailable.","error");return}
  try{
   const {data:identity,error}=await db().auth.getUser();
   if(error||!identity?.user){w.location.replace("login.html");return}
   const record=await query(db().from("Assignment").select("id,subject_id,name,description,status,deadline,is_group,required_file_types,max_file_size_bytes").eq("id",assignmentId).maybeSingle());
   if(!record)throw Error("Assignment not found or inaccessible to your account.");
   assignment=record;
   const subject=await query(db().from("Subject").select("id,class_id,name").eq("id",assignment.subject_id).single());
   room=await query(db().from("Class").select("id,name,section").eq("id",subject.class_id).single());
   const memberships=await query(db().from("ClassMembership").select("role,status").eq("class_id",room.id).eq("status","ACTIVE"));
   const current=memberships?.find(m=>m.status==="ACTIVE");
   if(!current)throw Error("ACTIVE classroom membership required.");
   role=current.role;
   w.BNTheme?.setRole(role);
   $("sub-title").textContent=assignment.name;
   $("sub-description").textContent=assignment.description||"Submit the requested files securely.";
   $("sub-class").textContent=room.name+(room.section?" · "+room.section:"");
   $("sub-type").textContent=assignment.is_group?"Group":"Individual";
   $("sub-deadline").textContent=date(assignment.deadline);
   $("sub-assignment-status").textContent=assignment.status;
   $("sub-assignment").hidden=false;
   if(role==="Student"){
    $("student-area").hidden=false;
    $("sub-files").disabled=assignment.status!=="OPEN";
    $("sub-upload").disabled=assignment.status!=="OPEN";
    const allowed=assignment.required_file_types||[];
    // Hint native file pickers about allowed formats. Server-side validation
    // and the existing upload guard remain authoritative.
    $("sub-files").accept=allowed.join(",");
    const max=Math.min(Number(assignment.max_file_size_bytes)||MAX,MAX);
    $("sub-limits").textContent="Up to 12 files per version; "+Math.floor(max/1048576)+
      " MiB per file. "+(allowed.length?"Allowed: "+allowed.join(", "):"Supported file types accepted.")+
      (assignment.status!=="OPEN"?" This assignment is no longer accepting uploads.":"");
    if(assignment.is_group){
      currentGroup=await rpc("bn_p3_my_group",{p_assignment:assignment.id});
      $("group-notice").hidden=false;
      $("group-notice").textContent=currentGroup?
        "Your shared group: "+currentGroup.name+". Any member may upload a new version.":
        "You haven't been assigned to a group. Ask your Admin before uploading.";
      if(!currentGroup){$("sub-upload").disabled=true;$("sub-files").disabled=true}
    }
    $("sub-upload-form").addEventListener("submit",upload);
    $("sub-refresh").addEventListener("click",()=>withBusy(refresh));
    $("sub-final-submit").addEventListener("click",submit);
   }else if(role==="Admin"||role==="Moderator"){
    $("staff-area").hidden=false;
    if(role==="Admin"&&assignment.is_group){
     $("group-management").hidden=false;
     $("group-create-form").addEventListener("submit",e=>{
      e.preventDefault();withBusy(async()=>{
       const name=$("group-name").value.trim();
       if(name.length<2)throw Error("Group name must have at least two characters.");
       await groupAction("create",null,null,name);
       $("group-create-form").reset();await loadGroups();report("Group created.","success");
      });
     });
     await loadGroups();
    }
   }else throw Error("This membership cannot access submissions.");
   await refresh();
   report("Private submission workspace loaded. Access is restricted to your classroom.","success");
  }catch(e){report(e?.message||"Unable to load assignment submissions.","error")}
 }
 document.addEventListener("DOMContentLoaded",init);
})(window);
