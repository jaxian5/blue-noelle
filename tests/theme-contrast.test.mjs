import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname,resolve } from "node:path";

const dir=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const read=p=>readFileSync(resolve(dir,p),"utf8");
const css=read("css/theme.css");
const ROLES=["student","moderator","admin","developer"];
const MODES=["light","dark"];
function block(selector){
  const start=css.indexOf(selector+"{");
  assert.ok(start>=0,"CSS token scope is missing: "+selector);
  const end=css.indexOf("}",start);
  assert.ok(end>start,"CSS token scope has no closing brace: "+selector);
  const body=css.slice(start,end);
  return Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-f]{6})/gi)]
    .map(match=>[match[1],match[2].toLowerCase()]));
}
function palette(role,mode){
  return Object.assign({},block(":root"),block('html[data-role="'+role+'"]'),
    mode==="dark"?block('html[data-theme="dark"]'):{},
    mode==="dark"?block('html[data-theme="dark"][data-role="'+role+'"]'):{});
}
function luminance(hex){
  assert.match(hex,/^#[0-9a-f]{6}$/i,"Hex color required: "+hex);
  const parts=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);
  const linear=parts.map(n=>n<=0.04045?n/12.92:((n+0.055)/1.055)**2.4);
  return linear[0]*.2126+linear[1]*.7152+linear[2]*.0722;
}
function contrast(fg,bg){
 const a=luminance(fg),b=luminance(bg);
 return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
}
function verify(label,foreground,background,min=4.5){
 const ratio=contrast(foreground,background);
 assert.ok(ratio>=min,label+" contrast "+ratio.toFixed(2)+":1 < "+min+":1 ("+foreground+" / "+background+")");
 return ratio;
}
test("WCAG AA: all four role foregrounds pass on light/dark page, card, input and selected surfaces",()=>{
 let comparisons=0;
 for(const role of ROLES)for(const mode of MODES){
  const p=palette(role,mode),tag=mode+"/"+role;
  for(const base of ["--ui-page","--ui-surface","--ui-raised","--ui-input"]){
   for(const foreground of ["--ui-text","--ui-muted","--role-ink","--role-main"]){
     verify(tag+" "+foreground+" on "+base,p[foreground],p[base]);
     comparisons++;
   }
  }
  verify(tag+" muted on role-soft",p["--ui-muted"],p["--role-soft"]);comparisons++;
  verify(tag+" role link on role-soft",p["--role-ink"],p["--role-soft"]);comparisons++;
  for(const kind of ["success","info","warn","error"]){
    const bg=p["--ui-"+kind+"-bg"],fg=p["--ui-"+kind+"-text"];
    verify(tag+" "+kind+" status",fg,bg);
    comparisons++;
  }
  for(const item of ["--role-sidebar-a","--role-sidebar-b"]){
    verify(tag+" sidebar text",p["--ui-sidebar-text"],p[item]);
    comparisons++;
  }
  for(const item of ["--role-hero-a","--role-hero-b"]){
    verify(tag+" hero white","#ffffff",p[item]);
    comparisons++;
  }
  verify(tag+" selected nav white","#ffffff",p["--role-active"]);comparisons++;
  verify(tag+" action label",mode==="dark"?"#102035":"#ffffff",p["--role-main"]);comparisons++;
 }
 assert.ok(comparisons>=200);
});

test("Theme overrides every known problem area using semantic color tokens",()=>{
 const areas=[
  ".bn-signup-dialog",".bn-otp-digit",".bn-sub-file-info strong",
  ".bn-sub-file-info small",".bn-sub-version p",".bn-admin-record p",
  ".bn-format-picker>summary",".bn-format-help",".bn-task-meta",
  ".bn-metric-top",".bn-class-select label",".bn-settings-help",
  ".bn-settings-memberships span",".bn-breadcrumb",".bn-top-date",
  ".bn-side-caption",".bn-settings-card input[readonly]",
  ".bn-sub-error",".bn-auth-notice[data-state=\"error\"]",
  ".bn-task-deadline[data-urgency=\"soon\"]",".bn-settings-crumb",
  ".bn-classwork-item h4",".bn-settings-profile-visual #account-email"
 ];
 for(const area of areas){
   assert.ok(css.includes(area),"Missing theme-aware rule for "+area);
 }
 assert.match(css,/--ui-muted:#536781/);
 assert.match(css,/--ui-muted:#a6b6ce/);
 assert.match(css,/\.bn-signup-dialog\s*\{\s*background:var\(--ui-surface\);color:var\(--ui-text\)/);
 assert.doesNotMatch(css,/!important\s*;?\s*\}/);
});

test("Old fixed dark text is not reintroduced in audited module styles",()=>{
 for(const path of ["css/auth.css","css/classwork.css",
  "css/classwork-admin.css","css/submissions.css","css/dashboard.css",
  "css/account-settings.css","css/workspace-shell.css","css/workspace-pages.css"]){
  const contents=read(path);
  assert.match(contents,/color:var\(--ui-text\)|color:var\(--ui-muted\)/,path);
 }
 const submissions=read("css/submissions.css");
 assert.match(submissions,/\.bn-sub-file-info strong[^\n]*color:var\(--ui-text\)/);
 assert.match(submissions,/\.bn-sub-version p[^\n]*color:var\(--ui-muted\)/);
 const picker=read("css/classwork-admin.css");
 assert.match(picker,/\.bn-format-picker>summary[^\n]*color:var\(--ui-text\)/);
 const auth=read("css/auth.css");
 assert.match(auth,/\.bn-signup-dialog h2\{[^}]*color:var\(--ui-text\)/);
});

test("Status/error typography changes together with chip background in both modes",()=>{
 for(const name of ["success","info","warn","error"]){
  assert.match(css,new RegExp("--ui-"+name+"-bg:#[0-9a-f]{6}"));
  assert.match(css,new RegExp("--ui-"+name+"-text:#[0-9a-f]{6}"));
 }
 assert.match(css,/\.bn-task-status\[data-state="submitted"\]/);
 assert.match(css,/\.bn-task-deadline\[data-urgency="overdue"\]/);
 assert.match(css,/\.bn-classwork-badge\[data-status="CLOSED"\]/);
});

test("Contrast audit does not reintroduce global white-on-white or dark-on-dark text rules",()=>{
 const source=css.slice(css.indexOf("Contrast pass 2026-10-26"));
 assert.ok(source.length>2000);
 assert.doesNotMatch(source,/body\s*\{[^}]*color:\s*#fff/i);
 assert.doesNotMatch(source,/\*\s*\{[^}]*color:\s*#fff/i);
 assert.ok(css.includes("html[data-theme] :is(.bn-hero-link"));
 assert.ok(css.includes("html[data-theme] .bn-signup-dialog"));
});
