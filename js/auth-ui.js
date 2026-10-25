/* Unified Phase 1 account entry. Supabase Auth identity, server RLS/RPC permissions.
 * Does not trust/demo localStorage identity, metadata roles or URL roles.
 */
(function (w) {
 "use strict";
 const $ = id => document.getElementById(id);
 const api = () => w.BNLivePhase1;
 const db = () => w.BNBackend?.client;
 function status(text, tone = "info") {
   const el = $("auth-status");
   if (!el) return;
   el.hidden = false; el.dataset.state = tone; el.textContent = text;
 }
 function submitLock(form, locked) {
   form.querySelectorAll('button[type="submit"]').forEach(button => button.disabled = locked);
 }
 async function task(form, handler) {
   submitLock(form, true);
   try { await handler(); } catch (error) {
     status(error?.message || "Unable to complete your request. Please try again.", "error");
   } finally { submitLock(form, false); }
 }
 async function currentUser() {
   const {data, error} = await db().auth.getUser();
   if (error?.name === "AuthSessionMissingError") return null;
   if (error) throw error;
   return data?.user || null;
 }
 async function memberships() {
   const user = await currentUser();
   if (!user) return [];
   return api().memberships();
 }
 function clearDemoSession() {
   // Clear only the obsolete prototype account; never clear genuine Supabase tokens.
   try { localStorage.removeItem("bn_current_user"); } catch (_) {}
 }
 function go(path) { w.location.replace(path); }
 async function login() {
   const recovery = new URLSearchParams(w.location.search).get("mode") === "recovery";
   const verify = new URLSearchParams(w.location.search).has("verified");
   const form = $("signin-form");
   if (!recovery) {
     const user = await currentUser();
     if (user) return go("account.html");
     if (verify) status("Email confirmation received. Sign in to continue your enrollment.", "success");
   } else {
     $("signin-section").hidden = true;
     $("recovery-section").hidden = false;
     const user = await currentUser();
     $("change-password-form").hidden = !user;
     if (!user) status("Open the latest password recovery link from your email. The link may have expired.", "info");
     else status("Recovery link verified. Choose your new password.", "success");
   }
   form.addEventListener("submit", event => {
     event.preventDefault();
     task(form, async () => {
       const email = $("signin-email").value.trim(), password = $("signin-password").value;
       await api().signIn(email, password);
       $("signin-password").value = "";
       status("Signed in. Opening your account…", "success");
       go("account.html");
     });
   });
   $("show-forgot").addEventListener("click", () => {
     $("forgot-section").hidden = false;
     $("signin-section").hidden = true;
     $("forgot-email").value = $("signin-email").value.trim();
     status("Enter your email address to request a password reset.", "info");
   });
   $("back-to-login").addEventListener("click", () => {
     $("forgot-section").hidden = true;
     $("signin-section").hidden = false;
     status("Sign in with your verified email.", "info");
   });
   const forgot = $("forgot-form");
   forgot.addEventListener("submit", event => {
     event.preventDefault();
     task(forgot, async () => {
       const email = $("forgot-email").value.trim();
       const redirectTo = new URL("login.html?mode=recovery", w.location.href).href;
       const {error} = await db().auth.resetPasswordForEmail(email, {redirectTo});
       if (error) throw error;
       status("If this email is registered, you'll receive a reset link. Check your inbox.", "success");
     });
   });
   const change = $("change-password-form");
   change.addEventListener("submit", event => {
     event.preventDefault();
     task(change, async () => {
       const p = $("new-password").value;
       if (p.length < 8) throw Error("Use at least eight characters.");
       if (p !== $("confirm-password").value) throw Error("Passwords do not match.");
       const {error} = await db().auth.updateUser({password: p});
       if (error) throw error;
       change.reset();
       status("Password updated. Opening your account…", "success");
       go("account.html");
     });
   });
   if (!verify && !recovery) status("Sign in using the email associated with your Blue Noelle account.", "info");
 }
 async function register() {
   const form = $("signup-form");
   const signupInfo = $("signup-info");
   async function refresh() {
     const user = await currentUser();
     $("join-section").hidden = !user;
     signupInfo.hidden = Boolean(user);
     $("signed-as").textContent = user ? "Signed in: " + (user.email || "Verified account") : "";
     if (user) {
       const list = await memberships();
       if (list.some(m => m.status === "ACTIVE" || m.status === "PENDING" || m.status === "REJECTED")) {
         $("join-hint").textContent = "You already have a membership record. Check My Account before requesting another class.";
       }
     }
   }
   form.addEventListener("submit", event => {
     event.preventDefault();
     task(form, async () => {
       if ($("signup-password").value !== $("signup-confirm").value) throw Error("Passwords do not match.");
       const result = await api().signUp($("signup-email").value,$("signup-password").value,$("signup-name").value);
       $("signup-password").value = ""; $("signup-confirm").value = "";
       if (!result?.session) status("Check your email and confirm your account. Then sign in and enter your class invitation below.", "success");
       else status("Account created. Continue with your class invitation.", "success");
       await refresh();
     });
   });
   const join = $("join-form");
   join.addEventListener("submit", event => {
     event.preventDefault();
     task(join, async () => {
       const result = await api().join($("join-code").value, $("join-username").value, $("join-student-id").value);
       if (!result?.ok) {
         status(result?.error || "The invitation could not be redeemed.", "error");
         return;
       }
       $("join-code").value = "";
       status("Request submitted. Your Student membership is PENDING until an officer approves it.", "success");
       go("account.html");
     });
   });
   await refresh();
   status($("join-section").hidden ? "Start by creating your account. You'll redeem your invite after confirming your email and signing in." : "You're signed in. Enter the private invite provided by your class administrator.", "info");
 }
 async function account() {
   const user = await currentUser();
   if (!user) return go("login.html");
   $("account-email").textContent = user.email || "Signed-in account";
   const box = $("memberships");
   const list = await memberships();
   const activeIds = [...new Set(list.filter(m => m.status === "ACTIVE").map(m => m.class_id))];
   const classNames = new Map();
   if (activeIds.length) {
     try {
       const {data, error} = await db().from("Class").select("id,name").in("id",activeIds);
       if (!error) for (const item of data || []) classNames.set(item.id, item.name);
     } catch (_) { /* still show verified membership without optional display name */ }
   }
   box.replaceChildren();
   $("member-count").textContent = list.length === 1 ? "1 class membership" : list.length + " class memberships";
   if (!list.length) {
     const note = document.createElement("p");
     note.textContent = "No classroom membership yet. Redeem the private class invitation you received from your class administrator.";
     box.appendChild(note);
     $("join-action").hidden = false;
   }
   let hasStaff = false, hasActive = false;
   for (const m of list) {
     const card = document.createElement("div"); card.className = "bn-membership";
     const title = document.createElement("strong");
     title.textContent = m.role + " · " + m.status;
     const detail = document.createElement("small"); detail.textContent = (classNames.get(m.class_id) || "Class") + " · " + m.class_id;
     const explanation = document.createElement("small");
     explanation.textContent = m.status === "PENDING" ? "Waiting for Moderator/Admin approval. Classroom data remains restricted." :
       m.status === "REJECTED" ? "Request declined. Contact a class officer if this is unexpected." :
       m.status === "ACTIVE" ? "Membership approved. Access is scoped to this classroom." :
       "Membership inactive.";
     card.append(title, detail, explanation); box.appendChild(card);
     if (m.status === "ACTIVE") {
       hasActive = true;
       if (m.role === "Moderator" || m.role === "Admin") hasStaff = true;
     }
   }
   $("staff-actions").hidden = !hasStaff;
   $("student-notice").hidden = !hasActive;
   const logout = $("signout");
   logout.addEventListener("click", () => task($("account-controls"), async () => {
     await api().signOut(); status("Signed out.", "success");go("login.html");
   }));
   $("refresh-account").addEventListener("click", () => w.location.reload());
   status(hasActive ? "Class membership verified. You are signed in." :
     "Your account is authenticated, but access to class content requires an approved membership.", "info");
 }
 document.addEventListener("DOMContentLoaded", async () => {
   clearDemoSession();
   if (!api()?.ready() || !db()) {
     status("Supabase is unavailable. Check your connection and try again.", "error");
     return;
   }
   try {
     const page = document.body.dataset.authPage;
     if (page === "login") await login();
     if (page === "register") await register();
     if (page === "account") await account();
   } catch (e) {
     status(e?.message || "Authentication service failed. Please try again.", "error");
   }
 });
})(window);
