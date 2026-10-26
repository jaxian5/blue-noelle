/* Blue Noelle presentation preferences and authenticated role palette.
 * Only DARK/LIGHT preference is stored on-device. Roles come from authenticated
 * class memberships / protected User.is_developer, never from localStorage.
 * CSS role theme is cosmetic: all permissions remain in Supabase RLS/RPC.
 */
(function(w){
 "use strict";
 const root=document.documentElement;
 const KEY="bn-ui-color-mode-v1";
 const THEMES=new Set(["light","dark"]);
 const ROLES=new Set(["student","moderator","admin","developer"]);
 function systemPreference(){
   return w.matchMedia?.("(prefers-color-scheme: dark)")?.matches?"dark":"light";
 }
 function savedPreference(){
   try{const raw=w.localStorage?.getItem(KEY);return THEMES.has(raw)?raw:null}catch(_){return null}
 }
 let choice=savedPreference();
 function resolved(){return choice||systemPreference()}
 function paintMode(){
   const mode=resolved();
   root.dataset.theme=mode;
   root.style.colorScheme=mode;
   for(const button of document.querySelectorAll("[data-theme-toggle]")){
     button.setAttribute("aria-pressed",String(mode==="dark"));
     button.setAttribute("aria-label",mode==="dark"?"Switch to light mode":"Switch to dark mode");
     const icon=button.querySelector(".bn-theme-icon");
     const text=button.querySelector(".bn-theme-label");
     if(icon)icon.textContent=mode==="dark"?"☀":"☾";
     if(text)text.textContent=mode==="dark"?"Light":"Dark";
     button.title=mode==="dark"?"Switch to light mode":"Switch to dark mode";
   }
 }
 function setMode(mode){
   if(!THEMES.has(mode))return;
   choice=mode;
   try{w.localStorage?.setItem(KEY,mode)}catch(_){}
   paintMode();
 }
 function setRole(role,{isDeveloper=false}={}){
   const normalized=String(role||"student").trim().toLowerCase();
   root.dataset.role=isDeveloper?"developer":(ROLES.has(normalized)?normalized:"student");
   const indicator=document.querySelector("[data-theme-role-indicator]");
   if(indicator)indicator.textContent=root.dataset.role.slice(0,1).toUpperCase()+root.dataset.role.slice(1)+" palette";
 }
 function toggle(){setMode(resolved()==="dark"?"light":"dark")}
 function createToggle(){
   if(document.querySelector("[data-theme-toggle]"))return;
   const button=document.createElement("button");
   button.type="button";
   button.className="bn-theme-toggle";
   button.dataset.themeToggle="";
   const icon=document.createElement("span");icon.className="bn-theme-icon";icon.setAttribute("aria-hidden","true");
   const label=document.createElement("span");label.className="bn-theme-label";
   button.append(icon,label);
   button.addEventListener("click",toggle);
   const host=document.querySelector(".bn-top-actions, .bn-settings-top-actions, .bn-entry-content .bn-entry-header, .bn-nav");
   if(host){host.prepend(button)}
   else{button.classList.add("bn-theme-floating");document.body.append(button)}
   paintMode();
 }
 if(!root.dataset.role)root.dataset.role="student";
 paintMode(); // in <head>, before stylesheet render, to prevent a white flash
 document.addEventListener("DOMContentLoaded",createToggle);
 const media=w.matchMedia?.("(prefers-color-scheme: dark)");
 media?.addEventListener?.("change",()=>{if(!choice)paintMode()});
 w.BNTheme=Object.freeze({
   setMode,setRole,getMode:resolved,getRole:()=>root.dataset.role,toggle
 });
})(window);
