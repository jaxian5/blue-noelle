-- Revoke anonymous execution of Blue Noelle SECURITY DEFINER RPCs.
-- Supabase may explicitly grant API function rights to anon despite earlier
-- REVOKE FROM PUBLIC, so revoke from the role directly.
revoke execute on function public.bn_has_class_role(uuid,text[]) from anon;
revoke execute on function public.bn_class_directory(uuid) from anon;
revoke execute on function public.bn_update_member(uuid,text,text) from anon;
