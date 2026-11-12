import { describe, it, expect, vi, afterEach } from 'vitest';
import { groupOf, groupCounts, daysPlayed, accuracy, correctPerMin, trend, GROUPS } from '../src/dashboard.js';
import { __test as g, boot } from '../src/game.js';
import { api } from '../src/api.js';

const NOW = new Date(2026, 10, 12, 14).getTime(); // Thu 12 Nov 2026
const DAY = 864e5;
const r = (daysAgo, c, n, extra = {}) => ({ d: NOW - daysAgo * DAY, c, n, len: 60, ...extra });

describe('teacher groups', () => {
  it('nobody played in 7 days = Not playing', () => {
    expect(groupOf([], NOW)).toBe('none');
    expect(groupOf([r(9, 20, 20)], NOW)).toBe('none');
  });
  it('playing but under 80% right = Needs help', () => expect(groupOf([r(1, 15, 20), r(2, 15, 20)], NOW)).toBe('help'));
  it('3+ days and 90%+ = Flying', () => expect(groupOf([r(0, 19, 20), r(1, 19, 20), r(2, 20, 20)], NOW)).toBe('flying'));
  it('playing well but on only 2 days = On track', () => expect(groupOf([r(0, 19, 20), r(1, 20, 20)], NOW)).toBe('ok'));
  it('counts add up to the class and follow GROUPS order', () => {
    const n = groupCounts([{ rounds: [] }, { rounds: [r(1, 10, 20)] }, { rounds: [r(1, 18, 20)] }], NOW);
    expect(n).toEqual({ none: 1, help: 1, ok: 1, flying: 0 });
    expect(GROUPS.map((x) => x.id)).toEqual(['none', 'help', 'ok', 'flying']);
  });
});

describe('teacher numbers', () => {
  const rounds = [r(0, 20, 22), r(0, 24, 25), r(3, 16, 20), r(10, 5, 20)];
  it('days played in 7 days (two rounds on one day count once)', () => expect(daysPlayed(rounds, NOW)).toBe(2));
  it('accuracy over the last 7 days only', () => expect(accuracy(rounds, NOW)).toBeCloseTo(60 / 67, 5));
  it('correct per minute', () => expect(correctPerMin(rounds, NOW)).toBeCloseTo(20, 5));
  it('trend needs 4 proper rounds', () => expect(trend([r(3, 10, 10), r(2, 12, 12), r(1, 14, 14)])).toBeNull());
  it('trend up, down and flat', () => {
    expect(trend([10, 10, 10, 14, 14, 14].map((c, i) => r(6 - i, c, c)))).toBe('up');
    expect(trend([14, 14, 14, 10, 10, 10].map((c, i) => r(6 - i, c, c)))).toBe('down');
    expect(trend([12, 12, 12, 12, 12, 12].map((c, i) => r(6 - i, c, c)))).toBe('flat');
  });
  it('short rounds (under 8 answers) are ignored for the trend', () => expect(trend([r(4, 2, 3), r(3, 10, 10), r(2, 12, 12), r(1, 14, 14)])).toBeNull());
});

describe('streak: school holidays and the streak card', () => {
  const at = (y, m, d, h = 10) => new Date(y, m - 1, d, h).getTime();
  afterEach(() => vi.useRealTimers());
  it('weekends, Remembrance Day and winter break are not school days', () => {
    expect(g.isSchoolDay(at(2026, 11, 10))).toBe(true);
    expect(g.isSchoolDay(at(2026, 11, 11))).toBe(false); // Remembrance Day
    expect(g.isSchoolDay(at(2026, 11, 14))).toBe(false); // Saturday
    expect(g.isSchoolDay(at(2026, 12, 23))).toBe(false); // winter break
    expect(g.isSchoolDay(at(2027, 1, 5))).toBe(true);
  });
  it('winter break does not break a streak', () => {
    const p = { daily: { count: 12, lastT: g.dayStart(at(2026, 12, 18)), best: 12 } };
    expect(g.streakInfo(p, at(2027, 1, 5))).toMatchObject({ count: 12, alive: true });
  });
  it('a holiday in the week is not a missed day', () => expect(g.missedSchoolDays(g.dayStart(at(2026, 11, 10)), g.dayStart(at(2026, 11, 12)))).toBe(0));
  it('says when to come back: tomorrow, Monday, or after the break', () => {
    expect(g.nextSchoolDay(at(2026, 11, 12))).toBe('tomorrow');
    expect(g.nextSchoolDay(at(2026, 11, 13))).toBe('Monday');
    expect(g.nextSchoolDay(at(2026, 12, 18))).toMatch(/January 5/);
  });
  it('the card shows the count, ticks this week\'s days and the right message', () => {
    const p = { rounds: [{ d: at(2026, 11, 9) }, { d: at(2026, 11, 10) }, { d: at(2026, 11, 12) }], daily: { count: 3, lastT: g.dayStart(at(2026, 11, 12)), best: 7 } };
    const div = document.createElement('div'); div.innerHTML = g.streakHTML(p, at(2026, 11, 12, 15));
    expect(div.querySelector('.shead b').textContent).toBe('3');
    expect(div.querySelectorAll('.sday.done').length).toBe(3);
    expect(div.querySelectorAll('.sday.off').length).toBe(1); // Wednesday 11 Nov
    expect(div.querySelector('.sday.today small').textContent).toBe('T');
    expect(div.textContent).toMatch(/Streak safe today! Come back tomorrow to make it 4/);
    expect(div.textContent).toMatch(/Best: 7/);
    const cold = document.createElement('div'); cold.innerHTML = g.streakHTML({ rounds: [] }, at(2026, 11, 12));
    expect(cold.querySelector('.streakbox').classList.contains('cold')).toBe(true);
    expect(cold.textContent).toMatch(/start a streak/);
  });
});

describe('screens (demo mode)', () => {
  it('teacher view shows four groups, no "Played today", no download, no competitions tab', async () => {
    const err = vi.spyOn(console, 'error');
    await api.teacherSignIn('t@demo.ca', 'password123');
    history.pushState({}, '', '/?teacher=1'); await boot(); await new Promise((res) => setTimeout(res, 60));
    expect(document.getElementById('grown').hidden).toBe(false);
    const k = document.getElementById('kpis');
    expect([...k.querySelectorAll('.label')].map((x) => x.textContent)).toEqual(['Not playing', 'Needs help', 'On track', 'Flying']);
    expect(k.textContent).not.toMatch(/Played today/);
    expect(document.getElementById('exportCsv')).toBeNull();
    expect(document.querySelector('[data-gtab="comp"]')).toBeNull();
    expect(document.querySelector('#tbl thead').textContent).toMatch(/Stars earned/);
    // clicking a group filters the table, clicking again shows everyone
    const rows = () => document.querySelectorAll('#tbl tbody tr[data-id]').length, all = rows();
    k.querySelector('[data-group="none"]').click(); expect(rows()).toBeLessThanOrEqual(all);
    k.querySelector('[data-group="none"]').click(); expect(rows()).toBe(all);
    // the owner gets a school picker; their own school is marked and nothing is view-only
    expect(document.getElementById('gSchoolWrap').hidden).toBe(false);
    expect(document.getElementById('gSchool').textContent).toMatch(/\(yours\)/);
    expect(document.getElementById('grown').classList.contains('viewonly')).toBe(false);
    expect(err).not.toHaveBeenCalled();
    history.pushState({}, '', '/');
  });
});

describe('student Top 10', () => {
  it('class board shows stars only; school board appears on paid plans; no rank outside the top 10', async () => {
    const log = await api.studentLogin('DEMO', '1111'); expect(log.token).toBeTruthy();
    const st = await api.studentState(log.token);
    expect(Array.isArray(st.school_board)).toBe(true); // demo school is on School Plus
    g.applyState(st);
    const p = g.S.players[g.S.current];
    g.setBoardScope('class'); g.renderBoard(p);
    expect(document.getElementById('boardTitle').textContent).toBe('Top 10 in your class');
    expect(document.getElementById('boardScope').hidden).toBe(false);
    expect(document.querySelector('#board .lhead').textContent).not.toMatch(/Time/);
    expect(document.getElementById('boardMe').textContent).not.toMatch(/#\d/);
    g.setBoardScope('school'); g.renderBoard(p);
    expect(document.getElementById('boardTitle').textContent).toBe('Top 10 in your school');
    expect(document.querySelectorAll('#board .lrow').length).toBeLessThanOrEqual(10);
    // free plan: no school board, back to the class board
    g.applyState({ ...st, school_board: null }); g.renderBoard(p);
    expect(document.getElementById('boardScope').hidden).toBe(true);
    expect(document.getElementById('boardTitle').textContent).toBe('Top 10 in your class');
  });
});

describe('streak for players saved before streaks existed', () => {
  const at = (d) => new Date(2026, 10, d, 10).getTime();
  it('is rebuilt from their rounds (Fri then Mon keeps it, one gap uses the freeze)', () => {
    const d = g.streakFromRounds([at(5), at(6), at(9), at(10), at(13)].map((t) => ({ d: t })));
    expect(d).toMatchObject({ count: 5, best: 5 }); // Thu, Fri, Mon, Tue, then Fri: Wed 11 Nov is a holiday and the missed Thu uses the freeze
    expect(g.streakFromRounds([at(2), at(9)].map((t) => ({ d: t })))).toMatchObject({ count: 1, best: 1 });
  });
});

describe('streak message on a day with no school', () => {
  it('says the streak is safe', () => {
    const at = (d, h = 10) => new Date(2026, 10, d, h).getTime();
    const div = document.createElement('div');
    div.innerHTML = g.streakHTML({ rounds: [{ d: at(10) }], daily: { count: 4, lastT: g.dayStart(at(10)), best: 4 } }, at(11, 15));
    expect(div.textContent).toMatch(/No school today, so your 4-day streak is safe/);
  });
});
