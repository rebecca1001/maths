import { describe, it, expect, vi, beforeEach } from 'vitest';
import { boot } from '../src/game.js';
import { api } from '../src/api.js';
import { normUsername, usernameFromName, nameFromUsername, parseRoster, swapNames } from '../src/usernames.js';

const settle = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const $ = (id) => document.getElementById(id);
const LS = 'mm.local.v1';
const clearDevice = () => Object.keys(localStorage).filter((k) => k !== 'mm.demo.db.v1').forEach((k) => localStorage.removeItem(k));
const setDevice = (o) => { sessionStorage.clear(); const k = Object.keys(localStorage).find((x) => x !== 'mm.demo.db.v1') || LS; localStorage.setItem(k, JSON.stringify({ ...JSON.parse(localStorage.getItem(k) || '{}'), ...o })); };
// tap a 4-digit code on the login keypad
const tapCode = async (code) => {
  for (const d of code) $('loginPad').querySelector(`[data-d="${d}"]`).dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }));
  await settle(250);
};
const foxPin = async () => (await api.listStudents((await api.listClasses())[0].id)).find((x) => x.username === 'fox.comet').pin;
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
  it('TT Rock Stars funnel: Log in / Register -> School / Family / Tutor -> Student / Teacher -> find your school -> student login', async () => {
    const err = vi.spyOn(console, 'error');
    clearDevice(); await api.teacherSignOut();
    await boot(); await settle();
    expect($('gateStep').hidden).toBe(false); expect($('loginBack').hidden).toBe(true);
    $('gateLogin').click(); await settle();
    expect($('kindStep').hidden).toBe(false); expect($('kindTitle').textContent).toBe('Log in');
    expect([$('kSchool'), $('kFamily'), $('kTutor')].map((b) => b.textContent)).toEqual(['School', 'Family', 'Tutor']);
    $('kSchool').click(); await settle();
    expect($('roleStep').hidden).toBe(false);
    $('rStudent').click(); await settle();
    expect($('schoolStep').hidden).toBe(false);
    await pickDemoSchool();
    expect($('userStep').hidden).toBe(false); expect($('userSchool').textContent).toBe('Demo School');
    expect($('userStep').contains($('loginPad'))).toBe(true); // username and keypad on one screen
    expect(err).not.toHaveBeenCalled();
  });
  it('username and keypad on one screen; no username yet says so; wrong code says try again; right code logs in', async () => {
    const pin = await foxPin();
    expect($('sPass')).toBeNull(); expect($('sGo')).toBeNull(); // no password box, no Next button
    expect($('loginPad').querySelectorAll('.kanimal')).toHaveLength(0); // plain numbers, no animals
    $('sUser').value = ''; await tapCode('1');
    expect($('loginFb').textContent).toMatch(/Type your username first/);
    $('sUser').value = 'Fox.Comet@sd54.bc.ca';
    await tapCode(pin === '0000' ? '1111' : '0000');
    expect($('loginFb').textContent).toMatch(/Not quite/); expect($('login').hidden).toBe(false);
    await tapCode(pin);
    expect($('login').hidden).toBe(true);
    expect(['home', 'intro'].some((id) => !$(id).hidden)).toBe(true);
  });
  it('Log out goes back to the start (Log in / Register); the school is still remembered, so Student goes straight to it', async () => {
    setDevice({ school: { id: 'demo-school', name: 'Demo School' }, loginWay: 'user' }); // what the device remembers after logging in
    document.querySelector('[data-tab="logout"]').click(); await settle(80);
    expect($('login').hidden).toBe(false); expect($('gateStep').hidden).toBe(false);
    $('gateLogin').click(); await settle(); $('kSchool').click(); await settle(); $('rStudent').click(); await settle();
    expect($('userStep').hidden).toBe(false); expect($('schoolStep').hidden).toBe(true);
  });
  it('the back arrow goes one step back through the funnel, forgetting the school on the way', async () => {
    setDevice({ school: { id: 'demo-school', name: 'Demo School' }, loginWay: 'user' }); await boot(); await settle(60);
    expect($('userStep').hidden).toBe(false); expect($('loginBack').hidden).toBe(false);
    expect($('userChangeSchool')).toBeNull(); expect($('changeClass')).toBeNull(); expect($('userTeacher')).toBeNull(); expect($('toParent')).toBeNull();
    $('loginBack').click(); await settle(); expect($('schoolStep').hidden).toBe(false);
    $('loginBack').click(); await settle(); expect($('roleStep').hidden).toBe(false);
    $('loginBack').click(); await settle(); expect($('kindStep').hidden).toBe(false);
    $('loginBack').click(); await settle(); expect($('gateStep').hidden).toBe(false);
    sessionStorage.clear(); await boot(); await settle(60); expect($('gateStep').hidden).toBe(false); // school forgotten
  });
  it('an unknown username gets the same answer as a wrong code', async () => {
    expect((await api.studentLoginUser('demo-school', 'nobody.here', '1234')).error).toBe('wrong_login');
    expect((await api.studentLoginUser('demo-school', 'fox.comet', 'tiger42')).error).toBe('wrong_login');
  });
  it('next time this device opens straight on the username box, school remembered', async () => {
    setDevice({ school: { id: 'demo-school', name: 'Demo School' }, loginWay: 'user' }); await boot(); await settle(60);
    expect($('userStep').hidden).toBe(false); expect($('schoolStep').hidden).toBe(true); expect($('userSchool').textContent).toBe('Demo School');
  });
  it('Teacher goes to the teacher sign-in (no school step); its back arrow returns to Student / Teacher; Family and Tutor say coming soon', async () => {
    clearDevice(); await api.teacherSignOut(); await boot(); await settle(60);
    $('gateLogin').click(); await settle(); $('kSchool').click(); await settle();
    expect($('rTeacher').textContent).toMatch(/Teachers and principals/);
    $('rTeacher').click(); await settle(60);
    expect($('teach').hidden).toBe(false);
    $('tBack').click(); await settle(); expect($('roleStep').hidden).toBe(false);
    $('loginBack').click(); await settle();
    $('kFamily').click(); await settle(); expect($('soonStep').textContent).toMatch(/coming soon/);
    $('loginBack').click(); await settle(); $('kTutor').click(); await settle(); expect($('soonTitle').textContent).toBe('Tutors');
    $('loginBack').click(); await settle(); expect($('kindStep').hidden).toBe(false);
  });
  it('TEMPORARY: "Log in with a 4-digit code" on the first screen -> find your school -> pick your class -> code (Ms Berry), remembered', async () => {
    clearDevice(); await api.teacherSignOut(); await boot(); await settle(60);
    $('gateCode').click(); await settle();
    expect($('schoolStep').hidden).toBe(false);
    await pickDemoSchool(); await settle(60);
    expect($('classStep').hidden).toBe(false);
    $('classList').querySelector('[data-code]').click(); await settle();
    expect($('pinStep').hidden).toBe(false);
    await tapCode('1111'); expect($('login').hidden).toBe(true);
    sessionStorage.clear(); setDevice({ token: null }); await boot(); await settle(60);
    expect($('classStep').hidden).toBe(false); // this device now opens on the class list
  });
  it('no class code typing, no footer teacher link, no Switch player', async () => {
    expect($('classForm')).toBeNull(); expect($('toCodeLogin')).toBeNull(); expect($('toWho')).toBeNull(); expect($('notMe')).toBeNull();
  });
  it("Ms Berry's class list device: just the class list (no links under it); mathwizz.co/?classlist brings it back", async () => {
    setDevice({ school: { id: 'demo-school', name: 'Demo School' }, loginWay: 'code' }); await api.teacherSignOut(); await boot(); await settle(60);
    expect($('classStep').hidden).toBe(false);
    expect($('toUserLogin')).toBeNull(); expect($('classTeacher')).toBeNull();
    setDevice({ school: { id: 'demo-school', name: 'Demo School' }, loginWay: 'user' }); history.pushState({}, '', '/?classlist'); await boot(); await settle(60);
    expect($('classStep').hidden).toBe(false);
  });
  it('Register opens Create account, then school setup (set up or join)', async () => {
    clearDevice(); await api.teacherSignOut(); await boot(); await settle();
    $('gateRegister').click(); await settle(60);
    expect($('kindTitle').textContent).toBe('Register');
    $('kSchool').click(); await settle(60);
    expect($('teach').hidden).toBe(false); expect($('tTitle').textContent).toBe('Register');
    expect($('tRegNote').hidden).toBe(false); expect($('tSubmit').textContent).toBe('Create account');
    $('tEmail').value = 'new@school.ca'; $('tPass').value = 'longpassword1';
    $('tSignIn').dispatchEvent(new Event('submit', { cancelable: true })); await settle(120);
    expect($('tSetup').hidden).toBe(false);
    expect($('tSetup').textContent).toMatch(/Set up my school/); expect($('tSetup').textContent).toMatch(/Join my school/);
    $('tSetupOut').click(); await settle(60);
  });
  it('a device that remembers its school skips the front door', async () => {
    clearDevice(); setDevice({ school: { id: 'demo-school', name: 'Demo School' }, loginWay: 'user' }); await boot(); await settle(60);
    expect($('gateStep').hidden).toBe(true); expect($('userStep').hidden).toBe(false);
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
    expect(r.added[0].passcode).toBeUndefined(); // no passwords
    const log = await api.studentLoginUser('demo-school', 'SMITH.AVA', r.added[0].pin); expect(log.token).toBeTruthy();
    expect((await api.setStudentLogin(r.added[0].id, null)).error).toBe('bad_username');
  });
  it('a class-code student can be given a username: same student, code still works', async () => {
    const cls = (await api.listClasses())[0];
    const kid = (await api.listStudents(cls.id)).find((s) => !s.username);
    const r = await api.setStudentLogin(kid.id, 'Berry.Kid@sd54.bc.ca');
    expect(r).toMatchObject({ ok: true, username: 'berry.kid', pin: kid.pin }); // same 4 digits as always
    expect((await api.studentLogin(cls.code, kid.pin)).token).toBeTruthy();
    expect((await api.studentLoginUser('demo-school', 'berry.kid', kid.pin)).token).toBeTruthy();
    expect((await api.setStudentLogin(kid.id, 'smith.ava')).error).toBe('already_added');
  });
});
