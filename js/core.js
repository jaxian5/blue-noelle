/**
 * PROJECT: Blue Noelle — Core Frontend Helpers
 * Phase 0 Baseline | September 2026
 *
 * Guidelines for expanding this file:
 * - Class Clock is permanent. Keep it accurate (Asia/Manila display).
 * - Role lives on ClassMembership, never a global isAdmin flag.
 * - Test credentials live in data/roles.json until real SQL/API exist.
 * - Dark mode preference is stored in localStorage only (client preference).
 * - Profile avatar is stored as data-URL in localStorage for demo; later move to File storage.
 * - Never log or expose real passwords in production.
 */

const BN = {
  VERSION: "0.3",
  PHASE: "Phase 2",
  TIMEZONE: "Asia/Manila",
  ROLES_URL: "../data/roles.json", // relative from /pages/*.html
  STORAGE_USER: "bn_current_user",
  STORAGE_THEME: "bn_theme",
  STORAGE_AVATAR_PREFIX: "bn_avatar_",
  DEVELOPER_EMAIL: "dev@bluenoelle.local",

  /* ---------- Time helpers ---------- */
  formatTime(date, options = {}) {
    const d = typeof date === "string" ? new Date(date) : date;
    return new Intl.DateTimeFormat("en-PH", {
      timeZone: this.TIMEZONE,
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
      ...options
    }).format(d);
  },

  formatDate(date) {
    const d = typeof date === "string" ? new Date(date) : date;
    return new Intl.DateTimeFormat("en-PH", {
      timeZone: this.TIMEZONE,
      weekday: "short",
      month: "short",
      day: "numeric"
    }).format(d);
  },

  formatDateTime(date) {
    return `${this.formatDate(date)} · ${this.formatTime(date)}`;
  },

  computeLateness(submittedAt, deadlineAtSubmission) {
    const submitted = new Date(submittedAt);
    const deadline = new Date(deadlineAtSubmission);
    const diffMs = submitted - deadline;
    return {
      isLate: diffMs > 0,
      minutesLate: Math.max(0, Math.floor(diffMs / 60000))
    };
  },

  getUrgency(deadline) {
    const now = Date.now();
    const dl = new Date(deadline).getTime();
    const hoursLeft = (dl - now) / 3_600_000;
    if (hoursLeft < 0) return "late";
    if (hoursLeft <= 48) return "soon";
    return "ok";
  },

  countdown(deadline) {
    const now = Date.now();
    const dl = new Date(deadline).getTime();
    let diff = dl - now;
    if (diff < 0) {
      const abs = Math.abs(diff);
      const h = Math.floor(abs / 3_600_000);
      const m = Math.floor((abs % 3_600_000) / 60_000);
      return `Late by ${h}h ${m}m`;
    }
    const days = Math.floor(diff / 86_400_000);
    const hours = Math.floor((diff % 86_400_000) / 3_600_000);
    const mins = Math.floor((diff % 3_600_000) / 60_000);
    if (days > 0) return `${days}d ${hours}h left`;
    if (hours > 0) return `${hours}h ${mins}m left`;
    return `${mins}m left`;
  },

  /* ---------- Permission matrix (Phase 0) ---------- */
  can(role, permission) {
    const matrix = {
      Student: ["submit_work", "chat", "view_schedule", "view_own_submissions"],
      Moderator: [
        "submit_work", "chat", "view_schedule", "verify_users",
        "moderate_chat", "monitor_submissions"
      ],
      Admin: [
        "submit_work", "chat", "view_schedule", "verify_users", "create_assignments",
        "moderate_chat", "manage_users", "manage_class", "view_reports"
      ],
      Developer: ["*"]
    };
    const allowed = matrix[role] || [];
    return allowed.includes("*") || allowed.includes(permission);
  },

  /* ---------- Session (demo only) ---------- */
  getCurrentUser() {
    try {
      const raw = localStorage.getItem(this.STORAGE_USER);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },

  setCurrentUser(user) {
    // Strip password before storing in session for slightly better hygiene
    const safe = { ...user };
    delete safe.password;
    localStorage.setItem(this.STORAGE_USER, JSON.stringify(safe));
  },

  clearCurrentUser() {
    localStorage.removeItem(this.STORAGE_USER);
  },

  async loadAccounts() {
    // Path depends on whether we are on /pages/ or root
    const candidates = [
      "../data/roles.json",
      "data/roles.json",
      "/data/roles.json"
    ];
    for (const url of candidates) {
      try {
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          return data.accounts || [];
        }
      } catch {
        /* try next */
      }
    }
    console.warn("BN: could not load roles.json — using empty list");
    return [];
  },

  async login(usernameOrEmail, password) {
    if (window.Phase1?.login) {
      return window.Phase1.login(usernameOrEmail, password);
    }
    const accounts = await this.loadAccounts();
    const user = accounts.find(
      (a) =>
        (a.username === usernameOrEmail || a.email === usernameOrEmail) &&
        a.password === password
    );
    if (!user) return { ok: false, error: "Invalid credentials" };
    this.setCurrentUser(user);
    return { ok: true, user };
  },

  logout() {
    this.clearCurrentUser();
    // Password invite unlock is session-only — clear on sign-out
    try {
      sessionStorage.removeItem("bn_password_unlocked");
    } catch {
      /* */
    }
    const loginPath = location.pathname.includes("/pages/")
      ? "login.html"
      : "pages/login.html";
    location.href = loginPath;
  },

  isPasswordUnlocked() {
    try {
      return sessionStorage.getItem("bn_password_unlocked") === "1";
    } catch {
      return false;
    }
  },

  setPasswordUnlocked(on) {
    try {
      if (on) sessionStorage.setItem("bn_password_unlocked", "1");
      else sessionStorage.removeItem("bn_password_unlocked");
    } catch {
      /* */
    }
  },

  /* ---------- Theme ---------- */
  getTheme() {
    return localStorage.getItem(this.STORAGE_THEME) || "light";
  },

  setTheme(theme) {
    const t = theme === "dark" ? "dark" : "light";
    localStorage.setItem(this.STORAGE_THEME, t);
    document.documentElement.setAttribute("data-theme", t);
  },

  toggleTheme() {
    const next = this.getTheme() === "dark" ? "light" : "dark";
    this.setTheme(next);
    return next;
  },

  /* ---------- Avatar (demo: localStorage data-URL) ---------- */
  getAvatar(userId) {
    if (!userId) return null;
    return localStorage.getItem(this.STORAGE_AVATAR_PREFIX + userId) || null;
  },

  setAvatar(userId, dataUrl) {
    if (!userId) return;
    if (dataUrl) {
      localStorage.setItem(this.STORAGE_AVATAR_PREFIX + userId, dataUrl);
    } else {
      localStorage.removeItem(this.STORAGE_AVATAR_PREFIX + userId);
    }
  },

  initials(fullName) {
    if (!fullName) return "?";
    return fullName
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0])
      .join("")
      .toUpperCase();
  }
};

/* ---------- Class Clock ---------- */
function initClassClock() {
  const clockEl = document.getElementById("bn-live-clock");
  const currentEl = document.getElementById("bn-current-class");
  const nextEl = document.getElementById("bn-next-class");
  if (!clockEl) return;

  function update() {
    const now = new Date();
    clockEl.textContent = BN.formatTime(now, { second: "2-digit" });
    if (currentEl) currentEl.textContent = "—";
    if (nextEl) nextEl.textContent = "Check full schedule";
  }
  update();
  setInterval(update, 1000);
}

/* ---------- Profile Sidebar ---------- */
function ensureSidebarMarkup() {
  if (document.getElementById("bn-profile-sidebar")) return;

  const overlay = document.createElement("div");
  overlay.id = "bn-sidebar-overlay";
  overlay.className = "bn-sidebar-overlay";
  overlay.setAttribute("aria-hidden", "true");

  const sidebar = document.createElement("aside");
  sidebar.id = "bn-profile-sidebar";
  sidebar.className = "bn-profile-sidebar";
  sidebar.setAttribute("aria-label", "Account panel");
  sidebar.innerHTML = `
    <div class="bn-sidebar-header">
      <h2>Account</h2>
      <button type="button" class="bn-sidebar-close" id="bn-sidebar-close" aria-label="Close">×</button>
    </div>
    <div class="bn-sidebar-body">
      <div class="bn-sidebar-avatar-block">
        <div class="bn-sidebar-avatar" id="bn-sidebar-avatar">?</div>
        <div>
          <div id="bn-sidebar-name" style="font-weight:650;">—</div>
          <div class="bn-muted bn-text-sm" id="bn-sidebar-role-label"></div>
        </div>
        <div class="bn-sidebar-avatar-actions">
          <label class="bn-btn bn-btn-secondary" style="padding:0.35rem 0.7rem; font-size:0.8rem; cursor:pointer;">
            Change photo
            <input type="file" id="bn-avatar-input" accept="image/*" hidden />
          </label>
          <button type="button" class="bn-btn bn-btn-ghost" style="padding:0.35rem 0.7rem; font-size:0.8rem;" id="bn-avatar-remove">Remove</button>
        </div>
      </div>

      <div>
        <div class="bn-sidebar-section-title">Account information</div>
        <div class="bn-sidebar-field">
          <label>Full name</label>
          <div class="value" id="bn-field-name">—</div>
        </div>
        <div class="bn-sidebar-field" style="margin-top:0.65rem;">
          <label>Email</label>
          <div class="value" id="bn-field-email">—</div>
        </div>
        <div class="bn-sidebar-field" style="margin-top:0.65rem;">
          <label>Username</label>
          <div class="value" id="bn-field-username">—</div>
        </div>
        <div class="bn-sidebar-field" style="margin-top:0.65rem;">
          <label>Password</label>
          <div class="value" id="bn-field-password">••••••••</div>
          <div class="bn-flex" style="margin-top:0.45rem; gap:0.4rem; flex-wrap:wrap;">
            <button type="button" class="bn-btn bn-btn-secondary" id="bn-password-view" style="padding:0.3rem 0.65rem; font-size:0.75rem;">View</button>
            <button type="button" class="bn-btn bn-btn-secondary" id="bn-password-edit" style="padding:0.3rem 0.65rem; font-size:0.75rem;">Edit</button>
          </div>
          <p class="bn-muted" style="font-size:0.7rem; margin-top:0.35rem;">
            View or edit requires the invite code used at registration (Phase 1).
          </p>
          <div id="bn-password-edit-panel" hidden style="margin-top:0.5rem;">
            <input type="password" id="bn-password-new" placeholder="New password (min 8)" style="width:100%; padding:0.45rem 0.65rem; border:1px solid var(--bn-border-strong); border-radius:var(--bn-radius-sm); font:inherit; background:var(--bn-bg); color:var(--bn-text);" />
            <button type="button" class="bn-btn bn-btn-primary" id="bn-password-save" style="width:100%; margin-top:0.4rem; padding:0.4rem; font-size:0.8rem;">Save new password</button>
          </div>
        </div>
        <div class="bn-sidebar-field" style="margin-top:0.65rem;">
          <label>Role</label>
          <div><span class="bn-sidebar-role-badge" id="bn-field-role">—</span></div>
        </div>
      </div>

      <div>
        <div class="bn-sidebar-section-title">Appearance</div>
        <button type="button" class="bn-theme-toggle" id="bn-theme-toggle" aria-pressed="false">
          <span id="bn-theme-label">Dark mode</span>
          <span class="toggle-track"><span class="toggle-thumb"></span></span>
        </button>
      </div>
    </div>
    <div class="bn-sidebar-footer">
      <button type="button" class="bn-btn bn-btn-danger" id="bn-sign-out">Sign out</button>
      <div class="bn-sidebar-meta">
        <div class="bn-sidebar-version">Blue Noelle (Version 0.3: Phase 2 started)</div>
        <button type="button" class="bn-sidebar-feedback" id="bn-feedback-open">
          Found bugs or have feedback? Click here
        </button>
      </div>
    </div>
  `;

  // Invite-code gate for password view/edit (Phase 1)
  if (!document.getElementById("bn-invite-gate-modal")) {
    const gate = document.createElement("div");
    gate.id = "bn-invite-gate-modal";
    gate.className = "bn-feedback-modal";
    gate.setAttribute("aria-hidden", "true");
    gate.innerHTML = `
      <div class="bn-feedback-dialog" role="dialog" aria-labelledby="bn-invite-gate-title">
        <div class="bn-feedback-dialog-header">
          <h3 id="bn-invite-gate-title">Confirm invite code</h3>
          <button type="button" class="bn-sidebar-close" id="bn-invite-gate-close" aria-label="Close">×</button>
        </div>
        <p class="bn-muted bn-text-sm" style="margin-bottom:0.75rem;">
          Enter the class invite code you used at registration to view or edit your password.
        </p>
        <input type="text" id="bn-invite-gate-input" autocomplete="off" placeholder="e.g. BN-EDUC2-2026"
          style="width:100%; padding:0.55rem 0.75rem; border:1px solid var(--bn-border-strong); border-radius:var(--bn-radius-sm); font:inherit; background:var(--bn-bg); color:var(--bn-text); margin-bottom:0.5rem;" />
        <p id="bn-invite-gate-error" class="bn-text-sm" style="color:var(--bn-danger); display:none; margin-bottom:0.5rem;"></p>
        <button type="button" class="bn-btn bn-btn-primary" id="bn-invite-gate-confirm" style="width:100%;">Confirm</button>
      </div>
    `;
    document.body.appendChild(gate);
  }

  // Feedback panel (chat system when available, or developer email)
  if (!document.getElementById("bn-feedback-modal")) {
    const modal = document.createElement("div");
    modal.id = "bn-feedback-modal";
    modal.className = "bn-feedback-modal";
    modal.setAttribute("aria-hidden", "true");
    modal.innerHTML = `
      <div class="bn-feedback-dialog" role="dialog" aria-labelledby="bn-feedback-title">
        <div class="bn-feedback-dialog-header">
          <h3 id="bn-feedback-title">Send feedback</h3>
          <button type="button" class="bn-sidebar-close" id="bn-feedback-close" aria-label="Close">×</button>
        </div>
        <p class="bn-muted bn-text-sm" style="margin-bottom:1rem;">
          Phase 0 · Report bugs or suggestions. Prefer in-app class chat when available (Phase 6);
          otherwise contact the platform developer.
        </p>
        <div class="bn-feedback-actions">
          <a href="#" class="bn-btn bn-btn-primary" id="bn-feedback-chat">
            Open class chat
          </a>
          <a href="mailto:dev@bluenoelle.local?subject=Blue%20Noelle%20feedback%20(v0.1%20Phase%200)&body=Describe%20the%20bug%20or%20suggestion%3A%0A%0APage%3A%20%0ASteps%3A%20%0AExpected%3A%20%0AActual%3A%20"
             class="bn-btn bn-btn-secondary" id="bn-feedback-email">
            Email developer
          </a>
        </div>
        <p class="bn-muted" style="font-size:0.75rem; margin-top:1rem;">
          Developer: dev@bluenoelle.local · All elevated actions remain auditable per Phase 0.
        </p>
      </div>
    `;
    document.body.appendChild(modal);
  }

  document.body.appendChild(overlay);
  document.body.appendChild(sidebar);
}

function openSidebar() {
  ensureSidebarMarkup();
  populateSidebar();
  document.getElementById("bn-sidebar-overlay").classList.add("open");
  document.getElementById("bn-profile-sidebar").classList.add("open");
  document.getElementById("bn-sidebar-overlay").setAttribute("aria-hidden", "false");
}

function closeSidebar() {
  const overlay = document.getElementById("bn-sidebar-overlay");
  const sidebar = document.getElementById("bn-profile-sidebar");
  if (overlay) {
    overlay.classList.remove("open");
    overlay.setAttribute("aria-hidden", "true");
  }
  if (sidebar) sidebar.classList.remove("open");
}

function populateSidebar() {
  const user = BN.getCurrentUser();
  if (!user) return;

  const name = user.full_name || "User";
  const avatarUrl = BN.getAvatar(user.id);

  const avatarEl = document.getElementById("bn-sidebar-avatar");
  if (avatarUrl) {
    avatarEl.innerHTML = `<img src="${avatarUrl}" alt="" />`;
  } else {
    avatarEl.textContent = BN.initials(name);
    avatarEl.querySelector("img")?.remove();
  }

  document.getElementById("bn-sidebar-name").textContent = name;
  document.getElementById("bn-sidebar-role-label").textContent = user.role || "";
  document.getElementById("bn-field-name").textContent = name;
  document.getElementById("bn-field-email").textContent = user.email || "—";
  document.getElementById("bn-field-username").textContent = user.username || "—";
  document.getElementById("bn-field-password").textContent = "••••••••";
  document.getElementById("bn-field-role").textContent = user.role || "—";

  // Sync header chip avatar too
  updateHeaderChip(user);
}

function updateHeaderChip(user) {
  const chip = document.getElementById("bn-user-chip") || document.querySelector(".bn-user-chip");
  if (!chip || !user) return;

  const avatarBox = chip.querySelector(".bn-avatar");
  const nameSpan = chip.querySelector("span:last-child") || chip.querySelector("span");
  if (nameSpan) nameSpan.textContent = user.full_name || "User";

  if (avatarBox) {
    const url = BN.getAvatar(user.id);
    if (url) {
      avatarBox.innerHTML = `<img src="${url}" alt="" />`;
    } else {
      avatarBox.textContent = BN.initials(user.full_name);
    }
  }
}

function bindSidebarEvents() {
  ensureSidebarMarkup();

  // Open via any .bn-user-chip
  document.querySelectorAll(".bn-user-chip").forEach((chip) => {
    if (chip.dataset.bnBound) return;
    chip.dataset.bnBound = "1";
    chip.setAttribute("role", "button");
    chip.setAttribute("tabindex", "0");
    chip.setAttribute("aria-haspopup", "dialog");
    chip.addEventListener("click", openSidebar);
    chip.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openSidebar();
      }
    });
  });

  document.getElementById("bn-sidebar-close")?.addEventListener("click", closeSidebar);
  document.getElementById("bn-sidebar-overlay")?.addEventListener("click", closeSidebar);

  document.getElementById("bn-sign-out")?.addEventListener("click", () => {
    BN.logout();
  });

  document.getElementById("bn-theme-toggle")?.addEventListener("click", () => {
    const next = BN.toggleTheme();
    const btn = document.getElementById("bn-theme-toggle");
    btn?.setAttribute("aria-pressed", next === "dark" ? "true" : "false");
  });

  document.getElementById("bn-avatar-input")?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    if (file.size > 2 * 1024 * 1024) {
      alert("Please choose an image under 2 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const user = BN.getCurrentUser();
      if (!user) return;
      BN.setAvatar(user.id, reader.result);
      populateSidebar();
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  });

  document.getElementById("bn-avatar-remove")?.addEventListener("click", () => {
    const user = BN.getCurrentUser();
    if (!user) return;
    BN.setAvatar(user.id, null);
    populateSidebar();
  });

  // Feedback: chat (Phase 6) or developer email
  const openFeedback = () => {
    const m = document.getElementById("bn-feedback-modal");
    if (m) {
      m.classList.add("open");
      m.setAttribute("aria-hidden", "false");
    }
  };
  const closeFeedback = () => {
    const m = document.getElementById("bn-feedback-modal");
    if (m) {
      m.classList.remove("open");
      m.setAttribute("aria-hidden", "true");
    }
  };
  document.getElementById("bn-feedback-open")?.addEventListener("click", openFeedback);
  document.getElementById("bn-feedback-close")?.addEventListener("click", closeFeedback);
  document.getElementById("bn-feedback-modal")?.addEventListener("click", (e) => {
    if (e.target.id === "bn-feedback-modal") closeFeedback();
  });
  document.getElementById("bn-feedback-chat")?.addEventListener("click", (e) => {
    e.preventDefault();
    // Class chat is Phase 6 — controlled scope, not Discord 2.0
    alert(
      "Class chat is scheduled for Phase 6 (Community).\n\n" +
        "Until then, please use Email developer, or message your class Moderator/Admin.\n\n" +
        "Per Phase 0: keep chat scope controlled — public class chat, moderation, reports."
    );
    closeFeedback();
  });

  // Password view/edit
  // - First time in this session: invite-code gate
  // - After success: unlocked until refresh or sign-out (sessionStorage)
  // - View toggles to Hide; Hide masks password again
  let passwordGateAction = null; // 'view' | 'edit'
  let passwordVisible = false;

  const showPassword = () => {
    const user = BN.getCurrentUser();
    const pwd = window.Phase1?.getEffectivePassword(user) || user?.password || "—";
    const el = document.getElementById("bn-field-password");
    const btn = document.getElementById("bn-password-view");
    if (el) el.textContent = pwd;
    if (btn) btn.textContent = "Hide";
    passwordVisible = true;
  };

  const hidePassword = () => {
    const el = document.getElementById("bn-field-password");
    const btn = document.getElementById("bn-password-view");
    if (el) el.textContent = "••••••••";
    if (btn) btn.textContent = "View";
    passwordVisible = false;
  };

  const requirePasswordUnlock = (action, onUnlocked) => {
    if (BN.isPasswordUnlocked()) {
      onUnlocked();
      return;
    }
    passwordGateAction = action;
    const m = document.getElementById("bn-invite-gate-modal");
    const input = document.getElementById("bn-invite-gate-input");
    const err = document.getElementById("bn-invite-gate-error");
    if (err) {
      err.style.display = "none";
      err.textContent = "";
    }
    if (input) input.value = "";
    if (m) {
      m.classList.add("open");
      m.setAttribute("aria-hidden", "false");
    }
    input?.focus();
    // stash callback
    window.__bnPasswordOnUnlocked = onUnlocked;
  };

  const closeInviteGate = () => {
    const m = document.getElementById("bn-invite-gate-modal");
    if (m) {
      m.classList.remove("open");
      m.setAttribute("aria-hidden", "true");
    }
    passwordGateAction = null;
    window.__bnPasswordOnUnlocked = null;
  };

  document.getElementById("bn-password-view")?.addEventListener("click", () => {
    if (passwordVisible) {
      hidePassword();
      return;
    }
    requirePasswordUnlock("view", () => {
      showPassword();
      document.getElementById("bn-password-edit-panel")?.setAttribute("hidden", "");
    });
  });

  document.getElementById("bn-password-edit")?.addEventListener("click", () => {
    requirePasswordUnlock("edit", () => {
      document.getElementById("bn-password-edit-panel")?.removeAttribute("hidden");
      document.getElementById("bn-password-new")?.focus();
    });
  });

  document.getElementById("bn-invite-gate-close")?.addEventListener("click", closeInviteGate);
  document.getElementById("bn-invite-gate-modal")?.addEventListener("click", (e) => {
    if (e.target.id === "bn-invite-gate-modal") closeInviteGate();
  });

  document.getElementById("bn-invite-gate-confirm")?.addEventListener("click", () => {
    const code = document.getElementById("bn-invite-gate-input")?.value || "";
    const err = document.getElementById("bn-invite-gate-error");
    const result = window.Phase1
      ? Phase1.verifyInviteForPassword(code)
      : { ok: false, error: "Phase 1 auth not loaded" };
    if (!result.ok) {
      if (err) {
        err.textContent = result.error || "Verification failed";
        err.style.display = "block";
      }
      return;
    }
    BN.setPasswordUnlocked(true);
    const cb = window.__bnPasswordOnUnlocked;
    closeInviteGate();
    if (typeof cb === "function") cb();
  });

  document.getElementById("bn-password-save")?.addEventListener("click", () => {
    const user = BN.getCurrentUser();
    if (!user || !window.Phase1) return;
    if (!BN.isPasswordUnlocked()) {
      requirePasswordUnlock("edit", () => {
        document.getElementById("bn-password-save")?.click();
      });
      return;
    }
    const next = document.getElementById("bn-password-new")?.value || "";
    const res = Phase1.changePassword(user.id, next);
    if (!res.ok) {
      alert(res.error || "Could not change password");
      return;
    }
    hidePassword();
    document.getElementById("bn-password-edit-panel")?.setAttribute("hidden", "");
    document.getElementById("bn-password-new").value = "";
    alert("Password updated (demo store until SQL/API).");
  });

  // Escape closes sidebar, feedback, and invite gate
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeInviteGate();
      closeFeedback();
      closeSidebar();
    }
  });
}

/* ---------- Boot ---------- */
document.addEventListener("DOMContentLoaded", () => {
  // Apply saved theme early
  BN.setTheme(BN.getTheme());

  initClassClock();

  const user = BN.getCurrentUser();
  if (user) {
    updateHeaderChip(user);
  }

  bindSidebarEvents();
});
