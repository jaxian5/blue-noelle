-- Applied to the hosted Supabase project as auth_profile_and_data_api_permissions.
-- NOTE: this git filename is for source review; reconcile with remote migration
-- history before running supabase db push.
create schema if not exists bn_private;
revoke all on schema bn_private from public, anon, authenticated;
create or replace function bn_private.create_blue_noelle_profile()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public."User"(id,email,username,full_name)
  values (new.id,coalesce(new.email,'user-' || new.id::text || '@no-email.invalid'),
    'bn_' || replace(new.id::text,'-',''),
    coalesce(nullif(left(btrim(new.raw_user_meta_data ->> 'full_name'),120),''),
      split_part(coalesce(new.email,'New Student'),'@',1)))
  on conflict(id) do nothing;
  return new;
end $$;
revoke all on function bn_private.create_blue_noelle_profile() from public,anon,authenticated;
do $$
begin
 if not exists(select 1 from pg_trigger where tgname='bn_on_auth_user_created'
  and tgrelid='auth.users'::regclass) then
  create trigger bn_on_auth_user_created after insert on auth.users
   for each row execute function bn_private.create_blue_noelle_profile();
 end if;
end $$;
grant usage on schema public to authenticated;
grant select on public."User",public."Class",public."ClassMembership",public."Subject",
 public."Assignment",public."ScheduleSlot",public."ScheduleException",public."ClassActionLog" to authenticated;
grant insert on public."Subject",public."Assignment",public."ScheduleSlot",public."ScheduleException" to authenticated;
revoke update on public."Subject",public."Assignment",public."ScheduleSlot",public."ScheduleException" from authenticated;
grant update(name,deleted_at) on public."Subject" to authenticated;
grant update(name,description,instructions,deadline,is_group,required_file_types,max_file_size_bytes,status,deleted_at) on public."Assignment" to authenticated;
grant update(subject_id,day_of_week,start_local,end_local,label) on public."ScheduleSlot" to authenticated;
grant update(exception_date,kind,note,replacement_start_local,replacement_end_local) on public."ScheduleException" to authenticated;
grant delete on public."ScheduleSlot",public."ScheduleException" to authenticated;
revoke all on public."ClassActionLog" from anon;
revoke execute on function public.bn_has_class_role(uuid,text[]),
 public.bn_class_directory(uuid),public.bn_update_member(uuid,text,text) from anon;
grant execute on function public.bn_has_class_role(uuid,text[]),
 public.bn_class_directory(uuid),public.bn_update_member(uuid,text,text) to authenticated;
create or replace function bn_private.ensure_schedule_subject_class()
returns trigger language plpgsql set search_path = ''
as $$
begin
 if new.subject_id is not null and not exists(
  select 1 from public."Subject" s where s.id=new.subject_id
   and s.class_id=new.class_id and s.deleted_at is null
 ) then
  raise exception 'Schedule subject must belong to the same active class';
 end if;
 return new;
end $$;
revoke all on function bn_private.ensure_schedule_subject_class() from public,anon,authenticated;
drop trigger if exists bn_schedule_subject_class on public."ScheduleSlot";
create trigger bn_schedule_subject_class before insert or update of class_id,subject_id
 on public."ScheduleSlot" for each row execute function bn_private.ensure_schedule_subject_class();
