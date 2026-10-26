/* Phase 4 schedule engine adapted from jaxian5/class-clock (Class Clock v2.9).
 * Keeps its NOW / NEXT / TODAY / WEEKLY + task countdown concepts but uses
 * Blue Noelle's authenticated class-scoped schedule and assignments.
 * Pure calculations: no Supabase keys, DOM, localStorage, or browser timezone.
 *
 * Modern Asia/Manila is UTC+08:00 with no DST. For date arithmetic, use Intl
 * to locate 'today' in Manila, then explicitly construct instants at UTC+8.
 * This implementation only supports academic dates in 2000..2100.
 */
(function(root,factory){
 const core=factory();
 if(typeof module==="object"&&module.exports)module.exports=core;
 if(root)root.BNClassClock=core;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
 "use strict";
 const PH="Asia/Manila",OFFSET=8*60*60*1000,DAY=86400000;
 const WEEK=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
 const stampFormatter=new Intl.DateTimeFormat("en-GB",{timeZone:PH,year:"numeric",month:"2-digit",day:"2-digit",
   hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"});
 function dateKey(instant){
   const fields=Object.fromEntries(stampFormatter.formatToParts(new Date(instant))
     .filter(x=>x.type!=="literal").map(x=>[x.type,x.value]));
   return fields.year+"-"+fields.month+"-"+fields.day;
 }
 function checkedDate(day){
   if(!/^20\d{2}-\d{2}-\d{2}$/.test(String(day)))throw Error("Invalid academic date");
   const [y,m,d]=day.split("-").map(Number);
   const dayMs=Date.UTC(y,m-1,d);
   if(new Date(dayMs).toISOString().slice(0,10)!==day)throw Error("Invalid calendar day");
   return dayMs;
 }
 function addDays(day,amount){return new Date(checkedDate(day)+amount*DAY).toISOString().slice(0,10)}
 function weekday(day){return new Date(checkedDate(day)).getUTCDay()}
 function minutes(time){
   const x=String(time||"").match(/^(\d\d):(\d\d)(?::\d\d(?:\.\d+)?)?$/);
   if(!x||Number(x[1])>23||Number(x[2])>59)throw Error("Invalid class time: "+time);
   return Number(x[1])*60+Number(x[2]);
 }
 function at(day,time){return checkedDate(day)+minutes(time)*60000-OFFSET}
 function timeLabel(time){
   const m=minutes(time),h=Math.floor(m/60);
   return String((h%12)||12)+":"+String(m%60).padStart(2,"0")+" "+(h<12?"AM":"PM");
 }
 function spanLabel(occ){return timeLabel(occ.start_local)+" – "+timeLabel(occ.end_local)}
 function countdown(ms){
   if(!Number.isFinite(ms)||ms<0)return "00:00:00";
   const total=Math.floor(ms/1000);
   const hours=Math.floor(total/3600);
   return String(hours).padStart(2,"0")+":"+
     String(Math.floor(total%3600/60)).padStart(2,"0")+":"+
     String(total%60).padStart(2,"0");
 }
 function sameSlot(e,id){return e.schedule_slot_id&&e.schedule_slot_id===id}
 function makeOccurrence(slot,day,changes={}){
   const start=changes.start_local||slot.start_local,end=changes.end_local||slot.end_local;
   if(minutes(end)<=minutes(start))throw Error("Invalid class time range for "+slot.label);
   return {...slot,...changes,date:day,start_local:start,end_local:end,
     startMs:at(day,start),endMs:at(day,end)};
 }
 function dayEvents(day,slots,exceptions,subjectById={}){
   const warnings=[],dayOfWeek=weekday(day);
   const base=slots.filter(s=>Number(s.day_of_week)===dayOfWeek);
   const edits=exceptions.filter(e=>e.exception_date===day);
   const globalHoliday=edits.find(e=>e.kind==="holiday"&&!e.schedule_slot_id);
   const globalCancel=edits.find(e=>e.kind==="cancelled"&&!e.schedule_slot_id);
   const cancelled=Boolean(globalHoliday||globalCancel);
   const notes=edits.filter(e=>e.kind==="special"&&!e.replacement_start_local)
     .map(e=>e.note||"Special day").filter(Boolean);
   const result=[];
   if(!cancelled)for(const slot of base){
     const per=edits.filter(e=>sameSlot(e,slot.id));
     if(per.some(e=>e.kind==="holiday"||e.kind==="cancelled"))continue;
     let shift=per.find(e=>e.kind==="rescheduled");
     if(!shift){
       const legacy=edits.filter(e=>e.kind==="rescheduled"&&!e.schedule_slot_id);
       if(legacy.length===1&&base.length===1)shift=legacy[0];
       else if(legacy.length)warnings.push("A legacy reschedule needs a specific class before it can be applied.");
     }
     const updated={};
     if(shift&&shift.replacement_start_local&&shift.replacement_end_local){
       updated.start_local=shift.replacement_start_local;
       updated.end_local=shift.replacement_end_local;
       updated.rescheduled=true;
       updated.note=shift.note;
     }
     updated.subject_name=(slot.subject_id&&subjectById[slot.subject_id])||slot.label;
     result.push(makeOccurrence(slot,day,updated));
   }
   // Standalone special events have explicit replacement times and are not
   // falsely treated as recurring subjects. Without times, they are notes only.
   if(!cancelled)for(const exception of edits.filter(e=>e.kind==="special")){
     if(exception.schedule_slot_id)continue;
     if(exception.replacement_start_local&&exception.replacement_end_local){
       result.push(makeOccurrence({
         id:"special:"+exception.id,label:exception.note||"Special session",
         day_of_week:dayOfWeek,subject_id:null
       },day,{start_local:exception.replacement_start_local,
         end_local:exception.replacement_end_local,
         subject_name:exception.note||"Special session",special:true}));
     }
   }
   result.sort((a,b)=>a.startMs-b.startMs||a.endMs-b.endMs||String(a.id).localeCompare(String(b.id)));
   // Flag conflicting one-day overrides without quietly choosing a winner.
   for(let i=1;i<result.length;i++){
     if(result[i].startMs<result[i-1].endMs){
       warnings.push("Two adjusted classes overlap on "+day+". Ask the Admin to correct the exception.");
     }
   }
   return {date:day,weekday:dayOfWeek,label:WEEK[dayOfWeek],events:result,cancelled,notes,
     reason:(globalHoliday||globalCancel)?.note||null,
     warnings:[...new Set(warnings)]};
 }
 function evaluate({slots=[],exceptions=[],subjects=[],assignments=[],now=Date.now(),days=14}={}){
   if(!Number.isFinite(Number(now)))throw Error("Invalid current time");
   const currentMs=Number(now),today=dateKey(currentMs),numDays=Math.max(1,Math.min(Number(days)||14,35));
   const bySubject=Object.fromEntries(subjects.map(s=>[s.id,s.name]));
   const agenda=Array.from({length:numDays},(_,n)=>
     dayEvents(addDays(today,n),slots,exceptions,bySubject));
   const events=agenda.flatMap(d=>d.events);
   const current=events.find(event=>event.startMs<=currentMs&&event.endMs>currentMs)||null;
   const next=events.find(event=>event.startMs>currentMs)||null;
   const todayAgenda=agenda[0];
   const previous=[...todayAgenda.events].reverse().find(e=>e.endMs<=currentMs)||null;
   const target=current?current.endMs:next?next.startMs:null;
   const state=current?"IN_CLASS":next?"UPCOMING":"NO_CLASSES";
   const deadlineItems=assignments.filter(a=>
     a.status==="OPEN"&&a.deadline&&Number.isFinite(Date.parse(a.deadline)))
     .map(a=>({...a,dueMs:Date.parse(a.deadline)}))
     .sort((a,b)=>a.dueMs-b.dueMs);
   const nextDeadline=deadlineItems.find(a=>a.dueMs>=currentMs)||null;
   return {today,nowMs:currentMs,state,current,next,previous,
     countdownMs:target===null?null:Math.max(0,target-currentMs),
     countdown:target===null?"--:--:--":countdown(target-currentMs),
     agenda,week:agenda.slice(0,7),todayAgenda,soonestTask:nextDeadline,
     taskCountdown:nextDeadline?countdown(nextDeadline.dueMs-currentMs):null,
     overdueTasks:deadlineItems.filter(a=>a.dueMs<currentMs),
     warnings:[...new Set(agenda.flatMap(x=>x.warnings))]};
 }
 return Object.freeze({PH,WEEK,dateKey,addDays,weekday,minutes,at,timeLabel,spanLabel,
   countdown,dayEvents,evaluate});
});
