import {test} from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";
const require=createRequire(import.meta.url);
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const C=require(resolve(root,"js/class-clock-core.js"));
const when=(date,time)=>Date.parse(date+"T"+time+"+08:00");
const slot=(id,day,start,end,label="Programming",extra={})=>
 ({id,day_of_week:day,start_local:start,end_local:end,label,...extra});
const one=slot("slot-a",1,"09:00","10:30");
const another=slot("slot-b",1,"11:00","13:00","Networks");
const resched=(day,slotId,start="14:00",end="16:00")=>({
 id:"exception-r",exception_date:day,kind:"rescheduled",
 schedule_slot_id:slotId,replacement_start_local:start,replacement_end_local:end,
 note:"Moved to afternoon"
});
test("Class Clock v2 NOW / NEXT / TODAY states use Manila independent of OS timezone",()=>{
 const early=C.evaluate({now:when("2026-10-26","08:59:59"),slots:[one,another]});
 assert.equal(early.today,"2026-10-26");
 assert.equal(early.state,"UPCOMING");
 assert.equal(early.next.id,"slot-a");
 assert.equal(early.countdown,"00:00:01");
 const now=C.evaluate({now:when("2026-10-26","09:00:00"),slots:[one,another]});
 assert.equal(now.state,"IN_CLASS");assert.equal(now.current.id,"slot-a");
 assert.equal(now.countdown,"01:30:00");
 const finished=C.evaluate({now:when("2026-10-26","10:30:00"),slots:[one,another]});
 assert.equal(finished.current,null);
 assert.equal(finished.next.id,"slot-b");
 assert.equal(finished.previous.id,"slot-a");
 assert.equal(finished.countdown,"00:30:00");
});
test("Class Clock resolves next week's session after last event ends",()=>{
 const model=C.evaluate({now:when("2026-10-26","14:00:00"),slots:[one],days:14});
 assert.equal(model.state,"UPCOMING");
 assert.equal(model.next.date,"2026-11-02");
 assert.equal(model.todayAgenda.events.length,1);
});
test("Manila midnight transitions and browser timezone-independent dates",()=>{
 const a=C.evaluate({now:when("2026-10-25","23:59:59"),slots:[one]});
 assert.equal(a.today,"2026-10-25");assert.equal(a.next.date,"2026-10-26");
 const b=C.evaluate({now:when("2026-10-26","00:00:00"),slots:[one]});
 assert.equal(b.today,"2026-10-26");assert.equal(b.next.date,"2026-10-26");
 assert.equal(C.dateKey(when("2026-10-26","00:00:00")),"2026-10-26");
 assert.equal(C.weekday("2026-10-26"),1);
 assert.equal(C.addDays("2026-12-31",1),"2027-01-01");
});
test("Global holiday/cancellation removes just that day without mutating weekly templates",()=>{
 const ex=[{id:"holiday",kind:"holiday",exception_date:"2026-10-26",
  schedule_slot_id:null,note:"Public holiday"}];
 const m=C.evaluate({now:when("2026-10-26","07:00:00"),
  slots:[one],exceptions:ex});
 assert.equal(m.todayAgenda.cancelled,true);
 assert.equal(m.todayAgenda.events.length,0);
 assert.equal(m.next.date,"2026-11-02");
 assert.equal(m.todayAgenda.reason,"Public holiday");
 assert.equal(m.agenda[7].events[0].id,"slot-a");
});
test("Cancel one session but keep another on the same day",()=>{
 const m=C.evaluate({now:when("2026-10-26","08:00:00"),slots:[one,another],
  exceptions:[{id:"cancel-1",kind:"cancelled",exception_date:"2026-10-26",
   schedule_slot_id:"slot-a"}]});
 assert.deepEqual(m.todayAgenda.events.map(e=>e.id),["slot-b"]);
});
test("Targeted reschedule shifts only the selected session and reorders the day",()=>{
 const m=C.evaluate({now:when("2026-10-26","08:00:00"),slots:[one,another],
  exceptions:[resched("2026-10-26","slot-a")]});
 assert.deepEqual(m.todayAgenda.events.map(e=>e.id),["slot-b","slot-a"]);
 const moved=m.todayAgenda.events[1];
 assert.equal(moved.rescheduled,true);
 assert.equal(moved.startMs,when("2026-10-26","14:00:00"));
 assert.equal(moved.endMs,when("2026-10-26","16:00:00"));
 assert.equal(C.spanLabel(moved),"2:00 PM – 4:00 PM");
});
test("Legacy unscoped reschedules are never arbitrarily applied to multiple sessions",()=>{
 const ex=[{...resched("2026-10-26",null),schedule_slot_id:null}];
 const multi=C.evaluate({now:when("2026-10-26","07:00:00"),slots:[one,another],exceptions:ex});
 assert.deepEqual(multi.todayAgenda.events.map(e=>e.start_local),["09:00","11:00"]);
 assert.match(multi.warnings[0],/legacy reschedule/);
 const single=C.evaluate({now:when("2026-10-26","07:00:00"),slots:[one],exceptions:ex});
 assert.equal(single.todayAgenda.events[0].start_local,"14:00");
});
test("Standalone special session only appears on the specified date",()=>{
 const ex=[{id:"special-a",kind:"special",exception_date:"2026-10-27",
  replacement_start_local:"12:30",replacement_end_local:"13:30",note:"Orientation"}];
 const m=C.evaluate({now:when("2026-10-26","07:00:00"),slots:[],exceptions:ex});
 assert.equal(m.next.date,"2026-10-27");
 assert.equal(m.next.subject_name,"Orientation");
 assert.equal(m.agenda[1].events[0].special,true);
 assert.equal(m.agenda[8].events.length,0);
});
test("Deadline countdown uses live assignment data and exact timestamptz instants",()=>{
 const assignments=[
  {id:"old",name:"Old Task",deadline:"2026-10-26T04:00:00Z",status:"OPEN"},
  {id:"a",name:"Class Journal",deadline:"2026-10-30T14:00:00Z",status:"OPEN"},
  {id:"b",name:"Closed",deadline:"2026-10-27T00:00:00Z",status:"CLOSED"}
 ];
 const m=C.evaluate({now:when("2026-10-26","16:00:00"),assignments,slots:[]});
 assert.equal(m.soonestTask.id,"a");
 assert.equal(m.overdueTasks.length,1);
 assert.equal(m.taskCountdown,"102:00:00");
});
test("Time parser rejects malformed ranges and doesn't accept a 25th hour",()=>{
 assert.equal(C.minutes("00:30:00"),30);
 assert.throws(()=>C.minutes("25:00"),/Invalid class time/);
 assert.throws(()=>C.dayEvents("2026-02-30",[],[]),/Invalid calendar day/);
 assert.throws(()=>C.dayEvents("2026-10-26",[slot("invalid",1,"13:00","12:00")],[]),
   /Invalid class time range/);
});
test("Phase 4 is inspired by Class Clock but uses only Blue Noelle's client",()=>{
 const fs=require("node:fs");
 const code=fs.readFileSync(resolve(root,"js/class-clock-page.js"),"utf8");
 const page=fs.readFileSync(resolve(root,"pages/class-clock.html"),"utf8");
 assert.match(code,/BNBackend/);assert.match(code,/ClassMembership/);
 assert.match(code,/ScheduleSlot/);assert.match(code,/ScheduleException/);
 assert.match(code,/Assignment/);
 assert.doesNotMatch(code,/saxpyxzbiruwytllmoia|sb_publishable_|localStorage\.getItem\("classClock/);
 assert.match(page,/workspace-shell\.js/);
 assert.match(page,/class-clock-core\.js/);
 assert.match(page,/class-clock-page\.js/);
});

test("untimed special notes stay visible without becoming fake clock sessions",()=>{
 const ex=[{id:"notice",kind:"special",exception_date:"2026-10-26",
   note:"Room inspection",replacement_start_local:null,replacement_end_local:null}];
 const m=C.evaluate({now:when("2026-10-26","08:00:00"),slots:[one],exceptions:ex});
 assert.deepEqual(m.todayAgenda.notes,["Room inspection"]);
 assert.equal(m.todayAgenda.events.length,1);
});
test("adjusted daily overlaps produce an explicit warning, not an arbitrary next class",()=>{
 const m=C.evaluate({now:when("2026-10-26","07:00:00"),
   slots:[one,another],exceptions:[resched("2026-10-26","slot-a","11:30","12:00")]});
 assert.match(m.warnings.join(" "),/overlap/);
 assert.equal(m.todayAgenda.events.length,2);
});
test("Clock page and dashboard preview parse and have explicit authenticated boundaries",()=>{
 const fs=require("node:fs");const {Script}=require("node:vm");
 for(const path of ["js/class-clock-page.js","js/dashboard-clock.js"]){
   const content=fs.readFileSync(resolve(root,path),"utf8");
   assert.doesNotThrow(()=>new Script(content),path);
   assert.match(content,/getUser\(\)/,path);
   assert.match(content,/ClassMembership/,path);
   assert.doesNotMatch(content,/service_role|sb_secret_|from\("profiles"\)/,path);
 }
 const html=fs.readFileSync(resolve(root,"pages/dashboard.html"),"utf8");
 assert.match(html,/id="dash-clock-preview"/);
 assert.match(html,/dashboard-clock\.js/);
 assert.match(html,/href="class-clock\.html"/);
});
test("Calendar view has no permission to edit academic data or ask for notifications automatically",()=>{
 const fs=require("node:fs");
 const src=fs.readFileSync(resolve(root,"js/class-clock-page.js"),"utf8");
 assert.doesNotMatch(src,/\.insert\(|\.delete\(|\.upsert\(|\.update\(/);
 assert.match(src,/clock-notifications"\)\.addEventListener\("click"/);
 assert.match(src,/Notification\.requestPermission\(\)/);
 assert.match(src,/if\(!reminders/);
 assert.match(src,/\+\+epoch/);
});
