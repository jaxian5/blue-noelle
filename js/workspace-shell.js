/* Shared navigation for authenticated Blue Noelle pages.
 * Sidebar markup is rendered once from this source on every non-dashboard page.
 * Dashboard uses the matching styles and IDs; all privileged actions remain guarded
 * by Supabase RLS/RPCs, never by whether a link happens to be visible.
 */
(function(w){
 "use strict";
 const $=id=>document.getElementById(id);
 const activeName=()=>String(w.location?.pathname||"").split("/").pop()||"dashboard.html";
 const page=activeName();
 const accountPage=page==="account.html";
 const items=[
   {href:"dashboard.html",icon:"▦",label:"Overview"},
   {href:"class-clock.html",icon:"◷",label:"Class Clock"},
   {href:"classwork.html",icon:"▤",label:"Subjects & classwork"},
   {href:"admin-classwork.html",icon:"✎",label:"Manage classwork",role:"admin",id:"classwork-admin-link"},
   {href:"phase1-class-staff.html",icon:"◎",label:"Member requests",role:"staff"},
   {href:"class-operations.html",icon:"▦",label:"Schedule & members",role:"staff"},
   {href:"account.html",icon:"♙",label:"Profile & security",section:"ACCOUNT"}
 ];
 function navItem(item){
   const a=document.createElement("a");
   a.className="bn-side-link";a.href=item.href;
   if(item.id)a.id=item.id;
   if(item.role){a.dataset.role=item.role;a.hidden=true}
   a.append(Object.assign(document.createElement("span"),{textContent:item.icon}));
   a.append(document.createTextNode(item.label));
   if(item.href===page||(page==="submission.html"&&item.href==="classwork.html")){
     a.classList.add("selected");a.setAttribute("aria-current","page");
   }
   return a;
 }
 function makeNav(){
   const aside=document.createElement("aside");
   aside.className="bn-workspace-sidebar bn-unified-sidebar";aside.id="shell-sidebar";
   aside.setAttribute("aria-label","Workspace navigation");
   aside.dataset.open="false";
   const brand=document.createElement("a");brand.className="bn-workspace-brand";brand.href="dashboard.html";
   const logo=document.createElement("span");logo.className="bn-brand-glyph";logo.textContent="✦";logo.setAttribute("aria-hidden","true");
   const brandName=document.createElement("span");brandName.className="bn-brand-name";brandName.append(document.createTextNode("Blue Noelle"));
   const small=document.createElement("small");small.textContent="CLASSROOM WORKSPACE";brandName.append(small);
   brand.append(logo,brandName);aside.append(brand);
   for(const section of ["YOUR WORKSPACE","ACCOUNT"]){
     const heading=document.createElement("p");heading.className="bn-side-caption"+(section==="ACCOUNT"?" bn-side-secondary":"");
     heading.textContent=section;aside.append(heading);
     const nav=document.createElement("nav");nav.className="bn-side-links";nav.setAttribute("aria-label",section==="ACCOUNT"?"Account":"Classroom");
     for(const item of items.filter(i=>(i.section||"YOUR WORKSPACE")===section))nav.append(navItem(item));
     aside.append(nav);
   }
   const spacer=document.createElement("div");spacer.className="bn-side-spacer";aside.append(spacer);
   const note=document.createElement("div");note.className="bn-sidebar-footer";
   const dot=document.createElement("span");dot.className="bn-side-info-dot";dot.setAttribute("aria-hidden","true");
   const text=document.createElement("div"),title=document.createElement("strong"),desc=document.createElement("small");
   title.textContent="Private classroom";desc.textContent="Access checked for every class";
   text.append(title,desc);note.append(dot,text);aside.append(note);
   return aside;
 }
 function topbar(){
   const header=document.createElement("header");header.className="bn-topbar bn-shell-topbar";
   const left=document.createElement("div");left.className="bn-topbar-left";
   const toggle=document.createElement("button");toggle.type="button";toggle.id="shell-menu";
   toggle.className="bn-menu-toggle";toggle.textContent="☰";
   toggle.setAttribute("aria-controls","shell-sidebar");
   toggle.setAttribute("aria-expanded","false");toggle.setAttribute("aria-label","Toggle workspace navigation");
   const crumb=document.createElement("div");crumb.className="bn-breadcrumb";
   crumb.append(document.createTextNode("WORKSPACE  /  "));
   const current=document.createElement("strong");
   current.textContent=items.find(i=>i.href===page)?.label||"Submissions";
   crumb.append(current);left.append(toggle,crumb);
   const right=document.createElement("div");right.className="bn-top-actions";
   const today=document.createElement("time");today.id="shell-date";today.className="bn-top-date";
   const identity=document.createElement("div");identity.className="bn-user-identity";
   const name=document.createElement("span");name.id="shell-user-name";name.textContent="Your account";
   const role=document.createElement("small");role.id="shell-role";role.textContent="Membership required";
   identity.append(name,role);
   const avatar=document.createElement("a");avatar.href="account.html";avatar.className="bn-top-account";
   avatar.setAttribute("aria-label","Profile and security settings");
   const initials=document.createElement("span");initials.id="shell-avatar";initials.textContent="BN";
   const photo=document.createElement("img");photo.id="shell-avatar-img";photo.alt="";photo.hidden=true;
   avatar.append(initials,photo);
   const logout=document.createElement("button");logout.id="shell-signout";logout.type="button";logout.className="bn-signout";logout.textContent="Sign out";
   right.append(today,identity,avatar,logout);header.append(left,right);
   return header;
 }
 function install(){
   const sidebar=makeNav(),app=document.querySelector(".bn-app");
   if(accountPage){
     const existing=document.querySelector(".bn-settings-sidebar");
     if(!existing)return;
     existing.replaceWith(sidebar);
     document.querySelector(".bn-settings-shell")?.classList.add("bn-shared-app");
     const header=document.querySelector(".bn-settings-topbar");
     if(header){const button=document.createElement("button");button.type="button";button.id="shell-menu";
       button.className="bn-menu-toggle";button.textContent="☰";button.setAttribute("aria-controls","shell-sidebar");
       button.setAttribute("aria-expanded","false");button.setAttribute("aria-label","Toggle workspace navigation");
       header.prepend(button)}
   }else{
     if(!app)return;
     const oldHeader=app.querySelector(".bn-header");
     const main=app.querySelector("main");
     if(!oldHeader||!main)return;
     const content=document.createElement("div");content.className="bn-workspace-main";
     oldHeader.remove();main.remove();
     content.append(topbar(),main);
     app.classList.add("bn-shared-app");
     app.prepend(sidebar,content);
   }
   const menu=$("shell-menu");
   menu?.addEventListener("click",()=>{
     const open=sidebar.dataset.open==="true";
     sidebar.dataset.open=String(!open);menu.setAttribute("aria-expanded",String(!open));
   });
   try{const d=new Intl.DateTimeFormat("en-PH",{timeZone:"Asia/Manila",weekday:"short",month:"short",day:"numeric"}).format(new Date());
     if($("shell-date"))$("shell-date").textContent=d}catch(_){}
 }
 async function hydrate(){
   const db=w.BNBackend?.client;
   if(!w.BNBackend?.configured||!db)return;
   try{
     const {data:auth,error}=await db.auth.getUser();
     if(error||!auth?.user){w.location.replace("login.html");return}
     const uid=auth.user.id;
     const [{data:memberships,error:membershipError},{data:profiles,error:profileError}]=await Promise.all([
       db.from("ClassMembership").select("class_id,role,status").eq("status","ACTIVE"),
       db.from("User").select("full_name,is_developer").eq("id",uid).limit(1)
     ]);
     const active=membershipError?[]:(memberships||[]).filter(m=>m.status==="ACTIVE");
     const admin=active.some(m=>m.role==="Admin");
     const staff=admin||active.some(m=>m.role==="Moderator");
     const developer=!profileError&&profiles?.[0]?.is_developer===true;
     if(document.documentElement)document.documentElement.dataset.developer=developer?"true":"false";
     const roleForClass=classId=>active.find(m=>m.class_id===classId)?.role;
     const selectedId=["classwork-class","admin-class","staff-class","ops-class"]
       .map(id=>$(id)?.value).find(id=>id&&roleForClass(id));
     const defaultRole=roleForClass(selectedId)||
       (admin?"Admin":staff?"Moderator":active.length?"Student":"Student");
     w.BNTheme?.setRole(defaultRole,{isDeveloper:developer});
     document.addEventListener("change",event=>{
       if(!["classwork-class","admin-class","staff-class","ops-class"].includes(event.target?.id))return;
       const choice=roleForClass(event.target.value);
       if(choice)w.BNTheme?.setRole(choice,{isDeveloper:developer});
     });

     for(const a of document.querySelectorAll(".bn-unified-sidebar [data-role]")){
       a.hidden=a.dataset.role==="admin"?!admin:!staff;
     }
     const name=!profileError&&profiles?.[0]?.full_name||auth.user.email?.split("@")[0]||"Your account";
     const fullName=String(name).trim();
     const initial=fullName.split(/\s+/).slice(0,2).filter(Boolean).map(n=>n[0]).join("").toUpperCase()||"BN";
     if($("shell-user-name"))$("shell-user-name").textContent=fullName;
     if($("shell-avatar"))$("shell-avatar").textContent=initial;
     if($("shell-role"))$("shell-role").textContent=(developer?"Developer · ":"")+(admin?"Admin · ACTIVE":staff?"Moderator · ACTIVE":active.length?"Student · ACTIVE":"Enrollment required");
     if(!accountPage&&db.storage?.from&&typeof URL!=="undefined"&&URL.createObjectURL){
       try{const {data,error:photoError}=await db.storage.from("bn-avatars").download(uid+"/avatar");
         if(!photoError&&data&&$("shell-avatar-img")){
           const objectUrl=URL.createObjectURL(data);
           $("shell-avatar-img").src=objectUrl;$("shell-avatar-img").hidden=false;
           $("shell-avatar").hidden=true;
           w.addEventListener?.("beforeunload",()=>URL.revokeObjectURL(objectUrl),{once:true});
         }
       }catch(_){/* initials remain a reliable fallback */}
     }
   }catch(_){/* individual workspace controllers own their authorization/error states */}
 }
 document.addEventListener("DOMContentLoaded",()=>{
   install();
   const signout=$("shell-signout");
   signout?.addEventListener("click",async()=>{
     signout.disabled=true;
     try{const {error}=await w.BNBackend.client.auth.signOut();if(error)throw error;
       w.location.replace("login.html");
     }catch(_){signout.disabled=false}
   });
   void hydrate();
 });
})(window);
