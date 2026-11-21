import { describe, it, expect } from 'vitest';
import { kidOf, withKid, effectiveSettings } from '../src/dashboard.js';
import { __test as g } from '../src/game.js';

const base = { maxTable: 12, division: false, sound: true, goal: { tables: [3], rounds: 5 } };

describe('settings for one child', () => {
  it('follows the class until the teacher sets something for that child', () => {
    expect(kidOf(base, 'a')).toEqual({ division: null, goal: null });
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
    expect(kidOf(s, 'a')).toEqual({ division: null, goal: { tables: [4], rounds: 2 } });
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

describe('teacher screen: settings for one student', () => {
  it('opening a student shows their settings; division and a focus-table goal save for that student only', async () => {
    Object.keys(localStorage).filter((k) => k !== 'mm.demo.db.v1').forEach((k) => localStorage.removeItem(k));
    await api.teacherSignIn('t@school.ca', 'longpassword1'); history.pushState({}, '', '/?teacher=1');
    await boot(); await settle(150);
    expect($('grown').hidden).toBe(false);
    expect($('gdetail').hidden).toBe(false);
    expect($('kset')).not.toBeNull();
    expect($('kset').textContent).toMatch(/Division/); expect($('kset').textContent).toMatch(/Focus tables/);
    $('kset').querySelector('[data-kdiv="on"]').click(); await settle(100);
    let cls = (await api.listClasses())[0];
    const ids = Object.keys(cls.settings.kids || {});
    expect(ids.length).toBe(1); expect(cls.settings.kids[ids[0]].division).toBe(true);
    $('kset').querySelector('[data-kt="7"]').click(); await settle(30);
    $('kset').querySelector('[data-kr="5"]').click(); await settle(30);
    $('kSave').click(); await settle(100);
    cls = (await api.listClasses())[0];
    expect(cls.settings.kids[ids[0]].goal).toEqual({ tables: [7], rounds: 5 });
    expect(cls.settings.goal).toBeUndefined();
    $('kClear').click(); await settle(100);
    cls = (await api.listClasses())[0];
    expect(cls.settings.kids[ids[0]].goal).toBeUndefined();
    await api.teacherSignOut();
  });
});
