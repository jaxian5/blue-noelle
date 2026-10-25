-- Blue Noelle: Supabase foundation, Phase 1/2 only.
-- Apply through Supabase migrations, NOT alongside docs/schema.sql (legacy design draft).
-- Supabase Auth owns passwords in auth.users; this schema stores no passwords.
create extension if not exists pgcrypto;

create table if not exists public."User" (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  username text not null unique,
  full_name text not null,
  student_id text,
  avatar_storage_key text,
  is_developer boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public."Class" (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  section text,
  timezone text not null default 'Asia/Manila',
  created_at timestamptz not null default now()
);
create table if not exists public."ClassMembership" (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public."User"(id),
  class_id uuid not null references public."Class"(id),
  role text not null default 'Student' check (role in ('Student','Moderator','Admin')),
  status text not null default 'PENDING' check (status in ('PENDING','ACTIVE','REJECTED','REMOVED')),
  joined_at timestamptz,
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, class_id)
);
create table if not exists public."Subject" (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public."Class"(id),
  name text not null check (length(btrim(name)) > 0),
  created_by uuid references public."User"(id),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create table if not exists public."Assignment" (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public."Subject"(id),
  name text not null check (length(btrim(name)) > 0),
  description text not null default '',
  instructions text not null default '',
  deadline timestamptz,
  is_group boolean not null default false,
  required_file_types text[] not null default '{}',
  max_file_size_bytes bigint check (max_file_size_bytes is null or max_file_size_bytes > 0),
  status text not null default 'OPEN' check (status in ('OPEN','CLOSED','ARCHIVED')),
  created_by uuid references public."User"(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists bn_member_user_class on public."ClassMembership"(user_id,class_id);
create index if not exists bn_subject_class on public."Subject"(class_id);
create index if not exists bn_assignment_subject on public."Assignment"(subject_id);

-- SECURITY DEFINER avoids recursively querying ClassMembership under its own RLS.
-- No caller-controlled arguments are used for SQL identifiers; search_path is fixed.
create or replace function public.bn_has_class_role(p_class uuid, p_roles text[] default array['Student','Moderator','Admin'])
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public."ClassMembership" m
    where m.class_id = p_class and m.user_id = (select auth.uid())
      and m.status = 'ACTIVE' and m.role = any(p_roles)
  );
$$;
revoke all on function public.bn_has_class_role(uuid,text[]) from public;
grant execute on function public.bn_has_class_role(uuid,text[]) to authenticated;

alter table public."User" enable row level security;
alter table public."Class" enable row level security;
alter table public."ClassMembership" enable row level security;
alter table public."Subject" enable row level security;
alter table public."Assignment" enable row level security;

-- Users may read their own profile, never edit privileged attributes in the client.
create policy "self profile read" on public."User"
  for select to authenticated using (id = (select auth.uid()));

create policy "active class read" on public."Class"
  for select to authenticated using (public.bn_has_class_role(id));

create policy "own memberships read" on public."ClassMembership"
  for select to authenticated using (user_id = (select auth.uid()));

create policy "active member subject read" on public."Subject"
  for select to authenticated using (deleted_at is null and public.bn_has_class_role(class_id));
create policy "admin subject insert" on public."Subject"
  for insert to authenticated with check (
    public.bn_has_class_role(class_id,array['Admin']::text[]) and created_by = (select auth.uid())
  );
create policy "admin subject update" on public."Subject"
  for update to authenticated
  using (public.bn_has_class_role(class_id,array['Admin']::text[]))
  with check (public.bn_has_class_role(class_id,array['Admin']::text[]));

create policy "active member assignment read" on public."Assignment"
  for select to authenticated using (
    deleted_at is null and exists (
      select 1 from public."Subject" s where s.id = subject_id
      and public.bn_has_class_role(s.class_id)
    )
  );
create policy "admin assignment insert" on public."Assignment"
  for insert to authenticated with check (
    created_by = (select auth.uid()) and exists (
      select 1 from public."Subject" s where s.id = subject_id
      and public.bn_has_class_role(s.class_id,array['Admin']::text[])
    )
  );
create policy "admin assignment update" on public."Assignment"
  for update to authenticated using (
    exists (select 1 from public."Subject" s where s.id = subject_id
      and public.bn_has_class_role(s.class_id,array['Admin']::text[]))
  ) with check (
    exists (select 1 from public."Subject" s where s.id = subject_id
      and public.bn_has_class_role(s.class_id,array['Admin']::text[]))
  );

-- Important: profile/membership creation, invitations, verification and role
-- changes require trusted server-side functions or Edge Functions (not yet built).
-- A future migration must also prevent changing sensitive ownership fields on UPDATE.
