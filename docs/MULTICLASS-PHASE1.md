# Blue Noelle Phase 1 · Multi-class self-service registration

**Architecture change:** October 25, 2026. Supersedes the original **single-class first-Admin bootstrap** in older Phase 1 docs. This extends the framework's class-scoped isolation to arbitrary classrooms. Academic Phase 2+ workflows are not yet migrated.

## Two registration choices

| Signup choice | Verified-account next step | Role assignment |
| --- | --- | --- |
| **Student** | Enter an invitation from an existing class Admin | `Student/PENDING`; Moderator/Admin review makes it `Student/ACTIVE` |
| **Admin** | Create **one** new class with a name and optional section | In a single database transaction, create a new `Class`, set `owner_user_id` to signed-in creator, and create their `Admin/ACTIVE` membership |

All signups require real Supabase Auth email verification before joining/creating classes. **Selecting Admin on the frontend does NOT grant Admin access to an existing class.** The class-creation RPC grants an Admin membership solely for the class that the verified account creates.

## Account types and immutable choice

At `auth.signUp`, the user selects **Student** or **Admin**. Signup metadata includes `registration_type`; the restricted `auth.users` INSERT trigger copies this to immutable `public."User".account_type`. This snapshot is safe for account-type decisions because later browser edits to `user_metadata` **do not update** the protected profile. Admin creation checks the persisted profile, email confirmation, and class ownership in PostgreSQL. The web client never derives authority from metadata alone.

- Existing real Auth profiles, including the first test account, default to **Student**. No account was deleted, recreated, or promoted.
- **Student** accounts may join different classes with different class-scoped roles (e.g., Student in one and Moderator in another if their class Admin promotes them).
- **Admin** signup accounts own **exactly zero or one class**: zero until they create it, then one permanently. They cannot join another class with that Admin identity. This enforces the requested "only one, their own" behavior.
- Each class has one immutable creator/owner. Its sole Admin membership must be `ACTIVE`. The owner cannot be demoted, removed, transferred, or give someone else Admin status through `bn_update_member`.
- The Admin can promote approved **Student** members to **Moderator** using the existing Admin membership management workflow. Moderators can approve/reject pending Students and are class-scoped.
- The previously imported demonstration class is **legacy sample data** with `owner_user_id=NULL` and no members. It is not silently assigned to anyone and is not an eligible self-service Admin class. It remains invisible to non-members under RLS.

## Trust boundaries

- `User.account_type`: validated Student/Admin signup choice captured once; not a class role.
- `Class.owner_user_id`: unique nullable FK used only by the class-creation function. Unique index `bn_one_owned_class_per_admin` prevents a second class owned by the same account.
- `ClassMembership`: authoritative role/status **per class**. Trigger `bn_guard_owner_membership` rejects unauthorized Admin rows and Admin accounts joining someone else's class.
- `bn_create_owned_class(p_name,p_section)`: exposed SECURITY INVOKER wrapper to privately executed permission-checking transaction. Requires `auth.uid()`, confirmed Auth email, `User.account_type='Admin'`, valid class name, and no existing owned class or memberships. Database serializes concurrent attempts by locking the creator's profile.
- Class creation and Admin membership assignment happen together; if one fails, neither persists. AuditLog records `CLASS_CREATED`.
- `bn_join_class`: existing RPC for Students to request membership via private Student invitation. It continues to create `PENDING` and requires an authorized class officer to approve.
- Direct browser INSERT/UPDATE into Class, User and ClassMembership remain blocked by PostgreSQL grants/RLS. `anon` cannot execute the new class creation RPC.
- Signup-as-Admin is intentionally **open self-service for any verified email**. One class per account does **not** prevent malicious actors creating many verified accounts. Supabase Free Auth signup/rate limits apply; abuse monitoring, quota and reports will be a future operational requirement.

## Pages

`pages/register.html`: two registration choices, verified Student invitation form, verified Admin class creation form.  
`pages/login.html`: existing canonical sign-in; lands on `pages/account.html`.  
`pages/account.html`: displays saved account type and class roles; Student sees Redeem invitation, unprovisioned Admin sees Create my one class, established Admin sees class management.  
`pages/phase1-class-staff.html`: an existing Admin generates invitations, reviews pending Students and promotes Moderators via Class Operations.

## Manual live test (use independent browser profiles or sign out between accounts)

1. **Admin A**: Select Admin on register page; signup using a **new email** and private password; confirm email; sign in. My Account must offer **Create my one class**. Create “Test Class A” and confirm ACTIVE Admin membership appears.
2. **Admin duplicate**: Return to registration; verify there is no second create option after ownership. A direct RPC attempt to create another class must fail.
3. **Admin B**: Repeat with a second new Admin email, creating “Test Class B”. Verify they do not see/manage members of A.
4. **Student A**: Signup using a third new email with **Student** selected. Confirm email; sign in; My Account shows a Student account with no memberships, NOT a class-creation option.
5. **Admin A**: Open Class officer tools, issue a single-use **Student** invite for A; share it privately with Student A.
6. **Student A**: Enter invite on register page; verify Student/PENDING and that Class A's records remain hidden.
7. **Admin A**: Approve the request in the Registration queue (Moderator equivalent can be tested by elevating a Student to Moderator). Student A refreshes My Account and must now see Student/ACTIVE for A.
8. **Role isolation**: Student A cannot create a class; Admin B cannot approve A's requests; an Admin account cannot redeem a Student invite to another class; 2nd class creation denied.
9. **Audit and recovery**: verify `CLASS_CREATED`, `INVITE_CREATED`, `REGISTRATION_REQUESTED`, `USER_APPROVED`; test sign out/in and password recovery.
10. **Cross-class Student**: issue an invite for B and verify a Student can be active in both A and B independently.

**DO NOT use the original test Student account to create an Admin class.** It was registered before Admin/Student choice existed and is correctly retained as Student. Create a separate **new** Admin account for the fresh test.

## Test status

- Database migration `20261025043228_multiclass_account_types_and_one_owned_class.sql` already applied to live Supabase.
- Transactional tests: Admin profile capture, Student restrictions, unconfirmed Admin restriction, one-class limit, separate class creator isolation, Student invited enrollment, rejection of other-class Admin enrollment, prevention of Student→Admin promotion and successful Student approval **PASS**. All temporary identities/classes rolled back.
- The project owner reports successful multi-account live testing and explicitly **approved Phase 1**. At the October 25 verification snapshot, Supabase held one owned class and ACTIVE Admin/Student memberships. See [Phase 1 sign-off](PHASE1-COMPLETE.md).
- Supabase Free Plan: leaked-password protection is unavailable, so the advisor warning is expected. Use strong unique passwords; never publish private invitation codes.
