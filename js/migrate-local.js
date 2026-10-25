/* Blue Noelle: explicit, authenticated browser-backup migration for Phase 2.
 * This only migrates subjects/assignments. NEVER import demo accounts/passwords.
 * RLS on the server is the authoritative class-Admin check.
 */
(function (global) {
  const normalize = x => String(x ?? "").trim().toLocaleLowerCase();
  const asDate = x => x ? new Date(x).toISOString() : null;

  function validate(data) {
    if (!data || !Array.isArray(data.subjects) || !Array.isArray(data.assignments))
      throw Error("Expected an object containing subjects[] and assignments[].");
    if (data.subjects.length > 500 || data.assignments.length > 5000)
      throw Error("Import exceeds the safety limit (500 subjects / 5,000 assignments).");
    const ids = new Set();
    for (const s of data.subjects) {
      if (!s || typeof s.id !== "string" || !s.id || typeof s.name !== "string" || !s.name.trim())
        throw Error("Each subject needs a legacy ID and nonempty name.");
      if (ids.has(s.id)) throw Error("Duplicate subject ID: " + s.id);
      ids.add(s.id);
    }
    for (const a of data.assignments) {
      if (!a || !ids.has(a.subject_id) || typeof a.name !== "string" || !a.name.trim())
        throw Error("An assignment is missing its title or corresponding subject.");
      if (a.deadline && !Number.isFinite(Date.parse(a.deadline)))
        throw Error("Invalid deadline for: " + a.name);
    }
    return data;
  }

  async function migrate(classId, raw, log = () => {}) {
    const store = validate(raw);
    const api = global.BNBackend;
    if (!api?.client) throw Error("Supabase configuration is missing.");
    const { data: userData, error: authError } = await api.client.auth.getUser();
    if (authError || !userData?.user) throw Error("Sign in with a real Supabase Auth account.");
    const memberships = await api.listMyClasses();
    if (!memberships.some(m => m.class_id === classId && m.role === "Admin" && m.status === "ACTIVE"))
      throw Error("An active Admin membership in the selected class is required.");

    const existingSubjects = await api.listSubjects(classId);
    const byName = new Map(existingSubjects.map(s => [normalize(s.name), s]));
    const mapped = new Map();
    let addedSubjects = 0, skippedSubjects = 0, addedAssignments = 0, skippedAssignments = 0;
    for (const subject of store.subjects) {
      const key = normalize(subject.name);
      let remote = byName.get(key);
      if (!remote) {
        const {data, error} = await api.client.from("Subject")
          .insert({class_id: classId, name: subject.name.trim(), created_by: userData.user.id})
          .select("id,name").single();
        if (error) throw error;
        remote = data; byName.set(key, remote); addedSubjects++;
      } else skippedSubjects++;
      mapped.set(subject.id, remote.id);
    }
    const remoteIds = Array.from(new Set(mapped.values()));
    const existingAssignments = await api.listAssignments(remoteIds);
    const keyFor = (subjectId, a) => [
      subjectId, normalize(a.name), asDate(a.deadline), Boolean(a.is_group)
    ].join("|");
    const known = new Set(existingAssignments.map(a => keyFor(a.subject_id, a)));

    for (const a of store.assignments) {
      const subjectId = mapped.get(a.subject_id);
      const key = keyFor(subjectId, a);
      if (known.has(key)) { skippedAssignments++; continue; }
      const status = ["OPEN", "CLOSED", "ARCHIVED"].includes(a.status) ? a.status : "OPEN";
      const row = {
        subject_id: subjectId,
        name: a.name.trim(),
        description: String(a.description || ""),
        instructions: String(a.instructions || ""),
        deadline: asDate(a.deadline),
        is_group: Boolean(a.is_group),
        status,
        required_file_types: Array.isArray(a.required_file_types)
          ? a.required_file_types.map(String).slice(0, 20) : [],
        max_file_size_bytes: Number.isSafeInteger(a.max_file_size_bytes) &&
          a.max_file_size_bytes > 0 ? a.max_file_size_bytes : null,
        created_by: userData.user.id
      };
      const { error } = await api.client.from("Assignment").insert(row);
      if (error) throw error;
      known.add(key); addedAssignments++;
      log("Imported assignment: " + row.name);
    }
    return {addedSubjects,skippedSubjects,addedAssignments,skippedAssignments};
  }
  global.BNLegacyImport = Object.freeze({validate,migrate});
})(window);
