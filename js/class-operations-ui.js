/* Class Operations: an authenticated, resilient UI for schedule and roster.
 * Partial failures are reported, not allowed to blank unrelated sections.
 * No class ownership or registration decisions come from local client state.
 */
(function(w){
 "use strict";
 const $=id=>document.getElementById(id);
 const DAYS=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
 const TYPES=new Set(["holiday","cancelled","special","rescheduled"]);
 let active=new Map(),classes=new Map(),generation=0,busy=false;
 function node(tag,text){
   const el=document.createElement(tag);
   if(text!==undefined)el.textContent=String(text??"");
   return el;
 }
 function cell(row,value){row.appendChild(node("td",value??""));return row.lastElementChild}
 function notice(text,state="info"){
   $("ops-message").textContent=text;
   $("ops-message").dataset.state=state;
 }
 function feedback(e){return e?.message||"Unexpected request failure. Please try again."}
 function chosen(){return $("ops-class").value}
 function isAdmin(){return active.get(chosen())==="Admin"}
 function button(label,click){
   const b=node("button",label);b.type="button";b.className="bn-btn bn-btn-secondary";
   b.addEventListener("click",click);return b;
 }
 function empty(tbody,text){
   const r=tbody.insertRow(),c=r.insertCell();c.colSpan=4;c.textContent=text;
   c.className="ops-empty";
 }
 function access(){
   const admin=isAdmin(),role=active.get(chosen());
   $("ops-role").textContent=role?role+" · ACTIVE":"Not authorized";
   $("ops-role").dataset.role=role||"";
   for(const id of ["slot-form","exception-form"]){
     const form=$(id);
     for(const control of form.querySelectorAll("input,select,button")){
       control.disabled=!admin||busy;
     }
   }
   $("ops-edit-hint").textContent=admin
     ?"Changes are saved to your classroom and recorded in the audit log."
     :"Read-only schedule. Only the classroom Admin can create or remove entries.";
   w.BNTheme?.setRole(role||"Student");
 }
 async function action(task,success){
   if(busy)return;
   busy=true;access();
   try{
     await task();
     const allGood=await refresh();
     if(allGood)notice(success,"success");
   }catch(e){notice("Unable to save: "+feedback(e),"error")}
   finally{busy=false;access()}
 }
 function redrawMembers(rows,role){
   const tbody=$("member-rows");tbody.replaceChildren();
   $("ops-member-count").textContent=rows.length+" member"+(rows.length===1?"":"s");
   if(!rows.length){empty(tbody,"No members are visible in this classroom.");return}
   const admin=role==="Admin",staff=admin||role==="Moderator";
   for(const member of rows){
     const tr=tbody.insertRow();
     cell(tr,member.full_name||"Unnamed member");
     cell(tr,member.role);
     cell(tr,member.status);
     const td=tr.insertCell();
     if(member.role==="Admin"){
       td.textContent="Protected class owner";
       continue;
     }
     if(member.status==="PENDING"){
       if(!staff){td.textContent="Pending review";continue}
       const actions=node("div");actions.className="ops-row-actions";
       actions.append(
         button("Approve",()=>action(()=>w.BNClassOps.review(member.membership_id,true),"Member approved.")),
         button("Reject",()=>{if(w.confirm("Reject this request?"))
           void action(()=>w.BNClassOps.review(member.membership_id,false),"Request rejected.");})
       );
       td.appendChild(actions);continue;
     }
     if(!admin){td.textContent="Read only";continue}
     const group=node("div");group.className="ops-row-actions";
     const rolePicker=node("select");rolePicker.setAttribute("aria-label","Role for "+member.full_name);
     for(const value of ["Student","Moderator"]){
       const opt=node("option",value);opt.value=value;rolePicker.appendChild(opt);
     }
     rolePicker.value=member.role;
     const statePicker=node("select");statePicker.setAttribute("aria-label","Status for "+member.full_name);
     for(const value of ["ACTIVE","REJECTED","REMOVED"]){
       const opt=node("option",value);opt.value=value;statePicker.appendChild(opt);
     }
     statePicker.value=member.status;
     const save=button("Save",()=>action(async()=>{
       if(rolePicker.value===member.role&&statePicker.value===member.status){
         throw Error("No changes selected.");
       }
       await w.BNClassOps.updateMember(member.membership_id,rolePicker.value,statePicker.value);
     },"Membership updated."));
     group.append(rolePicker,statePicker,save);td.appendChild(group);
   }
 }
 function redrawSlots(rows,role){
   const tbody=$("slot-rows");tbody.replaceChildren();
   $("ops-slot-count").textContent=rows.length+" recurring slot"+(rows.length===1?"":"s");
   if(!rows.length){empty(tbody,"No weekly classes scheduled yet.");return}
   for(const item of rows){
     const tr=tbody.insertRow();cell(tr,DAYS[item.day_of_week]||"Unknown day");
     cell(tr,String(item.start_local).slice(0,5)+"–"+String(item.end_local).slice(0,5));
     cell(tr,item.label);
     const td=tr.insertCell();
     if(role==="Admin"){
       td.appendChild(button("Delete",()=>{
         if(w.confirm("Delete the "+item.label+" schedule slot?")){
           void action(()=>w.BNClassOps.deleteSlot(item.id,chosen()),"Schedule slot removed.");
         }
       }));
     }else td.textContent="Read only";
   }
 }
 function redrawExceptions(rows,role){
   const tbody=$("exception-rows");tbody.replaceChildren();
   $("ops-exception-count").textContent=rows.length+" exception"+(rows.length===1?"":"s");
   if(!rows.length){empty(tbody,"No dated exceptions in this classroom.");return}
   for(const item of rows){
     const tr=tbody.insertRow();cell(tr,item.exception_date);
     cell(tr,item.kind);
     const note=item.note||"";
     const timing=item.replacement_start_local
       ?" ("+String(item.replacement_start_local).slice(0,5)+"–"+
         String(item.replacement_end_local).slice(0,5)+")":"";
     cell(tr,note+timing);
     const td=tr.insertCell();
     if(role==="Admin"){
       td.appendChild(button("Delete",()=>{
         if(w.confirm("Delete the exception for "+item.exception_date+"?")){
           void action(()=>w.BNClassOps.deleteException(item.id,chosen()),"Schedule exception removed.");
         }
       }));
     }else td.textContent="Read only";
   }
 }
 async function refresh(){
   const classId=chosen(),role=active.get(classId);
   if(!classId||!role){$("ops-panel").hidden=true;return false}
   const turn=++generation;
   $("ops-panel").hidden=false;
   access();
   notice("Loading "+(classes.get(classId)?.name||"classroom")+"…");
   const sections=[
     ["members",()=>w.BNClassOps.directory(classId),redrawMembers],
     ["weekly slots",()=>w.BNClassOps.slots(classId),redrawSlots],
     ["exceptions",()=>w.BNClassOps.exceptions(classId),redrawExceptions]
   ];
   const results=await Promise.allSettled(sections.map(s=>s[1]()));
   if(turn!==generation)return false;
   const failures=[];
   for(let i=0;i<results.length;i++){
     const outcome=results[i],section=sections[i],tbody=$(
       ["member-rows","slot-rows","exception-rows"][i]);
     if(outcome.status==="fulfilled"){
       section[2](Array.isArray(outcome.value)?outcome.value:[],role);
     }else{
       tbody.replaceChildren();
       empty(tbody,"Could not load "+section[0]+".");
       failures.push(section[0]+": "+feedback(outcome.reason));
     }
   }
   if(failures.length){
     notice("Some data could not be loaded. "+failures.join(" | "),"error");
     return false;
   }
   notice("Loaded "+(classes.get(classId)?.name||"classroom")+
     ". All displayed schedule times use Asia/Manila.","success");
   return true;
 }
 async function init(){
   $("ops-class").addEventListener("change",()=>{void refresh()});
   $("ops-refresh").addEventListener("click",()=>{void refresh()});
   $("slot-form").addEventListener("submit",e=>{
     e.preventDefault();
     void action(async()=>{
       if(!isAdmin())throw Error("Admin access required.");
       const form=new FormData(e.target);
       const start=String(form.get("start_local")||"");
       const end=String(form.get("end_local")||"");
       const label=String(form.get("label")||"").trim();
       if(!label||label.length>120)throw Error("Enter an activity name (up to 120 characters).");
       if(!start||!end||start>=end)throw Error("The end time must be later than the start time.");
       await w.BNClassOps.createSlot({class_id:chosen(),day_of_week:Number(form.get("day_of_week")),
         start_local:start,end_local:end,label});
       e.target.reset();
     },"Weekly schedule saved.");
   });
   $("exception-form").addEventListener("submit",e=>{
     e.preventDefault();
     void action(async()=>{
       if(!isAdmin())throw Error("Admin access required.");
       const form=new FormData(e.target),kind=String(form.get("kind")||"");
       const date=String(form.get("exception_date")||"");
       const note=String(form.get("note")||"").trim();
       const start=String(form.get("replacement_start_local")||"");
       const end=String(form.get("replacement_end_local")||"");
       if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!TYPES.has(kind)){
         throw Error("Select a valid date and exception type.");
       }
       if(note.length>250)throw Error("Exception notes are limited to 250 characters.");
       if(Boolean(start)!==Boolean(end)||start&&start>=end){
         throw Error("Enter both replacement times, with the end later than the start.");
       }
       if(kind==="rescheduled"&&!start){
         throw Error("Rescheduled classes require replacement start and end times.");
       }
       await w.BNClassOps.createException({class_id:chosen(),exception_date:date,
         kind,note,replacement_start_local:start||null,replacement_end_local:end||null});
       e.target.reset();
     },"Exception saved.");
   });
   if(!w.BNClassOps?.ready()){
     notice("Supabase is unavailable. Check your connection and reload.","error");return;
   }
   try{
     const memberships=await w.BNClassOps.memberships();
     const staff=(memberships||[]).filter(m=>["Admin","Moderator"].includes(m.role)
       &&m.status==="ACTIVE");
     active=new Map(staff.map(m=>[m.class_id,m.role]));
     if(!active.size){
       notice("No ACTIVE Admin or Moderator membership. Go to Profile & Security to check your enrollment.","error");
       return;
     }
     // Human-readable class names, but membership scope is established first.
     try{
       const found=await w.BNClassOps.classes([...active.keys()]);
       for(const cls of found||[])if(active.has(cls.id))classes.set(cls.id,cls);
     }catch(_){/* Class names are cosmetic. Keep the accessible selector working. */}
     const picker=$("ops-class");picker.replaceChildren();
     for(const [id,role] of active){
       const cls=classes.get(id);
       const option=node("option",(cls?.name||"Classroom "+(active.size>1?id.slice(0,8):""))+" · "+role);
       option.value=id;picker.appendChild(option);
     }
     await refresh();
   }catch(e){
     notice("Unable to load Class Operations: "+feedback(e),"error");
   }
 }
 document.addEventListener("DOMContentLoaded",()=>{void init()});
})(window);
