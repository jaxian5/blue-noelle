-- ============================================================
-- PROJECT: Blue Noelle — Phase 0 PostgreSQL Schema Draft
-- Version 0.1 · September 2026
-- Source of truth: Working Framework Phase 0 Baseline
--
-- Key rule: The database enforces invariants.
-- Naming: singular entity tables (User, Class, Submission, …)
-- Timezone: all timestamps stored in UTC; display Asia/Manila.
-- Soft delete: deleted_at / deleted_by on academic records.
-- ============================================================

-- Extensions (optional)
-- CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------- Enums (status values from §16) ----------
-- Submission: DRAFT | SUBMITTED | DELETED  (Late is computed, never stored)
-- Class Membership: PENDING | ACTIVE | REJECTED | REMOVED
-- Assignment: OPEN | CLOSED | ARCHIVED

CREATE TYPE membership_status AS ENUM ('PENDING', 'ACTIVE', 'REJECTED', 'REMOVED');
CREATE TYPE assignment_status AS ENUM ('OPEN', 'CLOSED', 'ARCHIVED');
CREATE TYPE submission_status AS ENUM ('DRAFT', 'SUBMITTED', 'DELETED');
CREATE TYPE class_role AS ENUM ('Student', 'Moderator', 'Admin');
-- Developer is platform-level, not class_role

-- ---------- Core identity ----------
CREATE TABLE "User" (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT NOT NULL UNIQUE,
  username        TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,          -- Phase 1: bcrypt/argon2
  full_name       TEXT NOT NULL,
  student_id      TEXT,
  avatar_storage_key TEXT,               -- opaque; not a public path
  is_developer    BOOLEAN NOT NULL DEFAULT FALSE, -- platform-level
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ,
  deleted_by      UUID REFERENCES "User"(id)
);

CREATE TABLE "Class" (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  section         TEXT,
  timezone        TEXT NOT NULL DEFAULT 'Asia/Manila',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ,
  deleted_by      UUID REFERENCES "User"(id)
);

-- Class-scoped role lives here (not a global property of the person)
CREATE TABLE "ClassMembership" (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES "User"(id),
  class_id        UUID NOT NULL REFERENCES "Class"(id),
  role            class_role NOT NULL DEFAULT 'Student',
  status          membership_status NOT NULL DEFAULT 'PENDING',
  joined_at       TIMESTAMPTZ,
  removed_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, class_id)
);

CREATE TABLE "InviteCode" (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            TEXT NOT NULL UNIQUE,
  class_id        UUID NOT NULL REFERENCES "Class"(id),
  created_by      UUID NOT NULL REFERENCES "User"(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ,
  revoked_at      TIMESTAMPTZ,
  max_uses        INT,
  use_count       INT NOT NULL DEFAULT 0
  -- Validation: correct class + not revoked + not expired + under max uses
);

-- ---------- Academic hierarchy ----------
CREATE TABLE "Subject" (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id        UUID NOT NULL REFERENCES "Class"(id),
  name            TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ,
  deleted_by      UUID REFERENCES "User"(id)
);

CREATE TABLE "Assignment" (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id      UUID NOT NULL REFERENCES "Subject"(id), -- 1 Subject → N Assignments; no M:N in V1
  name            TEXT NOT NULL,
  description     TEXT,
  instructions    TEXT,
  deadline        TIMESTAMPTZ,
  required_file_types TEXT[],            -- e.g. {'application/pdf','image/png'}
  max_file_size_bytes BIGINT,
  is_group        BOOLEAN NOT NULL DEFAULT FALSE, -- Individual OR Group, not mixed
  status          assignment_status NOT NULL DEFAULT 'OPEN',
  created_by      UUID REFERENCES "User"(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ,
  deleted_by      UUID REFERENCES "User"(id)
);

CREATE TABLE "Group" (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id   UUID NOT NULL REFERENCES "Assignment"(id),
  name            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ,
  deleted_by      UUID REFERENCES "User"(id)
);

CREATE TABLE "GroupMembership" (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id        UUID NOT NULL REFERENCES "Group"(id),
  user_id         UUID NOT NULL REFERENCES "User"(id),
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at      TIMESTAMPTZ,           -- membership history preserved
  UNIQUE (group_id, user_id)
);

-- ---------- Submission pipeline ----------
-- Critical invariant: exactly one owner (Student XOR Group)
CREATE TABLE "Submission" (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id         UUID NOT NULL REFERENCES "Assignment"(id),
  student_id            UUID REFERENCES "User"(id),
  group_id              UUID REFERENCES "Group"(id),
  status                submission_status NOT NULL DEFAULT 'DRAFT',
  current_version_id    UUID,            -- FK added after SubmissionVersion exists
  submitted_at          TIMESTAMPTZ,     -- immutable once set
  deadline_at_submission TIMESTAMPTZ,    -- snapshot; lateness computed, not stored
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at            TIMESTAMPTZ,
  deleted_by            UUID REFERENCES "User"(id),
  CONSTRAINT submission_owner_xor CHECK (
    (student_id IS NOT NULL AND group_id IS NULL)
    OR (student_id IS NULL AND group_id IS NOT NULL)
  )
);

CREATE TABLE "SubmissionVersion" (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id   UUID NOT NULL REFERENCES "Submission"(id),
  version_number  INT NOT NULL,
  uploaded_by     UUID REFERENCES "User"(id), -- shows “Uploaded by [name]” for groups
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (submission_id, version_number)
);

-- current_version must belong to same submission (enforce via trigger or composite FK pattern)
ALTER TABLE "Submission"
  ADD CONSTRAINT submission_current_version_fk
  FOREIGN KEY (current_version_id) REFERENCES "SubmissionVersion"(id);

CREATE TABLE "File" (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id        UUID NOT NULL REFERENCES "SubmissionVersion"(id),
  original_filename TEXT NOT NULL,
  storage_key       TEXT NOT NULL UNIQUE, -- opaque reference
  mime_type         TEXT,
  size_bytes        BIGINT,
  sha256            TEXT,                -- integrity + future dedup
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ,
  deleted_by        UUID REFERENCES "User"(id)
);

-- Compilation is a separate artifact, not a SubmissionVersion (§9)
CREATE TABLE "Compilation" (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id       UUID NOT NULL REFERENCES "Submission"(id),
  source_version_id   UUID NOT NULL REFERENCES "SubmissionVersion"(id),
  generated_file_id   UUID REFERENCES "File"(id),
  generated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  generated_by        UUID REFERENCES "User"(id)
);

-- ---------- Schedule (Class Clock) ----------
CREATE TABLE "ScheduleSlot" (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id        UUID NOT NULL REFERENCES "Class"(id),
  day_of_week     SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- local Asia/Manila
  start_local     TIME NOT NULL,         -- local time, not UTC
  end_local       TIME NOT NULL,
  subject_id      UUID REFERENCES "Subject"(id),
  label           TEXT
);

CREATE TABLE "ScheduleException" (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id        UUID NOT NULL REFERENCES "Class"(id),
  exception_date  DATE NOT NULL,         -- calendar date in class TZ
  kind            TEXT NOT NULL,         -- holiday | cancelled | special | rescheduled
  note            TEXT,
  replacement_start_local TIME,
  replacement_end_local   TIME
);

-- ---------- Community ----------
CREATE TABLE "Announcement" (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id        UUID NOT NULL REFERENCES "Class"(id),
  title           TEXT NOT NULL,
  message         TEXT NOT NULL,
  priority        SMALLINT DEFAULT 0,
  author_id       UUID REFERENCES "User"(id),
  pinned          BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ,
  deleted_by      UUID REFERENCES "User"(id)
);

CREATE TABLE "ChatMessage" (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id        UUID NOT NULL REFERENCES "Class"(id),
  author_id       UUID NOT NULL REFERENCES "User"(id),
  body            TEXT NOT NULL,
  parent_id       UUID REFERENCES "ChatMessage"(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  edited_at       TIMESTAMPTZ,
  deleted_at      TIMESTAMPTZ,           -- moderator or self soft-delete
  deleted_by      UUID REFERENCES "User"(id)
);

CREATE TABLE "Notification" (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES "User"(id),
  class_id        UUID REFERENCES "Class"(id),
  type            TEXT NOT NULL,         -- ASSIGNMENT_CREATED, DEADLINE_*, etc.
  payload         JSONB,
  read_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Audit (core infrastructure) ----------
CREATE TABLE "AuditLog" (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id          UUID REFERENCES "User"(id),
  actor_role_at_time TEXT NOT NULL,      -- historical accuracy if role later changes
  class_id          UUID REFERENCES "Class"(id),
  action            TEXT NOT NULL,       -- USER_APPROVED, SUBMISSION_REPLACED, DEVELOPER_ACTION, …
  target_type       TEXT,
  target_id         UUID,
  metadata          JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Useful indexes (expand as queries firm up)
CREATE INDEX idx_membership_class ON "ClassMembership"(class_id);
CREATE INDEX idx_membership_user ON "ClassMembership"(user_id);
CREATE INDEX idx_assignment_subject ON "Assignment"(subject_id);
CREATE INDEX idx_submission_assignment ON "Submission"(assignment_id);
CREATE INDEX idx_file_version ON "File"(version_id);
CREATE INDEX idx_audit_class_created ON "AuditLog"(class_id, created_at DESC);
CREATE INDEX idx_notification_user ON "Notification"(user_id, created_at DESC);

-- ============================================================
-- Invariants enforced here (not only in application code):
-- 1. Submission owner XOR (CHECK constraint)
-- 2. InviteCode belongs to one Class
-- 3. Soft-delete columns on academic entities
-- 4. submitted_at / deadline_at_submission treated as immutable in app layer
-- 5. Compilation links exact source_version_id
-- ============================================================
