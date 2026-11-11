import { describe, it, expect } from 'vitest';
import { demoPilotScore, pilotRows, pilotHeadline, weeklyText, weekLabel } from '../src/pilot.js';
import { api } from '../src/api.js';

const DAY = 864e5;
const START = '2026-10-12', END = '2026-11-08'; // 4 weeks, Mon to Sun
const at = (k, h = 10) => new Date(2026, 9, 12 + k, h).getTime(); // day k after the start, local time
const r = (k, c, h) => ({ d: at(k, h), c });
// Same scenario as supabase/tests/test_pilots.sql
function scenario(danLast = 9) {
  const kid = (id, rounds, demo) => ({ id, class_id: 'A', data: { rounds, demo } });
  const base = [r(-5, 10, 10), r(-5, 10, 11), r(-5, 10, 12)];
  const w13 = [0, 1, 2].flatMap((w) => [0, 1, 2].map((d) => r(w * 7 + d, 11)));
  return [
    kid('ann', [...base, ...w13, r(21, 13), r(22, 13), r(23, 13)]),
    kid('bob', [...base, ...w13, r(21, 13), r(22, 13), r(23, 13)]),
    kid('cat', [...base, ...w13, r(21, 9), r(22, 9)]),
    kid('dan', [...base, ...w13, r(21, danLast), r(22, danLast)]),
    kid('demo', Array.from({ length: 33 }, (_, i) => r(i - 5, 40)), true),
    { id: 'other', class_id: 'B', data: { rounds: [r(1, 50), r(2, 50), r(3, 50)] } },
  ];
}
const comps = [{ class_id: 'A', title: 'Star of the week', kind: 'top_player', starts_at: new Date(at(7, 0)).toISOString(), ends_at: new Date(at(14, 0)).toISOString() }];
const pilot = { id: 'p1', class_id: 'A', starts_on: START, ends_on: END, baseline_days: 14, bonus: false, school_name: 'Walnut Park', class_name: "Ms Berry's class" };
const NOW = at(30);

describe('pilot scorecard (same numbers as the database)', () => {
  it('fail case: usage and competitions met, fluency +10% and every child 50% not met, 2 of 4', () => {
    const s = demoPilotScore(pilot, scenario(), comps, { now: NOW });
    expect(s.phase).toBe('finished'); expect(s.students).toBe(4);
    expect(s.usage.weeks_met).toBe(3); expect(s.usage.met).toBe(true); expect(s.usage.weeks[3].pct).toBe(50);
    expect(s.fluency).toMatchObject({ baseline: 10, now: 11, change: 10, met: false });
    expect(s.every_child).toMatchObject({ eligible: 4, improved: 2, pct: 50, met: false });
    expect(s.competitions.best).toBe(100); expect(s.competitions.met).toBe(true);
    expect(s.met).toBe(2); expect(s.passed).toBe(false);
    expect(pilotHeadline(s).text).toBe('Not passed: 2 of 4 met (needs 3)');
  });
  it('pass case: Dan speeds up, 4 of 4', () => {
    const s = demoPilotScore(pilot, scenario(15), comps, { now: NOW });
    expect(s.fluency.change).toBe(25); expect(s.every_child.pct).toBe(75); expect(s.met).toBe(4); expect(s.passed).toBe(true);
    expect(pilotHeadline(s)).toEqual({ text: 'Passed: 4 of 4 met', state: 'met' });
  });
  it('mid-pilot: unfinished weeks do not count yet, states read "not yet", and missed weeks can make usage impossible', () => {
    const s = demoPilotScore(pilot, scenario(), comps, { now: at(10) });
    expect(s.phase).toBe('running'); expect(s.usage.weeks.map((w) => w.state)).toEqual(['done', 'now', 'future', 'future']);
    const rows = pilotRows(s);
    expect(rows.map((x) => x.key)).toEqual(['usage', 'fluency', 'every_child', 'competitions']);
    expect(rows[0].state).toBe('progress'); expect(rows[3].state).toBe('met');
    expect(weekLabel(pilot, at(10))).toBe('Week 2 of 4');
    const empty = demoPilotScore(pilot, scenario().map((k) => ({ ...k, data: { ...k.data, rounds: [] } })), [], { now: at(16) });
    expect(empty.usage.still_possible).toBe(false); expect(pilotRows(empty)[0].state).toBe('missed');
    expect(pilotRows(demoPilotScore(pilot, scenario(), [], { now: at(-3) }))[1].state).toBe('waiting');
  });
  it('Friday update text lists every criterion and the overall result', () => {
    const t = weeklyText({ ...pilot, score: demoPilotScore(pilot, scenario(15), comps, { now: NOW }) }, NOW);
    expect(t).toMatch(/^Walnut Park: MathWizz pilot, Ms Berry's class/);
    expect(t).toMatch(/1\. Regular use: 3 of 4 finished weeks met/);
    expect(t).toMatch(/2\. Class fluency: \+25%/); expect(t).toMatch(/4\. Competitions: 100%/);
    expect(t).toMatch(/Passed: 4 of 4 met\.$/);
  });
});

describe('demo backend pilots', () => {
  it('adds, scores, ticks the bonus and deletes a pilot', async () => {
    const cls = (await api.listClasses())[0];
    expect((await api.superPilotSave({ class_id: cls.id, starts_on: '2026-12-11', ends_on: '2026-11-16' })).error).toBe('bad_dates');
    expect((await api.superPilotSave({ class_id: 'nope', starts_on: '2026-11-16', ends_on: '2026-12-11' })).error).toBe('bad_class');
    const s = await api.superPilotSave({ class_id: cls.id, starts_on: '2026-11-16', ends_on: '2026-12-11', notes: 'Ms Berry' });
    expect(s.ok).toBe(true);
    let p = (await api.superPilots()).pilots[0];
    expect(p.class_name).toBe(cls.name); expect(p.score.usage.weeks.length).toBe(4); expect(p.notes).toBe('Ms Berry');
    await api.superPilotSave({ id: s.id, class_id: cls.id, starts_on: '2026-11-16', ends_on: '2026-12-11', bonus: true });
    p = (await api.superPilots()).pilots[0];
    expect(p.score.bonus).toBe(true); expect(p.notes).toBe('Ms Berry');
    expect((await api.superPilotDelete(s.id)).ok).toBe(true);
    expect((await api.superPilots()).pilots.length).toBe(0);
  });
});
