/* Blue Noelle signup email OTP. Supabase verifies the token; Brevo delivers it.
 * Never store OTP, passwords, privileged keys, or role authorization in browser storage.
 */
(function(w){
 "use strict";
 const KEY="bn_pending_confirmation_email";
 const COOLDOWN_MS=60000;
 const $=id=>document.getElementById(id);
 const api=()=>w.BNLivePhase1;
 const cleanEmail=s=>String(s||"").trim().toLowerCase();
 const digits=()=>Array.from(document.querySelectorAll(".bn-otp-digit"));
 const clock=()=>Date.now();
 let nextResendAt=0, timer=null, busy=false;

 function note(message,tone="info"){
   const el=$("auth-status");
   el.textContent=message; el.dataset.state=tone;
 }
 function errorMessage(error){
   if(error?.code==="over_email_send_rate_limit"||/email rate limit exceeded/i.test(error?.message||""))
     return "Email delivery is temporarily limited. Please try again later. If you already received a code, you can still enter it here.";
   if(error?.code==="otp_expired"||/expired/i.test(error?.message||""))
     return "That code has expired or was already used. Request a new code and try again.";
   if(error?.code==="otp_disabled")return "Email verification is currently unavailable. Please contact support.";
   if(/invalid.*(otp|token)|token.*invalid/i.test(error?.message||""))
     return "That code is incorrect. Check your email and try again.";
   return error?.message||"Unable to complete verification. Please try again.";
 }
 function loadPending(){
   try{
     const data=JSON.parse(sessionStorage.getItem(KEY)||"null");
     if(data&&typeof data.email==="string"&&data.email.includes("@")
        &&Number.isFinite(data.at)&&clock()-data.at<86400000){
       nextResendAt=Math.max(0,Number(data.nextResendAt)||0);
       return cleanEmail(data.email);
     }
   }catch(_){}
   return "";
 }
 function savePending(email){
   try{
     sessionStorage.setItem(KEY,JSON.stringify({
       email:cleanEmail(email),at:clock(),nextResendAt
     }));
   }catch(_){}
 }
 function clearPending(){
   try{sessionStorage.removeItem(KEY)}catch(_){}
 }
 function cooldown(){
   const remaining=Math.max(0,Math.ceil((nextResendAt-clock())/1000));
   const resend=$("resend-otp");
   resend.disabled=busy||remaining>0;
   $("otp-resend-timer").textContent=remaining
      ? "You can request another code in "+remaining+" seconds."
      : "You can request another code if needed.";
   if(remaining===0&&timer){clearInterval(timer);timer=null}
 }
 function startCooldown(){
   nextResendAt=clock()+COOLDOWN_MS;
   savePending($("otp-email").value);
   if(timer)clearInterval(timer);
   timer=setInterval(cooldown,1000);
   cooldown();
 }
 function clearDigits(){digits().forEach(input=>input.value="")}
 function fillDigits(source,start=0){
   const values=String(source||"").replace(/\D/g,"").slice(0,6-start).split("");
   const inputs=digits();
   if(!values.length)return;
   values.forEach((ch,i)=>inputs[start+i].value=ch);
   inputs[Math.min(5,start+values.length)].focus();
 }
 function setupDigits(){
   digits().forEach((input,index)=>{
     input.addEventListener("input",()=>{
       const value=input.value.replace(/\D/g,"");
       if(value.length>1){input.value="";fillDigits(value,index)}
       else{
         input.value=value;
         if(value&&index<5)digits()[index+1].focus();
       }
     });
     input.addEventListener("keydown",event=>{
       if(event.key==="Backspace"&&!input.value&&index>0){
         digits()[index-1].focus();digits()[index-1].value="";
       }
       if(event.key==="ArrowLeft"&&index>0){event.preventDefault();digits()[index-1].focus()}
       if(event.key==="ArrowRight"&&index<5){event.preventDefault();digits()[index+1].focus()}
     });
     input.addEventListener("paste",event=>{
       const value=event.clipboardData?.getData("text")||"";
       if(/\d/.test(value)){event.preventDefault();fillDigits(value,index)}
     });
   });
 }
 async function run(task){
   if(busy)return;
   busy=true;$("verify-submit").disabled=true;cooldown();
   try{await task()}catch(e){note(errorMessage(e),"error")}
   finally{busy=false;$("verify-submit").disabled=false;cooldown()}
 }
 async function verify(event){
   event.preventDefault();
   await run(async()=>{
     const email=cleanEmail($("otp-email").value);
     const token=digits().map(input=>input.value).join("");
     if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
       throw Error("Enter the email address used at registration.");
     if(!/^\d{6}$/.test(token))throw Error("Enter all six digits of the verification code.");
     const response=await api().verifySignupCode(email,token);
     if(!response?.user&&!response?.session)throw Error("Could not confirm your email. Please try again.");
     if(response?.session){
       // Supabase verifies and signs in atomically. Return to requested
       // password sign-in flow; never retain OTP or session in app storage.
       await api().signOut();
     }
     clearPending();clearDigits();
     $("otp-form").hidden=true;
     $("otp-complete").hidden=false;
     $("otp-resend-timer").textContent="";
     $("resend-otp").disabled=true;
     note("Your email is verified! Continue to Sign-In.","success");
   });
 }
 async function resend(){
   await run(async()=>{
     const email=cleanEmail($("otp-email").value);
     if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
       throw Error("Enter the email address used at registration.");
     if(clock()<nextResendAt)throw Error("Wait for the resend countdown to finish.");
     await api().resendSignupCode(email);
     clearDigits();startCooldown();
     note("A new verification code was requested. Check your inbox or spam folder.","success");
     digits()[0].focus();
   });
 }
 async function init(){
   if(!api()?.ready()){note("Verification service unavailable. Check your connection.","error");return}
   setupDigits();
   const previous=loadPending();
   if(previous){
     $("otp-email").value=previous;
     // On the initial signup flow, the first email was just requested.
     if(!nextResendAt){nextResendAt=clock()+COOLDOWN_MS;savePending(previous)}
     digits()[0].focus();
   }else $("otp-email").focus();
   cooldown();
   if(nextResendAt>clock())timer=setInterval(cooldown,1000);
   $("otp-form").addEventListener("submit",verify);
   $("resend-otp").addEventListener("click",resend);
   note(previous?"A code was requested for your registered email. Enter it below.":
        "Enter your registered email and the six-digit code from your message.","info");
 }
 document.addEventListener("DOMContentLoaded",init);
})(window);
