-- Move existing security-definer management implementations out of the public API
-- while retaining SECURITY INVOKER compatibility wrappers for existing frontend RPCs.
-- All existing authorization checks and public signatures remain intact.
do $$
declare v_name text; v_def text;
begin
 foreach v_name in array array['bn_has_class_role','bn_class_directory','bn_update_member'] loop
   select pg_get_functiondef(p.oid) into v_def
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname=v_name;
   if v_def is null then raise exception 'Expected function % not found',v_name; end if;
   v_def := replace(v_def,
     'FUNCTION public.'||v_name||'(',
     'FUNCTION bn_private.'||v_name||'_impl(');
   execute v_def;
 end loop;
end $$;
revoke all on function bn_private.bn_has_class_role_impl(uuid,text[]) from public,anon;
revoke all on function bn_private.bn_class_directory_impl(uuid) from public,anon;
revoke all on function bn_private.bn_update_member_impl(uuid,text,text) from public,anon;
grant usage on schema bn_private to authenticated;
grant execute on function bn_private.bn_has_class_role_impl(uuid,text[]) to authenticated;
grant execute on function bn_private.bn_class_directory_impl(uuid) to authenticated;
grant execute on function bn_private.bn_update_member_impl(uuid,text,text) to authenticated;

-- Important: retaining original API signatures preserves existing RLS policies.
create or replace function public.bn_has_class_role(
 p_class uuid,p_roles text[] default array['Student','Moderator','Admin']::text[])
returns boolean language sql stable security invoker set search_path = ''
as $$ select bn_private.bn_has_class_role_impl(p_class,p_roles) $$;
create or replace function public.bn_class_directory(p_class uuid)
returns table(membership_id uuid, full_name text, role text, status text)
language sql stable security invoker set search_path = ''
as $$ select * from bn_private.bn_class_directory_impl(p_class) $$;
create or replace function public.bn_update_member(p_membership uuid,p_role text,p_status text)
returns void language sql security invoker set search_path = ''
as $$ select bn_private.bn_update_member_impl(p_membership,p_role,p_status) $$;

revoke execute on function public.bn_has_class_role(uuid,text[]),
 public.bn_class_directory(uuid),public.bn_update_member(uuid,text,text) from public,anon;
grant execute on function public.bn_has_class_role(uuid,text[]),
 public.bn_class_directory(uuid),public.bn_update_member(uuid,text,text) to authenticated;
