-- Multi-class Admin/Student registration, ownership, and one-class limit.
alter table public."User"
 add column if not exists account_type text not null default 'Student'
 constraint bn_user_account_type_check check(account_type in ('Student','Admin'));
alter table public."Class"
 add column if not exists owner_user_id uuid references public."User"(id);
create unique index if not exists bn_one_owned_class_per_admin
 on public."Class"(owner_user_id) where owner_user_id is not null;

create or replace function bn_private.create_blue_noelle_profile()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
 insert into public."User"(id,email,username,full_name,account_type)
 values(new.id,coalesce(new.email,'user-'||new.id::text||'@no-email.invalid'),
   'bn_'||replace(new.id::text,'-',''),
   coalesce(nullif(left(btrim(new.raw_user_meta_data->>'full_name'),120),''),
     split_part(coalesce(new.email,'New Student'),'@',1)),
   case when new.raw_user_meta_data->>'registration_type'='Admin'
     then 'Admin' else 'Student' end)
 on conflict(id) do nothing;
 return new;
end $$;
revoke all on function bn_private.create_blue_noelle_profile() from public,anon,authenticated;

create or replace function bn_private.guard_owner_membership()
returns trigger language plpgsql set search_path=''
as $$
declare v_owner uuid;v_type text;
begin
 select owner_user_id into v_owner from public."Class" where id=new.class_id;
 select account_type into v_type from public."User" where id=new.user_id;
 if new.role='Admin' then
  if v_type is distinct from 'Admin'
     or v_owner is distinct from new.user_id
     or new.status<>'ACTIVE' then
   raise exception 'Admin membership must be ACTIVE and owned by its registered class creator';
  end if;
 elsif v_type='Admin' then
  raise exception 'Admin-registered accounts may belong only to their owned class';
 end if;
 if TG_OP='UPDATE' and old.role='Admin'
    and (new.role<>'Admin' or new.status<>'ACTIVE'
         or new.user_id<>old.user_id or new.class_id<>old.class_id) then
  raise exception 'An owned-class Admin cannot be demoted, removed or transferred';
 end if;
 return new;
end $$;
revoke all on function bn_private.guard_owner_membership() from public,anon,authenticated;
drop trigger if exists bn_guard_owner_membership on public."ClassMembership";
create trigger bn_guard_owner_membership
 before insert or update on public."ClassMembership"
 for each row execute function bn_private.guard_owner_membership();

create or replace function bn_private.create_owned_class_impl(p_name text,p_section text default null)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
 v_actor uuid:=(select auth.uid());
 v_type text;v_class uuid;
 v_name text:=btrim(coalesce(p_name,''));
 v_section text:=nullif(btrim(coalesce(p_section,'')),'');
begin
 if v_actor is null then raise exception 'Sign in before creating a class'; end if;
 if not exists(select 1 from auth.users where id=v_actor and email_confirmed_at is not null)
 then raise exception 'Confirm your email before creating a class'; end if;
 if char_length(v_name)<3 or char_length(v_name)>100 then
  raise exception 'Class name must contain 3 to 100 characters';
 end if;
 if char_length(coalesce(v_section,''))>80 then
  raise exception 'Section must have at most 80 characters';
 end if;
 select account_type into v_type from public."User" where id=v_actor for update;
 if v_type is distinct from 'Admin' then
  raise exception 'This account was registered as Student and cannot create a class';
 end if;
 if exists(select 1 from public."Class" where owner_user_id=v_actor) then
  raise exception 'An Admin account may create only one class';
 end if;
 if exists(select 1 from public."ClassMembership" where user_id=v_actor) then
  raise exception 'Admin accounts cannot own another class while holding other memberships';
 end if;
 insert into public."Class"(name,section,timezone,owner_user_id)
 values(v_name,v_section,'Asia/Manila',v_actor) returning id into v_class;
 insert into public."ClassMembership"(user_id,class_id,role,status,joined_at)
 values(v_actor,v_class,'Admin','ACTIVE',now());
 insert into public."AuditLog"(actor_id,actor_role_at_time,class_id,action,target_type,target_id,metadata)
 values(v_actor,'Admin',v_class,'CLASS_CREATED','Class',v_class,
  jsonb_build_object('name',v_name,'section',v_section));
 return jsonb_build_object('ok',true,'id',v_class,'name',v_name,'role','Admin');
end $$;
revoke all on function bn_private.create_owned_class_impl(text,text) from public,anon;
grant execute on function bn_private.create_owned_class_impl(text,text) to authenticated;

create or replace function public.bn_create_owned_class(p_name text,p_section text default null)
returns jsonb language sql security invoker set search_path=''
as $$ select bn_private.create_owned_class_impl(p_name,p_section) $$;
revoke execute on function public.bn_create_owned_class(text,text) from PUBLIC,anon;
grant execute on function public.bn_create_owned_class(text,text) to authenticated;
