/**
 * PROJECT: Blue Noelle — Phase 1 Authentication & Class Membership
 * Reference: PROJECT_ Blue Noelle.docx §4, Phase 1 roadmap
 *
 * Scope (framework):
 * - Login, Registration, Invite code, Verification
 * - Roles, Class membership, Profiles, Permissions
 * - Basic audit logging, Password hashing (demo), Secure sessions, Rate limiting
 *
 * Milestone: A verified student can securely enter their class.
 *
 * Guidelines:
 * - Invite codes are class-scoped (not platform-wide).
 * - Registration → PENDING → Moderator approve/reject → ACTIVE.
 * - Password view/edit requires the same invite code used at registration.
 * - Audit: USER_APPROVED, USER_REJECTED, ROLE_CHANGED, ACCOUNT events.
 * - Replace localStorage/JSON stores with SQL/API without changing call sites.
 */

const Phase1 = {
  STORAGE_PENDING: "bn_pending_registrations",
  STORAGE_AUDIT: "bn_audit_log",
  STORAGE_PASSWORD_OVERRIDES: "bn_password_overrides",
  STORAGE_RATE: "bn_login_attempts",
  STORAGE_INVITE_EXTRA: "bn_invite_codes_extra",
  RATE_WINDOW_MS: 15 * 60 * 1000,
  RATE_MAX: 8,

  async fetchJson(candidates) {
    for (const url of candidates) {
      try {
        const res = await fetch(url);
        if (res.ok) return await res.json();
      } catch {
        /* next */
      }
    }
    return null;
  },

  async loadInviteCodes() {
    const data = await this.fetchJson([
      "../data/invite-codes.json",
      "data/invite-codes.json"
    ]);
    const base = data?.codes || [];
    let extra = [];
    try {
      extra = JSON.parse(localStorage.getItem(this.STORAGE_INVITE_EXTRA) || "[]");
    } catch {
      extra = [];
    }
    // Extra codes (created in-session) overlay by code key; revoked_at updates apply
    const map = new Map();
    base.forEach((c) => map.set(c.code, { ...c }));
    extra.forEach((c) => map.set(c.code, { ...c }));
    return Array.from(map.values());
  },

  saveInviteExtra(codes) {
    localStorage.setItem(this.STORAGE_INVITE_EXTRA, JSON.stringify(codes));
  },

  getInviteExtra() {
    try {
      return JSON.parse(localStorage.getItem(this.STORAGE_INVITE_EXTRA) || "[]");
    } catch {
      return [];
    }
  },

  /**
   * Create invite code — Core Invariants §19.
   * Only Admin may create class invite codes. Developers cannot create/revoke invites.
   * Default role cannot be Developer (platform-level only).
   */
  async createInviteCode({ class_id, class_name, max_uses, expires_at, default_role, created_by, actor_role }) {
    if (actor_role === "Developer") {
      return { ok: false, error: "Developers cannot create invite codes (class-scoped only)" };
    }
    if (actor_role && actor_role !== "Admin") {
      return { ok: false, error: "Only Admin can create invite codes" };
    }
    if (!class_id) {
      return { ok: false, error: "Invite code must belong to one Class (invariant)" };
    }
    if (default_role === "Developer") {
      return { ok: false, error: "Cannot issue class invite for Developer role" };
    }
    const existing = await this.loadInviteCodes();
    let code;
    do {
      code =
        "BN-" +
        (class_name || "CLASS")
          .replace(/[^A-Za-z0-9]/g, "")
          .slice(0, 8)
          .toUpperCase() +
        "-" +
        Math.random().toString(36).slice(2, 6).toUpperCase();
    } while (existing.some((c) => c.code === code));

    const row = {
      code,
      class_id,
      class_name: class_name || class_id,
      created_by: created_by || null,
      created_at: new Date().toISOString(),
      expires_at: expires_at || null,
      revoked_at: null,
      max_uses: max_uses === "" || max_uses == null ? null : Number(max_uses),
      use_count: 0,
      default_role: default_role || "Student"
    };

    const extra = this.getInviteExtra();
    extra.unshift(row);
    this.saveInviteExtra(extra);

    this.appendAudit({
      actor_id: created_by,
      actor_role_at_time: "Admin",
      class_id,
      action: "INVITE_CODE_CREATED",
      target_type: "InviteCode",
      target_id: code,
      metadata: { max_uses: row.max_uses, expires_at: row.expires_at }
    });

    return { ok: true, invite: row };
  },

  async revokeInviteCode(code, actor) {
    if (actor?.role === "Developer") {
      return { ok: false, error: "Developers cannot revoke invite codes" };
    }
    if (actor?.role && actor.role !== "Admin") {
      return { ok: false, error: "Only Admin can revoke invite codes" };
    }
    const all = await this.loadInviteCodes();
    const row = all.find((c) => c.code === code);
    if (!row) return { ok: false, error: "Code not found" };
    if (row.revoked_at) return { ok: false, error: "Already revoked" };
    // Admins cannot revoke Developer bootstrap codes
    if (row.default_role === "Developer" || !row.class_id) {
      return { ok: false, error: "Admins cannot revoke Developer invite codes" };
    }

    const extra = this.getInviteExtra();
    const idx = extra.findIndex((c) => c.code === code);
    const updated = { ...row, revoked_at: new Date().toISOString() };
    if (idx >= 0) extra[idx] = updated;
    else extra.unshift(updated);
    this.saveInviteExtra(extra);

    this.appendAudit({
      actor_id: actor?.id,
      actor_role_at_time: actor?.role || "Admin",
      class_id: row.class_id,
      action: "INVITE_CODE_REVOKED",
      target_type: "InviteCode",
      target_id: code,
      metadata: {}
    });
    return { ok: true };
  },

  /** Invite codes visible to actor (Admin never sees Developer codes). */
  async listInviteCodesFor(actor) {
    const all = await this.loadInviteCodes();
    if (actor?.role === "Developer") {
      // Developers don't manage class invites
      return all.filter((c) => c.default_role === "Developer" || !c.class_id);
    }
    // Admin / others: class-scoped only — hide Developer codes
    return all.filter((c) => c.default_role !== "Developer" && c.class_id);
  },

  getLastLogins() {
    try {
      return JSON.parse(localStorage.getItem("bn_last_logins") || "{}");
    } catch {
      return {};
    }
  },

  recordLogin(userId) {
    const map = this.getLastLogins();
    map[userId] = new Date().toISOString();
    localStorage.setItem("bn_last_logins", JSON.stringify(map));
  },

  getRoleOverrides() {
    try {
      return JSON.parse(localStorage.getItem("bn_role_overrides") || "{}");
    } catch {
      return {};
    }
  },

  /**
   * Class masterlist — Moderator sees name+email; Admin sees more + role change.
   * Admins never see Developer accounts; Developers are platform-level.
   */
  async listClassUsers(viewer) {
    const accounts = await BN.loadAccounts();
    const promoted = JSON.parse(localStorage.getItem("bn_promoted_accounts") || "[]");
    const logins = this.getLastLogins();
    const roles = this.getRoleOverrides();
    const viewerClass =
      viewer?.class_memberships?.[0]?.class_id || "class-educ2-a";

    let list = accounts.concat(promoted).map((a) => {
      const role = roles[a.id] || a.role;
      return {
        id: a.id,
        full_name: a.full_name,
        email: a.email,
        username: a.username,
        role,
        student_id: a.student_id,
        status: a.class_memberships?.[0]?.status || (role === "Developer" ? "PLATFORM" : "ACTIVE"),
        class_id: a.class_memberships?.[0]?.class_id || null,
        class_name: a.class_memberships?.[0]?.class_name || "—",
        invite_code: a.invite_code || "—",
        last_login: logins[a.id] || null
      };
    });

    // Isolation: Admin ↔ Developer never see each other
    if (viewer?.role === "Admin" || viewer?.role === "Moderator") {
      list = list.filter((u) => u.role !== "Developer");
      // Same class when membership exists
      list = list.filter(
        (u) => !u.class_id || u.class_id === viewerClass || u.role === "Admin" || u.role === "Moderator"
      );
    } else if (viewer?.role === "Developer") {
      list = list.filter((u) => u.role === "Developer");
    }

    return list;
  },

  async listUsers(viewer) {
    return this.listClassUsers(viewer || BN.getCurrentUser());
  },

  /**
   * Admin-only role change within class roles (not Developer).
   */
  changeUserRole(targetId, newRole, actor) {
    if (actor?.role !== "Admin") {
      return { ok: false, error: "Only Admin can change roles" };
    }
    if (newRole === "Developer") {
      return { ok: false, error: "Cannot promote to Developer from class Admin" };
    }
    if (!["Student", "Moderator", "Admin"].includes(newRole)) {
      return { ok: false, error: "Invalid class role" };
    }
    const map = this.getRoleOverrides();
    map[targetId] = newRole;
    localStorage.setItem("bn_role_overrides", JSON.stringify(map));

    // Update session user if self
    const me = BN.getCurrentUser();
    if (me && me.id === targetId) {
      me.role = newRole;
      BN.setCurrentUser(me);
    }

    this.appendAudit({
      actor_id: actor.id,
      actor_role_at_time: actor.role,
      class_id: actor.class_memberships?.[0]?.class_id || null,
      action: "ROLE_CHANGED",
      target_type: "User",
      target_id: targetId,
      metadata: { new_role: newRole }
    });
    return { ok: true };
  },

  getPending() {
    try {
      const raw = localStorage.getItem(this.STORAGE_PENDING);
      if (raw) return JSON.parse(raw);
    } catch {
      /* fall through */
    }
    return [];
  },

  setPending(list) {
    localStorage.setItem(this.STORAGE_PENDING, JSON.stringify(list));
  },

  getAudit() {
    try {
      const raw = localStorage.getItem(this.STORAGE_AUDIT);
      if (raw) return JSON.parse(raw);
    } catch {
      /* */
    }
    return [];
  },

  appendAudit(event) {
    const list = this.getAudit();
    list.unshift({
      id: "aud-" + Date.now(),
      created_at: new Date().toISOString(),
      ...event
    });
    localStorage.setItem(this.STORAGE_AUDIT, JSON.stringify(list.slice(0, 500)));
  },

  getPasswordOverride(userId) {
    try {
      const map = JSON.parse(localStorage.getItem(this.STORAGE_PASSWORD_OVERRIDES) || "{}");
      return map[userId] || null;
    } catch {
      return null;
    }
  },

  setPasswordOverride(userId, password) {
    const map = JSON.parse(localStorage.getItem(this.STORAGE_PASSWORD_OVERRIDES) || "{}");
    map[userId] = password;
    localStorage.setItem(this.STORAGE_PASSWORD_OVERRIDES, JSON.stringify(map));
  },

  /**
   * Rate limiting (Phase 1 security). Client-side demo only.
   */
  checkRateLimit(key) {
    const now = Date.now();
    let bucket = {};
    try {
      bucket = JSON.parse(localStorage.getItem(this.STORAGE_RATE) || "{}");
    } catch {
      bucket = {};
    }
    const entry = bucket[key] || { count: 0, start: now };
    if (now - entry.start > this.RATE_WINDOW_MS) {
      entry.count = 0;
      entry.start = now;
    }
    if (entry.count >= this.RATE_MAX) {
      const mins = Math.ceil((this.RATE_WINDOW_MS - (now - entry.start)) / 60000);
      return { ok: false, error: `Too many attempts. Try again in ~${mins} min.` };
    }
    entry.count += 1;
    bucket[key] = entry;
    localStorage.setItem(this.STORAGE_RATE, JSON.stringify(bucket));
    return { ok: true };
  },

  resetRateLimit(key) {
    try {
      const bucket = JSON.parse(localStorage.getItem(this.STORAGE_RATE) || "{}");
      delete bucket[key];
      localStorage.setItem(this.STORAGE_RATE, JSON.stringify(bucket));
    } catch {
      /* */
    }
  },

  /**
   * Validate invite code per framework §4.
   */
  async validateInviteCode(code) {
    const codes = await this.loadInviteCodes();
    const row = codes.find((c) => c.code === code.trim());
    if (!row) return { ok: false, error: "Invalid invite code" };
    if (row.revoked_at) return { ok: false, error: "Invite code has been revoked" };
    if (row.expires_at && new Date(row.expires_at) < new Date()) {
      return { ok: false, error: "Invite code has expired" };
    }
    if (row.max_uses != null && row.use_count >= row.max_uses) {
      return { ok: false, error: "Invite code has reached max uses" };
    }
    return { ok: true, invite: row };
  },

  /**
   * Register → PENDING membership (framework registration flow).
   */
  async register(form) {
    const code = (form.invite_code || "").trim();
    const v = await this.validateInviteCode(code);
    if (!v.ok) return v;

    const username = (form.username || "").trim();
    const email = (form.email || "").trim().toLowerCase();
    if (!username || !email || !form.password || !form.full_name) {
      return { ok: false, error: "Missing required fields" };
    }
    if (form.password.length < 8) {
      return { ok: false, error: "Password must be at least 8 characters" };
    }

    const accounts = await BN.loadAccounts();
    if (accounts.some((a) => a.username === username || a.email === email)) {
      return { ok: false, error: "Username or email already in use" };
    }
    const pending = this.getPending();
    if (pending.some((p) => p.username === username || p.email === email)) {
      return { ok: false, error: "Registration already pending for this user" };
    }

    const record = {
      id: "pending-" + Date.now(),
      full_name: form.full_name.trim(),
      student_id: (form.student_id || "").trim() || null,
      email,
      username,
      password: form.password, // demo only — hash server-side in real Phase 1
      invite_code: code,
      class_id: v.invite.class_id,
      class_name: v.invite.class_name,
      requested_role: v.invite.default_role || "Student",
      status: "PENDING",
      created_at: new Date().toISOString()
    };
    pending.unshift(record);
    this.setPending(pending);

    this.appendAudit({
      actor_id: record.id,
      actor_role_at_time: "Applicant",
      class_id: record.class_id,
      action: "REGISTRATION_SUBMITTED",
      target_type: "ClassMembership",
      target_id: record.id,
      metadata: { username, email }
    });

    return { ok: true, record };
  },

  async approvePending(pendingId, moderator) {
    const pending = this.getPending();
    const idx = pending.findIndex((p) => p.id === pendingId);
    if (idx < 0) return { ok: false, error: "Not found" };
    const rec = pending[idx];
    pending.splice(idx, 1);
    this.setPending(pending);

    // Promote into local session-visible accounts (demo). Real: INSERT User + ClassMembership ACTIVE
    const promoted = {
      id: "user-" + Date.now(),
      role: rec.requested_role === "Developer" ? "Developer" : rec.requested_role,
      full_name: rec.full_name,
      email: rec.email,
      username: rec.username,
      password: rec.password,
      invite_code: rec.invite_code,
      student_id: rec.student_id,
      avatar: null,
      class_memberships: rec.class_id
        ? [
            {
              class_id: rec.class_id,
              class_name: rec.class_name,
              role: rec.requested_role === "Developer" ? "Student" : rec.requested_role,
              status: "ACTIVE"
            }
          ]
        : []
    };
    this.setPasswordOverride(promoted.id, rec.password);
    const promotedList = JSON.parse(localStorage.getItem("bn_promoted_accounts") || "[]");
    promotedList.push(promoted);
    localStorage.setItem("bn_promoted_accounts", JSON.stringify(promotedList));

    this.appendAudit({
      actor_id: moderator?.id,
      actor_role_at_time: moderator?.role || "Moderator",
      class_id: rec.class_id,
      action: "USER_APPROVED",
      target_type: "User",
      target_id: promoted.id,
      metadata: { username: rec.username }
    });

    return { ok: true, user: promoted };
  },

  async rejectPending(pendingId, moderator) {
    const pending = this.getPending();
    const idx = pending.findIndex((p) => p.id === pendingId);
    if (idx < 0) return { ok: false, error: "Not found" };
    const rec = pending[idx];
    pending.splice(idx, 1);
    this.setPending(pending);

    this.appendAudit({
      actor_id: moderator?.id,
      actor_role_at_time: moderator?.role || "Moderator",
      class_id: rec.class_id,
      action: "USER_REJECTED",
      target_type: "Registration",
      target_id: pendingId,
      metadata: { username: rec.username }
    });

    return { ok: true };
  },

  /**
   * Login with rate limit + password overrides for promoted users.
   */
  async login(usernameOrEmail, password) {
    const key = "login:" + (usernameOrEmail || "").toLowerCase();
    const rate = this.checkRateLimit(key);
    if (!rate.ok) return rate;

    const accounts = await BN.loadAccounts();
    const promoted = JSON.parse(localStorage.getItem("bn_promoted_accounts") || "[]");
    const all = accounts.concat(promoted);

    let user = all.find(
      (a) =>
        (a.username === usernameOrEmail || a.email === usernameOrEmail) &&
        (this.getPasswordOverride(a.id) || a.password) === password
    );

    // Also check pending — must NOT allow login while PENDING
    const pending = this.getPending();
    if (
      !user &&
      pending.some(
        (p) =>
          (p.username === usernameOrEmail || p.email === usernameOrEmail) &&
          p.password === password
      )
    ) {
      return {
        ok: false,
        error: "Registration is still PENDING. Wait for Moderator approval."
      };
    }

    if (!user) return { ok: false, error: "Invalid credentials" };

    this.resetRateLimit(key);
    const overrides = this.getRoleOverrides();
    if (overrides[user.id]) user = { ...user, role: overrides[user.id] };
    this.recordLogin(user.id);
    BN.setCurrentUser(user);
    this.appendAudit({
      actor_id: user.id,
      actor_role_at_time: user.role,
      class_id: user.class_memberships?.[0]?.class_id || null,
      action: "LOGIN_SUCCESS",
      target_type: "User",
      target_id: user.id,
      metadata: {}
    });
    return { ok: true, user };
  },

  /**
   * Verify invite code before revealing or changing password (user request).
   */
  verifyInviteForPassword(inputCode) {
    const user = BN.getCurrentUser();
    if (!user) return { ok: false, error: "Not signed in" };
    const expected = user.invite_code;
    if (!expected) {
      return { ok: false, error: "No invite code on file for this account" };
    }
    if ((inputCode || "").trim() !== expected) {
      return { ok: false, error: "Invite code does not match the one used at registration" };
    }
    return { ok: true };
  },

  getEffectivePassword(user) {
    if (!user) return null;
    return this.getPasswordOverride(user.id) || user.password || null;
  },

  changePassword(userId, newPassword) {
    if (!newPassword || newPassword.length < 8) {
      return { ok: false, error: "Password must be at least 8 characters" };
    }
    this.setPasswordOverride(userId, newPassword);
    const user = BN.getCurrentUser();
    if (user && user.id === userId) {
      // keep session without re-storing plain password in session blob beyond override
      this.appendAudit({
        actor_id: userId,
        actor_role_at_time: user.role,
        class_id: user.class_memberships?.[0]?.class_id || null,
        action: "PASSWORD_CHANGED",
        target_type: "User",
        target_id: userId,
        metadata: {}
      });
    }
    return { ok: true };
  },

  async renderPendingQueue() {
    const body = document.getElementById("mod-pending-body");
    const badge = document.getElementById("mod-pending-badge");
    const stat = document.getElementById("mod-stat-pending");
    if (!body) return;

    const pending = this.getPending();
    if (badge) badge.textContent = `${pending.length} waiting`;
    if (stat) stat.textContent = String(pending.length);

    const headerCells = body.closest("table")?.querySelectorAll("thead th") || [];
    const headers = Array.from(headerCells).map((th) => th.textContent.trim().toLowerCase());
    const cols = headers.length || 6;
    const hasUsername = headers.some((h) => h.includes("username"));

    if (pending.length === 0) {
      body.innerHTML = `
        <tr>
          <td colspan="${cols}" class="bn-empty" style="padding:1.5rem;">
            <strong>Queue empty</strong>
            New registrations appear here after invite-code signup (Phase 1).
          </td>
        </tr>`;
      return;
    }

    body.innerHTML = pending
      .map((p) => {
        const actions = `
          <button type="button" class="bn-btn bn-btn-primary bn-approve" style="padding:0.3rem 0.65rem; font-size:0.8rem;">Approve</button>
          <button type="button" class="bn-btn bn-btn-secondary bn-reject" style="padding:0.3rem 0.65rem; font-size:0.8rem;">Reject</button>`;
        if (hasUsername) {
          return `<tr data-pending-id="${p.id}">
            <td>${escapeHtml(p.full_name)}</td>
            <td>${escapeHtml(p.student_id || "—")}</td>
            <td class="bn-muted">${escapeHtml(p.email)}</td>
            <td>${escapeHtml(p.username)}</td>
            <td><code>${escapeHtml(p.invite_code)}</code></td>
            <td class="bn-muted">${BN.formatDateTime(p.created_at)}</td>
            <td>${actions}</td>
          </tr>`;
        }
        return `<tr data-pending-id="${p.id}">
          <td>${escapeHtml(p.full_name)}</td>
          <td>${escapeHtml(p.student_id || "—")}</td>
          <td class="bn-muted">${escapeHtml(p.email)}</td>
          <td><code>${escapeHtml(p.invite_code)}</code></td>
          <td class="bn-muted">${BN.formatDateTime(p.created_at)}</td>
          <td>${actions}</td>
        </tr>`;
      })
      .join("");

    body.querySelectorAll(".bn-approve").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.closest("tr").dataset.pendingId;
        const mod = BN.getCurrentUser();
        await this.approvePending(id, mod);
        await this.renderPendingQueue();
      });
    });
    body.querySelectorAll(".bn-reject").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.closest("tr").dataset.pendingId;
        const mod = BN.getCurrentUser();
        await this.rejectPending(id, mod);
        await this.renderPendingQueue();
      });
    });
  }
};

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

window.Phase1 = Phase1;
