# Blue Noelle — Class-Scoped Permission Matrix

**Phase 0 deliverable · Version 0.1**  
Reference: Working Framework §15 · ROLE → PERMISSION → ACTION

## Rules

- Class membership carries the role. A user can be Admin of Class A and Student of Class B.
- Developer is **platform-level**, separate from class-scoped roles.
- Do not scatter role checks. Use permission helpers that mirror this matrix.
- Admin = “Manage the classroom” · Developer = “Manage the machine running the classroom”.

## Matrix

| Permission | Student | Moderator | Admin | Developer |
|------------|:-------:|:---------:|:-----:|:---------:|
| Submit work | ✅ | ✅ | ✅ | ✅ |
| Chat | ✅ | ✅ | ✅ | ✅ |
| View schedule / Class Clock | ✅ | ✅ | ✅ | ✅ |
| View own submissions | ✅ | ✅ | ✅ | ✅ |
| Verify users (approve/reject) | ❌ | ✅ | ✅ | ✅ |
| Create / edit assignments | ❌ | Limited* | ✅ | ✅ |
| Moderate chat | ❌ | ✅ | ✅ | ✅ |
| Monitor submissions | ❌ | ✅ | ✅ | ✅ |
| Manage users (roles, remove) | ❌ | Limited* | ✅ | ✅ |
| Manage class settings / invite codes | ❌ | ❌ | ✅ | ✅ |
| View reports / audit log (class) | ❌ | ❌ | ✅ | ✅ |
| Manage system (config, maintenance) | ❌ | ❌ | Limited† | ✅ |
| Database / storage tools | ❌ | ❌ | ❌ | ✅ |
| Platform-wide developer audit | ❌ | ❌ | ❌ | ✅ |

\* Limited = only if explicitly permitted by class settings (e.g. announcements).  
† Limited = class-scoped operational settings only; not server/DB tools.

## Implementation notes

- Frontend (`BN.can(role, permission)`) is a usability gate only.
- Backend must re-check every mutating action.
- Database CHECK constraints remain the final bouncer for ownership and similar invariants.
- Record `actor_role_at_time` on every audit event so history stays accurate if roles change.
