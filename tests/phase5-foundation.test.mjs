import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {Script} from "node:vm";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const read=path=>readFileSync(resolve(root,path),"utf8");
const page=read("pages/phase5-groups.html");
const ui=read("js/phase5-groups.js");
const sql=read("supabase/migrations/20261026063125_phase5_group_integrity_compilation_manifest.sql");

test("Phase 5 workspace uses real auth, shared navigation and no demos",()=>{
 assert.doesNotThrow(()=>new Script(ui));
 assert.match(page,/workspace-shell\.js/);
 assert.match(page,/phase5-groups\.js/);
 assert.match(page,/id="p5-class"/);
 assert.match(page,/id="p5-assignment"/);
 assert.match(page,/id="p5-student"/);
 assert.match(page,/id="p5-staff"/);
 assert.match(page,/id="p5-compilation"/);
 assert.match(ui,/auth\.getUser\(\)/);
 assert.match(ui,/ClassMembership/);
 assert.match(ui,/eq\("status","ACTIVE"\)/);
 assert.doesNotMatch(ui,/service_role|sb_secret_|getPublicUrl|localStorage/);
});
test("Group changes reuse Phase 3's audited API rather than direct table writes",()=>{
 assert.match(ui,/bn_p3_groups/);
 assert.match(ui,/p_action:action/);
 assert.match(ui,/bn_p3_my_group/);
 assert.match(ui,/groupCall\("create"/);
 assert.match(ui,/groupCall\("add_member"/);
 assert.match(ui,/groupCall\("remove_member"/);
 assert.match(ui,/role!=="Admin"/);
 assert.doesNotMatch(ui,/\.from\(["'](?:Group|GroupMembership)["']\)/);
});
test("Compilation uses staff-only guard, submitted historical version and metadata-only records",()=>{
 assert.match(sql,/m\.role IN \('Admin','Moderator'\)/);
 assert.match(sql,/m\.status='ACTIVE'/);
 assert.match(sql,/vv\.upload_state='READY'/);
 assert.match(sql,/vv\.submitted_at IS NOT NULL/);
 assert.match(sql,/ORDER BY vv\.version_number DESC LIMIT 1/);
 assert.match(sql,/sub\.status<>'DELETED'/);
 assert.match(sql,/f\.upload_state='READY'/);
 assert.match(sql,/f\.deleted_at IS NULL/);
 assert.match(sql,/'contains_private_file_urls',false/);
 assert.doesNotMatch(sql,/['"]storage_key['"]|getPublicUrl|service_role/);
 assert.match(sql,/COMPILATION_MANIFEST_EXPORTED/);
 assert.match(sql,/REVOKE ALL ON TABLE public\."Compilation",public\."Group",public\."GroupMembership"/);
 assert.doesNotMatch(sql,/GRANT (?:ALL|SELECT|INSERT|UPDATE|DELETE) ON (?:TABLE )?public\."Compilation"/i);
});
test("Group membership cannot silently change after an uploaded submission draft",()=>{
 assert.match(sql,/bn_p5_group_membership_freeze/);
 assert.match(sql,/BEFORE INSERT OR UPDATE OF group_id,user_id,removed_at OR DELETE/);
 assert.match(sql,/Group membership is locked after a submission draft exists/);
 assert.match(sql,/sub\.group_id=v_group/);
 assert.match(sql,/sub\.deleted_at IS NULL/);
 assert.match(sql,/sub\.status<>'DELETED'/);
});
test("Manifest download is generated only from server-verified rows, not raw Storage links",()=>{
 assert.match(ui,/bn_p5_compilation/);
 assert.match(ui,/p_export:doExport/);
 assert.match(ui,/JSON\.stringify\(manifest,null,2\)/);
 assert.match(ui,/application\/json/);
 assert.match(ui,/revokeObjectURL/);
 assert.doesNotMatch(ui,/\.storage\.from\(|\.getPublicUrl\(/);
 assert.match(ui,/role==="Admin"/);
 assert.match(ui,/\["Admin","Moderator"\]\.includes\(role\)/);
});
test("Phase 5 respects role-aware light and dark palettes",()=>{
 const styles=read("css/phase5.css");
 for(const token of ["--ui-surface","--ui-text","--ui-muted","--role-ink","--role-soft","--ui-info-bg","--ui-error-bg"]){
  assert.ok(styles.includes("var("+token+")"),token);
 }
 assert.match(styles,/@media\(max-width:900px\)/);
 assert.match(page,/css\/theme\.css/);
});

test("Moderator group roster stays read-only and current class selection discards stale RPC results",()=>{
 const readModel=read("supabase/migrations/20261026063345_phase5_staff_group_read.sql");
 assert.match(readModel,/bn_p5_groups_read_impl/);
 assert.match(readModel,/cm\.role IN \('Admin','Moderator'\)/);
 assert.match(readModel,/'locked',EXISTS/);
 assert.match(readModel,/gm\.removed_at IS NULL/);
 assert.match(readModel,/REVOKE ALL ON FUNCTION public\.bn_p5_groups_read\(uuid\) FROM PUBLIC,anon/);
 assert.match(ui,/bn_p5_groups_read/);
 assert.match(ui,/viewerRole==="Admin"/);
 assert.match(ui,/group\.locked/);
 assert.match(ui,/turn!==requestId\|\|active\?\.id!==wanted/);
 assert.match(ui,/turn!==requestId\|\|id!==\$\("p5-class"\)\.value/);
 assert.doesNotMatch(ui,/\.from\("GroupMembership"\)/);
});
