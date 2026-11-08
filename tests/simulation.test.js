import { describe, it, expect, vi, afterEach } from 'vitest';
import { __test as g } from '../src/game.js';
import { seeded, loadPlayer, startRound } from './helpers.js';
import { seedDemoStudents } from '../src/demo-data.js';
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

// A simulated child: some tables already known, the rest improve with practice.
function child(rnd, easyTables) {
  const seen = {};
  return (a, b) => {
    const k = a + ',' + b, n = seen[k] = (seen[k] || 0) + 1;
    const base = easyTables.includes(a) || easyTables.includes(b) ? 0.95 : 0.35, pRight = Math.min(0.97, base + n * 0.12);
    return { ok: rnd() < pRight, ms: Math.max(700, (easyTables.includes(a) ? 1500 : 4200 - n * 450) * (0.8 + rnd() * 0.5)) };
  };
}
function playRound(p, kid, questions = 22) {
  startRound(); let right = 0;
  for (let i = 0; i < questions; i++) {
    const q = g.pick(p); g.setQ(q); const { ok, ms } = kid(q.a, q.b);
    g.record(ok, ms); g.afterAnswer(ok); if (ok) right++;
  }
  return right / questions;
}

describe('long-run simulation of a learner', () => {
  it('30 rounds: no errors, data stays well-formed, learner improves, difficulty stays in the "mostly right" zone', () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 10, 9, 10));
    const rnd = seeded(2026); vi.spyOn(Math, 'random').mockImplementation(rnd);
    const p = loadPlayer({}); const kid = child(rnd, [2, 10, 5]); const acc = [], triedOverTime = [];
    for (let r = 0; r < 30; r++) { vi.setSystemTime(new Date(2026, 10, 9, 10, r)); acc.push(playRound(p, kid)); triedOverTime.push(Object.keys(p.facts).length); }
    // invariants of stored data
    for (const [k, f] of Object.entries(p.facts)) { expect(k).toMatch(/^\d+,\d+$/); expect(f.r.length).toBeLessThanOrEqual(8); expect(f.t.length).toBeLessThanOrEqual(5); expect(f.r.every(v => v === 0 || v === 1)).toBe(true); expect(f.t.every(Number.isFinite)).toBe(true); }
    // new facts get introduced steadily, never all at once
    expect(triedOverTime[0]).toBeLessThan(25); expect(triedOverTime.at(-1)).toBeGreaterThan(triedOverTime[0]);
    // "aim for roughly 4 right in 5"
    const mean = acc.slice(3).reduce((s, v) => s + v, 0) / (acc.length - 3); expect(mean).toBeGreaterThan(0.6); expect(mean).toBeLessThan(0.95);
    // fluency of the practised facts rises
    const avgLevel = Object.values(p.facts).reduce((s, f) => s + g.level(f), 0) / Object.keys(p.facts).length; expect(avgLevel).toBeGreaterThan(2);
  });
  it('a child who gets everything wrong is never fed only hard facts (confidence is rebuilt)', () => {
    const rnd = seeded(11); vi.spyOn(Math, 'random').mockImplementation(rnd);
    const p = loadPlayer({ facts: { '2,2': { r: [1, 1, 1, 1], t: [1000, 1100, 1200], last: Date.now() }, '2,3': { r: [1, 1, 1, 1], t: [1000, 1100, 1200], last: Date.now() }, '10,2': { r: [1, 1, 1, 1], t: [1000, 1100, 1200], last: Date.now() } } });
    startRound({ qn: 6 }); g.G.res = [0, 0]; g.G.easyRun = 3; const picks = [];
    for (let i = 0; i < 3; i++) { const q = g.pick(p); picks.push(g.level(p.facts[q.a + ',' + q.b])); }
    expect(picks.every(l => l >= 3)).toBe(true);
  });
});

describe('stored data size', () => {
  it('worst-case student record is far below the 400KB database limit', () => {
    const facts = {}; for (let a = 1; a <= 12; a++) for (let b = 1; b <= 12; b++) facts[a + ',' + b] = { r: [1, 0, 1, 1, 0, 1, 1, 1], t: [12345, 23456, 3456, 4567, 5678], last: 1789000000000 };
    const rounds = Array.from({ length: 60 }, (_, i) => ({ d: 1789000000000 + i, c: 30, n: 33, ms: 1800, len: 60, best: 12, boss: true, pts: 900, stars: 120 }));
    const data = { facts, rounds, badges: g.BADGES.map(b => b.id), owned: Array(40).fill('skin-name'), rockets: Array(20).fill('rocket-name'), bestTrace: Array(150).fill(123), coins: 99999, maxCoins: 99999, daily: { count: 50, lastT: 1, best: 50, freezeWeek: 1 } };
    const bytes = JSON.stringify(data).length; expect(bytes).toBeLessThan(60000); expect(bytes).toBeLessThan(400000 / 5);
  });
  it('demo students look real: valid facts and rounds for every sample player', () => {
    for (const s of seedDemoStudents()) { const p = g.fixPlayer({ ...s.data }); expect(Object.keys(p.facts).length).toBeGreaterThan(50); expect(p.rounds.length).toBe(5); for (const f of Object.values(p.facts)) { expect(f.r.length).toBeGreaterThan(0); g.level(f); } }
  });
});
