/* Blue Noelle: opt-in Supabase connector for future phases.
 * Load the official @supabase/supabase-js UMD bundle, followed by
 * supabase-config.js and this file only on pages where integration is enabled.
 * Never use the service role key in browsers.
 */
(function (global) {
  const config = global.BN_SUPABASE_CONFIG;
  const valid = Boolean(config && /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(config.url)
    && config.publishableKey && !config.publishableKey.includes('REPLACE_ME'));
  let client = null;
  if (valid && global.supabase?.createClient) {
    client = global.supabase.createClient(config.url, config.publishableKey);
  }
  global.BNBackend = Object.freeze({
    mode: client ? 'supabase' : 'demo',
    configured: Boolean(client),
    client,
    async currentSession() {
      if (!client) return null;
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      return data.session;
    },
    async listMyClasses() {
      if (!client) throw new Error('Supabase has not been configured');
      const { data, error } = await client.from('ClassMembership')
        .select('class_id,role,status').eq('status','ACTIVE');
      if (error) throw error;
      return data;
    },
    async listSubjects(classId) {
      if (!client) throw new Error('Supabase has not been configured');
      const { data, error } = await client.from('Subject')
        .select('id,class_id,name,created_at').eq('class_id',classId)
        .is('deleted_at',null).order('name');
      if (error) throw error;
      return data;
    },
    async listAssignments(subjectIds) {
      if (!client) throw new Error('Supabase has not been configured');
      if (!subjectIds?.length) return [];
      const { data, error } = await client.from('Assignment')
        .select('id,subject_id,name,description,instructions,deadline,is_group,status,created_at')
        .in('subject_id',subjectIds).is('deleted_at',null).order('deadline');
      if (error) throw error;
      return data;
    }
  });
})(window);
