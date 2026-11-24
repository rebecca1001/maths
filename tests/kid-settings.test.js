import { describe, it, expect } from 'vitest';
import { kidOf, withKid, effectiveSettings } from '../src/dashboard.js';
import { __test as g } from '../src/game.js';

const base = { maxTable: 12, division: false, sound: true, goal: { tables: [3], rounds: 5 } };

describe('settings for one child', () => {
  it('follows the class until the teacher sets something for that child', () => {
    expect(kidOf(base, 'a')).toEqual({ multiplication: null, division: null, tables: null, goal: null });
    expect(effectiveSettings(base, 'a')).toEqual(base);
  });

  it('division on or off for one child, without touching the class or other children', () => {
    const s = withKid(base, 'a', { division: true });
    expect(effectiveSettings(s, 'a').division).toBe(true);
    expect(effectiveSettings(s, 'b').division).toBe(false);
    expect(s.division).toBe(false);
    const off = withKid({ ...base, division: true }, 'a', { division: false });
    expect(effectiveSettings(off, 'a').division).toBe(false);
    expect(effectiveSettings(off, 'b').division).toBe(true);
  });

  it('own focus tables and weekly goal replace the class goal for that child only', () => {
    const s = withKid(base, 'a', { goal: { tables: [7, 6, 7, 99, 1], rounds: 3 } });
    expect(kidOf(s, 'a').goal).toEqual({ tables: [6, 7], rounds: 3 });
    expect(effectiveSettings(s, 'a').goal).toEqual({ tables: [6, 7], rounds: 3 });
    expect(effectiveSettings(s, 'b').goal).toEqual({ tables: [3], rounds: 5 });
  });

  it('null goes back to the class setting, and empty entries are cleaned away', () => {
    let s = withKid(base, 'a', { division: true, goal: { tables: [4], rounds: 2 } });
    s = withKid(s, 'a', { division: null });
    expect(kidOf(s, 'a')).toEqual({ multiplication: null, division: null, tables: null, goal: { tables: [4], rounds: 2 } });
    s = withKid(s, 'a', { goal: null });
    expect(s.kids).toBeUndefined();
    expect(s).toEqual(base);
  });

  it('keeps other per-child settings (minimum rounds) when it saves', () => {
    const s = withKid({ ...base, minFor: { a: 4 } }, 'a', { division: true });
    expect(s.minFor).toEqual({ a: 4 });
  });

  it('the game plays a child with their own settings, not the class ones', () => {
    const st = (id) => ({ class: { id: 'c', name: 'C', settings: withKid(base, 'a', { division: true, goal: { tables: [8], rounds: 4 } }) },
      me: { id, name: 'Kid', data: {} }, classmates: [], competitions: [] });
    g.applyState(st('a'));
    expect(g.S.division).toBe(true); expect(g.S.goal).toEqual({ tables: [8], rounds: 4 });
    g.applyState(st('b'));
    expect(g.S.division).toBe(false); expect(g.S.goal).toEqual({ tables: [3], rounds: 5 });
  });
});

import { vi } from 'vitest';
import { boot } from '../src/game.js';
import { api } from '../src/api.js';
const settle = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const $ = (id) => document.getElementById(id);

describe('teacher screen: Settings pop-up for one student', () => {
  it('own times tables and Multiplication / Division save for that student only; the class is untouched', async () => {
    Object.keys(localStorage).filter((k) => k !== 'mm.demo.db.v1').forEach((k) => localStorage.removeItem(k));
    await api.teacherSignIn('t@school.ca', 'longpassword1'); history.pushState({}, '', '/?teacher=1');
    await boot(); await settle(150);
    expect($('grown').hidden).toBe(false);
    expect($('kidModal').hidden).toBe(true);
    const btn = $('tbl').querySelector('[data-settings]'); const id = btn.dataset.settings;
    btn.click(); await settle(30);
    expect($('kidModal').hidden).toBe(false);
    const t = $('kidCard').textContent;
    expect(t).toMatch(/Student code/); expect(t).toMatch(/Stars/); expect(t).toMatch(/Leaderboard/); expect(t).toMatch(/Rounds per day/);
    expect(t).toMatch(/Times tables/); expect(t).toMatch(/Multiplication/); expect(t).toMatch(/Division/); expect(t).toMatch(/Reset to class settings/);
    expect($('kidCard').querySelectorAll('[data-kt]').length).toBe(11);   // 2 to 12
    // Division on, tables 2-7 only
    { const dv = $('kidCard').querySelector('[data-km="div"]'); dv.checked = true; dv.dispatchEvent(new Event('change', { bubbles: true })); }
    for (const n of [8, 9, 10, 11, 12]) { $('kidCard').querySelector(`[data-kt="${n}"]`).click(); }
    $('kmSave').click(); await settle(100);
    let cls = (await api.listClasses())[0];
    expect(cls.settings.kids[id].division).toBe(true);
    expect(cls.settings.kids[id].tables).toEqual([2, 3, 4, 5, 6, 7]);
    expect(cls.settings.division).toBeFalsy();
    // Cancel changes nothing
    $('tbl').querySelector(`[data-settings="${id}"]`).click(); await settle(20);
    $('kidCard').querySelector('[data-kt="2"]').click(); $('kmCancel').click(); await settle(30);
    expect($('kidModal').hidden).toBe(true);
    expect((await api.listClasses())[0].settings.kids[id].tables).toEqual([2, 3, 4, 5, 6, 7]);
    // Escape closes too; Reset returns the student to the class values
    $('tbl').querySelector(`[data-settings="${id}"]`).click(); await settle(20);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); expect($('kidModal').hidden).toBe(true);
    $('tbl').querySelector(`[data-settings="${id}"]`).click(); await settle(20);
    $('kmReset').click(); await settle(100);
    cls = (await api.listClasses())[0];
    expect(cls.settings.kids).toBeUndefined();
    await api.teacherSignOut();
  });
  it('class settings: tables 2-12 and Multiplication / Division are separate; at least one of each is kept', async () => {
    await api.teacherSignIn('t@school.ca', 'longpassword1'); history.pushState({}, '', '/?teacher=1');
    await boot(); await settle(150);
    const chips = $('setTables').querySelectorAll('[data-ct]'); expect(chips.length).toBe(11);
    // Division only
    $('setDiv').checked = true; $('setDiv').dispatchEvent(new Event('change')); $('setMul').checked = false; $('setMul').dispatchEvent(new Event('change'));
    // cannot turn both off
    $('setDiv').checked = false; $('setDiv').dispatchEvent(new Event('change'));
    expect($('setDiv').checked).toBe(true);
    // tables 3 and 4 only
    [...chips].filter((c) => !['3', '4'].includes(c.dataset.ct)).forEach((c) => c.click());
    $('setTables').querySelector('[data-ct="3"]').click(); $('setTables').querySelector('[data-ct="4"]').click(); // would leave none: refused
    expect($('setTables').querySelectorAll('.on').length).toBe(1);
    $('saveClass').click(); await settle(100);
    const st = (await api.listClasses())[0].settings;
    expect(st.multiplication).toBe(false); expect(st.division).toBe(true); expect(st.tables.length).toBe(1);
    expect(g.ALL).toEqual(st.tables);
    await api.teacherSignOut();
  });
});

describe('students list: search, A to Z, Show all, class total', () => {
  it('starts at 10, search finds one, Show all reveals the rest, total covers everyone', async () => {
    await api.teacherSignIn('t@school.ca', 'longpassword1'); history.pushState({}, '', '/?teacher=1');
    await boot(); await settle(150);
    const c = (await api.listClasses())[0];
    const rows = Array.from({ length: 30 }, (_, i) => ({ first: 'Kid' + String.fromCharCode(65 + (i % 26)) + i, last: 'Zed', name: 'Space ' + i }));
    await api.addSchoolStudents(c.id, rows, false);
    history.pushState({}, '', '/?teacher=1'); await boot(); await settle(150);
    const n = g.S.order.length; expect(n).toBeGreaterThanOrEqual(30);
    expect($('tbl').querySelectorAll('tbody tr[data-id]').length).toBe(10);
    expect($('stuFoot').textContent).toMatch(new RegExp(`Showing 10 of ${n} students`));
    const names = [...$('tbl').querySelectorAll('tbody .who b')].map((x) => x.textContent);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })));
    $('stuSearch').value = 'KidB1'; $('stuSearch').dispatchEvent(new Event('input', { bubbles: true }));
    expect($('tbl').querySelectorAll('tbody tr[data-id]').length).toBe(1);
    $('stuSearch').value = ''; $('stuSearch').dispatchEvent(new Event('input', { bubbles: true }));
    $('showAll').click();
    expect($('tbl').querySelectorAll('tbody tr[data-id]').length).toBe(n);
    expect($('classTotal').textContent).toMatch(/^\d+ rounds?$/);
    await api.teacherSignOut();
  });
});

describe('multiplication and division ticks', () => {
  it('multiplication off + division on gives only division questions; both off is not allowed', () => {
    const st = (settings) => ({ class: { id: 'c', name: 'C', settings }, me: { id: 'a', name: 'Kid', data: {} }, classmates: [], competitions: [] });
    g.applyState(st(withKid({ division: false }, 'a', { multiplication: false, division: true })));
    for (let i = 0; i < 60; i++) expect(g.makeQ(2 + (i % 11), 1 + (i % 12)).text).toMatch(/÷/);
    g.applyState(st(withKid({ division: false }, 'a', { multiplication: false })));
    expect(g.S.multiplication).toBe(true);
    g.applyState(st({ division: true }));
    const kinds = new Set(Array.from({ length: 200 }, (_, i) => g.makeQ(2 + (i % 11), 1 + (i % 12)).text.includes('÷')));
    expect(kinds.size).toBe(2);
  });
  it('keeps the class value when a tick matches it', () => {
    const s = withKid({ division: true }, 'a', { multiplication: null, division: null });
    expect(s.kids).toBeUndefined();
  });
});
