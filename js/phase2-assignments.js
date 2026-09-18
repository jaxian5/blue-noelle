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
    return (s.assignments || []).filter((a) => ids.has(a.subject_id) || !classId);
  },

  async createSubject({ class_id, name, created_by }) {
    if (!name?.trim()) return { ok: false, error: "Subject name required" };
    const s = await this.ensureStore();
    const row = {
      id: "subj-" + Date.now(),
      class_id: class_id || "class-educ2-a",
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
    if (!s.subjects.some((x) => x.id === subject_id)) {
      return { ok: false, error: "Subject not found" };
    }

    const row = {
      id: "asgn-" + Date.now(),
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
        class_id: null,
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
    a.status = status;
    a.updated_at = new Date().toISOString();
    this.setStore(s);
    if (window.Phase1?.appendAudit) {
      Phase1.appendAudit({
        actor_id: actor?.id,
        actor_role_at_time: actor?.role || "Admin",
        class_id: null,
        action: "ASSIGNMENT_STATUS_CHANGED",
        target_type: "Assignment",
        target_id: id,
        metadata: { status }
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
