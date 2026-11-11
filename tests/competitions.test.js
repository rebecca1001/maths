import { describe, it, expect } from 'vitest';
import { compSummary, studentView, whenText, KINDS, unit, TIMEFRAMES, PRESETS, PRIZES, niceNumber, schoolDays, suggestTargets } from '../src/competitions.js';
import { api } from '../src/api.js';
import { __test } from '../src/game.js';

const DAY = 864e5, NOW = Date.parse('2026-11-15T12:00:00-08:00');
const classes = [{ id: 'A', name: 'Grade 5 Ravens' }, { id: 'B', name: 'Grade 4 Owls' }, { id: 'OLD', name: 'Old class', archived_at: '2026-01-01' }];
const round = (daysAgo, stars, c) => ({ d: NOW - daysAgo * DAY, stars, c, n: c + 1, ms: 2500, len: 60 });
const students = [
  { id: 'amy', class_id: 'A', name: 'Star Fox', real_name: 'Amy', data: { skin: 'ninja', rounds: [round(1, 80, 20), round(2, 60, 15), round(30, 99, 30)] } },
  { id: 'ben', class_id: 'A', name: 'Moon Cat', real_name: 'Ben', data: { rounds: [round(1, 50, 12)] } },
  { id: 'cal', class_id: 'A', name: 'Sky Owl', data: { rounds: [] } },
  { id: 'dem', class_id: 'A', name: 'Demo Kid', data: { demo: true, rounds: [round(1, 100, 40)] } },
  { id: 'dan', class_id: 'B', name: 'Comet Ray', data: { rounds: [round(1, 70, 18), round(3, 70, 18)] } },
  { id: 'old', class_id: 'OLD', name: 'Gone', data: { rounds: [round(1, 100, 40)] } },
];
const comp = (kind, extra = {}) => ({ id: kind, kind, measure: 'stars', title: KINDS[kind].label, prize: 'Gift card', starts_at: NOW - 7 * DAY, ends_at: NOW + 14 * DAY, class_id: KINDS[kind].scope === 'class' ? 'A' : null, target: KINDS[kind].target ? 1000 : null, ...extra });
const sum = (c, me, teacher = false, opts = {}) => compSummary(c, students, classes, me, teacher, { now: NOW, ...opts });

describe('competition scoring', () => {
  it('top player: only rounds inside the dates, demo and archived left out, rank and players', () => {
    const s = sum(comp('top_player'), 'ben');
    expect(s.status).toBe('active');
    expect(s.me).toBe(50); expect(s.rank).toBe(2); expect(s.players).toBe(3);
    expect(s.standings.map((x) => x.name)).toEqual(['Star Fox', 'Moon Cat']); // zero players hidden from students
    expect(s.standings[0].v).toBe(140); // the 30-day-old round does not count
    expect(s.standings.every((x) => x.real_name === null)).toBe(true);
  });
  it('teachers get everyone, with real names', () => {
    const s = sum(comp('top_player'), null, true);
    expect(s.standings.length).toBe(3); expect(s.standings[0].real_name).toBe('Amy');
  });
  it('correct answers can be counted instead of stars', () => expect(sum(comp('top_player', { measure: 'correct' }), 'amy').me).toBe(35));
  it('class goal adds up the class and knows when it is reached', () => {
    const s = sum(comp('class_target', { target: 150 }), 'amy');
    expect(s.total).toBe(190); expect(s.reached).toBe(true); expect(s.my_class_total).toBe(190);
    expect(sum(comp('class_target', { target: 500 }), 'amy').reached).toBe(false);
  });
  it('school goal counts every live class and lists them', () => {
    const s = sum(comp('school_target', { target: 1000 }), 'dan');
    expect(s.total).toBe(330); expect(s.my_class_total).toBe(140);
    expect(s.classes.map((x) => x.name)).toEqual(['Grade 5 Ravens', 'Grade 4 Owls']);
  });
  it('class race ranks by amount per student, so a small class can win', () => {
    const s = sum(comp('class_race'), 'amy');
    expect(s.classes[0].name).toBe('Grade 4 Owls'); expect(s.classes[0].per).toBe(140);
    expect(s.classes[1].per).toBeCloseTo(63.3, 1); expect(s.rank).toBe(2);
  });
  it('ending early stops the count; upcoming and ended states', () => {
    expect(sum(comp('top_player', { ended_at: NOW - 1.5 * DAY }), 'amy').me).toBe(60);
    expect(sum(comp('top_player', { ended_at: NOW - 1.5 * DAY }), 'amy').status).toBe('ended');
    expect(sum(comp('top_player', { starts_at: NOW + DAY, ends_at: NOW + 10 * DAY }), 'amy').status).toBe('upcoming');
  });
  it('demo students can be counted (the browser-only demo)', () => expect(sum(comp('top_player'), 'dem', false, { includeDemo: true }).rank).toBe(2));
});

describe('what students read', () => {
  it('top player: leading, behind, not played yet, won', () => {
    expect(studentView(sum(comp('top_player'), 'amy'), NOW).sub).toMatch(/in the lead/);
    const ben = studentView(sum(comp('top_player'), 'ben'), NOW);
    expect(ben.main).toBe('You: 50 stars · #2 of 3'); expect(ben.sub).toBe('90 stars behind #1 (Star Fox)'); expect(ben.pct).toBeCloseTo(35.7, 0);
    expect(studentView(sum(comp('top_player'), 'cal'), NOW).sub).toMatch(/Play a round/);
    const won = studentView(sum(comp('top_player', { ended_at: NOW - DAY / 2 }), 'amy'), NOW);
    expect(won.win).toBe(true); expect(won.sub).toMatch(/You won/); expect(won.when).toMatch(/Finished/);
  });
  it('goals show the total, how much is left, and what you added', () => {
    const v = studentView(sum(comp('class_target', { target: 500 }), 'amy'), NOW);
    expect(v.main).toBe('Class total: 190 of 500 stars'); expect(v.sub).toBe("You've added 140. 310 to go!"); expect(v.pct).toBe(38);
    expect(studentView(sum(comp('school_target', { target: 1000 }), 'dan'), NOW).sub).toMatch(/Your class has added 140/);
  });
  it('class race and coming-up wording; days left', () => {
    expect(studentView(sum(comp('class_race'), 'amy'), NOW).main).toBe('Your class is #2 of 2');
    const up = studentView(sum(comp('school_target', { starts_at: NOW + 3 * DAY, ends_at: NOW + 20 * DAY }), 'amy'), NOW);
    expect(up.main).toBe('School goal: 1,000 stars together'); expect(up.when).toBe('Starts in 3 days');
    expect(whenText({ status: 'active', starts_at: NOW - DAY, ends_at: NOW + 14 * DAY }, NOW)).toBe('14 days left');
    expect(unit('correct', 1)).toBe('correct answer');
  });
});

describe('demo backend competitions', () => {
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const later = (n) => { const d = new Date(Date.now() + n * DAY); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  it('checks input, creates, shows students their competition, ends and deletes', async () => {
    const cls = (await api.listClasses())[0];
    expect((await api.competitionCreate({ kind: 'top_player', class_id: cls.id, prize: '', starts_on: today(), ends_on: later(10) })).error).toBe('no_prize');
    expect((await api.competitionCreate({ kind: 'class_target', class_id: cls.id, prize: 'x', starts_on: today(), ends_on: later(10) })).error).toBe('bad_target');
    expect((await api.competitionCreate({ kind: 'top_player', class_id: cls.id, prize: 'x', starts_on: later(10), ends_on: today() })).error).toBe('bad_dates');
    const c = await api.competitionCreate({ kind: 'top_player', class_id: cls.id, prize: '$20 gift card', starts_on: later(-7), ends_on: later(10) });
    expect(c.status).toBe('active'); expect(c.standings[0].v).toBeGreaterThan(0);
    const { token } = await api.studentLogin('DEMO', '2222');
    const st = await api.studentState(token);
    expect(st.competitions.length).toBe(1); expect(st.competitions[0].rank).toBe(1); // Nova Falcon is the demo class's best player
    expect((await api.competitionsList()).competitions.length).toBe(1);
    expect((await api.competitionEnd(c.id, false)).ok).toBe(true);
    expect((await api.competitionsList()).competitions[0].status).toBe('ended');
    expect((await api.competitionEnd(c.id, true)).ok).toBe(true);
    expect((await api.competitionsList()).competitions.length).toBe(0);
  });
  it('free plan: cannot create, students see nothing; the owner sets the plan', async () => {
    expect((await api.superSetPlan('demo-school', 'free')).ok).toBe(true);
    expect((await api.superOverview()).schools[0].plan).toBe('free');
    const cls = (await api.listClasses())[0];
    expect((await api.competitionCreate({ kind: 'top_player', class_id: cls.id, prize: 'x', starts_on: today(), ends_on: later(5) })).error).toBe('needs_plan');
    expect((await api.competitionsList()).plan).toBe('free');
    expect((await api.superSetPlan('demo-school', 'gold')).error).toBe('bad_plan');
    await api.superSetPlan('demo-school', 'school');
  });
});

describe('student home card', () => {
  it('shows the competition with prize, progress bar and time left; hidden when there are none', () => {
    __test.setComps([sum(comp('top_player'), 'ben')]);
    __test.renderCompBox();
    const box = document.getElementById('compBox');
    expect(box.hidden).toBe(false);
    expect(box.textContent).toMatch(/Top player/); expect(box.textContent).toMatch(/Prize: Gift card/);
    expect(box.textContent).toMatch(/90 stars behind #1/); expect(box.querySelector('.gbar i').style.width).toBe('36%');
    expect(box.innerHTML).not.toMatch(/Amy|Ben/); // never real names
    __test.setComps([]); __test.renderCompBox(); expect(box.hidden).toBe(true);
  });
  it('escapes teacher-written text', () => {
    __test.setComps([sum(comp('class_target', { prize: '<img src=x onerror=alert(1)>', title: '<b>x</b>' }), 'amy')]);
    __test.renderCompBox();
    const box = document.getElementById('compBox');
    expect(box.querySelector('img')).toBeNull(); expect(box.textContent).toMatch(/<img src=x/);
  });
});

describe('quick picks', () => {
  const tf = (id, d) => TIMEFRAMES.find((t) => t.id === id).range(d);
  it('timeframes start today and end on the right day', () => {
    const wed = new Date(2026, 10, 11); // Wed 11 Nov 2026
    expect(tf('week', wed)).toEqual(['2026-11-11', '2026-11-17']);
    expect(tf('2weeks', wed)).toEqual(['2026-11-11', '2026-11-24']);
    expect(tf('month', wed)).toEqual(['2026-11-11', '2026-11-30']);
    expect(tf('30days', wed)).toEqual(['2026-11-11', '2026-12-10']);
    expect(tf('month', new Date(2026, 10, 28))).toEqual(['2026-11-28', '2026-12-04']); // near month end: at least a week
    for (const t of TIMEFRAMES) { const [a, b] = t.range(wed); expect(schoolDays(a, b)).toBeGreaterThan(0); }
  });
  it('every preset is valid: known kind, measure, timeframe, prize; goals have a per-student target', () => {
    for (const p of PRESETS) {
      expect(KINDS[p.kind], p.id).toBeTruthy(); expect(['stars', 'correct']).toContain(p.measure);
      expect(TIMEFRAMES.some((t) => t.id === p.time), p.id).toBe(true); expect(p.prize.length).toBeGreaterThan(2);
      expect(!!p.perStudent, p.id).toBe(KINDS[p.kind].target);
    }
    expect(PRIZES.class.length).toBeGreaterThan(3); expect(PRIZES.team.length).toBeGreaterThan(3);
  });
  it('school days skip weekends; targets are round numbers that grow with class size and effort', () => {
    expect(schoolDays('2026-11-09', '2026-11-15')).toBe(5);
    expect(schoolDays('2026-11-14', '2026-11-15')).toBe(0);
    expect(niceNumber(1234)).toBe(1250); expect(niceNumber(23456)).toBe(23500); expect(niceNumber(12)).toBe(50);
    const t = suggestTargets('stars', 24, '2026-11-09', '2026-11-20'); // 10 school days
    expect(t.map((x) => x.label)).toEqual(['Easy', 'Steady', 'Stretch']);
    expect(t[0].value).toBe(24000); expect(t[2].value).toBeGreaterThan(t[1].value);
    expect(suggestTargets('correct', 24, '2026-11-09', '2026-11-20')[0].value).toBe(9500);
    expect(suggestTargets('stars', 24, '2026-11-14', '2026-11-15')).toEqual([]);
  });
});
