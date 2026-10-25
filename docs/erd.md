# Blue Noelle | Authoritative ER diagram (Phase 0)

Aligned with `PROJECT_ Blue Noelle.docx` (September 18, 2026), sections 2, 16, 19, 22.
All entities correspond to 19 live tables in the Supabase `public` schema. Supabase `auth.users` is managed externally and has a 1:1 reference from the application User table. This diagram is conceptual and omits some columns; versioned migrations are the executable schema.

```mermaid
erDiagram
    AUTH_USERS ||--o| User : provisions
    User ||--o{ ClassMembership : joins
    Class ||--o{ ClassMembership : contains
    Class ||--o{ Subject : teaches
    Subject ||--o{ Assignment : owns
    Class ||--o{ ScheduleSlot : schedules
    Subject o|--o{ ScheduleSlot : describes
    Class ||--o{ ScheduleException : modifies
    Class ||--o{ InviteCode : invites
    User ||--o{ InviteCode : creates
    Assignment ||--o{ Group : organizes
    Group ||--o{ GroupMembership : has
    User ||--o{ GroupMembership : joins
    Assignment ||--o{ Submission : receives
    User o|--o{ Submission : individual_owner
    Group o|--o{ Submission : group_owner
    Submission ||--o{ SubmissionVersion : history
    SubmissionVersion ||--o{ File : stores
    SubmissionVersion ||--o{ Compilation : source
    Submission ||--o{ Compilation : collects
    File o|--o{ Compilation : output
    Class ||--o{ Announcement : broadcasts
    Class ||--o{ ChatMessage : exchanges
    ChatMessage o|--o{ ChatMessage : replies
    User ||--o{ Notification : receives
    Class o|--o{ Notification : concerns
    User o|--o{ AuditLog : acts
    Class o|--o{ AuditLog : contextualizes
    Class ||--o{ ClassActionLog : traces
    User ||--o{ ClassActionLog : actor
    ClassMembership o|--o{ ClassActionLog : targets
```

## Core invariant map

| Invariant | Primary enforcement |
| --- | --- |
| Every user identity maps to managed Supabase Auth | `User.id` → `auth.users.id` FK |
| Student / Moderator / Admin roles are class-scoped | `ClassMembership` unique `(user_id,class_id)`; server policy and `bn_has_class_role` |
| Developer role is separate | `User.is_developer` (reserved; not trusted as an editable client role) |
| A Subject belongs to one Class, an Assignment to one Subject | non-null foreign keys |
| A Submission has **Student XOR Group** owner | `bn_submission_owner_xor` check |
| Group submission belongs to matching group assignment | `bn_submission_assignment_guard` trigger |
| Current version belongs to its submission | composite FK `bn_current_version_owned_by_submission` |
| Compilation source belongs to its submission | composite FK `bn_compilation_source_version` |
| Populated submission timestamps cannot change | `bn_submission_timestamp_guard` |
| No permanently stored `is_late` | computed comparison of submitted timestamp and snapshotted deadline |
| Recurring schedule uses local clock time | `ScheduleSlot.start_local/end_local` are SQL TIME; dates/timestamps use UTC `timestamptz` |
| Replies must stay in a class | composite FK `bn_reply_in_same_class` |
| File bytes are separate from metadata | `File.storage_key`; no open file access policies yet |
| Important actions preserve historical actor role | `AuditLog.actor_role_at_time` for future audit writes |

**Implementation caveat:** Phase 0 specifies the invariants. Business operations enforcing group-version serialization, full audit coverage, storage access and privacy, and submission soft-delete visibility are scheduled in their corresponding implementation phases. The existence of a table or constraint is not evidence that the user-facing workflow is operational.
