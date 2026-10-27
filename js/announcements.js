/* Phase 7: staff-authored announcements and personal class-scoped inbox. */
(function(w){
 "use strict";
 const {dom,el,status,rpc,fmt,init,periodic}=w.BNComm;
 let user=null,posts=[],notices=[],working=false,seq=0,editing=null;
 const classId=()=>dom("p7-class").value;
 function manilaLocal(utc){
   if(!utc)return "";
   const formatter=new Intl.DateTimeFormat("en-GB",{
     timeZone:"Asia/Manila",year:"numeric",month:"2-digit",day:"2-digit",
     hour:"2-digit",minute:"2-digit",hour12:false,hourCycle:"h23"
   });
   const parts=Object.fromEntries(formatter.formatToParts(new Date(utc))
     .filter(p=>p.type!=="literal").map(p=>[p.type,p.value]));
   return parts.year+"-"+parts.month+"-"+parts.day+"T"+parts.hour+":"+parts.minute;
 }
 function expiresUtc(){
   const time=dom("p7-expires").value;
   if(!time)return null;
   const date=new Date(time+":00+08:00");
   if(Number.isNaN(date.valueOf()))throw Error("Enter a valid Manila expiration time.");
   if(date<=new Date()||date>new Date(Date.now()+366*86400000))
     throw Error("Expiration must be in the future and within one year.");
   return date.toISOString();
 }
 const staff=()=>["Admin","Moderator"].includes(user?.role(classId()));
 const mutate=(p_action,p_announcement=null,data={})=>rpc("bn_p7_announcements_mutate",{
  p_class:classId(),p_action,p_announcement,
  p_title:data.title??null,p_message:data.body??null,
  p_priority:data.priority??0,p_pinned:data.pinned??false,
  p_expires:data.expires??null
 });
 function btn(label,callback){
   const button=el("button",label,"bn-btn bn-btn-secondary");button.type="button";
   button.addEventListener("click",callback);return button;
 }
 function renderPosts(){
   const list=dom("p7-posts");list.replaceChildren();
   dom("p7-total").textContent=posts.length+" posts";
   if(!posts.length){list.append(el("p","No announcements published for this classroom.","p67-empty"));return}
   for(const post of posts){
     const article=el("article",null,"p67-post");
     article.dataset.announcement=post.id;
     const heading=el("div",null,"p67-row");
     heading.append(el("strong",post.title),el("small",
       (post.pinned?"📌 Pinned · ":"")+
       (post.priority===2?"URGENT · ":post.priority===1?"Important · ":"")+
       fmt(post.created_at)));
     article.append(heading,el("p",post.message));
     article.append(el("small","From "+(post.author_name||"Classroom staff")));
     if(staff()){
       const actions=el("div",null,"p67-row");
       actions.append(btn("Edit",()=>{
         editing=post.id;dom("p7-title").value=post.title;
         dom("p7-body").value=post.message;
         dom("p7-priority").value=String(post.priority);
         dom("p7-pinned").checked=post.pinned;
         dom("p7-expires").value=manilaLocal(post.expires_at);
         dom("p7-publish").textContent="Save changes";
         dom("p7-cancel-edit").hidden=false;
         dom("p7-form").scrollIntoView({behavior:"smooth",block:"nearest"});
       }));
       actions.append(btn(post.pinned?"Unpin":"Pin",()=>perform(async()=>{
         await mutate("pin",post.id,{pinned:!post.pinned});
       },"Announcement pin updated.")));
       actions.append(btn("Remove",()=>{
         if(!w.confirm("Remove this announcement from the classroom?"))return;
         void perform(()=>mutate("delete",post.id),"Announcement removed.");
       }));
       article.append(actions);
     }
     list.append(article);
   }
 }
 function renderInbox(){
   const list=dom("p7-inbox");list.replaceChildren();
   const unread=notices.filter(x=>!x.read_at).length;
   dom("p7-unread").textContent=unread+" unread";
   dom("p7-read-all").disabled=working||unread===0;
   if(!notices.length){list.append(el("p","No notifications in this classroom yet.","p67-empty"));return}
   for(const notice of notices){
     const card=el("article",null,"p67-notice");
     card.dataset.read=String(Boolean(notice.read_at));
     const type=notice.type==="ANNOUNCEMENT"?"New announcement":
       notice.type==="CHAT_REPLY"?"New reply":"Classroom update";
     card.append(el("strong",type),el("small",fmt(notice.created_at)));
     const detail=notice.type==="ANNOUNCEMENT"?
       String(notice.payload?.title||"A new announcement was posted"):
       notice.type==="CHAT_REPLY"?"Someone replied to a classroom discussion":
       "You have a classroom notification.";
     card.append(el("p",detail));
     const actions=el("div",null,"p67-row");
     if(!notice.read_at){
       actions.append(btn("Mark read",()=>perform(async()=>{
         await rpc("bn_p7_notification_read",{p_class:classId(),p_id:notice.id});
       },"Notification marked read.")));
     }
     if(notice.type==="CHAT_REPLY"){
       const link=el("a","Open discussion ↗","bn-btn bn-btn-secondary");
       link.href="discussions.html?class="+encodeURIComponent(classId());
       actions.append(link);
     }else if(notice.type==="ANNOUNCEMENT"){
       actions.append(btn("View announcement",()=>{
         const id=String(notice.payload?.announcement_id||"");
         const target=[...dom("p7-posts").children]
           .find(post=>post.dataset.announcement===id);
         (target||dom("p7-posts")).scrollIntoView({behavior:"smooth",block:"start"});
       }));
     }
     card.append(actions);list.append(card);
   }
 }
 async function reload(force=false){
   const room=classId(),turn=++seq;
   if(!room||document.hidden&&!force)return;
   try{
     const [ann,feed]=await Promise.all([
       rpc("bn_p7_announcements_list",{p_class:room}),
       rpc("bn_p7_notifications",{p_class:room,p_limit:60})
     ]);
     if(turn!==seq||room!==classId())return;
     posts=Array.isArray(ann)?ann:[];notices=Array.isArray(feed)?feed:[];
     dom("p7-content").hidden=false;dom("p7-form").hidden=!staff();
     renderPosts();renderInbox();
     if(force)status("Classroom updates and inbox refreshed.","success");
   }catch(e){if(room===classId())status(e.message||"Updates unavailable.","error")}
 }
 async function perform(fn,success){
   if(working)return;working=true;
   for(const id of ["p7-publish","p7-reload","p7-read-all"])dom(id).disabled=true;
   try{await fn();status(success,"success");await reload();}
   catch(e){status(e.message||"Request failed.","error")}
   finally{working=false;for(const id of ["p7-publish","p7-reload"])dom(id).disabled=false;
    dom("p7-read-all").disabled=!notices.some(n=>!n.read_at)}
 }
 function clearForm(){
   editing=null;dom("p7-form").reset();dom("p7-publish").textContent="Publish";
   dom("p7-cancel-edit").hidden=true;
 }
 document.addEventListener("DOMContentLoaded",async()=>{
   try{
     user=await init("p7-class");await reload(true);
     dom("p7-class").addEventListener("change",()=>{
       seq++;posts=[];notices=[];clearForm();
       dom("p7-content").hidden=true;user.setTheme(classId());
       void reload(true);
     });
     dom("p7-reload").addEventListener("click",()=>{void reload(true)});
     dom("p7-cancel-edit").addEventListener("click",()=>{clearForm();});
     dom("p7-read-all").addEventListener("click",()=>{
       void perform(()=>rpc("bn_p7_notifications_read_all",{p_class:classId()}),
         "Your classroom notifications were marked read.");
     });
     dom("p7-form").addEventListener("submit",event=>{
       event.preventDefault();if(!staff())return;
       const id=editing;
       let expires;
       try{expires=expiresUtc()}
       catch(e){status(e.message,"error");return}
       const data={title:dom("p7-title").value.trim(),
        body:dom("p7-body").value.trim(),priority:Number(dom("p7-priority").value),
        pinned:dom("p7-pinned").checked,expires};
       void perform(async()=>{
         await mutate(id?"edit":"create",id,data);
         clearForm();
       },id?"Announcement updated.":"Announcement published to active members.");
     });
     periodic(()=>reload(),30000);
   }catch(e){status(e.message||"Unable to open announcements.","error")}
 });
})(window);
