import { describe, it, expect, vi, afterEach } from 'vitest';
import { daysPlayed, accuracy, correctPerMin, trend, minFor, hasOwnMin, roundsToday, withClassMin, withStudentMin } from '../src/dashboard.js';
import { __test as g, boot } from '../src/game.js';
import { api } from '../src/api.js';

const NOW = new Date(2026, 10, 12, 14).getTime(); // Thu 12 Nov 2026
const DAY = 864e5;
const r = (daysAgo, c, n, extra = {}) => ({ d: NOW - daysAgo * DAY, c, n, len: 60, ...extra });

describe('minimum rounds each time they play', () => {
  it('class number, own number for one child, 0 = off', () => {
    let st = withClassMin({ maxTable: 10 }, 3);
    expect(st).toMatchObject({ maxTable: 10, minRounds: 3 });
    expect(minFor(st, 'a')).toBe(3);
    st = withStudentMin(st, 'a', 5); expect(minFor(st, 'a')).toBe(5); expect(hasOwnMin(st, 'a')).toBe(true); expect(minFor(st, 'b')).toBe(3);
    st = withStudentMin(st, 'b', 0); expect(minFor(st, 'b')).toBe(0); // no minimum for this child
    st = withClassMin(st, 4); expect(minFor(st, 'a')).toBe(5); expect(minFor(st, 'c')).toBe(4); // class change keeps own numbers
    st = withStudentMin(st, 'a', null); st = withStudentMin(st, 'b', null); expect(minFor(st, 'a')).toBe(4); expect(st.minFor).toBeUndefined();
    expect(minFor({}, 'x')).toBe(0); expect(minFor(null, 'x')).toBe(0);
    expect(minFor(withClassMin({}, 99), 'x')).toBe(30); expect(minFor(withClassMin({}, -2), 'x')).toBe(0);
  });
  it('counts only today\'s rounds', () => expect(roundsToday([r(0, 1, 1), r(0, 1, 1), r(1, 1, 1), r(3, 1, 1)], NOW)).toBe(2));
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
  it('Principal box: a signed-in school admin lands on the School page', async () => {
    await api.teacherSignIn('t@demo.ca', 'password123');
    history.pushState({}, '', '/'); await boot(); await new Promise((res) => setTimeout(res, 60));
    document.getElementById('gateLogin').click(); await new Promise((res) => setTimeout(res, 20));
    document.getElementById('kSchool').click(); await new Promise((res) => setTimeout(res, 20));
    document.getElementById('rPrincipal').click(); await new Promise((res) => setTimeout(res, 120));
    expect(document.getElementById('school').hidden).toBe(false);
    expect(document.getElementById('grown').hidden).toBe(true);
  });
  it('teacher page: three steps in order, list columns, rounds per day (class and one student)', async () => {
    const err = vi.spyOn(console, 'error');
    await api.teacherSignIn('t@demo.ca', 'password123');
    history.pushState({}, '', '/?teacher=1'); await boot(); await new Promise((res) => setTimeout(res, 60));
    const $ = (id) => document.getElementById(id);
    expect($('grown').hidden).toBe(false);
    // order: add students, then the list, then class settings, then More
    const order = ['step1', 'step2', 'step3', 'more'].map((id) => $(id));
    order.forEach((el, i) => { if (i) expect(order[i - 1].compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy(); });
    expect(document.querySelector('[data-gtab]')).toBeNull();            // no tabs, no weekly goal
    expect($('goalCard')).toBeNull();
    expect($('step1').contains($('showCards'))).toBe(true);              // Print login cards sits in step 1
    expect($('more').contains($('showCards'))).toBe(false);
    const head = $('tbl').querySelector('thead').textContent;
    expect(head).toMatch(/Student/); expect(head).toMatch(/Status/); expect(head).toMatch(/Rounds today/); expect(head).toMatch(/Rounds this week/); expect(head).not.toMatch(/Accuracy|Days|Trend/);
    // only two status words, ever
    const words = new Set([...$('tbl').querySelectorAll('.stag')].map((x) => x.textContent));
    for (const w of words) expect(['On track', 'Needs assistance']).toContain(w);
    // whole class: rounds per day, saved with the button, loads again next time
    expect(Number($('rdVal').value)).toBe(10);                           // default 10 the first time
    $('rdPlus').click(); $('rdPlus').click(); $('saveClass').click();
    await new Promise((res) => setTimeout(res, 40));
    let cls = (await api.listClasses())[0];
    expect(cls.settings.minRounds).toBe(12);
    await boot(); await new Promise((res) => setTimeout(res, 60));
    expect(Number($('rdVal').value)).toBe(12);                           // the saved number loads
    // one student: open Settings, own number, save, then reset to the class values
    $('tbl').querySelector('[data-settings]').click(); await new Promise((res) => setTimeout(res, 10));
    expect($('kidModal').hidden).toBe(false);
    const id = $('tbl').querySelector('[data-settings]').dataset.settings;
    expect($('kmHint').textContent).toBe('same as class');
    $('kmMinus').click(); $('kmMinus').click();
    expect($('kmHint').textContent).toBe('own number');
    $('kmSave').click(); await new Promise((res) => setTimeout(res, 40));
    expect($('kidModal').hidden).toBe(true);
    expect((await api.listClasses())[0].settings.minFor[id]).toBe(10);
    $('tbl').querySelector(`[data-settings="${id}"]`).click(); await new Promise((res) => setTimeout(res, 10));
    $('kmReset').click(); await new Promise((res) => setTimeout(res, 40));
    cls = (await api.listClasses())[0];
    expect(cls.settings.minFor).toBeUndefined(); expect(cls.settings.kids).toBeUndefined();
    expect($('gSchoolWrap').hidden).toBe(false);                         // the super admin's school dropdown
    expect($('pickbar').hidden).toBe(false);
    expect($('gSchool').options.length).toBeGreaterThan(0);
    expect($('ptbl').querySelector('thead').textContent).toMatch(/Accuracy.*Stars earned.*Trend/);
    expect($('grown').classList.contains('viewonly')).toBe(false);
    expect(err).not.toHaveBeenCalled();
    history.pushState({}, '', '/');
  });
  it('Give everyone a username: check list (from real names, clashes numbered, no real name skipped), then one tap; codes unchanged', async () => {
    await api.teacherSignIn('t@demo.ca', 'password123');
    history.pushState({}, '', '/?teacher=1'); await boot(); await new Promise((res) => setTimeout(res, 60));
    const cls = (await api.listClasses())[0];
    const kids = (await api.listStudents(cls.id)).filter((s) => !s.username);
    await api.setRealName(kids[0].id, 'Emma Smith'); await api.setRealName(kids[1].id, 'Emma Smith'); await api.setRealName(kids[2].id, '');
    for (const k of kids.slice(3)) await api.setRealName(k.id, `Kid ${k.id.slice(0, 4)} Test${k.id.slice(-3)}`);
    history.pushState({}, '', '/?teacher=1'); await boot(); await new Promise((res) => setTimeout(res, 60));
    const btn = document.getElementById('giveAll');
    expect(btn.hidden).toBe(false); expect(btn.textContent).toMatch(new RegExp(`\\(${kids.length - 1}\\)`)); // counts only students who can get one (one has no real name)
    btn.click(); await new Promise((res) => setTimeout(res, 20));
    const review = document.getElementById('unameReview');
    expect(review.textContent).toMatch(/smith\.emma/); expect(review.textContent).toMatch(/smith\.emma2/);
    expect(review.textContent).toMatch(/1 student needs a first and last name/);
    expect((await api.listStudents(cls.id)).filter((s) => s.username).length).toBe(1); // nothing saved yet (fox.comet only)
    document.getElementById('uConfirm').click(); await new Promise((res) => setTimeout(res, 200));
    const after = await api.listStudents(cls.id);
    expect(after.find((s) => s.id === kids[0].id).username).toBe('smith.emma');
    expect(after.find((s) => s.id === kids[1].id).username).toBe('smith.emma2');
    expect(after.find((s) => s.id === kids[2].id).username).toBeFalsy();
    expect(after.find((s) => s.id === kids[0].id).pin).toBe(kids[0].pin); // same code
    expect(document.getElementById('addMsg').textContent).toMatch(/Done: \d+ students now have usernames/);
    expect(document.getElementById('giveAll').textContent).toMatch(/1 needs a full name/); // only the one without a real name left
    history.pushState({}, '', '/');
  });
  it("kid's Play screen shows today's minimum, or nothing when there is none", () => {
    const now = Date.now(), p = { id: 'k1', rounds: [{ d: now - 60e3 }] };
    g.applySettings({ minRounds: 3 }); g.renderMinBox(p);
    const box = document.getElementById('minBox');
    expect(box.hidden).toBe(false); expect(box.textContent).toMatch(/1 of 3/); expect(box.textContent).toMatch(/2 to go/);
    g.applySettings({ minRounds: 3, minFor: { k1: 1 } }); g.renderMinBox(p);
    expect(box.textContent).toMatch(/Done for today/); expect(box.classList.contains('done')).toBe(true);
    g.applySettings({}); g.renderMinBox(p); expect(box.hidden).toBe(true);
  });
});

describe('student Top 10', () => {
  it('class board shows stars only; school board appears on paid plans; no rank outside the top 10', async () => {
    const log = await api.studentLogin('DEMO', '1111'); expect(log.token).toBeTruthy();
    const st = await api.studentState(log.token);
    expect(Array.isArray(st.school_board)).toBe(true); // demo school is on the School plan
    g.applyState(st);
    const p = g.S.players[g.S.current];
    g.setBoardScope('class'); g.renderBoard(p);
    expect(document.getElementById('boardTitle').textContent).toBe('Top 10 in your class');
    expect(document.getElementById('boardScope').hidden).toBe(false);
    expect(document.querySelector('#board .lhead').textContent).not.toMatch(/Time/);
    expect(document.getElementById('boardMe').textContent).not.toMatch(/#\d/);
    expect(document.getElementById('board').textContent + document.getElementById('boardMe').textContent).not.toMatch(/Monday|this week/); // never resets
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

import { groupOf as _groupOf } from '../src/dashboard.js';
import { statusReasons as _reasons, roundsThisWeek as _week, schoolDaysDone as _done } from '../src/dashboard.js';
describe('status label: judged over the week, never over today', () => {
  const fri = new Date(2026, 10, 20, 15).getTime(), mon = new Date(2026, 10, 23, 9).getTime(), sat = new Date(2026, 10, 21, 10).getTime();
  const day = (now, back, h = 10) => { const d = new Date(now); d.setDate(d.getDate() - back); d.setHours(h, 0, 0, 0); return d.getTime(); };
  const round = (d, c, n = 20) => ({ d, c, n, len: 60 });
  const busy = (now, c, n, rounds = 24) => Array.from({ length: rounds }, (_, i) => round(day(now, i % 4), c, n));
  it('counts school days finished this week, not today', () => {
    expect(_done(mon)).toBe(0); expect(_done(fri)).toBe(4); expect(_done(sat)).toBe(5);
  });
  it('rounds this week start on Monday', () => {
    const rs = [round(day(fri, 4), 10), round(day(fri, 1), 10), round(day(fri, 6), 10)];   // Mon, Thu, last Sunday
    expect(_week(rs, fri)).toBe(2);
  });
  it('a Monday, or a student who simply was not in school today, is never flagged', () => {
    expect(groupOfX([], mon)).toBe('ok');
    expect(groupOfX(busy(fri, 18, 20), fri)).toBe('ok');                     // played Mon-Thu, nothing today
  });
  it('low activity: far fewer rounds than the daily target x finished school days', () => {
    expect(_reasons([], fri)).toEqual(['activity']);                          // nothing all week by Friday
    expect(_reasons([round(day(fri, 3), 18)], fri)).toEqual(['activity']);   // 1 round against 40 expected
    expect(_reasons(busy(fri, 18, 20, 24), fri)).toEqual([]);                // 24 of 40 expected: enough
    expect(_reasons([round(day(fri, 3), 18), round(day(fri, 2), 18)], fri, 1)).toEqual([]);   // a target of 1 a day: 2 of 4 expected is enough
  });
  it('low accuracy: very few right over enough answers; a weaker child who plays a lot is on track', () => {
    expect(_reasons(busy(fri, 8, 20, 24), fri)).toEqual(['accuracy']);       // 40% right over 480 answers
    expect(_reasons(busy(fri, 13, 20, 24), fri)).toEqual([]);                // 65% right and playing plenty: on track
    expect(_reasons([round(day(fri, 1), 2, 10), round(day(fri, 2), 2, 10)], fri, 1)).toEqual([]);   // only 20 answers: too few to judge
  });
  it('both reasons can apply', () => {
    expect(_reasons([round(day(fri, 3), 2, 30)], fri)).toEqual(['accuracy', 'activity']);
  });
});
const groupOfX = (rounds, now) => _groupOf(rounds, now);

import { lastPlayedLabel } from '../src/dashboard.js';
describe('last played label', () => {
  it('Today only for the same calendar day', () => {
    const now = new Date(2026, 10, 14, 10, 51).getTime(), at = (d, h) => [{ d: new Date(2026, 10, d, h, 0).getTime() }];
    expect(lastPlayedLabel([], now)).toBe('Never');
    expect(lastPlayedLabel(at(14, 8), now)).toBe('Today');
    expect(lastPlayedLabel(at(13, 16), now)).toBe('Yesterday'); // 19h ago, but not today
    expect(lastPlayedLabel(at(11, 9), now)).toBe('3 days ago');
  });
});

describe('week boxes use the full played-days history', () => {
  const at = (m, d, h = 12) => new Date(2026, m - 1, d, h).getTime();
  it('days missing from the last 60 saved rounds still tick when the server says they were played', () => {
    const p = { rounds: [{ d: at(11, 13) }], playedDays: ['2026-11-09', '2026-11-12', '2026-11-13'], daily: { count: 5, lastT: g.dayStart(at(11, 14)), best: 5 } };
    const div = document.createElement('div'); div.innerHTML = g.streakHTML(p, at(11, 14, 12));
    expect(div.querySelectorAll('.sday.done').length).toBe(3); // Mon, Thu, Fri
  });
});

describe('buying back a lost streak', () => {
  const at = (m, d, h = 12) => new Date(2026, m - 1, d, h).getTime();
  const lostPlayer = (coins) => ({ rounds: [], coins, daily: { count: 6, lastT: g.dayStart(at(11, 3)), best: 6 } }); // last played Tue 3 Nov
  it('a dead streak shows Streak lost and a buy button that needs 400 stars', () => {
    const div = document.createElement('div'); div.innerHTML = g.streakHTML(lostPlayer(100), at(11, 12));
    expect(div.textContent).toMatch(/Streak lost! Your 6-day streak ended/);
    expect(div.querySelector('[data-restore]').disabled).toBe(true);
    div.innerHTML = g.streakHTML(lostPlayer(500), at(11, 12));
    expect(div.querySelector('[data-restore]').disabled).toBe(false);
  });
  it('buying it back costs 400 stars, keeps the old count alive, and today\'s round makes it 7', () => {
    const p = lostPlayer(450); expect(g.restoreStreak(p, at(11, 12))).toBe(true);
    expect(p.coins).toBe(50);
    expect(g.streakInfo(p, at(11, 12)).count).toBe(6);
    expect(g.streakInfo(p, at(11, 12)).lost).toBe(0);
  });
  it('cannot buy back without enough stars, or when the streak is not lost', () => {
    const poor = lostPlayer(399); expect(g.restoreStreak(poor, at(11, 12))).toBe(false); expect(poor.coins).toBe(399);
    const alive = { rounds: [], coins: 900, daily: { count: 3, lastT: g.dayStart(at(11, 12)), best: 3 } };
    expect(g.restoreStreak(alive, at(11, 12))).toBe(false); expect(alive.coins).toBe(900);
  });
});

describe('streak buy-back window', () => {
  const at = (m, d, h = 12) => new Date(2026, m - 1, d, h).getTime();
  const lp = () => ({ rounds: [], coins: 900, daily: { count: 6, lastT: g.dayStart(at(11, 3)), best: 6 } }); // streak ended Fri 6 Nov
  it('can be bought back for 7 days after it ended, not after', () => {
    expect(g.streakInfo(lp(), at(11, 13)).lost).toBe(6);  // 7 days after
    expect(g.streakInfo(lp(), at(11, 14)).lost).toBe(0);  // 8 days after
    const p = lp(); expect(g.restoreStreak(p, at(11, 20))).toBe(false); expect(p.coins).toBe(900);
  });
});
