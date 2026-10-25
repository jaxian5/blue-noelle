/* Blue Noelle Phase 2: live classwork reader. No localStorage demo accounts or writes.
 * Backend RLS determines what rows are accessible. UI selection is not auth.
 */
(function (w) {
  "use strict";
  const $ = id => document.getElementById(id);
  const client = () => w.BNBackend?.client;
  let allowed = new Map();
  let generation = 0;

  function say(message, type="info") {
    const box = $("classwork-status");
    box.textContent = message;
    box.dataset.state = type;
  }
  function node(tag, text, className) {
    const el = document.createElement(tag);
    if (text != null) el.textContent = String(text);
    if (className) el.className = className;
    return el;
  }
  function formatDeadline(value) {
    if (!value) return "No deadline";
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "Deadline unavailable";
    return "Due " + new Intl.DateTimeFormat("en-PH", {
      timeZone:"Asia/Manila",dateStyle:"medium",timeStyle:"short"
    }).format(date);
  }
  function cardSubject(subject, assignments, role) {
    const section = node("section",null,"bn-card bn-classwork-subject");
    const heading = node("h3",subject.name || "Untitled subject");
    section.appendChild(heading);
    const body = node("div",null,"bn-classwork-list");
    if (!assignments.length) {
      body.appendChild(node("p","No assignments in this subject yet.","bn-muted bn-text-sm"));
    }
    for (const item of assignments) {
      const row = node("article",null,"bn-classwork-item");
      const left = node("div");
      left.append(node("h4",item.name || "Untitled assignment"));
      if (item.description) left.append(node("p",item.description));
      if (item.instructions) left.append(node("p","Instructions: " + item.instructions));
      const meta = node("div",null,"bn-classwork-meta");
      const kind = node("span",item.is_group ? "Group" : "Individual","bn-classwork-badge");
      const status = node("span",item.status || "OPEN","bn-classwork-badge");
      status.dataset.status = item.status || "OPEN";
      const deadline = node("span",formatDeadline(item.deadline),"bn-classwork-badge");
      meta.append(kind,status,deadline);
      if(role==="Student"){
        const link=node("a","Open submission","bn-btn bn-btn-secondary");
        link.href="submission.html?assignment="+encodeURIComponent(item.id);
        link.setAttribute("aria-label","Open submission for "+item.name);
        meta.append(link);
      }
      row.append(left,meta);
      body.appendChild(row);
    }
    section.appendChild(body);
    return section;
  }
  async function checked(request) {
    const {data,error} = await request;
    if (error) throw error;
    return data || [];
  }
  async function loadClass(classId) {
    const current = ++generation;
    $("classwork-content").hidden = true;
    const target = $("classwork-subjects");
    target.replaceChildren();
    if (!allowed.has(classId)) {
      say("This classroom is not part of your active memberships.","error");
      return;
    }
    say("Loading classwork from Supabase…");
    try {
      const db=client();
      const subjects=await checked(db.from("Subject")
        .select("id,class_id,name,created_at")
        .eq("class_id",classId).is("deleted_at",null).order("name"));
      if(current!==generation) return;
      const ids=subjects.map(s=>s.id);
      const assignments=ids.length ? await checked(db.from("Assignment")
        .select("id,subject_id,name,description,instructions,deadline,is_group,status,created_at")
        .in("subject_id",ids).is("deleted_at",null).order("created_at",{ascending:false})) : [];
      if(current!==generation) return;
      const membership = allowed.get(classId);
      $("classwork-role").textContent = membership.role + " · ACTIVE";
      $("classwork-admin-link").hidden = membership.role !== "Admin";
      if (!subjects.length) {
        target.append(node("div","No subjects yet. An Admin will create the first subject.","bn-card bn-classwork-empty"));
      } else {
        for (const subject of subjects) {
          target.appendChild(cardSubject(subject,assignments.filter(item=>item.subject_id===subject.id),membership.role));
        }
      }
      $("classwork-content").hidden = false;
      say(subjects.length + " subject(s) and " + assignments.length +
          " assignment(s) loaded. Data is restricted to your active classroom.","success");
    } catch (error) {
      if(current===generation) say("Unable to load classwork: " + (error?.message||"Unknown error"),"error");
    }
  }
  async function init() {
    const db=client();
    if(!w.BNBackend?.configured||!db){
      say("Supabase is unavailable. Check your connection or configuration.","error");
      return;
    }
    try {
      const {data:auth,error:authError}=await db.auth.getUser();
      if(authError||!auth?.user){
        w.location.replace("login.html");
        return;
      }
      const memberships=await checked(db.from("ClassMembership")
        .select("class_id,role,status").eq("status","ACTIVE"));
      const active=memberships.filter(m=>m.status==="ACTIVE");
      if(!active.length){
        say("You do not have an ACTIVE classroom membership. Return to My Account to complete enrollment.","info");
        return;
      }
      const ids=[...new Set(active.map(m=>m.class_id))];
      const classes=await checked(db.from("Class")
        .select("id,name,section").in("id",ids));
      allowed=new Map(active.filter(m=>classes.some(c=>c.id===m.class_id))
        .map(m=>[m.class_id,m]));
      if(!allowed.size){
        say("No accessible classroom records were found. Check your membership status.","info");
        return;
      }
      const picker=$("classwork-class");
      picker.replaceChildren();
      for(const cls of classes){
        if(!allowed.has(cls.id)) continue;
        const opt=node("option",(cls.name||"Classroom")+(cls.section?" · "+cls.section:""));
        opt.value=cls.id; picker.appendChild(opt);
      }
      picker.value = classes.find(cls => allowed.has(cls.id)).id;
      picker.disabled=false;
      picker.addEventListener("change",()=>loadClass(picker.value));
      await loadClass(picker.value);
    } catch(error) {
      say("Unable to load your classrooms: " + (error?.message||"Unknown error"),"error");
    }
  }
  document.addEventListener("DOMContentLoaded",init);
})(window);
