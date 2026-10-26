/* Phase 4 Dashboard clock preview. Independently guarded, so an unavailable
 * timetable never prevents Phase 2 dashboard/classwork from rendering. */
(function(w){
 "use strict";
 const $=id=>document.getElementById(id),db=()=>w.BNBackend?.client;
 let slots=[],exceptions=[],subjects=[],classId="",generation=0;
 async function query(req){const {data,error}=await req;if(error)throw error;return data||[]}
 function update(){
   if(!classId||!w.BNClassClock)return;
   const model=w.BNClassClock.evaluate({slots,exceptions,subjects,days:14});
   const active=model.current||model.next;
   $("dash-clock-title").textContent=active?(active.subject_name||active.label):
     "Nothing scheduled yet";
   $("dash-clock-phase").textContent=model.current?"NOW · CLASS IN SESSION":
     model.next?"NEXT · CLASS UPCOMING":"CLASS CLOCK · EMPTY TIMETABLE";
   $("dash-clock-countdown").textContent=model.countdown;
   $("dash-clock-caption").textContent=active?
     (model.current?"Ends":"Starts")+" "+new Intl.DateTimeFormat("en-PH",{
       timeZone:"Asia/Manila",weekday:"short",hour:"numeric",minute:"2-digit"}).format(
         new Date(model.current?active.endMs:active.startMs)):
     "Your Admin can publish weekly sessions in Schedule & Members.";
   $("dash-clock-link").href="class-clock.html?class="+encodeURIComponent(classId);
 }
 async function refresh(){
   const picker=$("dash-class"),id=picker?.value||"";
   if(!id||picker.disabled||!db())return;
   const run=++generation;classId=id;
   $("dash-clock-preview").hidden=false;
   try{
     const {data:auth,error}=await db().auth.getUser();
     if(error||!auth?.user)return;
     const memberships=await query(db().from("ClassMembership")
       .select("class_id").eq("class_id",id).eq("status","ACTIVE"));
     if(!memberships.length)throw Error("Classroom membership is not ACTIVE.");
     const [a,b,c]=await Promise.all([
       query(db().from("ScheduleSlot").select("*").eq("class_id",id)),
       query(db().from("ScheduleException").select("*").eq("class_id",id)),
       query(db().from("Subject").select("id,name").eq("class_id",id).is("deleted_at",null))
     ]);
     if(run!==generation)return;
     slots=a;exceptions=b;subjects=c;update();
   }catch(_){
     if(run===generation){
       $("dash-clock-title").textContent="Clock currently unavailable";
       $("dash-clock-caption").textContent="Open Class Clock to retry.";
       $("dash-clock-countdown").textContent="--:--:--";
       $("dash-clock-link").href="class-clock.html";
     }
   }
 }
 document.addEventListener("DOMContentLoaded",()=>{
   const picker=$("dash-class");
   if(!picker||!w.BNClassClock)return;
   picker.addEventListener("change",()=>{void refresh()});
   const observer=w.MutationObserver?new w.MutationObserver(()=>{if(picker.value!==classId)void refresh()}):null;
   observer?.observe(picker,{attributes:true,attributeFilter:["disabled"],childList:true});
   const ready=w.setInterval(()=>{
     if(picker.value&&picker.value!==classId)void refresh();
     update();
   },1000);
   w.addEventListener?.("beforeunload",()=>{w.clearInterval(ready);observer?.disconnect()});
   void refresh();
 });
})(window);
