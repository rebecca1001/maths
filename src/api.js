// Data layer. Two interchangeable backends with the same functions:
//  - Supabase (real schools): used when VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set
//  - Demo (no setup): everything lives in this browser's localStorage, with an example class (code DEMO)
import { createClient } from '@supabase/supabase-js';
import { seedDemoStudents } from './demo-data.js';

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
    studentState: (token) => rpc('student_state', { p_token: token }),
    studentSave: (token, data) => rpc('student_save', { p_token: token, p_data: data }),
    studentLogout: (token) => rpc('student_logout', { p_token: token }),
    challengeCreate: (token, to, seed) => rpc('challenge_create', { p_token: token, p_to: to, p_seed: seed }),
    challengeScore: (token, id, score) => rpc('challenge_score', { p_token: token, p_challenge: id, p_score: score }),
    // teachers
    async teacherSession() {
      const { data: { session } } = await sb.auth.getSession();
      if (!session) return null;
      const t = await q(sb.from('teachers').select('id,name,role,school_id,schools(id,name,join_code)').eq('id', session.user.id).maybeSingle());
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
    createSchool: (schoolName, teacherName) => rpc('create_school', { p_school_name: schoolName, p_teacher_name: teacherName }),
    joinSchool: (code, teacherName) => rpc('join_school', { p_join_code: code, p_teacher_name: teacherName }),
    listClasses: () => q(sb.from('classes').select('id,name,code,settings,teacher_id,archived_at,created_at').is('archived_at', null).order('created_at')),
    createClass: async (name, teacherId) => (await q(sb.from('classes').insert(teacherId ? { name, teacher_id: teacherId } : { name }).select('id,name,code,settings,teacher_id,archived_at').single())),
    updateClass: (id, patch) => q(sb.from('classes').update(patch).eq('id', id)),
    listStudents: (classId) => q(sb.from('students').select('id,name,pin,data,created_at').eq('class_id', classId).order('created_at')),
    addStudent: async (classId, name) => (await q(sb.from('students').insert({ class_id: classId, name }).select('id,name,pin,data').single())),
    addStudents: (classId, names) => q(sb.from('students').insert(names.map((name) => ({ class_id: classId, name }))).select('id,name,pin,data')),
    async countStudents() { const rows = await q(sb.from('students').select('class_id')); const n = {}; rows.forEach((r) => { n[r.class_id] = (n[r.class_id] || 0) + 1; }); return n; },
    // school admin
    listTeachers: () => q(sb.from('teachers').select('id,name,email,role,created_at').order('created_at')),
    setTeacherRole: (id, role) => rpc('admin_set_role', { p_teacher: id, p_role: role }),
    removeTeacher: (id) => rpc('admin_remove_teacher', { p_teacher: id }),
    newJoinCode: () => rpc('admin_new_join_code', {}),
    renameSchool: (schoolId, name) => q(sb.from('schools').update({ name }).eq('id', schoolId)),
    async newPin(studentId) {
      for (let i = 0; i < 20; i++) {
        const pin = randomPin();
        const { error } = await sb.from('students').update({ pin }).eq('id', studentId);
        if (!error) return pin;
      }
      throw new Error('Could not make a new code');
    },
    removeStudent: (id) => q(sb.from('students').delete().eq('id', id)),
    // Live messages between players (battle invites, live race progress). Only ids and scores are sent.
    live(name, onMsg) {
      const ch = sb.channel(name, { config: { broadcast: { self: false } } });
      ch.on('broadcast', { event: 'm' }, ({ payload }) => onMsg(payload)).subscribe();
      return { send: (m) => { ch.send({ type: 'broadcast', event: 'm', payload: m }).catch(() => {}); }, close: () => { sb.removeChannel(ch); } };
    },
  };
}

// ---------------------------------------------------------------------------
// Demo backend (browser only)
// ---------------------------------------------------------------------------
const DEMO_KEY = 'mm.demo.db.v1';
function demoApi() {
  const id = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
  let db = null;
  try { db = JSON.parse(localStorage.getItem(DEMO_KEY)); } catch (e) { db = null; }
  if (!db || !db.classes) {
    const classId = id();
    db = {
      school: { name: 'Demo School', join_code: 'DEMO0000' },
      teacher: null,
      classes: [{ id: classId, name: 'Demo class', code: 'DEMO', teacher_id: 'me', settings: { maxTable: 12, division: false, sound: true, battles: false }, archived_at: null }],
      students: seedDemoStudents().map(s => ({ ...s, class_id: classId })),
      challenges: [], sessions: {},
    };
  }
  const persist = () => { try { localStorage.setItem(DEMO_KEY, JSON.stringify(db)); } catch (e) { /* storage full or blocked */ } };
  persist();
  // Re-read before every call so several tabs share one demo database
  const reload = () => { try { const x = JSON.parse(localStorage.getItem(DEMO_KEY)); if (x && x.classes) db = x; } catch (e) { /* keep in-memory copy */ } };
  const me = (token) => db.students.find(s => s.id === db.sessions[token]);
  const ok = (v) => Promise.resolve(JSON.parse(JSON.stringify(v)));
  const methods = {
    studentLogin(classCode, pin) {
      const c = db.classes.find(x => x.code === String(classCode || '').trim().toUpperCase() && !x.archived_at);
      if (!c) return ok({ error: 'no_class' });
      const s = db.students.find(x => x.class_id === c.id && x.pin === pin);
      if (!s) return ok({ error: 'wrong_code' });
      const t = id() + id(); db.sessions[t] = s.id; persist();
      return ok({ token: t, student_id: s.id });
    },
    studentState(token) {
      const m = me(token); if (!m) return ok({ error: 'signed_out' });
      const c = db.classes.find(x => x.id === m.class_id);
      const cut = Date.now() - 21 * 864e5;
      return ok({
        me: { id: m.id, name: m.name, data: m.data },
        class: { id: c.id, name: c.name, settings: c.settings },
        classmates: db.students.filter(s => s.class_id === m.class_id && s.id !== m.id).map(s => { const { facts, ...rest } = s.data; return { id: s.id, name: s.name, data: rest }; }),
        challenges: db.challenges.filter(ch => (ch.from === m.id || ch.to === m.id) && ch.d > cut),
      });
    },
    studentSave(token, data) { const m = me(token); if (!m) return ok({ error: 'signed_out' }); m.data = data; persist(); return ok({ ok: true }); },
    studentLogout(token) { delete db.sessions[token]; persist(); return ok(null); },
    challengeCreate(token, to, seed) {
      const m = me(token); if (!m) return ok({ error: 'signed_out' });
      const ch = { id: id(), from: m.id, to, seed, scores: {}, d: Date.now() }; db.challenges.push(ch); persist(); return ok({ id: ch.id });
    },
    challengeScore(token, cid, score) {
      const m = me(token); const ch = db.challenges.find(x => x.id === cid);
      if (!m || !ch || ch.scores[m.id]) return ok({ error: 'not_found' });
      ch.scores[m.id] = score; persist(); return ok({ ok: true });
    },
    teacherSession: () => ok(db.teacher ? { email: db.teacher.email, teacher: db.teacher.name ? { id: 'me', name: db.teacher.name, role: 'admin', school: { id: 'demo-school', ...db.school } } : null } : null),
    teacherSignIn(email) { db.teacher = { email, name: (db.teacher && db.teacher.name) || 'Demo teacher' }; persist(); return ok({ ok: true }); },
    teacherSignUp(email) { db.teacher = { email, name: null }; persist(); return ok({ ok: true, needsConfirm: false }); },
    teacherSignInWith() { db.teacher = { email: 'demo@school.ca', name: 'Demo teacher' }; persist(); return ok({ ok: true }); },
    teacherSignOut() { db.teacher = null; persist(); return ok(null); },
    createSchool(schoolName, teacherName) { db.school.name = schoolName; db.teacher.name = teacherName; persist(); return ok('demo-school'); },
    joinSchool(code, teacherName) { db.teacher.name = teacherName; persist(); return ok('demo-school'); },
    listClasses: () => ok(db.classes.filter(c => !c.archived_at).map(c => ({ teacher_id: 'me', ...c }))),
    createClass(name, teacherId) {
      const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
      let code; do { code = Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join(''); } while (db.classes.some(c => c.code === code));
      const c = { id: id(), name, code, teacher_id: teacherId || 'me', settings: { maxTable: 10, division: false, sound: true, battles: false }, archived_at: null };
      db.classes.push(c); persist(); return ok(c);
    },
    updateClass(cid, patch) { Object.assign(db.classes.find(c => c.id === cid), patch); persist(); return ok(null); },
    listStudents: (cid) => ok(db.students.filter(s => s.class_id === cid)),
    addStudent(cid, name) {
      let pin; do { pin = randomPin(); } while (db.students.some(s => s.class_id === cid && s.pin === pin));
      const s = { id: id(), class_id: cid, name, pin, data: {} }; db.students.push(s); persist(); return ok(s);
    },
    addStudents(cid, names) { return Promise.all(names.map(n => methods.addStudent(cid, n))); },
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
    newJoinCode() { db.school.join_code = Math.random().toString(16).slice(2, 10).toUpperCase(); persist(); return ok({ join_code: db.school.join_code }); },
    renameSchool(_sid, name) { db.school.name = name; persist(); return ok(null); },
    newPin(sid) {
      const s = db.students.find(x => x.id === sid);
      let pin; do { pin = randomPin(); } while (db.students.some(x => x.class_id === s.class_id && x.pin === pin));
      s.pin = pin; persist(); return ok(pin);
    },
    removeStudent(sid) { db.students = db.students.filter(s => s.id !== sid); persist(); return ok(null); },
    resetDemo() { localStorage.removeItem(DEMO_KEY); },
    live(name, onMsg) { // demo: other tabs in this browser
      let bc; try { bc = new BroadcastChannel('mm.' + name); } catch (e) { return { send() {}, close() {} }; }
      bc.onmessage = (e) => onMsg(e.data);
      return { send: (m) => bc.postMessage(m), close: () => bc.close() };
    },
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
