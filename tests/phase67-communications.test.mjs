import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {Script} from "node:vm";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const read=p=>readFileSync(resolve(root,p),"utf8");
const chatSQL=read("supabase/migrations/20261027021547_phase6_class_discussions.sql");
const newsSQL=read("supabase/migrations/20261027021553_phase7_announcements_inbox.sql");
const chat=read("js/discussions.js"),news=read("js/announcements.js"),core=read("js/phase67-core.js");
const shell=read("js/workspace-shell.js");
test("Phase 6 + 7 share real class membership and avoid demo/unsafe HTML rendering",()=>{
 for(const [name,js] of [["discussions",chat],["announcements",news],["core",core]]){
  assert.doesNotThrow(()=>new Script(js,{filename:name+".js"}));
  assert.doesNotMatch(js,/\.innerHTML\s*=|getPublicUrl\(|service_role|sb_secret_|localStorage/);
 }
 assert.match(core,/auth\.getUser\(\)/);
 assert.match(core,/from\("ClassMembership"\)/);
 assert.match(core,/\.eq\("status","ACTIVE"\)/);
 assert.match(core,/BNTheme\?\.setRole/);
 assert.match(core,/document\.hidden/);
 assert.match(chat,/bn_p6_chat_page/);
 assert.match(news,/bn_p7_notifications/);
});
test("Phase 6 list and mutation RPCs require ACTIVE member; staff moderation scoped to class",()=>{
 assert.match(chatSQL,/bn_p6_staff_or_student/);
 assert.match(chatSQL,/m\.status='ACTIVE'/);
 assert.match(chatSQL,/m\.role IN \('Admin','Moderator','Student'\)/);
 assert.match(chatSQL,/c\.class_id=p_class/);
 assert.match(chatSQL,/WHERE id=p_message AND class_id=p_class AND deleted_at IS NULL FOR UPDATE/);
 assert.match(chatSQL,/v_message\.author_id<>actor/);
 assert.match(chatSQL,/v_role NOT IN \('Admin','Moderator'\)/);
 assert.match(chatSQL,/interval '15 minutes'/);
 assert.match(chatSQL,/interval '1 minute'/);
 assert.match(chatSQL,/p_action IS NULL OR p_action NOT IN/);
 assert.match(chatSQL,/CHAT_REMOVED/);
 assert.match(chatSQL,/bn_reply_in_same_class|Reply target is unavailable in this class/);
});
test("Phase 7 authorizes staff-only publication and broadcasts to only ACTIVE class membership",()=>{
 assert.match(newsSQL,/v_role NOT IN \('Admin','Moderator'\)/);
 assert.match(newsSQL,/IF p_action IS NULL OR p_action NOT IN/);
 assert.match(newsSQL,/INSERT INTO public\."Notification"\(user_id,class_id,type,payload\)/);
 assert.match(newsSQL,/m\.class_id=p_class AND m\.status='ACTIVE' AND m\.user_id<>actor/);
 assert.match(newsSQL,/WHERE id=p_announcement AND class_id=p_class AND deleted_at IS NULL FOR UPDATE/);
 assert.match(newsSQL,/ANNOUNCEMENT_CREATED/);
 assert.match(newsSQL,/ANNOUNCEMENT_REMOVED/);
 assert.match(newsSQL,/expires_at IS NULL OR expires_at>now\(\)/);
 assert.match(newsSQL,/char_length\(title_clean\) NOT BETWEEN 3 AND 120/);
});
test("Inbox is per-user, class-scoped, and its read receipt cannot be edited by another user",()=>{
 assert.match(newsSQL,/WHERE user_id=\(SELECT auth\.uid\(\)\) AND class_id=p_class/);
 assert.match(newsSQL,/WHERE id=p_id AND user_id=\(SELECT auth\.uid\(\)\) AND class_id=p_class/);
 assert.match(newsSQL,/coalesce\(read_at,now\(\)\)/);
 assert.match(newsSQL,/bn_p7_notifications_impl/);
 assert.match(newsSQL,/bn_p7_notification_read_impl/);
 assert.match(chatSQL,/recipient<>actor/);
 assert.match(chatSQL,/m\.class_id=p_class AND m\.user_id=recipient AND m\.status='ACTIVE'/);
});
test("All three communications tables remain RLS-enabled and deny direct REST grants",()=>{
 for(const [sql,table] of [[chatSQL,"ChatMessage"],[newsSQL,"Announcement"],[newsSQL,"Notification"]]){
  assert.ok(sql.includes('ALTER TABLE public."'+table+'" ENABLE ROW LEVEL SECURITY'));
  assert.ok(sql.includes('REVOKE ALL ON public."'+table+'"') ||
    sql.includes('REVOKE ALL ON public."Announcement",public."Notification"'));
 }
 assert.doesNotMatch(chatSQL+newsSQL,/GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE|ALL)\s+ON\s+(?:TABLE\s+)?public\."(?:ChatMessage|Announcement|Notification)"/i);
 for(const method of ["bn_p6_chat_list","bn_p6_chat_mutate"])assert.ok(chatSQL.includes(method));
 for(const method of ["bn_p7_announcements_list","bn_p7_announcements_mutate",
   "bn_p7_notifications","bn_p7_notification_read"])assert.ok(newsSQL.includes(method));
});
test("Routes share responsive themed sidebar and have named accessible controls",()=>{
 const discuss=read("pages/discussions.html"),announce=read("pages/announcements.html");
 for(const [html,ids] of [[discuss,["p6-class","p6-form","p6-body","p6-messages","p6-more"]],
  [announce,["p7-class","p7-posts","p7-inbox","p7-form","p7-unread"]]]){
  assert.match(html,/workspace-shell\.js/);
  assert.match(html,/phase67-core\.js/);
  assert.match(html,/theme\.css/);
  assert.match(html,/phase67\.css/);
  for(const id of ids)assert.ok(html.includes('id="'+id+'"'),id);
 }
 for(const route of ["discussions.html","announcements.html"]){
  assert.ok(shell.includes('href:"'+route+'"'));
  assert.ok(read("pages/dashboard.html").includes('href="'+route+'"'));
 }
 const css=read("css/phase67.css");
 for(const token of ["--ui-surface","--ui-text","--ui-muted","--ui-input","--role-ink"]){
  assert.ok(css.includes("var("+token+")"));
 }
 assert.match(css,/@media\(max-width:840px\)/);
});
test("No database Realtime broadcast open to unauthorized channels",()=>{
 assert.doesNotMatch(chatSQL+newsSQL,/ALTER\s+PUBLICATION\s+supabase_realtime\s+ADD/i);
 assert.match(core,/periodic/);
 assert.match(chat,/periodic\(\(\)=>reload\(\),20000\)/);
 assert.match(news,/periodic\(\(\)=>reload\(\),30000\)/);
});

test("Hardened chat cursor tracks identical timestamps and post count uses serialized lock",()=>{
 const migrated=read("supabase/migrations/20261027024458_phase6_phase7_polish_hardening.sql");
 assert.match(migrated,/bn_p6_chat_page_impl/);
 assert.match(migrated,/\(c\.created_at,c\.id\)<\(p_before,p_before_id\)/);
 assert.match(migrated,/pg_advisory_xact_lock/);
 assert.match(migrated,/CHAT_POSTED/);
 assert.match(migrated,/bn_p7_notifications_read_all_impl/);
 assert.match(migrated,/WHERE user_id=\(SELECT auth\.uid\(\)\) AND class_id=p_class AND read_at IS NULL/);
 assert.match(migrated,/bn_p6_staff_or_student\(p_class\) IS NULL/);
 assert.match(chat,/p_before_id:before\.id/);
 assert.match(chat,/before=thread\.length\?\{time:thread\[0\]\.created_at,id:thread\[0\]\.id\}/);
});
test("Announcement expiry is sent as Manila-local UTC and edit form preserves expiry",()=>{
 const html=read("pages/announcements.html");
 for(const id of ["p7-expires","p7-read-all"])assert.ok(html.includes('id="'+id+'"'),id);
 assert.match(html,/type="datetime-local"/);
 assert.match(news,/timeZone:"Asia\/Manila"/);
 assert.match(news,/new Date\(time\+":00\+08:00"\)/);
 assert.match(news,/p_expires:data\.expires\?\?null/);
 assert.match(news,/dom\("p7-expires"\)\.value=manilaLocal\(post\.expires_at\)/);
 assert.match(news,/bn_p7_notifications_read_all/);
 assert.match(news,/dom\("p7-read-all"\)\.disabled=working\|\|unread===0/);
 assert.ok(html.includes('id="p7-cancel-edit"'));
 assert.match(news,/dom\("p7-cancel-edit"\)\.hidden=false/);
 assert.match(news,/dom\("p7-cancel-edit"\)\.hidden=true/);
 assert.match(news,/post\.dataset\.announcement===id/);
 assert.match(read("css/phase67.css"),/\.bn-p67 \[hidden\]\{display:none!important\}/);
});
