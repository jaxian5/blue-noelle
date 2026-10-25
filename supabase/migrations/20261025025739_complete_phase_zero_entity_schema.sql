-- Phase 0 model completion: create remaining entities with RLS enabled.
-- These are secure schema placeholders; UI feature implementation follows later.
create table if not exists public."InviteCode" (
 id uuid primary key default gen_random_uuid(),
 class_id uuid not null references public."Class"(id),
 code_hash text not null unique,
 created_by uuid not null references public."User"(id),
 created_at timestamptz not null default now(),
 expires_at timestamptz,
 revoked_at timestamptz,
 max_uses integer check(max_uses is null or max_uses > 0),
 use_count integer not null default 0 check(use_count >= 0),
 default_role text not null default 'Student' check(default_role in ('Student','Moderator')),
 check(max_uses is null or use_count <= max_uses)
);
create table if not exists public."Group" (
 id uuid primary key default gen_random_uuid(),
 assignment_id uuid not null references public."Assignment"(id),
 name text not null default '',
 created_at timestamptz not null default now(),
 deleted_at timestamptz,
 deleted_by uuid references public."User"(id),
 unique(id,assignment_id)
);
create table if not exists public."GroupMembership" (
 id uuid primary key default gen_random_uuid(),
 group_id uuid not null references public."Group"(id),
 user_id uuid not null references public."User"(id),
 joined_at timestamptz not null default now(),
 removed_at timestamptz,
 unique(group_id,user_id)
);
create table if not exists public."Submission" (
 id uuid primary key default gen_random_uuid(),
 assignment_id uuid not null references public."Assignment"(id),
 student_id uuid references public."User"(id),
 group_id uuid references public."Group"(id),
 status text not null default 'DRAFT' check(status in ('DRAFT','SUBMITTED','DELETED')),
 current_version_id uuid,
 submitted_at timestamptz,
 deadline_at_submission timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 deleted_at timestamptz,
 deleted_by uuid references public."User"(id),
 constraint bn_submission_owner_xor check(
  (student_id is not null and group_id is null) or
  (student_id is null and group_id is not null)),
 constraint bn_submitted_requires_current check(status <> 'SUBMITTED' or current_version_id is not null),
 constraint bn_submitted_requires_timestamp check(status <> 'SUBMITTED' or submitted_at is not null)
);
create table if not exists public."SubmissionVersion" (
 id uuid primary key default gen_random_uuid(),
 submission_id uuid not null references public."Submission"(id),
 version_number integer not null check(version_number > 0),
 uploaded_by uuid references public."User"(id),
 created_at timestamptz not null default now(),
 unique(submission_id,version_number),
 unique(id,submission_id)
);
alter table public."Submission"
 add constraint bn_current_version_owned_by_submission
 foreign key (current_version_id,id)
 references public."SubmissionVersion"(id,submission_id)
 deferrable initially deferred;

create table if not exists public."File" (
 id uuid primary key default gen_random_uuid(),
 version_id uuid not null references public."SubmissionVersion"(id),
 original_filename text not null,
 storage_key text not null unique,
 mime_type text,
 size_bytes bigint not null check(size_bytes >= 0),
 sha256 text check(sha256 is null or sha256 ~ '^[a-fA-F0-9]{64}$'),
 created_at timestamptz not null default now(),
 deleted_at timestamptz,
 deleted_by uuid references public."User"(id)
);
create table if not exists public."Compilation" (
 id uuid primary key default gen_random_uuid(),
 submission_id uuid not null references public."Submission"(id),
 source_version_id uuid not null,
 generated_file_id uuid references public."File"(id),
 generated_at timestamptz not null default now(),
 generated_by uuid references public."User"(id),
 constraint bn_compilation_source_version
 foreign key (source_version_id,submission_id)
 references public."SubmissionVersion"(id,submission_id)
);
create table if not exists public."Announcement" (
 id uuid primary key default gen_random_uuid(),
 class_id uuid not null references public."Class"(id),
 title text not null,
 message text not null,
 priority smallint not null default 0,
 author_id uuid references public."User"(id),
 pinned boolean not null default false,
 expires_at timestamptz,
 created_at timestamptz not null default now(),
 deleted_at timestamptz,
 deleted_by uuid references public."User"(id)
);
create table if not exists public."ChatMessage" (
 id uuid primary key default gen_random_uuid(),
 class_id uuid not null references public."Class"(id),
 author_id uuid not null references public."User"(id),
 body text not null,
 parent_id uuid,
 created_at timestamptz not null default now(),
 edited_at timestamptz,
 deleted_at timestamptz,
 deleted_by uuid references public."User"(id),
 unique(id,class_id),
 constraint bn_reply_in_same_class
 foreign key(parent_id,class_id) references public."ChatMessage"(id,class_id)
);
create table if not exists public."Notification" (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public."User"(id),
 class_id uuid references public."Class"(id),
 type text not null,
 payload jsonb,
 read_at timestamptz,
 created_at timestamptz not null default now()
);
create table if not exists public."AuditLog" (
 id uuid primary key default gen_random_uuid(),
 actor_id uuid references public."User"(id),
 actor_role_at_time text not null,
 class_id uuid references public."Class"(id),
 action text not null,
 target_type text,
 target_id uuid,
 metadata jsonb,
 created_at timestamptz not null default now()
);

-- Runtime DB invariants in addition to basic foreign keys.
create or replace function bn_private.guard_submission_timestamp()
returns trigger language plpgsql set search_path = ''
as $$
begin
 if old.submitted_at is not null and new.submitted_at is distinct from old.submitted_at then
   raise exception 'submitted_at cannot be changed';
 end if;
 if old.deadline_at_submission is not null and new.deadline_at_submission is distinct from old.deadline_at_submission then
   raise exception 'deadline_at_submission cannot be changed';
 end if;
 return new;
end $$;
revoke all on function bn_private.guard_submission_timestamp() from public,anon,authenticated;
drop trigger if exists bn_submission_timestamp_guard on public."Submission";
create trigger bn_submission_timestamp_guard before update on public."Submission"
 for each row execute function bn_private.guard_submission_timestamp();

create or replace function bn_private.check_submission_assignment_group()
returns trigger language plpgsql set search_path = ''
as $$
declare v_is_group boolean;
begin
 select is_group into v_is_group from public."Assignment"
  where id=new.assignment_id and deleted_at is null;
 if not found then raise exception 'Assignment does not exist or has been deleted'; end if;
 if v_is_group <> (new.group_id is not null) then
   raise exception 'Submission owner type must match assignment type';
 end if;
 if new.group_id is not null and not exists(
   select 1 from public."Group" g where g.id=new.group_id
    and g.assignment_id=new.assignment_id and g.deleted_at is null
 ) then raise exception 'Group does not belong to assignment'; end if;
 return new;
end $$;
revoke all on function bn_private.check_submission_assignment_group() from public,anon,authenticated;
drop trigger if exists bn_submission_assignment_guard on public."Submission";
create trigger bn_submission_assignment_guard before insert or update of assignment_id,student_id,group_id
 on public."Submission" for each row execute function bn_private.check_submission_assignment_group();

-- Deny-by-default: tables for future phases receive no API grants or RLS policies.
-- Trusted migrations/DB operators can manage them until Phase 3/5/6/7 arrives.
do $$
declare v_table text;
begin
 foreach v_table in array array[
  'InviteCode','Group','GroupMembership','Submission','SubmissionVersion',
  'File','Compilation','Announcement','ChatMessage','Notification','AuditLog'
 ] loop
  execute format('alter table public.%I enable row level security',v_table);
  execute format('revoke all on table public.%I from anon, authenticated',v_table);
 end loop;
end $$;

create index if not exists bn_submissions_by_assignment on public."Submission"(assignment_id);
create index if not exists bn_versions_by_submission on public."SubmissionVersion"(submission_id,version_number);
create index if not exists bn_files_by_version on public."File"(version_id);
create index if not exists bn_notifications_by_user on public."Notification"(user_id,created_at desc);
create index if not exists bn_audit_by_class on public."AuditLog"(class_id,created_at desc);
