import { describe, it, expect, vi, beforeEach } from 'vitest';
import { boot } from '../src/game.js';
import { api, newPasscode } from '../src/api.js';
import { normUsername, usernameFromName, nameFromUsername, passKey, parseRoster, swapNames } from '../src/usernames.js';

const settle = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const $ = (id) => document.getElementById(id);
const LS = 'mm.local.v1';
const clearDevice = () => Object.keys(localStorage).filter((k) => k !== 'mm.demo.db.v1').forEach((k) => localStorage.removeItem(k));
const setDevice = (o) => { sessionStorage.clear(); const k = Object.keys(localStorage).find((x) => x !== 'mm.demo.db.v1') || LS; localStorage.setItem(k, JSON.stringify({ ...JSON.parse(localStorage.getItem(k) || '{}'), ...o })); };
const pickDemoSchool = async () => {
  $('schoolSearch').value = 'demo'; $('schoolSearch').dispatchEvent(new Event('input')); await settle(320);
  $('schoolList').querySelector('[data-school]').click(); await settle();
};

describe('username helpers (same rules as the database)', () => {
  it('every way a child types their username or school email gives the same username', () => {
    for (const e of ['Franklin.Joshua@SD54.bc.ca', 'franklin.joshua@sd54', ' franklin.joshua ', 'FRANKLIN . joshua']) expect(normUsername(e)).toBe('franklin.joshua');
    expect(normUsername('  ')).toBeNull();
  });
  it('usernames from names: surname.firstname, accents and apostrophes cleaned', () => {
    expect(usernameFromName('Joshua', 'Franklin')).toBe('franklin.joshua');
    expect(usernameFromName('Zoë-Anne', "O'Brien")).toBe('obrien.zoe-anne');
    expect(usernameFromName('Cher', '')).toBe('cher');
  });
  it('real name from surname.firstname; none from a student number', () => {
    expect(nameFromUsername('franklin.joshua')).toBe('Joshua Franklin'); expect(nameFromUsername('12345')).toBeNull();
  });
  it('passwords match without dashes, spaces or capitals', () => expect(passKey('Blue Tiger 42')).toBe(passKey('blue-tiger-42')));
  it('passwords look like blue-tiger-42', () => { for (let i = 0; i < 200; i++) expect(newPasscode()).toMatch(/^[a-z]{3,8}-[a-z]{3,8}-\d{2}$/); });
});

describe('pasted class lists', () => {
  it('reads emails, "First Last", "Last, First" and spreadsheet columns', () => {
    const rows = parseRoster('franklin.joshua@sd54.bc.ca\nAva Mae Smith\nLee, Noah\nMia\tChen\tchen.mia@sd54.bc.ca\n\n');
    expect(rows.map(({ email, first, last }) => ({ email, first, last }))).toEqual([
      { email: 'franklin.joshua@sd54.bc.ca', first: '', last: '' },
      { email: '', first: 'Ava Mae', last: 'Smith' },
      { email: '', first: 'Noah', last: 'Lee' },
      { email: 'chen.mia@sd54.bc.ca', first: 'Mia', last: 'Chen' },
    ]);
  });
  it('a header row is skipped and sets the column order', () => {
    const rows = parseRoster('Surname\tFirst name\nFranklin\tJoshua');
    expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ first: 'Joshua', last: 'Franklin' });
    expect(swapNames(rows)[0]).toMatchObject({ first: 'Franklin', last: 'Joshua' });
  });
});

describe('login screens (demo mode)', () => {
  beforeEach(() => { history.pushState({}, '', '/'); });
  it('a new device asks for the school first, then shows Student username + password (TT Rock Stars style)', async () => {
    const err = vi.spyOn(console, 'error');
    clearDevice(); await api.teacherSignOut();
    await boot(); await settle();
    expect($('schoolStep').hidden).toBe(false); expect($('userStep').hidden).toBe(true);
    await pickDemoSchool();
    expect($('userStep').hidden).toBe(false); expect($('userSchool').textContent).toBe('Demo School');
    expect(err).not.toHaveBeenCalled();
  });
  it('wrong password says so; the right one (typed any way, or the whole email) logs in', async () => {
    $('sUser').value = 'fox.comet'; $('sPass').value = 'red-fox-11';
    $('userStep').dispatchEvent(new Event('submit', { cancelable: true })); await settle(80);
    expect($('userFb').textContent).toMatch(/don't match at Demo School/);
    $('sUser').value = 'Fox.Comet@sd54.bc.ca'; $('sPass').value = 'Blue Tiger 42';
    $('userStep').dispatchEvent(new Event('submit', { cancelable: true })); await settle(120);
    expect($('login').hidden).toBe(true);
    expect(['home', 'intro'].some((id) => !$(id).hidden)).toBe(true);
  });
  it('next time this device opens straight on username + password, school remembered', async () => {
    setDevice({ school: { id: 'demo-school', name: 'Demo School' }, loginWay: 'user' }); await boot(); await settle(60);
    expect($('userStep').hidden).toBe(false); expect($('schoolStep').hidden).toBe(true); expect($('userSchool').textContent).toBe('Demo School');
  });
  it('Teacher tab opens the teacher sign-in; Back returns; parent link shows coming soon', async () => {
    setDevice({ school: { id: 'demo-school', name: 'Demo School' }, loginWay: 'user' }); await api.teacherSignOut(); await boot(); await settle(60);
    $('userTeacher').click(); await settle(60);
    expect($('teach').hidden).toBe(false);
    $('tBack').click(); await settle();
    expect($('userStep').hidden).toBe(false);
    $('toParent').click(); await settle(); expect($('parentStep').textContent).toMatch(/coming soon/);
    $('parentBack').click(); await settle(); expect($('userStep').hidden).toBe(false);
  });
  it('"Use a class code instead" opens the class list and 4-digit keypad, and the device remembers it', async () => {
    setDevice({ school: { id: 'demo-school', name: 'Demo School' }, loginWay: 'user' }); await boot(); await settle(60);
    $('toCodeLogin').click(); await settle(60);
    expect($('classStep').hidden).toBe(false);
    sessionStorage.clear(); await boot(); await settle(60);
    expect($('classStep').hidden).toBe(false);
    $('toUserLogin').click(); await settle(); expect($('userStep').hidden).toBe(false);
  });
  it("Ms Berry's class: a device that remembered its school before usernames still goes straight to its class list", async () => {
    clearDevice(); setDevice({ school: { id: 'demo-school', name: 'Demo School' } });
    await boot(); await settle(60);
    expect($('userStep').hidden).toBe(true); expect($('classStep').hidden).toBe(false);
    $('classList').querySelector('[data-code]').click(); await settle();
    expect($('pinStep').hidden).toBe(false);
  });
});

describe('teachers add students from a pasted list', () => {
  it('review first (nothing saved), then add: emails and names, clashes numbered, duplicates skipped', async () => {
    const cls = (await api.listClasses())[0];
    const before = (await api.listStudents(cls.id)).length;
    const rows = parseRoster('Smith.Ava@sd54.bc.ca\nNoah Lee\nNoah Lee\nfox.comet@sd54.bc.ca');
    const dry = await api.addSchoolStudents(cls.id, rows, true);
    expect(dry.added.map((x) => x.username)).toEqual(['smith.ava', 'lee.noah', 'lee.noah2']);
    expect(dry.added[2].renamed).toBe(true);
    expect(dry.skipped).toEqual([{ row: 4, username: 'fox.comet', why: 'already_added' }]);
    expect((await api.listStudents(cls.id)).length).toBe(before);
    const r = await api.addSchoolStudents(cls.id, rows.map((x) => ({ ...x, name: 'Nova Owl' })), false);
    expect(r.added[0]).toMatchObject({ username: 'smith.ava', real_name: 'Ava Smith', name: 'Nova Owl' });
    expect(r.added[0].pin).toMatch(/^\d{4}$/); // every student keeps a 4-digit code too
    const log = await api.studentLoginUser('demo-school', 'SMITH.AVA', r.added[0].passcode); expect(log.token).toBeTruthy();
    const np = await api.setStudentLogin(r.added[0].id, null); expect(np.passcode).toMatch(/^[a-z]+-[a-z]+-\d{2}$/);
  });
  it('a class-code student can be given a username: same student, code still works', async () => {
    const cls = (await api.listClasses())[0];
    const kid = (await api.listStudents(cls.id)).find((s) => !s.username);
    const r = await api.setStudentLogin(kid.id, 'Berry.Kid@sd54.bc.ca');
    expect(r).toMatchObject({ ok: true, username: 'berry.kid' });
    expect((await api.studentLogin(cls.code, kid.pin)).token).toBeTruthy();
    expect((await api.setStudentLogin(kid.id, 'smith.ava')).error).toBe('already_added');
  });
});
