# Blue Noelle — File Storage Specification

**Phase 0 deliverable · Version 0.1**  
Reference: Working Framework §7

## Decision

Application-managed **local storage first**, behind a **storage abstraction**.  
The backend does not care whether bytes live on local disk or later on MinIO / S3.

## Logical hierarchy (never a giant /uploads dump)

```
CLASS → Subject / Assignment → Submission → Version → File(s)
```

Example path structure (logical only):

```
/storage/classes/{class_id}/assignments/{assignment_id}/submissions/{submission_id}/versions/{version_id}/
```

## Metadata (database)

| Field | Purpose |
|-------|---------|
| `id` | Primary key |
| `original_filename` | Display name (sanitized) |
| `storage_key` | Opaque reference; never a public guessable path |
| `mime_type` | Validated |
| `size_bytes` | Enforced against assignment limits |
| `sha256` | Integrity + future deduplication |
| `created_at` | UTC |

## Security (Phase 1 / 3 checklist)

- Every download requires authentication + authorization.
- Filename itself never grants access.
- Extension + MIME validation, size limits, filename sanitization.
- Random / internal storage names; upload rate limits.
- Virus scanning deferred until the environment warrants it.

## Soft delete

When a Submission is soft-deleted, Versions and Files become logically inaccessible.  
Physical byte removal is a later scheduled maintenance process.

## Interface sketch (backend)

```
put(storage_key, bytes, content_type) → void
get(storage_key) → stream
delete(storage_key) → void   // hard delete only from maintenance job
exists(storage_key) → bool
```

Swap implementation from LocalDiskStore to S3Store without changing academic domain code.
