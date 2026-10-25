-- Blue Noelle: class operations (apply after initial classroom migration).
-- Only active Admin can edit schedule or member roles; Moderator may review
-- pending members but cannot promote Admins or edit roles.
create table if not exists public."ScheduleSlot" (
 id uuid primary key default gen_random_uuid(),
 class_id uuid not null references public."Class"(id),
 subject_id uuid references public."Subject"(id),
 day_of_week smallint not null check (day_of_week between 0 and 6),
 start_local time not null, end_local time not null,
 label text not null default '',
 created_at timestamptz not null default now(),
 constraint positive_slot check (start_local < end_local)
);
create table if not exists public."ScheduleException" (
 id uuid primary key default gen_random_uuid(),
 class_id uuid not null references public."Class"(id),
 exception_date date not null,
 kind text not null check (kind in ('holiday','cancelled','special','rescheduled')),
 note text not null default '',
 replacement_start_local time,
 replacement_end_local time,
 created_at timestamptz not null default now(),
 constraint replacement_range check (
 replacement_start_local is null and replacement_end_local is null
 or replacement_start_local is not null and replacement_end_local is not null
 and replacement_start_local < replacement_end_local)
);
alter table public."ScheduleSlot" enable row level security;
alter table public."ScheduleException" enable row level security;
create policy "member schedule read" on public."ScheduleSlot" for select to authenticated using (public.bn_has_class_role(class_id));
create policy "admin schedule insert" on public."ScheduleSlot" for insert to authenticated with check (public.bn_has_class_role(class_id,array['Admin']::text[]));
create policy "admin schedule update" on public."ScheduleSlot" for update to authenticated using (public.bn_has_class_role(class_id,array['Admin']::text[])) with check (public.bn_has_class_role(class_id,array['Admin']::text[]));
create policy "admin schedule delete" on public."ScheduleSlot" for delete to authenticated using (public.bn_has_class_role(class_id,array['Admin']::text[]));
create policy "member exception read" on public."ScheduleException" for select to authenticated using (public.bn_has_class_role(class_id));
create policy "admin exception insert" on public."ScheduleException" for insert to authenticated with check (public.bn_has_class_role(class_id,array['Admin']::text[]));
create policy "admin exception update" on public."ScheduleException" for update to authenticated using (public.bn_has_class_role(class_id,array['Admin']::text[])) with check (public.bn_has_class_role(class_id,array['Admin']::text[]));
create policy "admin exception delete" on public."ScheduleException" for delete to authenticated using (public.bn_has_class_role(class_id,array['Admin']::text[]));

-- Return only names of users in the requested class; no emails or credentials.
create or replace function public.bn_class_directory(p_class uuid)
returns table (membership_id uuid, full_name text, role text, status text)
language sql stable security definer set search_path = ''
as $$
 select m.id, u.full_name, m.role, m.status
 from public."ClassMembership" m join public."User" u on u.id=m.user_id
 where m.class_id=p_class and public.bn_has_class_role(p_class,array['Admin','Moderator']::text[])
 order by u.full_name;
$$;
revoke all on function public.bn_class_directory(uuid) from public;
grant execute on function public.bn_class_directory(uuid) to authenticated;

-- Executed inside one transaction, server-side authority and audit trail.
create table if not exists public."ClassActionLog" (
 id uuid primary key default gen_random_uuid(),
 class_id uuid not null references public."Class"(id),
 actor_id uuid not null references public."User"(id),
 target_membership_id uuid references public."ClassMembership"(id),
 action text not null,
 before_value jsonb, after_value jsonb,
 created_at timestamptz not null default now()
);
alter table public."ClassActionLog" enable row level security;
create policy "admin action log read" on public."ClassActionLog" for select to authenticated using (public.bn_has_class_role(class_id,array['Admin']::text[]));

create or replace function public.bn_update_member(p_membership uuid, p_role text, p_status text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_target public."ClassMembership"%rowtype; v_actor uuid := (select auth.uid());
begin
 if v_actor is null then raise exception 'Authentication required'; end if;
 select * into v_target from public."ClassMembership" where id=p_membership for update;
 if not found then raise exception 'Membership not found'; end if;
 if not public.bn_has_class_role(v_target.class_id,array['Admin']::text[]) then
   raise exception 'Only class administrators may manage memberships';
 end if;
 if p_role not in ('Student','Moderator','Admin') or p_status not in ('PENDING','ACTIVE','REJECTED','REMOVED') then
   raise exception 'Invalid role or membership status';
 end if;
 if v_target.user_id=v_actor and (p_role<>'Admin' or p_status<>'ACTIVE') then
   raise exception 'Administrators cannot deactivate or demote themselves here';
 end if;
 if v_target.role='Admin' and p_role<>'Admin' and (
   select count(*) from public."ClassMembership" where class_id=v_target.class_id
     and role='Admin' and status='ACTIVE'
 ) <= 1 then raise exception 'Cannot remove the last active administrator'; end if;
 update public."ClassMembership" set role=p_role,status=p_status,
   joined_at=case when p_status='ACTIVE' then coalesce(joined_at,now()) else joined_at end,
   removed_at=case when p_status='REMOVED' then now() else null end
 where id=p_membership;
 insert into public."ClassActionLog"(class_id,actor_id,target_membership_id,action,before_value,after_value)
 values(v_target.class_id,v_actor,p_membership,'MEMBERSHIP_UPDATED',
 jsonb_build_object('role',v_target.role,'status',v_target.status),
 jsonb_build_object('role',p_role,'status',p_status));
end $$;
revoke all on function public.bn_update_member(uuid,text,text) from public;
grant execute on function public.bn_update_member(uuid,text,text) to authenticated;
