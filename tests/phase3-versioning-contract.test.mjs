import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const sql=readFileSync(resolve(root,"supabase/migrations/20261025222705_phase3_immutable_version_snapshots.sql"),"utf8");
test("resubmission keeps V1 snapshot while storing new READY version snapshot",()=>{
  assert.match(sql,/ADD COLUMN IF NOT EXISTS submitted_at timestamptz/);
  assert.match(sql,/guard_version_submission_snapshot/);
  assert.match(sql,/OLD\.status='SUBMITTED' AND NEW\.status='DRAFT'/);
  assert.match(sql,/v\.submitted_at IS NOT DISTINCT FROM OLD\.submitted_at/);
  assert.match(sql,/UPDATE public\."SubmissionVersion" SET upload_state='READY',\s*submitted_at=now\(\),deadline_at_submission=a\.deadline/);
  assert.match(sql,/'submitted_at',v\.submitted_at/);
  assert.match(sql,/'deadline_at_submission',v\.deadline_at_submission/);
  assert.doesNotMatch(sql,/DROP TRIGGER IF EXISTS bn_submission_timestamp_guard/);
});
