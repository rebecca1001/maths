import { describe, it, expect, vi, beforeEach } from 'vitest';
import { boot } from '../src/game.js';
import { api, normStudentEmail, nameFromEmail, newPasscode } from '../src/api.js';

const settle = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const $ = (id) => document.getElementById(id);
const LS = 'mm.local.v1';

describe('email helpers (same rules as the database)', () => {
  it('normalises every way a child types their email', () => {
    for (const e of ['Franklin.Joshua@SD54.bc.ca', 'franklin.joshua@sd54', ' franklin.joshua@sd54.bc.ca ']) expect(normStudentEmail(e)).toBe('franklin.joshua@sd54');
    expect(normStudentEmail('franklin.joshua')).toBeNull();
  });
  it('real name from surname.firstname', () => expect(nameFromEmail('franklin.joshua@sd54')).toBe('Joshua Franklin'));
  it('passcodes look like blue-tiger-42', () => { for (let i = 0; i < 200; i++) expect(newPasscode()).toMatch(/^[a-z]{3,8}-[a-z]{3,8}-\d{2}$/); });
});

describe('login screens (demo mode)', () => {
  beforeEach(() => { history.pushState({}, '', '/'); });
  it('a new device asks who is logging in: Student, Teacher, Principal, Parent', async () => {
    const err = vi.spyOn(console, 'error');
    Object.keys(localStorage).filter((k) => k !== 'mm.demo.db.v1').forEach((k) => localStorage.removeItem(k));
    await boot(); await settle();
    expect($('whoStep').hidden).toBe(false);
    expect([...document.querySelectorAll('[data-who] b')].map((b) => b.textContent)).toEqual(['Student', 'Teacher', 'Principal', 'Parent']);
    expect(err).not.toHaveBeenCalled();
  });
  it('Student opens email + password with a corner link to the class code login', async () => {
    document.querySelector('[data-who="student"]').click(); await settle();
    expect($('emailStep').hidden).toBe(false); expect($('whoStep').hidden).toBe(true);
    $('toCodeLogin').click(); await settle();
    expect($('schoolStep').hidden).toBe(false); // the old flow, unchanged
    $('toEmailLogin').click(); await settle(); expect($('emailStep').hidden).toBe(false);
  });
  it('wrong password says so; the right one logs in and remembers email on this device', async () => {
    $('sEmail').value = 'fox.comet@sd54.bc.ca'; $('sPass').value = 'red-fox-11';
    $('emailStep').dispatchEvent(new Event('submit', { cancelable: true })); await settle(80);
    expect($('emailFb').textContent).toMatch(/don't match/);
    $('sPass').value = 'Blue-Tiger-42';
    $('emailStep').dispatchEvent(new Event('submit', { cancelable: true })); await settle(120);
    expect($('login').hidden).toBe(true);
    expect(['home', 'intro'].some((id) => !$(id).hidden)).toBe(true);
  });
  it('Principal opens the same sign-in with a principal heading; Parent shows coming soon', async () => {
    Object.keys(localStorage).filter((k) => k !== 'mm.demo.db.v1').forEach((k) => localStorage.removeItem(k));
    await api.teacherSignOut(); await boot(); await settle();
    document.querySelector('[data-who="principal"]').click(); await settle(60);
    expect($('teach').hidden).toBe(false); expect($('tTitle').textContent).toBe('Principals'); expect($('tRoleNote').hidden).toBe(false);
    $('tBack').click(); await settle();
    document.querySelector('[data-who="parent"]').click(); await settle();
    expect($('parentStep').hidden).toBe(false); expect($('parentStep').textContent).toMatch(/coming soon/);
  });
  it("a device that already uses class codes (Ms Berry's class) goes straight to its class list, as before", async () => {
    const k = Object.keys(localStorage).find((x) => x !== 'mm.demo.db.v1') || LS;
    const cur = JSON.parse(localStorage.getItem(k) || '{}');
    localStorage.setItem(k, JSON.stringify({ ...cur, school: { id: 'demo-school', name: 'Demo School' }, loginWay: undefined, token: null }));
    await boot(); await settle(60);
    expect($('whoStep').hidden).toBe(true); expect($('classStep').hidden).toBe(false);
  });
});

describe('teachers add students by school email', () => {
  it('creates email logins with passwords, skips bad and duplicate emails', async () => {
    const cls = (await api.listClasses())[0];
    const r = await api.addEmailStudents(cls.id, [{ email: 'Smith.Ava@sd54.bc.ca', name: 'Nova Owl' }, { email: 'oops', name: 'X' }, { email: 'smith.ava@sd54', name: 'Y' }]);
    expect(r.added.length).toBe(1); expect(r.added[0]).toMatchObject({ username: 'smith.ava@sd54', real_name: 'Ava Smith', name: 'Nova Owl' });
    expect(r.skipped.map((x) => x.why)).toEqual(['not_an_email', 'already_added']);
    const log = await api.studentLoginEmail('smith.ava@SD54.bc.ca', r.added[0].passcode); expect(log.token).toBeTruthy();
    const np = await api.setStudentLogin(r.added[0].id, null); expect(np.passcode).toMatch(/^[a-z]+-[a-z]+-\d{2}$/);
  });
});
