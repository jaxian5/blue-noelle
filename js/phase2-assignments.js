/**
 * PROJECT: Blue Noelle — Phase 2 Assignments
 * Reference: PROJECT_ Blue Noelle.docx §5 + Phase 2 roadmap
 *
 * Milestone: Admin can create classwork; students can see it.
 *
 * Rules:
 * - Subject 1 → N Assignments (no M:N in V1)
 * - Assignment is Individual OR Group — not mixed
 * - Status: OPEN | CLOSED | ARCHIVED
 * - Late is never stored on assignment; computed at submit time (Phase 3)
 */

const Phase2 = {
  STORAGE_KEY: "bn_phase2_assignments",

  newId(prefix) {
    return prefix + (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  },

  actorCanManage(classId) {
    const user = window.BN?.getCurrentUser?.();
    return !!user && user.role === "Admin" &&
      !!user.class_memberships?.some((m) => m.class_id === classId && m.status === "ACTIVE");
  },

  async loadBase() {
    for (const url of ["../data/assignments.json", "data/assignments.json"]) {
      try {
        const res = await fetch(url);
        if (res.ok) return await res.json();
      } catch {
        /* */
      }
    }
    return { subjects: [], assignments: [] };
  },

  getStore() {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch {
      /* */
    }
    return null;
  },

  setStore(data) {
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data));
  },

  async ensureStore() {
    let s = this.getStore();
    if (!s) {
      const base = await this.loadBase();
      s = {
        subjects: base.subjects || [],
        assignments: base.assignments || []
      };
      this.setStore(s);
    }
    return s;
  },

  async listSubjects(classId) {
    const s = await this.ensureStore();
    return (s.subjects || []).filter((x) => !classId || x.class_id === classId);
  },

  async listAssignments(classId) {
    const s = await this.ensureStore();
    const subjects = await this.listSubjects(classId);
    const ids = new Set(subjects.map((x) => x.id));
    return (s.assignments || []).filter((a) => !classId || ids.has(a.subject_id));
  },

  async createSubject({ class_id, name, created_by }) {
    if (!name?.trim()) return { ok: false, error: "Subject name required" };
    if (!class_id || !this.actorCanManage(class_id)) return { ok: false, error: "Admin membership is required for this class" };
    const s = await this.ensureStore();
    const row = {
      id: this.newId("subj-"),
      class_id,
      name: name.trim(),
      created_by: created_by || null,
      created_at: new Date().toISOString()
    };
    s.subjects.unshift(row);
    this.setStore(s);
    if (window.Phase1?.appendAudit) {
      Phase1.appendAudit({
        actor_id: created_by,
        actor_role_at_time: "Admin",
        class_id: row.class_id,
        action: "SUBJECT_CREATED",
        target_type: "Subject",
        target_id: row.id,
        metadata: { name: row.name }
      });
    }
    return { ok: true, subject: row };
  },

  async createAssignment(payload) {
    const {
      subject_id,
      name,
      description,
      instructions,
      deadline,
      is_group,
      required_file_types,
      max_file_size_bytes,
      created_by
    } = payload;
    if (!subject_id) return { ok: false, error: "Assignment must belong to exactly one subject" };
    if (!name?.trim()) return { ok: false, error: "Assignment name required" };

    const s = await this.ensureStore();
    const subject = s.subjects.find((x) => x.id === subject_id);
    if (!subject) return { ok: false, error: "Subject not found" };
    if (!this.actorCanManage(subject.class_id)) return { ok: false, error: "Admin membership is required for this class" };
    if (deadline && !Number.isFinite(Date.parse(deadline))) return { ok: false, error: "Invalid deadline" };

    const row = {
      id: this.newId("asgn-"),
      subject_id,
      name: name.trim(),
      description: description || "",
      instructions: instructions || "",
      deadline: deadline || null,
      is_group: !!is_group,
      required_file_types: required_file_types || [],
      max_file_size_bytes: max_file_size_bytes || null,
      status: "OPEN",
      created_by: created_by || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    s.assignments.unshift(row);
    this.setStore(s);

    if (window.Phase1?.appendAudit) {
      Phase1.appendAudit({
        actor_id: created_by,
        actor_role_at_time: "Admin",
        class_id: subject.class_id,
        action: "ASSIGNMENT_CREATED",
        target_type: "Assignment",
        target_id: row.id,
        metadata: { name: row.name, is_group: row.is_group }
      });
    }
    return { ok: true, assignment: row };
  },

  async setAssignmentStatus(id, status, actor) {
    if (!["OPEN", "CLOSED", "ARCHIVED"].includes(status)) {
      return { ok: false, error: "Invalid status" };
    }
    const s = await this.ensureStore();
    const a = s.assignments.find((x) => x.id === id);
    if (!a) return { ok: false, error: "Not found" };
    const subject = s.subjects.find((x) => x.id === a.subject_id);
    if (!subject || !this.actorCanManage(subject.class_id)) return { ok: false, error: "Admin membership is required for this class" };
    if (a.status === status) return { ok: true };
    const previousStatus = a.status;
    a.status = status;
    a.updated_at = new Date().toISOString();
    this.setStore(s);
    if (window.Phase1?.appendAudit) {
      Phase1.appendAudit({
        actor_id: actor?.id,
        actor_role_at_time: actor?.role || "Admin",
        class_id: subject.class_id,
        action: "ASSIGNMENT_STATUS_CHANGED",
        target_type: "Assignment",
        target_id: id,
        metadata: { previous_status: previousStatus, status }
      });
    }
    return { ok: true };
  },

  /** Group assignments by subject for student/admin views */
  async groupedBySubject(classId) {
    const subjects = await this.listSubjects(classId);
    const assignments = await this.listAssignments(classId);
    return subjects.map((subj) => ({
      subject: subj,
      assignments: assignments.filter((a) => a.subject_id === subj.id)
    }));
  }
};

window.Phase2 = Phase2;
