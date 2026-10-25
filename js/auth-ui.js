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
     const limited = error?.code === "over_email_send_rate_limit" ||
       /email rate limit exceeded/i.test(error?.message || "");
     const unconfirmed = error?.code === "email_not_confirmed" ||
       /email not confirmed/i.test(error?.message || "");
     const duplicate = error?.code === "user_already_exists" ||
       /user already registered|user already exists/i.test(error?.message || "");
     status(limited
       ? "Too many confirmation or recovery emails have been requested. Email delivery is temporarily limited. Please try again later, or use an existing code."
       : unconfirmed
       ? "Your email is not verified. Open Verify Email below and enter your confirmation code, or request a new code from that page."
       : duplicate
       ? "An account may already exist for this email. Try signing in or using Forgot password instead of registering again."
       : (error?.message || "Unable to complete your request. Please try again."), "error");
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
   const params = new URLSearchParams(w.location.search);
   const verify = params.has("verified");
   const signupPending = params.get("signup") === "check-email";
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
   if (!verify && !recovery && signupPending)
     status("Registration received. Check your email for the confirmation link, then sign in.", "success");
   else if (!verify && !recovery)
     status("Sign in using the email associated with your Blue Noelle account.", "info");
 }
 async function register() {
   const form = $("signup-form");
   const signupInfo = $("signup-info");
   const confirmation = $("signup-confirmation");
   let signupComplete = false;
   let confirmationDestination = "verify-email.html";
   confirmation.addEventListener("close", () => {
     if (signupComplete) go(confirmationDestination);
   });
   async function refresh() {
     const user = await currentUser();
     const profile = user ? await api().profile() : null;
     const isAdmin = profile?.account_type === "Admin";
     const list = user ? await memberships() : [];
     const alreadyOwns = isAdmin && list.some(m => m.role === "Admin" && m.status === "ACTIVE");
     $("join-section").hidden = !user || isAdmin;
     $("create-section").hidden = !user || !isAdmin || alreadyOwns;
     $("already-owned-section").hidden = !alreadyOwns;
     signupInfo.hidden = Boolean(user);
     $("signed-as").textContent = user ? "Signed in: " + (user.email || "Verified account") : "";
     if (!isAdmin && list.length) {
       $("join-hint").textContent = "You already have a membership record. You may join another class using a different invitation.";
     }
     return {user, isAdmin, alreadyOwns};
   }
   form.addEventListener("submit", event => {
     event.preventDefault();
     task(form, async () => {
       if ($("signup-password").value !== $("signup-confirm").value) throw Error("Passwords do not match.");
       const registrationType = document.querySelector('input[name="registration-type"]:checked')?.value || "Student";
       const email = $("signup-email").value.trim();
       const result = await api().signUp(email,$("signup-password").value,$("signup-name").value,registrationType);
       $("signup-password").value = ""; $("signup-confirm").value = "";
       // When email confirmation is disabled, signUp may immediately create a
       // session. End it so the requested journey consistently begins at Sign In.
       if (result?.session) await api().signOut();
       signupComplete = true;
       form.reset();
       if (result?.session) {
         confirmationDestination = "login.html";
         $("signup-confirm-title").textContent = "Account created";
         $("signup-confirm-description").textContent =
           "Your account is ready. Continue to Sign-In to access Blue Noelle.";
       } else {
         confirmationDestination = "verify-email.html";
         // Store only a short-lived email hint and resend cooldown. Never the
         // account password, OTP token, or a trusted role.
         try {
           const at = Date.now();
           sessionStorage.setItem("bn_pending_confirmation_email",
             JSON.stringify({email,at,nextResendAt:at+60000}));
         } catch (_) { /* Verification page also accepts manually typed email. */ }
         $("signup-confirm-title").textContent = "Check your email";
         $("signup-confirm-description").textContent =
           "If this is a new account, check your inbox for a eight-digit verification code. Already registered? Sign in instead. A successful signup response does not always mean a new email was sent.";
       }
       $("signup-confirm-continue").href = confirmationDestination;
       $("signup-continue-label").textContent =
         result?.session ? "Continue to Sign-In " : "Enter verification code ";
       status(result?.session
         ? "Account ready. Continue to sign in."
         : "Request processed. If this is a new account, check your email for a verification code. Already registered? Sign in or recover your password.", "info");
       if (typeof confirmation.showModal === "function") {
         confirmation.showModal();
       } else {
         // Older browsers still get the email reminder and clear navigation.
         w.alert($("signup-confirm-title").textContent + "\\n\\n" +
           $("signup-confirm-description").textContent);
         go(confirmationDestination);
       }
     });
   });
   const create = $("create-form");
   create.addEventListener("submit", event => {
     event.preventDefault();
     task(create, async () => {
       const result = await api().createClass($("create-name").value,$("create-section-name").value);
       if (!result?.ok) throw Error("Class creation could not be completed.");
       status("Your class has been created. You are its ACTIVE Admin.", "success");
       go("account.html");
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
   const state = await refresh();
   status(!state.user ? "Choose Student or Admin, create an account, confirm your email and sign in." :
     state.isAdmin && state.alreadyOwns ? "Your Admin class already exists. Open My Account to manage it." :
     state.isAdmin ? "Your Admin account is ready. Create your one classroom below." :
     "You're signed in as Student. Enter an invitation from a class administrator.", "info");
 }
 async function account() {
   const user = await currentUser();
   if (!user) return go("login.html");
   $("account-email").textContent = user.email || "Signed-in account";
   const profile = await api().profile();
   const isAdminAccount = profile?.account_type === "Admin";
   $("account-type").textContent = isAdminAccount ? "Admin account · One owned class" : "Student account · Join classes by invitation";
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
   const hasOwnedClass = isAdminAccount && list.some(m => m.role === "Admin" && m.status === "ACTIVE");
   $("join-action").hidden = hasOwnedClass;
   $("join-action").textContent = isAdminAccount ? "Create my one class" :
     (list.length ? "Join another class" : "Redeem an invitation");
   if (!list.length) {
     const note = document.createElement("p");
     note.textContent = isAdminAccount
       ? "Your account is registered as Admin. Create your one class to activate its Admin membership."
       : "No classroom membership yet. Redeem the private class invitation you received from a class administrator.";
     box.appendChild(note);
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
     isAdminAccount ? "Your Admin account is authenticated. Create your one class to continue." :
     "Your Student account is authenticated. Class access requires an approved invitation.", "info");
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
