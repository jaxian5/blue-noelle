/* Blue Noelle class operations API. Only authenticated, class-scoped data.
 * Schedule writes are Admin-only via PostgreSQL RLS and audited triggers.
 * Member approvals use the existing guarded review RPC (not role editing).
 */
(function(w){
 "use strict";
 const client=()=>w.BNBackend?.client;
 async function session(){
   const db=client();
   if(!w.BNBackend?.configured||!db)throw Error("Supabase is unavailable. Check your connection.");
   const {data,error}=await db.auth.getUser();
   if(error||!data?.user)throw Error("Your session has expired. Sign in again.");
   return db;
 }
 async function query(run){
   const db=await session();
   const {data,error}=await run(db);
   if(error)throw error;
   return data;
 }
 function id(value){if(!value)throw Error("Choose a valid classroom.");return value}
 async function deleted(table,rowId,classId){
   const rows=await query(db=>db.from(table).delete().eq("id",rowId)
     .eq("class_id",id(classId)).select("id"));
   if(!Array.isArray(rows)||rows.length!==1){
     throw Error("Nothing was deleted. Refresh the classroom and check your Admin permissions.");
   }
   return rows[0];
 }
 w.BNClassOps=Object.freeze({
   ready:()=>Boolean(w.BNBackend?.configured&&client()),
   memberships:()=>query(db=>db.from("ClassMembership")
     .select("class_id,role,status").eq("status","ACTIVE")),
   classes:(ids)=>query(db=>db.from("Class").select("id,name,section").in("id",ids)),
   directory:(classId)=>query(db=>db.rpc("bn_class_directory",{p_class:id(classId)})),
   review:(membershipId,approve)=>query(db=>db.rpc("bn_review_registration",
     {p_membership:membershipId,p_approve:Boolean(approve)})),
   updateMember:(membershipId,role,status)=>query(db=>db.rpc("bn_update_member",
     {p_membership:membershipId,p_role:role,p_status:status})),
   subjects:(classId)=>query(db=>db.from("Subject").select("id,name").eq("class_id",id(classId)).is("deleted_at",null)),
   slots:(classId)=>query(db=>db.from("ScheduleSlot").select("*").eq("class_id",id(classId))
     .order("day_of_week").order("start_local")),
   exceptions:(classId)=>query(db=>db.from("ScheduleException").select("*")
     .eq("class_id",id(classId)).order("exception_date")),
   createSlot:(row)=>query(db=>db.from("ScheduleSlot").insert(row).select().single()),
   deleteSlot:(rowId,classId)=>deleted("ScheduleSlot",rowId,classId),
   createException:(row)=>query(db=>db.from("ScheduleException").insert(row).select().single()),
   deleteException:(rowId,classId)=>deleted("ScheduleException",rowId,classId)
 });
})(window);
