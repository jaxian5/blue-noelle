/* Blue Noelle Phase 1 live registration adapter.
 * Supabase Auth owns credentials, PostgreSQL RPCs own membership decisions.
 * Never rely on the old localStorage demo session for authorization.
 */
(function(w){
 const client=()=>{const db=w.BNBackend?.client;if(!db)throw Error("Supabase browser configuration unavailable");return db;};
 async function checked(run){
   const db=client();
   const {data:profile,error:authError}=await db.auth.getUser();
   if(authError||!profile.user)throw Error("Sign in to Supabase Auth before continuing.");
   const {data,error}=await run(db);if(error)throw error;return data;
 }
 w.BNLivePhase1=Object.freeze({
   ready:()=>Boolean(w.BNBackend?.configured),
   async signUp(email,password,fullName){
     if(fullName.trim().length<2 || fullName.trim().length>120)throw Error("Full name must contain 2–120 characters.");
     if(password.length<8)throw Error("Password must contain at least eight characters.");
     const {data,error}=await client().auth.signUp({email:email.trim(),password,options:{data:{full_name:fullName.trim()}}});
     if(error)throw error;return data;
   },
   async signIn(email,password){
     const {data,error}=await client().auth.signInWithPassword({email:email.trim(),password});
     if(error)throw error;return data;
   },
   async signOut(){
     const {error}=await client().auth.signOut();if(error)throw error;
   },
   user:async()=>{const {data,error}=await client().auth.getUser();if(error)throw error;return data.user;},
   memberships:()=>checked(db=>db.from("ClassMembership").select("id,class_id,role,status,joined_at").order("created_at",{ascending:false})),
   join:(code,username,studentId)=>checked(db=>db.rpc("bn_join_class",{p_code:code.trim(),p_username:username.trim(),p_student_id:studentId.trim()||null})),
   pending:(classId)=>checked(db=>db.rpc("bn_pending_class_registrations",{p_class:classId})),
   review:(membershipId,approve)=>checked(db=>db.rpc("bn_review_registration",{p_membership:membershipId,p_approve:approve})),
   issue:(classId,maxUses,expiresAt)=>checked(db=>db.rpc("bn_issue_class_invite",{p_class:classId,p_max_uses:maxUses,p_expires_at:expiresAt}))
 });
})(window);
