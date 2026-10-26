/* Post-login profile and security settings.
 * Supabase Auth owns credentials, public.User has self-only full_name UPDATE,
 * and private bn-avatars storage permits only <auth.uid()>/avatar.
 * NO classroom role edits, password resets by email, or service-role keys.
 */
(function(w){
 "use strict";
 const $=id=>document.getElementById(id);
 const db=()=>w.BNBackend?.client;
 const BUCKET="bn-avatars",MAX_BYTES=2*1024*1024;
 const TYPES=new Set(["image/png","image/jpeg","image/webp"]);
 let user=null,profile=null,avatarUrl=null;
 function message(content,state="info"){
   const box=$("account-status");
   box.hidden=false;box.textContent=content;box.dataset.state=state;
 }
 function initials(name){
   return (String(name||"").trim().split(/\s+/).filter(Boolean).slice(0,2)
     .map(part=>part[0]).join("")||"BN").toUpperCase();
 }
 function setAvatar(blob){
   if(avatarUrl){URL.revokeObjectURL(avatarUrl);avatarUrl=null}
   const ids=["profile-avatar-image","photo-preview-image"];
   for(const id of ids){$(id).hidden=!blob;if(!blob)$(id).removeAttribute("src")}
   $("profile-avatar-fallback").hidden=Boolean(blob);
   $("photo-preview-fallback").hidden=Boolean(blob);
   if(blob){
     avatarUrl=URL.createObjectURL(blob);
     for(const id of ids)$(id).src=avatarUrl;
   }
 }
 function applyName(name){
   $("profile-display-name").textContent=name;
   $("profile-full-name").value=name;
   const short=initials(name);
   $("profile-avatar-fallback").textContent=short;
   $("photo-preview-fallback").textContent=short;
 }
 function lock(button,locked){button.disabled=Boolean(locked)}
 async function query(request){const {data,error}=await request;if(error)throw error;return data}
 async function loadAvatar(){
   if(!user)return;
   const {data,error}=await db().storage.from(BUCKET).download(user.id+"/avatar");
   if(error){setAvatar(null);return}
   setAvatar(data);
 }
 function renderOnboarding(list){
   const active=list.some(m=>m.status==="ACTIVE");
   $("settings-workspace").hidden=!active;
   $("account-onboarding").hidden=active;
   if(active)return;
   const admin=profile.account_type==="Admin";
   $("account-onboarding-message").textContent=admin
     ?"Your Admin account is verified, but no classroom is ACTIVE yet. Create your one classroom to open the management workspace."
     :"Classwork is available after you redeem a private invitation and an Admin or Moderator approves your membership.";
   const box=$("memberships");box.replaceChildren();
   for(const m of list){
     const card=document.createElement("article");
     const heading=document.createElement("strong");
     heading.textContent=m.role+" · "+m.status;
     const line=document.createElement("span");
     line.textContent=m.status==="PENDING"?"Awaiting class officer approval"
       :m.status==="REJECTED"?"Request declined. Ask your class officer for guidance."
       :"Classroom access: "+m.status.toLowerCase();
     card.append(heading,line);box.append(card);
   }
   $("member-count").textContent=list.length
     ?list.length+" membership request"+(list.length===1?"":"s")
     :"No classroom membership yet.";
   $("join-action").textContent=admin?"Create your classroom ↗":"Redeem an invitation ↗";
 }
 async function boot(){
   if(!w.BNBackend?.configured||!db()){message("Supabase is unavailable. Check your connection.","error");return}
   try{
     const {data:auth,error}=await db().auth.getUser();
     if(error||!auth?.user){w.location.replace("login.html");return}
     user=auth.user;
     profile=await query(db().from("User")
       .select("id,full_name,account_type,is_developer").eq("id",user.id).single());
     if(!profile)throw Error("Your account profile is unavailable.");
     const list=await query(db().from("ClassMembership")
       .select("class_id,role,status").eq("user_id",user.id));
     const active=list.filter(m=>m.status==="ACTIVE");
     if(document.documentElement)document.documentElement.dataset.developer=profile.is_developer===true?"true":"false";
     const chosen=profile.is_developer?"Developer":
       (active.some(m=>m.role==="Admin")?"Admin":active.some(m=>m.role==="Moderator")?"Moderator":"Student");
     w.BNTheme?.setRole(chosen,{isDeveloper:profile.is_developer===true});
     $("account-email").textContent=user.email||"Your verified account";
     $("profile-email").value=user.email||"";
     applyName(profile.full_name||"Blue Noelle member");
     $("account-type").textContent=active.length
       ?chosen
        +" · "+active.length+" approved classroom"+(active.length===1?"":"s")
       :(profile.account_type==="Admin"?"Admin":"Student")+" · Enrollment required";
     renderOnboarding(list);
     if(active.length){
       await loadAvatar();
       message("Your profile is ready. Changes to your password and photo are handled securely.","success");
     }else{
       message("Your account is signed in. Complete classroom enrollment to unlock your workspace.","info");
     }
   }catch(e){message("Could not load your account: "+(e?.message||"Unknown error"),"error")}
 }
 function install(){
   $("profile-name-form").addEventListener("submit",async event=>{
     event.preventDefault();if(!user||!profile)return;
     const fullName=$("profile-full-name").value.trim();
     if(fullName.length<2||fullName.length>120){
       message("Display name must be 2 to 120 characters.","error");return;
     }
     const button=$("profile-save");lock(button,true);
     try{
       const updated=await query(db().from("User").update({full_name:fullName})
         .eq("id",user.id).select("full_name").single());
       if(!updated?.full_name)throw Error("The profile update was not saved.");
       profile.full_name=updated.full_name;applyName(updated.full_name);
       message("Your display name has been saved.","success");
     }catch(e){message("Unable to update name: "+(e?.message||"Please retry."),"error")}
     finally{lock(button,false)}
   });
   $("profile-password-form").addEventListener("submit",async event=>{
     event.preventDefault();if(!user)return;
     const current=$("profile-current-password").value;
     const next=$("profile-new-password").value;
     const again=$("profile-confirm-password").value;
     if(!current||next.length<8||next!==again||current===next){
       message("Enter your current password and a different new password of at least eight matching characters.","error");
       return;
     }
     const button=$("profile-password-save");lock(button,true);
     try{
       // Reauthenticate through Supabase, never compare or store password client-side.
       const {error:reauthError}=await db().auth.signInWithPassword({
         email:user.email,password:current
       });
       if(reauthError)throw Error("Current password could not be confirmed.");
       const {error:updateError}=await db().auth.updateUser({password:next});
       if(updateError)throw updateError;
       $("profile-password-form").reset();
       // Clear credential fields explicitly even in environments without native form reset.
       for(const id of ["profile-current-password","profile-new-password","profile-confirm-password"])$(id).value="";
       message("Password updated successfully. Use your new password next time you sign in.","success");
     }catch(e){
       $("profile-current-password").value="";
       $("profile-new-password").value="";
       $("profile-confirm-password").value="";
       message("Password not updated: "+(e?.message||"Please retry."),"error");
     }finally{lock(button,false)}
   });
   $("profile-photo-form").addEventListener("submit",async event=>{
     event.preventDefault();if(!user)return;
     const file=$("profile-photo-file").files?.[0];
     if(!file||!TYPES.has(file.type)||file.size<1||file.size>MAX_BYTES){
       message("Choose a valid JPG, PNG, or WebP image smaller than 2 MiB.","error");return;
     }
     const button=$("profile-photo-save");lock(button,true);
     try{
       const {error}=await db().storage.from(BUCKET).upload(
         user.id+"/avatar",file,{upsert:true,contentType:file.type,cacheControl:"0"});
       if(error)throw error;
       // Download the saved object; the bucket is private, not a public avatar URL.
       await loadAvatar();
       $("profile-photo-form").reset();
       message("Profile photo saved privately.","success");
     }catch(e){message("Unable to save photo: "+(e?.message||"Please retry."),"error")}
     finally{lock(button,false)}
   });
   $("profile-photo-remove").addEventListener("click",async()=>{
     if(!user)return;
     const button=$("profile-photo-remove");lock(button,true);
     try{
       const {error}=await db().storage.from(BUCKET).remove([user.id+"/avatar"]);
       if(error)throw error;
       setAvatar(null);
       message("Profile photo removed.","success");
     }catch(e){message("Could not remove photo: "+(e?.message||"Please retry."),"error")}
     finally{lock(button,false)}
   });
   $("refresh-account").addEventListener("click",()=>w.location.reload());
   $("signout").addEventListener("click",async()=>{
     const button=$("signout");lock(button,true);
     try{
       const {error}=await db().auth.signOut();
       if(error)throw error;
       setAvatar(null);
       w.location.replace("login.html");
     }catch(e){message("Unable to sign out: "+(e?.message||"Unknown error"),"error");lock(button,false)}
   });
   w.addEventListener?.("beforeunload",()=>{if(avatarUrl)URL.revokeObjectURL(avatarUrl)});
 }
 document.addEventListener("DOMContentLoaded",()=>{install();return boot()});
})(window);
