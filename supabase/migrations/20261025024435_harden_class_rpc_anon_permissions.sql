-- Applied to Supabase project zllphzqalkurnibfctyl as
-- remote migration 20261025024435_harden_class_rpc_anon_permissions.
-- Supabase grants anon EXECUTE explicitly on newly created public RPCs.
-- REVOKE FROM PUBLIC alone does not override that explicit role grant.
revoke execute on function public.bn_has_class_role(uuid,text[]) from anon;
revoke execute on function public.bn_class_directory(uuid) from anon;
revoke execute on function public.bn_update_member(uuid,text,text) from anon;
