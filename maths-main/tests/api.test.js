import { describe, it, expect } from 'vitest';
import { api, randomPin } from '../src/api.js';

describe('PINs', () => {
  it('are 4 digits, never repeated digits or runs, over 20,000 draws', () => {
    for (let i = 0; i < 20000; i++) { const p = randomPin(); expect(p).toMatch(/^\d{4}$/); expect(p).not.toMatch(/^(\d)\1{3}$/); expect('0123456789').not.toContain(p); expect('9876543210').not.toContain(p); }
  });
  it('cover the whole space (not stuck on a few values)', () => { const s = new Set(); for (let i = 0; i < 30000; i++) s.add(randomPin()); expect(s.size).toBeGreaterThan(5000); });
});

describe('demo backend (no keys = browser-only demo)', () => {
  it('runs in demo mode in tests', () => expect(api.mode).toBe('demo'));
  it('student login: class DEMO with a sample PIN', async () => {
    const r = await api.studentLogin('DEMO', '1111'); expect(r.token).toBeTruthy(); expect(r.student_id).toBe('demo-1111');
  });
  it('class code is case-insensitive and trimmed', async () => expect((await api.studentLogin(' demo ', '2222')).token).toBeTruthy());
  it('wrong PIN, unknown class, empty input', async () => {
    expect(await api.studentLogin('DEMO', '0000')).toEqual({ error: 'wrong_code' }); expect(await api.studentLogin('NOPE', '1111')).toEqual({ error: 'no_class' });
    expect(await api.studentLogin('', '')).toEqual({ error: 'no_class' }); expect(await api.studentLogin(null, null)).toEqual({ error: 'no_class' });
  });
  it('state, save, state round-trip; classmates carry only safe fields', async () => {
    const { token } = await api.studentLogin('DEMO', '1111'); let st = await api.studentState(token);
    expect(st.me.name).toBe('Comet Fox'); expect(st.class.name).toBe('Demo class'); expect(st.classmates.length).toBe(3);
    for (const c of st.classmates) expect(Object.keys(c.data).sort()).toEqual(['skin', 'wkMins', 'wkStars']);
    await api.studentSave(token, { ...st.me.data, coins: 777 }); st = await api.studentState(token); expect(st.me.data.coins).toBe(777);
  });
  it('logout and unknown tokens are rejected', async () => {
    const { token } = await api.studentLogin('DEMO', '3333'); await api.studentLogout(token);
    expect(await api.studentState(token)).toEqual({ error: 'signed_out' }); expect(await api.studentSave(token, {})).toEqual({ error: 'signed_out' }); expect(await api.studentState('nope')).toEqual({ error: 'signed_out' });
  });
  it('school search needs 2+ characters', async () => { expect(await api.findSchools('d')).toEqual([]); expect((await api.findSchools('demo')).length).toBe(1); expect(await api.findSchools('zzz')).toEqual([]); });
  it('class creation: unique 6-char codes from the unambiguous alphabet; new students get unique PINs', async () => {
    const codes = new Set(); let cls;
    for (let i = 0; i < 60; i++) { cls = await api.createClass('Class ' + i); expect(cls.code).toMatch(/^[A-HJKMNP-Z2-9]{6}$/); codes.add(cls.code); }
    expect(codes.size).toBe(60);
    const studs = await api.addStudents(cls.id, Array.from({ length: 40 }, (_, i) => 'S' + i)); expect(new Set(studs.map(s => s.pin)).size).toBe(40);
  });
  it('archived classes cannot log in and are hidden from the class picker', async () => {
    const cls = await api.createClass('To archive'); const [s] = await api.addStudents(cls.id, ['Kid']);
    expect((await api.studentLogin(cls.code, s.pin)).token).toBeTruthy();
    await api.updateClass(cls.id, { archived_at: new Date().toISOString() });
    expect(await api.studentLogin(cls.code, s.pin)).toEqual({ error: 'no_class' }); expect((await api.schoolClasses()).some(c => c.code === cls.code)).toBe(false);
  });
  it('removing a student removes their login; new PIN invalidates the old one', async () => {
    const cls = await api.createClass('PIN class'); const [s] = await api.addStudents(cls.id, ['Kid']); const old = s.pin;
    const fresh = await api.newPin(s.id); expect(fresh).not.toBe(old); expect(await api.studentLogin(cls.code, old)).toEqual({ error: 'wrong_code' }); expect((await api.studentLogin(cls.code, fresh)).token).toBeTruthy();
    await api.removeStudent(s.id); expect(await api.studentLogin(cls.code, fresh)).toEqual({ error: 'wrong_code' });
  });
  it('teacher admin guards: cannot remove self; password needs 8+ chars', async () => {
    expect(await api.removeTeacher('me')).toEqual({ error: 'not_self' }); expect(await api.adminSetPassword('x', 'short')).toEqual({ error: 'too_short' }); expect(await api.adminSetPassword('x', 'long-enough-pw')).toEqual({ ok: true });
  });
  it('join code rotates to a new code', async () => { const r = await api.newJoinCode(); expect(r.join_code).toMatch(/^[0-9A-F]{1,8}$/); });
});
