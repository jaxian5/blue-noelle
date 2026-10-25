-- Non-sensitive class metadata from data/roles.json + data/invite-codes.json.
-- This is DEMONSTRATION DATA, not an authenticated class or a real student roster.
-- The legacy id was class-educ2-a; Supabase uses a UUID instead.
-- No passwords, accounts, memberships or public invite codes are imported.
insert into public."Class"(name,section,timezone)
select 'EDUC 2 · The Teaching Profession · Section A','A','Asia/Manila'
where not exists (
 select 1 from public."Class" where name='EDUC 2 · The Teaching Profession · Section A'
   and section='A'
);
