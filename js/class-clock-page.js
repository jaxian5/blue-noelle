/* Blue Noelle Phase 4: authenticated Class Clock user interface.
 * Adapted from Class Clock v2.9 concept, never its separate database/auth.
 * Every query is RLS-restricted and further filtered by ACTIVE membership.
 */
(function(w){
 "use strict";
 const $=id=>document.getElementById(id);
 const db=()=>w.BNBackend?.client;
 const clock=()=>w.BNClassClock;
 const DAYS=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
 const REFRESH_MS=60000;
 let memberships=[],rooms=[],slotRows=[],exceptionRows=[],assignmentRows=[],subjectRows=[];
 let selectedClass=null,loop=null,lastFetch=0,epoch=0,notified=new Set();
 const notifyKey="bn-clock-browser-reminders-v1";
 let reminders=false;
 try{reminders=w.localStorage?.getItem(notifyKey)==="true"}catch(_){}
 function el(tag,text,cls){
   const x=document.createElement(tag);
   if(text!==undefined&&text!==null)x.textContent=String(text);
   if(cls)x.className=cls;
   return x;
 }
 function text(id,value){$(id).textContent=String(value)}
 function message(value,state="info"){text("clock-status",value);$("clock-status").dataset.state=state}
 async function query(result){const {data,error}=await result;if(error)throw error;return data||[]}
 function liveRow(item,now){
   const state=item.startMs<=now&&now<item.endMs?"live":item.startMs>now?"next":"past";
   const box=el("article",null,"clock-event");box.dataset.state=state;
   const left=el("div",null,"clock-event-left");
   left.append(el("span",state==="live"?"●":state==="next"?"◷":"✓","clock-event-icon"));
   const info=el("div");
   info.append(el("strong",item.subject_name||item.label||"Class"));
   info.append(el("small",clock().spanLabel(item)+(item.rescheduled?" · RESCHEDULED":item.special?" · SPECIAL":"")));
   left.append(info);box.append(left,el("span",state==="live"?"NOW":state==="next"?"NEXT":"DONE","clock-event-state"));
   return box;
 }
 function renderToday(model){
   const box=$("clock-today-list");box.replaceChildren();
   text("clock-today-badge",model.todayAgenda.events.length+" session"+(model.todayAgenda.events.length===1?"":"s"));
   if(!model.todayAgenda.events.length){
     box.append(el("p",model.todayAgenda.cancelled?"No classes today. "+(model.todayAgenda.reason||"Schedule exception applies."):"No classes scheduled today.","clock-muted"));
   }else for(const item of model.todayAgenda.events)box.append(liveRow(item,model.nowMs));
 }
 function renderWeek(model){
   const box=$("clock-week-list");box.replaceChildren();
   for(const day of model.week){
     const card=el("article",null,"clock-day"+(day.date===model.today?" today":""));
     card.append(el("strong",DAYS[day.weekday],"clock-day-title"));
     card.append(el("small",day.date.slice(5)));
     const list=el("div",null,"clock-day-events");
     if(day.cancelled)list.append(el("span","NO CLASSES · "+(day.reason||"Cancelled"),"clock-day-notice"));
     else if(!day.events.length)list.append(el("span","No classes","clock-day-empty"));
     else for(const item of day.events){
       const row=el("div",null,"clock-day-event");
       row.append(el("strong",item.subject_name||item.label));
       row.append(el("small",clock().spanLabel(item)+(item.rescheduled?" · Moved":"")));
       list.append(row);
     }
     card.append(list);box.append(card);
   }
 }
 function renderTasks(model){
   const box=$("clock-task-list");box.replaceChildren();
   if(!model.soonestTask){
     text("clock-task-countdown","--:--:--");
     text("clock-task-name","No upcoming open deadlines");
   }else{
     text("clock-task-countdown",model.taskCountdown);
     text("clock-task-name",model.soonestTask.name||"Assignment");
   }
   const items=assignmentRows.filter(a=>a.status==="OPEN"&&a.deadline&&Date.parse(a.deadline)>=model.nowMs)
     .sort((a,b)=>Date.parse(a.deadline)-Date.parse(b.deadline)).slice(0,5);
   if(!items.length)box.append(el("p","No upcoming open classwork. You're caught up.","clock-muted"));
   for(const task of items){
     const row=el("div",null,"clock-task"),link=el("a",task.name||"Assignment");
     link.href="submission.html?assignment="+encodeURIComponent(task.id);
     const due=el("time",new Intl.DateTimeFormat("en-PH",
       {timeZone:"Asia/Manila",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}).format(new Date(task.deadline)));
     row.append(link,due);box.append(row);
   }
 }
 function renderTick(){
   if(!selectedClass||!clock())return;
   const now=Date.now();
   const model=clock().evaluate({slots:slotRows,exceptions:exceptionRows,
     subjects:subjectRows,assignments:assignmentRows,now});
   const datetime=new Date(now);
   text("clock-now",new Intl.DateTimeFormat("en-PH",{timeZone:"Asia/Manila",hour:"2-digit",
     minute:"2-digit",second:"2-digit",hour12:true}).format(datetime));
   text("clock-date",new Intl.DateTimeFormat("en-PH",
     {timeZone:"Asia/Manila",weekday:"long",month:"short",day:"numeric",year:"numeric"}).format(datetime));
   const current=model.current,next=model.next;
   $("clock-hero").dataset.state=model.state;
   text("clock-state",model.state==="IN_CLASS"?"CLASS IN SESSION":
     model.state==="UPCOMING"?"UP NEXT":"NO CLASS SCHEDULED");
   text("clock-event",current?(current.subject_name||current.label):
     next?(next.subject_name||next.label):"No scheduled classes");
   text("clock-summary",current?"Currently in progress · "+clock().spanLabel(current):
     next?"Your next class starts "+new Intl.DateTimeFormat("en-PH",
       {timeZone:"Asia/Manila",weekday:"long",month:"short",day:"numeric"}).format(new Date(next.startMs)):
       "Your Admin hasn't published a future class session.");
   text("clock-label",current?"TIME UNTIL CLASS ENDS":next?"TIME UNTIL NEXT CLASS":"NO UPCOMING SESSION");
   text("clock-countdown",model.countdown);
   text("clock-next-name",next?(next.subject_name||next.label):"No upcoming classes");
   text("clock-next-time",next?clock().spanLabel(next)+" · "+new Intl.DateTimeFormat("en-PH",
     {timeZone:"Asia/Manila",weekday:"short",month:"short",day:"numeric"}).format(new Date(next.startMs)):"—");
   text("clock-previous",model.previous?(model.previous.subject_name||model.previous.label):"None today");
   renderToday(model);renderWeek(model);renderTasks(model);
   reminderCheck(model);
 }
 function reminderCheck(model){
   if(!reminders||!w.Notification||w.Notification.permission!=="granted")return;
   const now=model.nowMs;
   const events=model.agenda.slice(0,2).flatMap(x=>x.events);
   for(const item of events){
     for(const [offset,label] of [[10,"10 minutes"],[5,"5 minutes"],[0,"starting now"]]){
       const diff=item.startMs-now;
       if(diff<=offset*60000&&diff>offset*60000-REFRESH_MS){
         const key=item.date+":"+item.id+":"+offset;
         if(notified.has(key))continue;
         notified.add(key);
         try{new w.Notification("Blue Noelle Class Clock",{
           body:(item.subject_name||item.label)+" · "+(offset===0?label:"starts in "+label),
           tag:"bn-class-clock-"+key});
         }catch(_){}
       }
     }
   }
   if(notified.size>100)notified.clear();
 }
 function beginLoop(){
   if(loop)w.clearInterval(loop);
   loop=w.setInterval(()=>{
     try{renderTick()}catch(e){message("Clock calculation error: "+(e.message||e),"error")}
     if(Date.now()-lastFetch>5*REFRESH_MS)void fetchData(false);
   },1000);
 }
 async function fetchData(showMessage=true){
   if(!selectedClass)return;
   const mine=++epoch,id=selectedClass;
   if(showMessage)message("Refreshing the timetable…");
   try{
     // A single subject query establishes classroom-scoped assignment IDs.
     // Avoid repeated nested network requests and invalid .in([]) queries.
     const [slots,exceptions,subjects]=await Promise.all([
       query(db().from("ScheduleSlot").select("*").eq("class_id",id)
         .order("day_of_week").order("start_local")),
       query(db().from("ScheduleException").select("*").eq("class_id",id)
         .order("exception_date")),
       query(db().from("Subject").select("id,name").eq("class_id",id)
         .is("deleted_at",null))
     ]);
     const subjectIds=subjects.map(subject=>subject.id);
     const assignments=subjectIds.length?await query(db().from("Assignment")
       .select("id,name,deadline,status,subject_id")
       .in("subject_id",subjectIds).eq("status","OPEN")):[];
     if(mine!==epoch)return;
     [slotRows,exceptionRows,subjectRows,assignmentRows]=[slots,exceptions,subjects,assignments];
     lastFetch=Date.now();
     $("clock-content").hidden=false;
     renderTick();
     message("Live class clock ready · Manila time · "+slotRows.length+" weekly slot"+(slotRows.length===1?"":"s"),"success");
   }catch(e){
     if(mine!==epoch)return;
     message("Unable to refresh this classroom: "+(e.message||e)+". Older results, if any, remain visible.","error");
   }
 }
 async function load(){
   if(!w.BNBackend?.configured||!db()){message("Supabase is unavailable.","error");return}
   if(!clock()){message("Class Clock engine failed to initialize.","error");return}
   try{
     const {data:auth,error}=await db().auth.getUser();
     if(error||!auth?.user){w.location.replace("login.html");return}
     memberships=await query(db().from("ClassMembership")
       .select("class_id,role,status").eq("status","ACTIVE"));
     if(!memberships.length){
       message("You need an approved classroom before using the Class Clock.","error");return}
     const unique=[...new Set(memberships.map(m=>m.class_id))];
     rooms=await query(db().from("Class").select("id,name,section").in("id",unique));
     const picker=$("clock-class");
     picker.replaceChildren();
     for(const room of rooms){
       const option=el("option",room.name+(room.section?" · "+room.section:""));
       option.value=room.id;picker.append(option);
     }
     if(!rooms.length)throw Error("No approved classroom could be loaded.");
     const params=new URLSearchParams(w.location.search);
     const requested=params.get("class");
     selectedClass=rooms.find(r=>r.id===requested)?.id||rooms[0].id;
     picker.value=selectedClass;picker.disabled=false;
     picker.addEventListener("change",()=>{
       selectedClass=picker.value;slotRows=[];exceptionRows=[];assignmentRows=[];subjectRows=[];
       $("clock-content").hidden=true;
       const role=memberships.find(m=>m.class_id===selectedClass)?.role;
       w.BNTheme?.setRole(role||"Student");
       $("clock-admin-link").hidden=role!=="Admin";
       void fetchData();
     });
     $("clock-reload").addEventListener("click",()=>fetchData());
     const role=memberships.find(m=>m.class_id===selectedClass)?.role;
     w.BNTheme?.setRole(role||"Student");
     $("clock-admin-link").hidden=role!=="Admin";
     $("clock-notifications").addEventListener("click",async()=>{
       if(reminders){reminders=false}else if(!w.Notification){
         message("Browser notifications are unavailable here.","error");return
       }else{
         const permission=await w.Notification.requestPermission();
         if(permission!=="granted"){message("Browser notifications were not allowed.","error");return}
         reminders=true;
       }
       try{w.localStorage?.setItem(notifyKey,String(reminders))}catch(_){}
       $("clock-notifications").textContent=reminders?"🔔 Class reminders on":"🔕 Class reminders off";
       $("clock-notifications").setAttribute("aria-pressed",String(reminders));
     });
     $("clock-notifications").textContent=reminders?"🔔 Class reminders on":"🔕 Class reminders off";
     $("clock-notifications").setAttribute("aria-pressed",String(reminders));
     await fetchData();
     beginLoop();
     document.addEventListener("visibilitychange",()=>{if(!document.hidden)void fetchData(false)});
     w.addEventListener?.("beforeunload",()=>{if(loop)w.clearInterval(loop)});
   }catch(e){message("Unable to open Class Clock: "+(e.message||e),"error")}
 }
 document.addEventListener("DOMContentLoaded",()=>{void load()});
})(window);
