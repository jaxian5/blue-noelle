-- Personal profile editing for authenticated Blue Noelle accounts.
-- Classroom roles and email identity remain admin/Supabase controlled.
-- Private 2 MiB avatar objects are readable and writable only by their owner.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES ('bn-avatars','bn-avatars',false,2097152,ARRAY['image/png','image/jpeg','image/webp']::text[])
ON CONFLICT (id) DO NOTHING;

-- The app only updates the display name. Never grant control of account_type,
-- is_developer, verified email, class roles or other authorization fields.
GRANT UPDATE(full_name) ON public."User" TO authenticated;
DROP POLICY IF EXISTS "self profile update name" ON public."User";
CREATE POLICY "self profile update name" ON public."User"
 FOR UPDATE TO authenticated
 USING (id=(SELECT auth.uid()))
 WITH CHECK (id=(SELECT auth.uid()));

-- The key is deterministic, e.g. <auth.uid()>/avatar. No path traversal,
-- cross-user overwrite or public download is permitted.
DROP POLICY IF EXISTS bn_avatar_owner_insert ON storage.objects;
CREATE POLICY bn_avatar_owner_insert ON storage.objects FOR INSERT TO authenticated
 WITH CHECK (bucket_id='bn-avatars'
  AND name=(SELECT auth.uid())::text||'/avatar');
DROP POLICY IF EXISTS bn_avatar_owner_select ON storage.objects;
CREATE POLICY bn_avatar_owner_select ON storage.objects FOR SELECT TO authenticated
 USING (bucket_id='bn-avatars'
  AND name=(SELECT auth.uid())::text||'/avatar');
DROP POLICY IF EXISTS bn_avatar_owner_update ON storage.objects;
CREATE POLICY bn_avatar_owner_update ON storage.objects FOR UPDATE TO authenticated
 USING (bucket_id='bn-avatars'
  AND name=(SELECT auth.uid())::text||'/avatar')
 WITH CHECK (bucket_id='bn-avatars'
  AND name=(SELECT auth.uid())::text||'/avatar');
DROP POLICY IF EXISTS bn_avatar_owner_delete ON storage.objects;
CREATE POLICY bn_avatar_owner_delete ON storage.objects FOR DELETE TO authenticated
 USING (bucket_id='bn-avatars'
  AND name=(SELECT auth.uid())::text||'/avatar');
