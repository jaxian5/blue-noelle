import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {Script} from "node:vm";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const read=p=>readFileSync(resolve(root,p),"utf8");
const sql=read("supabase/migrations/20261026150000_phase5_private_compilation_artifacts.sql");
const edge=read("supabase/functions/bn-phase5-compilation/index.ts");
const ui=read("js/phase5-groups.js");
const html=read("pages/phase5-groups.html");

test("Private generated artifacts have durable provenance and no direct browser Data API grant",()=>{
 for(const text of ['"CompilationExport"','"Compilation"','source_version_id',
   'export_id','"bn-compilations"','bn_compilation_one_source_per_export']){
   assert.ok(sql.includes(text),text);
 }
 assert.match(sql,/ALTER TABLE public\."CompilationExport" ENABLE ROW LEVEL SECURITY/);
 assert.match(sql,/REVOKE ALL ON public\."CompilationExport" FROM PUBLIC,anon,authenticated/);
 assert.match(sql,/REVOKE ALL ON public\."Compilation" FROM PUBLIC,anon,authenticated/);
 assert.match(sql,/storage\.buckets/);
 assert.match(sql,/public=false/);
 assert.doesNotMatch(sql,/CREATE POLICY[\s\S]*bn-compilations/);
});
test("User-scoped SQL locks the actual submitted historical version and enforces 20 MiB/48 file caps",()=>{
 assert.match(sql,/bn_p5_export_start_impl/);
 assert.match(sql,/bn_p5_export_staff\(p_assignment\)/);
 assert.match(sql,/m\.status='ACTIVE'/);
 assert.match(sql,/m\.role IN \('Admin','Moderator'\)/);
 assert.match(sql,/pg_advisory_xact_lock/);
 assert.match(sql,/source_count/);
 assert.match(sql,/fileCount>48 OR byteCount>20971520/);
 assert.match(sql,/v\.submitted_at IS NOT NULL/);
 assert.match(sql,/v\.upload_state='READY'/);
 assert.match(sql,/ORDER BY v\.version_number DESC LIMIT 1/);
 assert.match(sql,/f\.upload_state='READY'/);
 assert.match(sql,/f\.deleted_at IS NULL/);
 assert.match(sql,/PDF compilations require only PDF files/);
 assert.match(sql,/INSERT INTO public\."Compilation"\(submission_id,source_version_id,export_id,generated_by\)/);
});
test("Only service role can attest built file digest and size",()=>{
 assert.match(sql,/CREATE OR REPLACE FUNCTION public\.bn_p5_export_finish/);
 assert.match(sql,/REVOKE ALL ON FUNCTION public\.bn_p5_export_finish\(uuid,boolean,bigint,text,text\)[\s\S]*?PUBLIC,anon,authenticated/);
 assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.bn_p5_export_finish\(uuid,boolean,bigint,text,text\)[\s\S]*?TO service_role/);
 assert.match(sql,/p_sha256 !~ '\^\[a-f0-9\]\{64\}\$'/);
 assert.match(sql,/COMPILATION_BUILD_STARTED/);
 assert.match(sql,/COMPILATION_BUILD_READY/);
 assert.match(sql,/COMPILATION_BUILD_FAILED/);
 assert.match(sql,/COMPILATION_DOWNLOAD_REQUESTED/);
});
test("Edge requires JWT Auth + user-scoped RPC before any private service-key read",()=>{
 assert.match(edge,/auth\.getUser\(token\)/);
 assert.match(edge,/verify JWT at the Supabase gateway|Verify JWT at the Supabase gateway/);
 assert.match(edge,/SUPABASE_SERVICE_ROLE_KEY/);
 assert.match(edge,/bn_p5_export_start/);
 assert.match(edge,/bn_p5_export_access/);
 assert.match(edge,/bn_p5_export_finish/);
 assert.match(edge,/storage\.from\(SOURCES\)\.download/);
 assert.match(edge,/storage\.from\(BUCKET\)\.upload/);
 assert.match(edge,/storage\.from\(BUCKET\)\.download/);
 assert.match(edge,/storage\.from\(BUCKET\)\.remove/);
 assert.match(edge,/cacheControl: "0", upsert: false/);
 assert.match(edge,/await hash\(bytes\) !== grant\.sha256/);
 assert.doesNotMatch(edge,/getPublicUrl|createSignedUrl|localStorage|user_metadata/);
});
test("ZIP keeps mixed files; PDF sources must be PDF and are merged page-by-page",()=>{
 assert.match(edge,/pdf-lib@1\.17\.1/);
 assert.match(edge,/fflate@0\.8\.2/);
 assert.match(edge,/PDFDocument\.load/);
 assert.match(edge,/doc\.copyPages/);
 assert.match(edge,/zipSync/);
 assert.match(edge,/COMPILATION-MANIFEST\.json/);
 assert.match(edge,/source\.mime !== "application\/pdf"/);
 assert.match(edge,/file\.sha256 && await hash\(bytes\)/);
 assert.match(edge,/MAX_SOURCE_BYTES = 20 \* 1024 \* 1024/);
 assert.match(edge,/MAX_OUTPUT_BYTES = 24 \* 1024 \* 1024/);
 assert.match(edge,/MAX_FILES = 48/);
});
test("Generated-file UI honors staff-only panel and never includes service key or raw Storage URLs",()=>{
 assert.doesNotThrow(()=>new Script(ui));
 for(const id of ["p5-generated","p5-build-pdf","p5-build-zip","p5-history","p5-build-status"]){
   assert.ok(html.includes('id="'+id+'"'),id);
 }
 assert.match(ui,/bn_p5_export_history/);
 assert.match(ui,/functions\.invoke\("bn-phase5-compilation"/);
 assert.match(ui,/action:"build"/);
 assert.match(ui,/action:"download"/);
 assert.match(ui,/\["Admin","Moderator"\]\.includes\(role\)/);
 assert.match(ui,/p5-generated"\)\.hidden/);
 assert.match(ui,/URL\.revokeObjectURL/);
 assert.doesNotMatch(ui,/getPublicUrl\(|service_role|\.from\("CompilationExport"\)/);
});
