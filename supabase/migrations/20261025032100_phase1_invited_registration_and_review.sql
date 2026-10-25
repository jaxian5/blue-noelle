-- Blue Noelle Phase 1: secure invited registration + moderator review.
-- Design: signUp is Supabase Auth; redeem requires an authenticated CONFIRMED email.
-- Public wrappers are SECURITY INVOKER; privileged implementation is in private schema.
create table if not exists bn_private."InviteAttempt" (
 id bigint generated always as identity primary key,
 user_id uuid not null references public."User"(id),
 created_at timestamptz not null default now(),
 successful boolean not null default false
);
create index if not exists bn_invite_attempt_user_time
 on bn_private."InviteAttempt"(user_id,created_at desc);
alter table bn_private."InviteAttempt" enable row level security;
revoke all on bn_private."InviteAttempt" from public,anon,authenticated;
grant usage on schema bn_private to authenticated;

-- Case-insensitive usernames: no two users should differ only in capitalization.
create unique index if not exists bn_username_case_insensitive_unique
 on public."User"(lower(username));

create or replace function bn_private.issue_class_invite_impl(
 p_class uuid, p_max_uses integer default null, p_expires_at timestamptz default null)
returns text language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid()); v_code text;
begin
 if v_actor is null or not public.bn_has_class_role(p_class,array['Admin']::text[]) then
   raise exception 'Only an active class administrator may issue invites';
 end if;
 if p_max_uses is not null and (p_max_uses<1 or p_max_uses>1000) then
   raise exception 'Usage limit must be between 1 and 1000';
 end if;
 if p_expires_at is not null and (p_expires_at <= now() or p_expires_at > now() + interval '1 year') then
   raise exception 'Expiration must be in the next year';
 end if;
 v_code := 'BN-' || upper(encode(extensions.gen_random_bytes(24),'hex'));
 insert into public."InviteCode"(class_id,code_hash,created_by,max_uses,expires_at,default_role)
 values (p_class,encode(extensions.digest(v_code,'sha256'),'hex'),v_actor,p_max_uses,p_expires_at,'Student');
 insert into public."AuditLog"(actor_id,actor_role_at_time,class_id,action,target_type,metadata)
 values (v_actor,'Admin',p_class,'INVITE_CREATED','InviteCode',
         jsonb_build_object('max_uses',p_max_uses,'expires_at',p_expires_at));
 return v_code; -- The plaintext code is returned ONCE; never stored in the DB.
end $$;
revoke all on function bn_private.issue_class_invite_impl(uuid,integer,timestamptz) from public,anon;
grant execute on function bn_private.issue_class_invite_impl(uuid,integer,timestamptz) to authenticated;

create or replace function public.bn_issue_class_invite(
 p_class uuid, p_max_uses integer default null, p_expires_at timestamptz default null)
returns text language sql security invoker set search_path = ''
as $$ select bn_private.issue_class_invite_impl(p_class,p_max_uses,p_expires_at) $$;
revoke all on function public.bn_issue_class_invite(uuid,integer,timestamptz) from public,anon;
grant execute on function public.bn_issue_class_invite(uuid,integer,timestamptz) to authenticated;

create or replace function bn_private.join_class_impl(
 p_code text, p_username text, p_student_id text default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
 v_actor uuid := (select auth.uid());
 v_inv public."InviteCode"%rowtype;
 v_username text := lower(btrim(coalesce(p_username,'')));
 v_student text := nullif(btrim(coalesce(p_student_id,'')),'');
 v_membership uuid;
 v_hash text;
begin
 if v_actor is null then raise exception 'Sign in to request membership'; end if;
 if not exists (select 1 from auth.users where id=v_actor and email_confirmed_at is not null) then
    raise exception 'Confirm your email before requesting class membership';
 end if;
 if v_username !~ '^[a-z][a-z0-9_]{2,29}$' then
    raise exception 'Username must be 3–30 lowercase letters, digits or underscores, beginning with a letter';
 end if;
 if length(coalesce(v_student,''))>60 then raise exception 'Student ID is too long'; end if;
 if (select count(*) from bn_private."InviteAttempt"
     where user_id=v_actor and created_at > now() - interval '15 minutes') >= 8 then
     return jsonb_build_object('ok',false,'error','Too many requests. Try again in 15 minutes.');
 end if;
 -- Always log attempts, including invalid code: raises roll back the transaction.
 insert into bn_private."InviteAttempt"(user_id) values (v_actor);
 if p_code is null or length(p_code)>120 then
   return jsonb_build_object('ok',false,'error','Invalid or unavailable invitation');
 end if;
 v_hash := encode(extensions.digest(upper(btrim(p_code)),'sha256'),'hex');
 select * into v_inv from public."InviteCode" where code_hash=v_hash for update;
 if not found or v_inv.revoked_at is not null or
   (v_inv.expires_at is not null and v_inv.expires_at<=now()) or
   (v_inv.max_uses is not null and v_inv.use_count>=v_inv.max_uses)
 then
   return jsonb_build_object('ok',false,'error','Invalid or unavailable invitation');
 end if;
 if exists (select 1 from public."ClassMembership" where user_id=v_actor and class_id=v_inv.class_id) then
   return jsonb_build_object('ok',false,'error','You already have a membership request for this class');
 end if;
 if not exists (select 1 from public."User" where id=v_actor) then
   raise exception 'Profile not initialized. Please sign out and sign in again';
 end if;
 update public."User" set username=v_username,student_id=v_student,updated_at=now() where id=v_actor;
 insert into public."ClassMembership"(user_id,class_id,role,status)
 values (v_actor,v_inv.class_id,'Student','PENDING') returning id into v_membership;
 update public."InviteCode" set use_count=use_count+1 where id=v_inv.id;
 update bn_private."InviteAttempt" set successful=true
 where id=(select id from bn_private."InviteAttempt" where user_id=v_actor order by id desc limit 1);
 insert into public."AuditLog"(actor_id,actor_role_at_time,class_id,action,target_type,target_id,metadata)
 values(v_actor,'Student',v_inv.class_id,'REGISTRATION_REQUESTED','ClassMembership',v_membership,'{}'::jsonb);
 return jsonb_build_object('ok',true,'status','PENDING','class_id',v_inv.class_id,'membership_id',v_membership);
end $$;
revoke all on function bn_private.join_class_impl(text,text,text) from public,anon;
grant execute on function bn_private.join_class_impl(text,text,text) to authenticated;
create or replace function public.bn_join_class(p_code text,p_username text,p_student_id text default null)
returns jsonb language sql security invoker set search_path = ''
as $$ select bn_private.join_class_impl(p_code,p_username,p_student_id) $$;
revoke all on function public.bn_join_class(text,text,text) from public,anon;
grant execute on function public.bn_join_class(text,text,text) to authenticated;

create or replace function bn_private.pending_class_registrations_impl(p_class uuid)
returns table(membership_id uuid,full_name text,email text,username text,student_id text,requested_at timestamptz)
language plpgsql security definer stable set search_path = ''
as $$
begin
 if auth.uid() is null or not public.bn_has_class_role(p_class,array['Admin','Moderator']::text[]) then
   raise exception 'Only class staff may view pending registrations';
 end if;
 return query select m.id,u.full_name,u.email,u.username,u.student_id,m.created_at
  from public."ClassMembership" m join public."User" u on u.id=m.user_id
  where m.class_id=p_class and m.status='PENDING' and m.role='Student'
  order by m.created_at;
end $$;
revoke all on function bn_private.pending_class_registrations_impl(uuid) from public,anon;
grant execute on function bn_private.pending_class_registrations_impl(uuid) to authenticated;
create or replace function public.bn_pending_class_registrations(p_class uuid)
returns table(membership_id uuid,full_name text,email text,username text,student_id text,requested_at timestamptz)
language sql security invoker stable set search_path = ''
as $$ select * from bn_private.pending_class_registrations_impl(p_class) $$;
revoke all on function public.bn_pending_class_registrations(uuid) from public,anon;
grant execute on function public.bn_pending_class_registrations(uuid) to authenticated;

create or replace function bn_private.review_registration_impl(p_membership uuid,p_approve boolean)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := (select auth.uid()); v_row public."ClassMembership"%rowtype; v_role text;
begin
 if v_actor is null then raise exception 'Sign in first'; end if;
 select * into v_row from public."ClassMembership" where id=p_membership for update;
 if not found or v_row.status<>'PENDING' or v_row.role<>'Student' then
    raise exception 'Pending student registration not found';
 end if;
 if not public.bn_has_class_role(v_row.class_id,array['Moderator','Admin']::text[]) then
    raise exception 'Only class staff may review registrations';
 end if;
 if v_row.user_id=v_actor then raise exception 'You cannot approve your own registration'; end if;
 select role into v_role from public."ClassMembership"
  where class_id=v_row.class_id and user_id=v_actor and status='ACTIVE';
 update public."ClassMembership" set
  status=case when p_approve then 'ACTIVE' else 'REJECTED' end,
  joined_at=case when p_approve then now() else null end
 where id=p_membership;
 insert into public."ClassActionLog"(class_id,actor_id,target_membership_id,action,before_value,after_value)
 values(v_row.class_id,v_actor,p_membership,case when p_approve then 'USER_APPROVED' else 'USER_REJECTED' end,
  jsonb_build_object('status','PENDING'),jsonb_build_object('status',case when p_approve then 'ACTIVE' else 'REJECTED' end));
 insert into public."AuditLog"(actor_id,actor_role_at_time,class_id,action,target_type,target_id,metadata)
 values(v_actor,v_role,v_row.class_id,case when p_approve then 'USER_APPROVED' else 'USER_REJECTED' end,
 'ClassMembership',p_membership,jsonb_build_object('previous_status','PENDING'));
 return jsonb_build_object('ok',true,'status',case when p_approve then 'ACTIVE' else 'REJECTED' end);
end $$;
revoke all on function bn_private.review_registration_impl(uuid,boolean) from public,anon;
grant execute on function bn_private.review_registration_impl(uuid,boolean) to authenticated;
create or replace function public.bn_review_registration(p_membership uuid,p_approve boolean)
returns jsonb language sql security invoker set search_path = ''
as $$ select bn_private.review_registration_impl(p_membership,p_approve) $$;
revoke all on function public.bn_review_registration(uuid,boolean) from public,anon;
grant execute on function public.bn_review_registration(uuid,boolean) to authenticated;
