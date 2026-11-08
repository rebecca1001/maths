import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { __test as g } from '../src/game.js';

// 2026-11-09 is a Monday.
const at = (d, h = 10) => new Date(2026, 10, d, h).getTime();
const day = d => g.dayStart(at(d));
beforeEach(() => vi.useFakeTimers({ toFake: ['Date'] }));
afterEach(() => vi.useRealTimers());

describe('school days missed (weekends are free)', () => {
  it('nothing missed from Friday to Monday', () => expect(g.missedSchoolDays(day(6), day(9))).toBe(0));
  it('Thursday to Monday misses Friday only', () => expect(g.missedSchoolDays(day(5), day(9))).toBe(1));
  it('Wednesday to Monday misses Thu and Fri', () => expect(g.missedSchoolDays(day(4), day(9))).toBe(2));
  it('consecutive weekdays miss none', () => expect(g.missedSchoolDays(day(9), day(10))).toBe(0));
  it('a full missed week counts 5 school days', () => expect(g.missedSchoolDays(day(2), day(9))).toBe(4));
});

describe('streakInfo', () => {
  it('no streak yet', () => expect(g.streakInfo({}, at(9))).toMatchObject({ count: 0, alive: false, playedToday: false, freeLeft: true }));
  it('played today keeps the streak', () => expect(g.streakInfo({ daily: { count: 4, lastT: day(9) } }, at(9))).toMatchObject({ count: 4, alive: true, playedToday: true }));
  it('weekend gap is fine', () => expect(g.streakInfo({ daily: { count: 6, lastT: day(6) } }, at(9))).toMatchObject({ count: 6, alive: true }));
  it('one missed school day uses the weekly freeze', () => expect(g.streakInfo({ daily: { count: 6, lastT: day(5) } }, at(9))).toMatchObject({ count: 6, alive: true, needsFreeze: true, freeLeft: true }));
  it('freeze already used this week = streak lost', () => expect(g.streakInfo({ daily: { count: 6, lastT: day(5), freezeWeek: g.weekKey(day(9)) } }, at(9))).toMatchObject({ count: 0, alive: false }));
  it('two missed school days lose the streak', () => expect(g.streakInfo({ daily: { count: 9, lastT: day(4) } }, at(9))).toMatchObject({ count: 0, alive: false }));
});

describe('bumpStreak', () => {
  it('first ever round starts at 1', () => { vi.setSystemTime(at(9)); const p = {}; expect(g.bumpStreak(p)).toMatchObject({ count: 1, grew: true }); expect(p.daily.best).toBe(1); });
  it('a second round the same day does not grow the streak', () => { vi.setSystemTime(at(9)); const p = {}; g.bumpStreak(p); expect(g.bumpStreak(p)).toEqual({ count: 1, grew: false }); });
  it('consecutive days grow it and track the best', () => {
    const p = {}; for (const d of [9, 10, 11]) { vi.setSystemTime(at(d)); g.bumpStreak(p); }
    expect(p.daily).toMatchObject({ count: 3, best: 3 });
  });
  it('Friday then Monday keeps the streak going', () => { const p = {}; for (const d of [5, 6, 9]) { vi.setSystemTime(at(d)); g.bumpStreak(p); } expect(p.daily.count).toBe(3); });
  it('a single missed school day spends the freeze once per week', () => {
    const p = { daily: { count: 5, lastT: day(5), best: 5 } }; vi.setSystemTime(at(9));
    expect(g.bumpStreak(p)).toMatchObject({ count: 6, grew: true, usedFreeze: true });
    expect(p.daily.freezeWeek).toBe(g.weekKey(day(9)));
  });
  it('after a break the streak restarts at 1 but best is kept', () => {
    const p = { daily: { count: 8, lastT: day(2), best: 8 } }; vi.setSystemTime(at(9));
    expect(g.bumpStreak(p)).toMatchObject({ count: 1, grew: true }); expect(p.daily.best).toBe(8);
  });
});

describe('week start', () => {
  it.each([[11, 9], [9, 9], [15, 9], [16, 16]])('day %i belongs to the week starting Monday %i', (d, mon) => { vi.setSystemTime(at(d, 15)); expect(g.weekStart()).toBe(day(mon)); });
});
