/* Blue Noelle admin operations. Requires a real Supabase Auth session.
 * No demo account can mutate backend data.
 */
(function (w) {
 const backend = () => w.BNBackend?.client;
 async function query(run) {
   const db=backend(); if (!db) throw Error('Connect Supabase in order to use class management.');
   const {data:{user},error:authError}=await db.auth.getUser();
   if(authError||!user) throw Error('Sign in with Supabase Auth first. Demo login is not a backend session.');
   const {data,error}=await run(db); if(error) throw error; return data;
 }
 w.BNClassOps=Object.freeze({
   ready:()=>Boolean(backend()),
   memberships:()=>query(db=>db.from('ClassMembership').select('class_id,role,status').eq('status','ACTIVE')),
   directory:(classId)=>query(db=>db.rpc('bn_class_directory',{p_class:classId})),
   updateMember:(membershipId,role,status)=>query(db=>db.rpc('bn_update_member',{p_membership:membershipId,p_role:role,p_status:status})),
   slots:(classId)=>query(db=>db.from('ScheduleSlot').select('*').eq('class_id',classId).order('day_of_week').order('start_local')),
   exceptions:(classId)=>query(db=>db.from('ScheduleException').select('*').eq('class_id',classId).order('exception_date')),
   createSlot:(row)=>query(db=>db.from('ScheduleSlot').insert(row).select().single()),
   deleteSlot:(id)=>query(db=>db.from('ScheduleSlot').delete().eq('id',id).select('id')),
   createException:(row)=>query(db=>db.from('ScheduleException').insert(row).select().single()),
   deleteException:(id)=>query(db=>db.from('ScheduleException').delete().eq('id',id).select('id'))
 });
})(window);
