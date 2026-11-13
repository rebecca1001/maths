// Data layer. Two interchangeable backends with the same functions:
//  - Supabase (real schools): used when VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set
//  - Demo (no setup): everything lives in this browser's localStorage, with an example class (code DEMO)
import { createClient } from '@supabase/supabase-js';
import { seedDemoStudents } from './demo-data.js';
import { rowsFromPlayers } from './progress.js';
import { compSummary, PAID_PLANS } from './competitions.js';
import { demoPilotScore } from './pilot.js';
import { normUsername, usernameFromName, nameFromUsername, passKey } from './usernames.js';

const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// ---------------------------------------------------------------------------
// Supabase backend
// ---------------------------------------------------------------------------
function supabaseApi() {
  const sb = createClient(URL, KEY, { auth: { persistSession: true, autoRefreshToken: true } });
  const rpc = async (fn, args) => {
    const { data, error } = await sb.rpc(fn, args);
    if (error) return { error: error.message };
    return data;
  };
  const q = async (p) => { const { data, error } = await p; if (error) throw new Error(error.message); return data; };
  return {
    mode: 'supabase',
    // students
    studentLogin: (classCode, pin) => rpc('student_login', { p_class_code: classCode, p_pin: pin }),
    // school + username (or whole school email) + password
    studentLoginUser: (schoolId, username, passcode) => rpc('student_login_user', { p_school: schoolId, p_username: username, p_passcode: passcode }),
    findSchools: (q) => rpc('find_schools', { p_query: q }),
    schoolClasses: (schoolId) => rpc('school_classes', { p_school: schoolId }),
    studentState: (token) => rpc('student_state', { p_token: token }),
    studentSave: (token, data) => rpc('student_save', { p_token: token, p_data: data }),
    studentLogout: (token) => rpc('student_logout', { p_token: token }),
    // teachers
    async teacherSession() {
      const { data: { session } } = await sb.auth.getSession();
      if (!session) return null;
      const t = await q(sb.from('teachers').select('id,name,role,school_id,schools(id,name,join_code,plan)').eq('id', session.user.id).maybeSingle());
      return { email: session.user.email, teacher: t ? { id: t.id, name: t.name, role: t.role, school: t.schools } : null };
    },
    async teacherSignIn(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      return error ? { error: error.message } : { ok: true };
    },
    async teacherSignUp(email, password) {
      const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin } });
      if (error) return { error: error.message };
      return { ok: true, needsConfirm: !data.session };
    },
    async teacherSignInWith(provider) { // 'google' or 'azure' (Microsoft)
      const { error } = await sb.auth.signInWithOAuth({ provider, options: { redirectTo: location.origin + '/?teacher=1' } });
      return error ? { error: error.message } : { ok: true };
    },
    async teacherSignOut() { await sb.auth.signOut(); },
    async teacherResetPassword(email) {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + '/?reset=1' });
      return error ? { error: error.message } : { ok: true };
    },
    async teacherSetPassword(password) {
      const { data: { session } } = await sb.auth.getSession();
      if (!session) return { error: 'expired' };
      const { error } = await sb.auth.updateUser({ password });
      return error ? { error: error.message } : { ok: true };
    },
    createSchool: (schoolName, teacherName) => rpc('create_school', { p_school_name: schoolName, p_teacher_name: teacherName }),
    joinSchool: (code, teacherName) => rpc('join_school', { p_join_code: code, p_teacher_name: teacherName }),
    // every list is filtered to one school: the owner can read all schools, so the school must always be named
    listClasses: (schoolId) => q(sb.from('classes').select('id,name,code,settings,teacher_id,archived_at,created_at').eq('school_id', schoolId).is('archived_at', null).order('created_at')),
    listSchools: () => q(sb.from('schools').select('id,name,plan').order('name')),
    createClass: async (name, teacherId) => (await q(sb.from('classes').insert(teacherId ? { name, teacher_id: teacherId } : { name }).select('id,name,code,settings,teacher_id,archived_at').single())),
    updateClass: (id, patch) => q(sb.from('classes').update(patch).eq('id', id)),
    listStudents: (classId) => q(sb.from('students').select('id,name,real_name,pin,username,passcode,data,created_at').eq('class_id', classId).order('created_at')),
    // stars earned (not the spendable balance), stars this week and total rounds, from the server's round log
    classStats: (classId) => rpc('class_stats', { p_class: classId }),
    addStudent: async (classId, name) => (await q(sb.from('students').insert({ class_id: classId, name }).select('id,name,pin,data').single())),
    addStudents: (classId, names, realNames) => q(sb.from('students').insert(names.map((name, i) => ({ class_id: classId, name, real_name: (realNames && realNames[i]) || null }))).select('id,name,real_name,pin,data')),
    // add students from a pasted list: rows = [{ email, first, last, name }] (name = space name); dryRun = the review screen
    addSchoolStudents: (classId, rows, dryRun) => rpc('add_school_students', { p_class: classId, p_rows: rows, p_dry_run: !!dryRun }),
    // give a student a username (or email), or a new password (username null)
    setStudentLogin: (id, username) => rpc('set_student_login', { p_student: id, p_email: username || null }),
    setRealName: (id, realName) => q(sb.from('students').update({ real_name: realName || null }).eq('id', id)),
    async countStudents(schoolId) { const rows = await q(sb.from('students').select('class_id,classes!inner(school_id)').eq('classes.school_id', schoolId)); const n = {}; rows.forEach((r) => { n[r.class_id] = (n[r.class_id] || 0) + 1; }); return n; },
    // school admin
    listTeachers: (schoolId) => q(sb.from('teachers').select('id,name,email,role,created_at').eq('school_id', schoolId).order('created_at')),
    setTeacherRole: (id, role) => rpc('admin_set_role', { p_teacher: id, p_role: role }),
    removeTeacher: (id) => rpc('admin_remove_teacher', { p_teacher: id }),
    newJoinCode: () => rpc('admin_new_join_code', {}),
    adminSetPassword: (id, password) => rpc('admin_set_password', { p_teacher: id, p_password: password }),
    deleteMyAccount: async () => { const r = await rpc('delete_my_account', {}); if (r && r.ok) await sb.auth.signOut(); return r; },
    renameSchool: (schoolId, name) => q(sb.from('schools').update({ name }).eq('id', schoolId)),
    // owner only (checked by the database)
    isSuperAdmin: async () => { try { return (await rpc('is_super_admin', {})) === true; } catch (e) { return false; } },
    superOverview: () => rpc('super_overview', {}),
    // weekly progress rows per class (school admins get their school, the owner gets everything)
    schoolProgress: () => rpc('school_progress', {}),
    superProgress: () => rpc('super_progress', {}),
    superSetPlan: (schoolId, plan) => rpc('super_set_plan', { p_school: schoolId, p_plan: plan }),
    // pilot scorecards (owner only)
    superPilots: () => rpc('super_pilots', {}),
    superPilotSave: (p) => rpc('super_pilot_save', { p }),
    superPilotDelete: (id) => rpc('super_pilot_delete', { p_id: id }),
    // competitions (School and School Plus plans; the database checks the plan and who may do what)
    competitionsList: () => rpc('competitions_list', {}),
    competitionCreate: (c) => rpc('competition_create', { p: c }),
    competitionEnd: (id, del) => rpc('competition_end', { p_id: id, p_delete: !!del }),
    async newPin(studentId) {
      for (let i = 0; i < 20; i++) {
        const pin = randomPin();
        const { error } = await sb.from('students').update({ pin }).eq('id', studentId);
        if (!error) return pin;
      }
      throw new Error('Could not make a new code');
    },
    removeStudent: (id) => q(sb.from('students').delete().eq('id', id)),
  };
}

// ---------------------------------------------------------------------------
// Demo backend (browser only)
// ---------------------------------------------------------------------------
const DEMO_KEY = 'mm.demo.db.v1';
// Same rules as the database: "Franklin.Joshua@SD54.bc.ca" -> "franklin.joshua@sd54"
const COLOURS = ['red', 'blue', 'green', 'gold', 'pink', 'purple', 'orange', 'silver', 'teal', 'lime', 'ruby', 'mint', 'coral', 'sky', 'sun', 'moon'];
const ANIMALS = ['tiger', 'panda', 'otter', 'falcon', 'koala', 'shark', 'eagle', 'fox', 'wolf', 'owl', 'lynx', 'hawk', 'bear', 'frog', 'whale', 'comet', 'rocket', 'dragon', 'zebra', 'llama'];
const pickOne = (a) => a[Math.floor(Math.random() * a.length)];
export const newPasscode = () => `${pickOne(COLOURS)}-${pickOne(ANIMALS)}-${10 + Math.floor(Math.random() * 90)}`;
const roundStarsOf = (r) => r.stars ?? Math.round((r.pts ?? r.c * 30) / 10);
const mondayStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); };
const weekStars = (s, cut) => ((s.data && s.data.rounds) || []).filter(r => r.d >= cut).reduce((t, r) => t + roundStarsOf(r), 0);
function demoApi() {
  const id = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
  let db = null;
  // weekly progress rows for every class, worked out from the students' saved rounds (the real database does this in SQL)
  const demoProgressRows = () => db.classes.flatMap((c) => rowsFromPlayers(db.students.filter((x) => x.class_id === c.id).map((x) => ({ rounds: (x.data && x.data.rounds) || [] }))).map((r) => ({ ...r, class_id: c.id })));
  try { db = JSON.parse(localStorage.getItem(DEMO_KEY)); } catch (e) { db = null; }
  if (!db || !db.classes) {
    const classId = id();
    db = {
      school: { name: 'Demo School', join_code: 'DEMO0000', plan: 'school_plus' },
      competitions: [],
      teacher: null,
      classes: [{ id: classId, name: 'Demo class', code: 'DEMO', teacher_id: 'me', settings: { maxTable: 12, division: false, sound: true, battles: false }, archived_at: null }],
      students: seedDemoStudents().map(s => ({ ...s, class_id: classId })),
      sessions: {},
    };
  }
  const persist = () => { try { localStorage.setItem(DEMO_KEY, JSON.stringify(db)); } catch (e) { /* storage full or blocked */ } };
  persist();
  // Re-read before every call so several tabs share one demo database
  // older saved demos lack newer lists, so fill them in whenever the saved copy is (re)loaded
  const fill = () => {
    if (db.students.length && !db.students.some(x => x.username)) Object.assign(db.students[0], { username: 'fox.comet', passcode: 'blue-tiger-42', real_name: db.students[0].real_name || 'Comet Fox' });
    db.students.forEach(s => { if (s.username && s.username.includes('@')) s.username = s.username.split('@')[0]; }); // older demos stored the whole email
    if (!db.school.plan) db.school.plan = 'school_plus'; if (!db.competitions) db.competitions = []; if (!db.pilots) db.pilots = []; };
  const reload = () => { try { const x = JSON.parse(localStorage.getItem(DEMO_KEY)); if (x && x.classes) { db = x; fill(); } } catch (e) { /* keep in-memory copy */ } };
  const me = (token) => db.students.find(s => s.id === db.sessions[token]);
  fill();
  const paid = () => PAID_PLANS.includes(db.school.plan);
  const demoComps = (filter, meId, teacher) => db.competitions.filter(filter).map(c => compSummary(c, db.students, db.classes, meId, teacher, { includeDemo: true }));
  const localDay = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '')); return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : NaN; };
  const ok = (v) => Promise.resolve(JSON.parse(JSON.stringify(v)));
  const methods = {
    findSchools(q) {
      q = String(q || '').trim().toLowerCase();
      return ok(q.length >= 2 && db.school.name.toLowerCase().includes(q) ? [{ id: 'demo-school', name: db.school.name }] : []);
    },
    schoolClasses: () => ok(db.classes.filter(c => !c.archived_at).map(c => ({ name: c.name, code: c.code })).sort((a, b) => a.name.localeCompare(b.name))),
    studentLogin(classCode, pin) {
      const c = db.classes.find(x => x.code === String(classCode || '').trim().toUpperCase() && !x.archived_at);
      if (!c) return ok({ error: 'no_class' });
      const s = db.students.find(x => x.class_id === c.id && x.pin === pin);
      if (!s) return ok({ error: 'wrong_code' });
      const t = id() + id(); db.sessions[t] = s.id; s.last_login_at = s.last_seen_at = new Date().toISOString(); persist();
      return ok({ token: t, student_id: s.id });
    },
    studentLoginUser(schoolId, username, passcode) {
      const u = normUsername(username), pc = passKey(passcode);
      const s = schoolId === 'demo-school' && u && db.students.find(x => x.username === u && passKey(x.passcode) === pc && db.classes.some(c => c.id === x.class_id && !c.archived_at));
      if (!s) return ok({ error: 'wrong_login' });
      const t = id() + id(); db.sessions[t] = s.id; s.last_login_at = s.last_seen_at = new Date().toISOString(); persist();
      return ok({ token: t, student_id: s.id });
    },
    studentState(token) {
      const m = me(token); if (!m) return ok({ error: 'signed_out' });
      const c = db.classes.find(x => x.id === m.class_id);
      const cut = mondayStart();
      return ok({
        school_board: paid() ? db.students.map(s => ({ id: s.id, name: s.name, skin: (s.data && s.data.skin) || 'blob', class: (db.classes.find(x => x.id === s.class_id) || {}).name || '', stars: weekStars(s, cut) }))
          .filter(x => x.stars > 0).sort((a, b) => b.stars - a.stars || a.name.localeCompare(b.name)).slice(0, 10) : null,
        me: { id: m.id, name: m.name, data: m.data },
        class: { id: c.id, name: c.name, settings: c.settings },
        competitions: paid() ? demoComps(x => (!x.class_id || x.class_id === m.class_id) && new Date(x.starts_at) - Date.now() < 7 * 864e5 && Date.now() - new Date(x.ended_at || x.ends_at) < 7 * 864e5, m.id, false) : [],
        classmates: db.students.filter(s => s.class_id === m.class_id && s.id !== m.id).map(s => {
          const rs = (s.data.rounds || []).filter(r => r.d >= cut);
          return { id: s.id, name: s.name, data: { skin: s.data.skin || 'blob', wkStars: weekStars(s, cut), wkMins: Math.round(rs.reduce((t, r) => t + (r.len || 60), 0) / 60) } };
        }),
      });
    },
    studentSave(token, data) { const m = me(token); if (!m) return ok({ error: 'signed_out' }); m.data = data; m.last_seen_at = new Date().toISOString(); persist(); return ok({ ok: true }); },
    studentLogout(token) { delete db.sessions[token]; persist(); return ok(null); },
    teacherSession: () => ok(db.teacher ? { email: db.teacher.email, teacher: db.teacher.name ? { id: 'me', name: db.teacher.name, role: 'admin', school: { id: 'demo-school', ...db.school } } : null } : null),
    teacherSignIn(email) { db.teacher = { email, name: (db.teacher && db.teacher.name) || 'Demo teacher' }; persist(); return ok({ ok: true }); },
    teacherSignUp(email) { db.teacher = { email, name: null }; persist(); return ok({ ok: true, needsConfirm: false }); },
    teacherSignInWith() { db.teacher = { email: 'demo@school.ca', name: 'Demo teacher' }; persist(); return ok({ ok: true }); },
    teacherSignOut() { db.teacher = null; persist(); return ok(null); },
    teacherResetPassword() { return ok({ ok: true }); },
    teacherSetPassword() { return ok({ ok: true }); },
    createSchool(schoolName, teacherName) { db.school.name = schoolName; db.teacher.name = teacherName; persist(); return ok('demo-school'); },
    joinSchool(code, teacherName) { db.teacher.name = teacherName; persist(); return ok('demo-school'); },
    listSchools: () => ok([{ id: 'demo-school', name: db.school.name, plan: db.school.plan }]),
    listClasses: () => ok(db.classes.filter(c => !c.archived_at).map(c => ({ teacher_id: 'me', ...c }))),
    createClass(name, teacherId) {
      const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
      let code; do { code = Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join(''); } while (db.classes.some(c => c.code === code));
      const c = { id: id(), name, code, teacher_id: teacherId || 'me', settings: { maxTable: 10, division: false, sound: true, battles: false }, archived_at: null };
      db.classes.push(c); persist(); return ok(c);
    },
    updateClass(cid, patch) { Object.assign(db.classes.find(c => c.id === cid), patch); persist(); return ok(null); },
    listStudents: (cid) => ok(db.students.filter(s => s.class_id === cid)),
    classStats: (cid) => ok({ students: db.students.filter(s => s.class_id === cid).map(s => { const rs = (s.data && s.data.rounds) || [];
      return { id: s.id, stars_total: rs.reduce((t, r) => t + roundStarsOf(r), 0), stars_week: weekStars(s, mondayStart()), rounds_total: rs.length }; }) }),
    addStudent(cid, name) {
      let pin; do { pin = randomPin(); } while (db.students.some(s => s.class_id === cid && s.pin === pin));
      const s = { id: id(), class_id: cid, name, pin, data: {} }; db.students.push(s); persist(); return ok(s);
    },
    async addStudents(cid, names, realNames) {
      const out = await Promise.all(names.map(n => methods.addStudent(cid, n)));
      out.forEach((st, i) => { const s = db.students.find(x => x.id === st.id); s.real_name = st.real_name = (realNames && realNames[i]) || null; });
      persist(); return out;
    },
    // same rules as add_school_students in the database
    async addSchoolStudents(cid, rows, dryRun) {
      const added = [], skipped = [], taken = db.students.map(x => x.username).filter(Boolean);
      let i = 0;
      for (const r of rows || []) {
        i++; const f = String(r.first || '').trim(), l = String(r.last || '').trim();
        let u, real = `${f} ${l}`.trim() || null, renamed = false;
        if (String(r.email || '').includes('@')) {
          u = normUsername(r.email);
          if (!u) { skipped.push({ row: i, why: 'bad_email' }); continue; }
          if (taken.includes(u)) { skipped.push({ row: i, username: u, why: 'already_added' }); continue; }
          real = real || nameFromUsername(u);
        } else {
          const base = usernameFromName(f, l);
          if (!base) { skipped.push({ row: i, why: 'no_name' }); continue; }
          u = base; let k = 1; while (taken.includes(u)) { k++; u = base + k; } renamed = u !== base;
        }
        taken.push(u);
        if (dryRun) { added.push({ row: i, username: u, real_name: real, renamed }); continue; }
        const st = await methods.addStudent(cid, r.name || 'Space Cadet'), s = db.students.find(x => x.id === st.id);
        Object.assign(s, { username: u, passcode: newPasscode(), real_name: real });
        added.push({ row: i, ...s });
      }
      persist(); return { added, skipped };
    },
    setStudentLogin(sid, email) {
      const s = db.students.find(x => x.id === sid); if (!s) return ok({ error: 'not_allowed' });
      let u = s.username;
      if (email) { u = normUsername(email); if (!u) return ok({ error: 'bad_username' }); if (db.students.some(x => x.username === u && x.id !== sid)) return ok({ error: 'already_added' }); s.username = u; s.passcode = s.passcode || newPasscode(); }
      else { if (!u) return ok({ error: 'bad_username' }); s.passcode = newPasscode(); }
      persist(); return ok({ ok: true, username: s.username, passcode: s.passcode });
    },
    setRealName(sid, realName) { const s = db.students.find(x => x.id === sid); if (s) { s.real_name = realName || null; persist(); } return ok(null); },
    countStudents() { const n = {}; db.students.forEach(s => { n[s.class_id] = (n[s.class_id] || 0) + 1; }); return ok(n); },
    listTeachers() {
      const others = db.otherTeachers || (db.otherTeachers = [{ id: 'demo-lee', name: 'Mr Lee', email: 'lee@demo.school', role: 'teacher' }]);
      persist();
      return ok([{ id: 'me', name: (db.teacher && db.teacher.name) || 'Demo teacher', email: (db.teacher && db.teacher.email) || '', role: 'admin' }, ...others]);
    },
    setTeacherRole(tid, role) {
      const t = (db.otherTeachers || []).find(x => x.id === tid);
      if (tid === 'me' && role === 'teacher' && !(db.otherTeachers || []).some(x => x.role === 'admin')) return ok({ error: 'last_admin' });
      if (t) { t.role = role; persist(); }
      return ok({ ok: true });
    },
    removeTeacher(tid) {
      if (tid === 'me') return ok({ error: 'not_self' });
      db.otherTeachers = (db.otherTeachers || []).filter(x => x.id !== tid);
      db.classes.forEach(c => { if (c.teacher_id === tid) c.teacher_id = null; }); persist(); return ok({ ok: true });
    },
    deleteMyAccount() { const solo = !(db.otherTeachers || []).length; db.teacher = null; persist(); return ok({ ok: true, school_deleted: solo }); },
    adminSetPassword(_id, pw) { return ok(pw && pw.length >= 8 ? { ok: true } : { error: 'too_short' }); },
    newJoinCode() { db.school.join_code = Math.random().toString(16).slice(2, 10).toUpperCase(); persist(); return ok({ join_code: db.school.join_code }); },
    renameSchool(_sid, name) { db.school.name = name; persist(); return ok(null); },
    newPin(sid) {
      const s = db.students.find(x => x.id === sid);
      let pin; do { pin = randomPin(); } while (db.students.some(x => x.class_id === s.class_id && x.pin === pin));
      s.pin = pin; persist(); return ok(pin);
    },
    removeStudent(sid) { db.students = db.students.filter(s => s.id !== sid); persist(); return ok(null); },
    isSuperAdmin: () => ok(true),
    superOverview() {
      const day = (d) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
      const t = db.teacher || {};
      return ok({
        now: Date.now(),
        schools: [{ id: 'demo-school', name: db.school.name, plan: db.school.plan, created_at: null }],
        teachers: [{ id: 'me', school_id: 'demo-school', name: t.name || 'Demo teacher', email: t.email || '', role: 'admin' }, ...(db.otherTeachers || []).map(x => ({ ...x, school_id: 'demo-school' }))],
        classes: db.classes.map(c => ({ id: c.id, school_id: 'demo-school', teacher_id: c.teacher_id === 'me' ? 'me' : c.teacher_id, name: c.name, code: c.code, archived_at: c.archived_at, created_at: null })),
        students: db.students.map(s => {
          const rs = ((s.data && s.data.rounds) || []).filter(r => typeof r.d === 'number');
          return { id: s.id, class_id: s.class_id, name: s.name, real_name: s.real_name || null, created_at: null, last_login_at: s.last_login_at || null, last_seen_at: s.last_seen_at || null,
            demo: true, stars: rs.reduce((a, r) => a + roundStarsOf(r), 0), balance: Math.round((s.data && s.data.coins) || 0), rounds: rs.length, mins: Math.round(rs.reduce((a, r) => a + (r.len || 60), 0) / 60),
            first_round: rs.length ? Math.min(...rs.map(r => r.d)) : null, last_round: rs.length ? Math.max(...rs.map(r => r.d)) : null, days: [...new Set(rs.map(r => day(r.d)))] };
        }),
      });
    },
    schoolProgress() { return ok({ rows: demoProgressRows() }); },
    superPilots() {
      return ok({ pilots: db.pilots.map(p => { const c = db.classes.find(x => x.id === p.class_id) || {};
        return { ...p, class_name: c.name || 'Class', school_name: db.school.name, score: demoPilotScore(p, db.students, db.competitions, { includeDemo: true }) }; }) });
    },
    superPilotSave(p) {
      const okDay = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
      if (!db.classes.some(c => c.id === p.class_id)) return ok({ error: 'bad_class' });
      if (!okDay(p.starts_on) || !okDay(p.ends_on) || p.ends_on < p.starts_on) return ok({ error: 'bad_dates' });
      const fields = { class_id: p.class_id, starts_on: p.starts_on, ends_on: p.ends_on, baseline_days: Math.min(60, Math.max(3, +p.baseline_days || 14)) };
      let x = p.id && db.pilots.find(q => q.id === p.id);
      if (p.id && !x) return ok({ error: 'not_found' });
      if (x) Object.assign(x, fields, p.bonus != null ? { bonus: !!p.bonus } : {}, p.notes != null ? { notes: String(p.notes).slice(0, 1000) } : {});
      else { x = { id: id(), ...fields, bonus: !!p.bonus, notes: String(p.notes || '').slice(0, 1000) }; db.pilots.push(x); }
      persist(); return ok({ ok: true, id: x.id });
    },
    superPilotDelete(pid) { const n = db.pilots.length; db.pilots = db.pilots.filter(p => p.id !== pid); persist(); return ok({ ok: db.pilots.length < n }); },
    superSetPlan(_sid, plan) { if (!['free', 'school', 'school_plus'].includes(plan)) return ok({ error: 'bad_plan' }); db.school.plan = plan; persist(); return ok({ ok: true, plan }); },
    competitionsList() { return ok({ plan: db.school.plan, competitions: demoComps(c => Date.now() - new Date(c.ended_at || c.ends_at) < 90 * 864e5, null, true).sort((a, b) => (a.status === 'ended') - (b.status === 'ended') || new Date(b.starts_at) - new Date(a.starts_at)) }); },
    competitionCreate(p) {
      // the demo teacher is a school admin, so every kind is allowed
      if (!paid()) return ok({ error: 'needs_plan' });
      const kinds = ['top_player', 'class_target', 'school_target', 'class_race'];
      if (!kinds.includes(p.kind)) return ok({ error: 'bad_kind' });
      const measure = p.measure || 'stars'; if (!['stars', 'correct'].includes(measure)) return ok({ error: 'bad_measure' });
      const classKind = p.kind === 'top_player' || p.kind === 'class_target', targetKind = p.kind === 'class_target' || p.kind === 'school_target';
      if (classKind && !db.classes.some(c => c.id === p.class_id && !c.archived_at)) return ok({ error: 'bad_class' });
      const target = Math.round(+p.target); if (targetKind && !(target >= 1 && target <= 1e7)) return ok({ error: 'bad_target' });
      const prize = String(p.prize || '').trim().slice(0, 200); if (!prize) return ok({ error: 'no_prize' });
      const s = localDay(p.starts_on), e = localDay(p.ends_on);
      if (!(s && e) || e < s || (e - s) / 864e5 > 120 || s < Date.now() - 8 * 864e5) return ok({ error: 'bad_dates' });
      const title = String(p.title || '').trim().slice(0, 80) || { top_player: 'Top player', class_target: 'Class goal', school_target: 'School goal', class_race: 'Class race' }[p.kind];
      const c = { id: id(), kind: p.kind, measure, class_id: classKind ? p.class_id : null, target: targetKind ? target : null, title, prize,
        starts_at: new Date(s).toISOString(), ends_at: new Date(e + 864e5).toISOString(), ended_at: null, created_by: 'me' };
      db.competitions.push(c); persist(); return ok(compSummary(c, db.students, db.classes, null, true, { includeDemo: true }));
    },
    competitionEnd(cid, del) {
      const c = db.competitions.find(x => x.id === cid); if (!c) return ok({ error: 'not_found' });
      if (del) db.competitions = db.competitions.filter(x => x.id !== cid); else if (!c.ended_at) c.ended_at = new Date().toISOString();
      persist(); return ok({ ok: true });
    },
    superProgress() { return ok({ rows: demoProgressRows() }); },
    resetDemo() { localStorage.removeItem(DEMO_KEY); },
  };
  const wrapped = { mode: 'demo' };
  for (const [k, f] of Object.entries(methods)) wrapped[k] = (...args) => { reload(); return f(...args); };
  return wrapped;
}

export function randomPin() {
  let s;
  do { s = String(Math.floor(Math.random() * 10000)).padStart(4, '0'); }
  while (/^(\d)\1{3}$/.test(s) || '0123456789'.includes(s) || '9876543210'.includes(s));
  return s;
}

export const api = URL && KEY ? supabaseApi() : demoApi();
