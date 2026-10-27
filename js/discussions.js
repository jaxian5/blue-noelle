/* Phase 6: private, class-scoped discussion threads. */
(function(w){
 "use strict";
 const {dom,el,status,rpc,fmt,init,periodic}=w.BNComm;
 let uid="",membership=null,thread=[],before=null,replyId=null,loading=false,seq=0,posting=false;
 const classId=()=>dom("p6-class").value;
 const api=(p_action,p_body=null,p_message=null,p_parent=null)=>rpc("bn_p6_chat_mutate",{
    p_class:classId(),p_action,p_body,p_message,p_parent
 });
 function action(label,fn){
   const btn=el("button",label,"bn-btn bn-btn-secondary");btn.type="button";
   btn.addEventListener("click",fn);return btn;
 }
 function render(){
   const list=dom("p6-messages");list.replaceChildren();
   if(!thread.length){list.append(el("p","No messages yet. Start your classroom discussion.","p67-empty"));return}
   const role=membership?.role(classId());
   for(const message of thread){
     const card=el("article",null,"p67-message");
     card.dataset.reply=String(Boolean(message.parent_id));
     const head=el("div",null,"p67-row");
     const by=el("strong",message.author_name||"Class member");
     const time=el("small",fmt(message.created_at)+(message.edited_at?" · Edited":""));
     head.append(by,time);card.append(head);
     if(message.parent_id){
       const source=thread.find(x=>x.id===message.parent_id);
       card.append(el("small","↳ Reply to "+(source?.author_name||"an earlier message")));
     }
     card.append(el("p",message.body));
     const controls=el("div",null,"p67-row");
     controls.append(action("Reply",()=>{
       replyId=message.id;dom("p6-replying").hidden=false;
       dom("p6-replying").textContent="Replying to "+(message.author_name||"class member");
       dom("p6-cancel-reply").hidden=false;dom("p6-body").focus();
     }));
     const mine=message.author_id===uid;
     const editable=mine && Date.now()-Date.parse(message.created_at)<15*60*1000;
     if(editable)controls.append(action("Edit",async()=>{
       const body=w.prompt("Edit your message (2,000 characters max)",message.body);
       if(body===null||body===message.body)return;
       await mutate(()=>api("edit",body,message.id),"Message edited");
     }));
     if(mine||["Admin","Moderator"].includes(role)){
       controls.append(action("Remove",async()=>{
         if(!w.confirm("Remove this classroom message?"))return;
         await mutate(()=>api("delete",null,message.id),"Message removed");
       }));
     }
     card.append(controls);list.append(card);
   }
 }
 async function mutate(fn,label){
   if(posting)return;posting=true;dom("p6-send").disabled=true;
   try{await fn();status(label,"success");await reload(true)}
   catch(e){status(e.message||"Unable to update discussion.","error")}
   finally{posting=false;dom("p6-send").disabled=false}
 }
 async function reload(force=false){
   if(loading||document.hidden&&!force)return;
   const room=classId(),turn=++seq;loading=true;
   try{
     const rows=await rpc("bn_p6_chat_list",{p_class:room,p_before:null,p_limit:60});
     if(turn!==seq||room!==classId())return;
     thread=Array.isArray(rows)?rows:[];
     before=thread.length?thread[0].created_at:null;
     dom("p6-more").hidden=thread.length<60;
     render();dom("p6-content").hidden=false;
     if(force)status("Class discussion updated.","success");
   }catch(e){if(room===classId())status(e.message,"error")}
   finally{
     loading=false;
     // If the classroom changed mid-request, fetch only the newly chosen
     // class. Never leave previous classroom messages visible.
     if(room!==classId())void reload(true);
   }
 }
 async function more(){
   if(loading||!before)return;loading=true;const room=classId();
   try{
     const rows=await rpc("bn_p6_chat_list",{p_class:room,p_before:before,p_limit:60});
     if(room!==classId())return;
     const existing=new Set(thread.map(x=>x.id));
     thread=[...(Array.isArray(rows)?rows:[]).filter(x=>!existing.has(x.id)),...thread];
     before=thread[0]?.created_at||null;
     dom("p6-more").hidden=!rows?.length||rows.length<60;render();
   }catch(e){status(e.message,"error")}finally{
     loading=false;
     if(room!==classId())void reload(true);
   }
 }
 function reset(){
   seq++;thread=[];before=null;replyId=null;
   dom("p6-replying").hidden=true;dom("p6-cancel-reply").hidden=true;
   dom("p6-content").hidden=true;dom("p6-messages").replaceChildren();
   membership?.setTheme(classId());
 }
 document.addEventListener("DOMContentLoaded",async()=>{
   try{
     membership=await init("p6-class");uid=membership.uid;
     await reload(true);
     dom("p6-class").addEventListener("change",()=>{reset();void reload(true)});
     dom("p6-reload").addEventListener("click",()=>{void reload(true)});
     dom("p6-more").addEventListener("click",()=>{void more()});
     dom("p6-cancel-reply").addEventListener("click",()=>{
       replyId=null;dom("p6-replying").hidden=true;dom("p6-cancel-reply").hidden=true;
     });
     dom("p6-form").addEventListener("submit",event=>{
       event.preventDefault();const body=dom("p6-body").value.trim();const parent=replyId;
       void mutate(async()=>{
         await api("post",body,null,parent);
         dom("p6-body").value="";replyId=null;dom("p6-replying").hidden=true;
         dom("p6-cancel-reply").hidden=true;
       },"Message posted");
     });
     periodic(()=>reload(),20000);
   }catch(e){status(e.message||"Unable to open discussions.","error")}
 });
})(window);
