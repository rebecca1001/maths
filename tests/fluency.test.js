import { describe, it, expect, vi, afterEach } from 'vitest';
import { __test as g } from '../src/game.js';
import { fact, known, weak } from './helpers.js';
afterEach(() => vi.useRealTimers());

describe('median and level', () => {
  it('median handles empty, odd and even lists', () => { expect(g.med([])).toBeNull(); expect(g.med([5])).toBe(5); expect(g.med([9, 1, 5])).toBe(5); expect(g.med([1000, 3000])).toBe(2000); });
  it('level 0 = not tried', () => { expect(g.level(undefined)).toBe(0); expect(g.level(null)).toBe(0); expect(g.level(fact([], []))).toBe(0); });
  it('level 1 = tricky: low accuracy, no right answers, or very slow', () => {
    expect(g.level(fact([0, 0, 1, 0], [3000]))).toBe(1);
    expect(g.level(fact([0, 0, 0], []))).toBe(1);
    expect(g.level(fact([1, 1, 1], [6500, 7000, 8000]))).toBe(1);
  });
  it('level 2 = getting there', () => { expect(g.level(fact([1, 1, 1, 0], [1500, 1600, 1500]))).toBe(2); expect(g.level(fact([1, 1, 1, 1], [4000, 4200]))).toBe(2); });
  it('level 3 = quick: 85%+ and median 2-3.5 s', () => expect(g.level(fact([1, 1, 1, 1, 1, 1, 1, 0], [2500, 2600, 2400]))).toBe(3));
  it('level 4 = instant: 85%+ and median under 2 s', () => expect(g.level(known())).toBe(4));
  it('boundaries: exactly 60% accuracy is not tricky; exactly 85% needs speed', () => {
    expect(g.level(fact([1, 1, 1, 0, 0], [1000]))).toBe(2);
    expect(g.level(fact([1, 1, 1, 1, 1, 1, 0, 0], [1000]))).toBe(2); // 75%
  });
  it('is monotonic in speed for a perfect fact', () => { let prev = 5; for (const t of [800, 1900, 2000, 2500, 3500, 3600, 6000, 6100]) { const l = g.level(fact([1, 1, 1], [t, t, t])); expect(l).toBeLessThanOrEqual(prev); prev = l; } });
});

describe('weakWeight', () => {
  it('unseen facts get weight 4', () => expect(g.weakWeight({ facts: {} }, 7, 8)).toBe(4));
  it('weak facts are weighted above known ones', () => { const p = { facts: { '7,8': weak(), '2,2': known() } }; expect(g.weakWeight(p, 7, 8)).toBeGreaterThan(g.weakWeight(p, 2, 2)); });
  it('facts not seen for a while get more weight (capped at 2 days)', () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 10, 9, 12));
    const now = Date.now(), mk = h => ({ facts: { '3,3': fact([1, 1], [1500], now - h * 36e5) } });
    const fresh = g.weakWeight(mk(0), 3, 3), day = g.weakWeight(mk(24), 3, 3), long = g.weakWeight(mk(24 * 30), 3, 3);
    expect(day).toBeGreaterThan(fresh); expect(long).toBeCloseTo(fresh + 2, 5);
  });
  it('is always positive and finite', () => { for (const f of [fact([0], []), fact([1], [1]), fact([0, 0, 0], [99999]), fact([1], [], 0)]) { const w = g.weakWeight({ facts: { '2,3': f } }, 2, 3); expect(w).toBeGreaterThan(0); expect(Number.isFinite(w)).toBe(true); } });
});

describe('ranks (tiers) from recent round speed', () => {
  const rd = (c, n, ms) => ({ c, n, ms });
  it('statusSecs is null until a qualifying round exists', () => { expect(g.statusSecs({ rounds: [] })).toBeNull(); expect(g.statusSecs({ rounds: [rd(5, 7, 2000), rd(0, 10, 0)] })).toBeNull(); });
  it('statusSecs is the right-answer-weighted average of the last 3 qualifying rounds', () => {
    expect(g.statusSecs({ rounds: [rd(10, 10, 3000)] })).toBeCloseTo(3, 5);
    expect(g.statusSecs({ rounds: [rd(10, 10, 9000), rd(10, 10, 2000), rd(10, 10, 4000), rd(10, 10, 6000)] })).toBeCloseTo(4, 5);
    expect(g.statusSecs({ rounds: [rd(30, 30, 2000), rd(10, 10, 4000)] })).toBeCloseTo(2.5, 5);
  });
  it('tierIndex maps seconds to the 10 ranks, Ground to Galaxy', () => {
    expect(g.tierIndex(null)).toBe(-1); expect(g.tierIndex(undefined)).toBe(-1);
    expect(g.tierIndex(30)).toBe(0); expect(g.tierIndex(9)).toBe(1); expect(g.tierIndex(3)).toBe(6); expect(g.tierIndex(2.3)).toBe(7);
    expect(g.tierIndex(1.35)).toBe(9); expect(g.tierIndex(0.5)).toBe(9);
    expect(g.TIERS.map(t => t.name)).toEqual(['Ground', 'Clouds', 'Space', 'Orbit', 'Station', 'Moon', 'Mars', 'Jupiter', 'Saturn', 'Galaxy']);
  });
  it('tierIndex only ever improves as seconds fall', () => { let prev = -1; for (let s = 12; s >= 0.5; s -= 0.1) { const i = g.tierIndex(s); expect(i).toBeGreaterThanOrEqual(prev); prev = i; } });
  it('personal best is the fastest qualifying round in seconds', () => {
    expect(g.pb({ rounds: [] })).toBeNull();
    expect(g.pb({ rounds: [rd(10, 10, 3200), rd(12, 12, 2100), rd(3, 5, 900), rd(0, 9, 0)] })).toBeCloseTo(2.1, 5);
  });
});

describe('table summaries', () => {
  it('tableScore averages levels over tried facts only', () => {
    expect(g.tableScore({ facts: {} }, 7)).toBeNull();
    expect(g.tableScore({ facts: { '7,1': known(), '7,2': weak() } }, 7)).toBeCloseTo((4 + g.level(weak())) / 2, 5);
  });
  it('knowsTable needs every fact 1..12 at level 3+', () => {
    const facts = {}; for (let b = 1; b <= 12; b++) facts['4,' + b] = known();
    expect(g.knowsTable({ facts }, 4)).toBe(true); delete facts['4,9']; expect(g.knowsTable({ facts }, 4)).toBe(false);
  });
  it('focusOf lists up to 3 weakest tried tables (score under 3)', () => {
    const facts = { '7,1': weak(), '8,1': fact([0, 0], []), '9,1': known(), '6,1': fact([1, 0, 1], [3000]), '5,1': fact([0, 1, 0], [5000]) };
    const f = g.focusOf({ facts }); expect(f.length).toBeLessThanOrEqual(3); expect(f).not.toContain(9); expect(f.slice(0, 2).sort()).toEqual([5, 8]);
  });
  it('trickyFacts names the missed-most facts', () => {
    const p = { facts: { '7,8': fact([0, 0, 1], [5000]), '2,2': known(), '6,9': fact([0, 1, 1, 1], [3000]) } };
    expect(g.trickyFacts(p, 2)).toEqual(['7 × 8', '6 × 9']);
  });
  it('weekAcc is a whole-percent share of right answers since the week start', () => expect(g.weekAcc({ rounds: [{ d: 10, c: 9, n: 10 }, { d: 20, c: 1, n: 10 }, { d: 1, c: 0, n: 100 }] }, 5)).toBe(50));
});

describe('badges', () => {
  const base = () => ({ rounds: [], facts: {}, owned: ['blob'], rockets: ['classic'] });
  it('existing players get their badges quietly the first time', () => { const p = { ...base(), rounds: [{ c: 5, n: 5, ms: 3000 }] }; expect(g.checkBadges(p)).toEqual([]); expect(p.badges).toContain('first'); });
  it('new badges are returned once and recorded', () => {
    const p = { ...base(), badges: [] };
    expect(g.checkBadges(p)).toEqual([]);
    p.rounds.push({ c: 10, n: 10, ms: 1500, best: 10 });
    const ids = g.checkBadges(p).map(b => b.id); expect(ids).toEqual(expect.arrayContaining(['first', 'perfect', 'combo10', 'speedy']));
    expect(g.checkBadges(p)).toEqual([]);
  });
  it('century needs 100 right answers across rounds; streak badge needs best streak 5', () => {
    const p = { ...base(), badges: [], rounds: Array.from({ length: 10 }, () => ({ c: 10, n: 12, ms: 2500 })) };
    const ids = g.checkBadges(p).map(b => b.id); expect(ids).toEqual(expect.arrayContaining(['century', 'r10'])); expect(ids).not.toContain('streak5');
    p.daily = { best: 5 }; expect(g.checkBadges(p).map(b => b.id)).toContain('streak5');
  });
  it('perfect round needs 10+ right with no mistakes', () => { const p = { ...base(), badges: [], rounds: [{ c: 9, n: 9, ms: 3000 }] }; expect(g.checkBadges(p).map(b => b.id)).not.toContain('perfect'); });
  it('badge ids are unique', () => { const ids = g.BADGES.map(b => b.id); expect(new Set(ids).size).toBe(ids.length); });
});
