import { describe, it, expect, vi, beforeEach } from 'vitest';
import { boot, __test as g } from '../src/game.js';
import { api } from '../src/api.js';

const settle = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const $ = (id) => document.getElementById(id);
const clearDevice = () => Object.keys(localStorage).filter((k) => k !== 'mm.demo.db.v1').forEach((k) => localStorage.removeItem(k));
const submit = async () => { $('homeStep').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await settle(120); };
const openFamily = async (flow) => {
  clearDevice(); await api.teacherSignOut(); await boot(); await settle(60);
  (flow === 'register' ? $('gateRegister') : $('gateLogin')).click(); await settle();
  $('kFamily').click(); await settle();
};

describe('home plan (demo mode)', () => {
  beforeEach(() => { history.pushState({}, '', '/'); });

  it('Family opens a username + password form (not "coming soon"), and the back arrow returns to School / Family / Tutor', async () => {
    await openFamily('login');
    expect($('homeStep').hidden).toBe(false); expect($('soonStep').hidden).toBe(true);
    expect($('homeTitle').textContent).toBe('Family log in'); expect($('hGo').textContent).toBe('Log in');
    $('loginBack').click(); await settle(); expect($('kindStep').hidden).toBe(false);
  });

  it('registering makes an account, logs the child in, and shows the home view: Top 30 + Progress tab', async () => {
    const err = vi.spyOn(console, 'error');
    await openFamily('register');
    expect($('homeTitle').textContent).toBe('Family register'); expect($('hGo').textContent).toBe('Create account');
    $('hUser').value = 'x'; $('hPass').value = 'abcdef'; await submit();
    expect($('loginFb').textContent).toMatch(/at least 3/); expect($('login').hidden).toBe(false);
    $('hUser').value = 'zoe.home'; $('hPass').value = 'abc'; await submit();
    expect($('loginFb').textContent).toMatch(/at least 6/);
    $('hUser').value = 'zoe.home'; $('hPass').value = 'secret1'; await submit();
    expect($('login').hidden).toBe(true);
    expect(['home', 'intro'].some((id) => !$(id).hidden)).toBe(true);
    const st = await api.studentState(JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k !== 'mm.demo.db.v1'))).token);
    expect(st.home).toBe(true); expect(st.school_board).toBeNull();
    expect(err).not.toHaveBeenCalled();
  });

  it('the same username cannot be registered twice; wrong password says try again; right password logs in', async () => {
    await openFamily('register');
    $('hUser').value = 'Zoe.Home'; $('hPass').value = 'whatever1'; await submit();
    expect($('loginFb').textContent).toMatch(/taken/);
    $('hSwap').click(); await settle(); expect($('homeTitle').textContent).toBe('Family log in');
    $('hUser').value = 'zoe.home'; $('hPass').value = 'wrong-one'; await submit();
    expect($('loginFb').textContent).toMatch(/Not quite/); expect($('login').hidden).toBe(false);
    $('hUser').value = 'zoe.home'; $('hPass').value = 'secret1'; await submit();
    expect($('login').hidden).toBe(true);
  });

  it('home child sees one "Top 30 players" board (no class/school switch) and a Progress tab that opens with no lock', async () => {
    g.setTab('board'); await settle(60);
    expect($('boardTitle').textContent).toBe('Top 30 players'); expect($('boardScope').hidden).toBe(true);
    expect(document.querySelector('.rail [data-tab=board] span').textContent).toBe('Top 30');
    expect($('railProgress').hidden).toBe(false);
    g.setTab('progress'); await settle();
    expect($('tab-progress').hidden).toBe(false);
    expect($('progressBox').textContent).toMatch(/progress/);
    expect($('progressBox').textContent).toMatch(/Strengths/); expect($('progressBox').textContent).toMatch(/Needs practice/);
  });

  it('Progress shows strengths and weaknesses from the facts the child has practised', () => {
    const p = g.S.players[g.S.current];
    p.facts = {};
    for (let b = 1; b <= 12; b++) p.facts['7,' + b] = { r: [1, 1, 1, 1, 1], t: [1100, 1200, 1300, 1200, 1100], last: Date.now() };
    for (let b = 1; b <= 12; b++) p.facts['8,' + b] = { r: [0, 1, 0, 1, 0], t: [5200, 4800, 5400], last: Date.now() };
    const d = g.progressData(p);
    expect(d.strong).toContain(7); expect(d.weak).toContain(8); expect(d.strong).not.toContain(8);
  });

  it('the home Top 30 lists home players only, best first, at most 30', async () => {
    const list = Array.from({ length: 35 }, (_, i) => ({ id: 'h' + i, name: 'Player ' + i, skin: 'blob', stars: 1000 - i }));
    g.applyState({ class: { id: 'c', name: 'Home', settings: {} }, me: { id: 'me', name: 'Comet Fox', data: {} }, classmates: [], home: true, home_board: list.slice(0, 30) });
    g.renderBoard(g.S.players.me);
    expect($('board').querySelectorAll('.lrow')).toHaveLength(30);
    expect($('board').querySelector('.lrow .lnm').textContent).toContain('Player 0');
  });

  it('school students are unchanged: Top 10, no Progress tab', async () => {
    g.applyState({ class: { id: 'c', name: 'Class', settings: {} }, me: { id: 'me', name: 'Comet Fox', data: {} }, classmates: [] });
    g.renderBoard(g.S.players.me);
    expect($('boardTitle').textContent).toBe('Top 10 in your class');
  });
});
