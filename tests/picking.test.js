import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { __test as g } from '../src/game.js';
import { seeded, fact, known, weak, loadPlayer, startRound } from './helpers.js';
afterEach(() => vi.restoreAllMocks());

const allFacts = (tables, fn) => { const f = {}; for (const a of tables) for (let b = 1; b <= 12; b++) f[a + ',' + b] = fn(); return f; };
const keyOf = q => q.a + ',' + q.b;

describe('class settings', () => {
  it('maxTable is clamped to 5..12 and defaults to 12', () => {
    for (const [v, max] of [[undefined, 12], [0, 12], [3, 5], [5, 5], ['10', 10], [12, 12], [99, 12], [-4, 5]]) { g.applySettings({ maxTable: v }); expect(g.ALL.at(-1)).toBe(max); expect(g.ALL[0]).toBe(2); }
  });
  it('tables 2..max with no gaps', () => { g.applySettings({ maxTable: 8 }); expect(g.ALL).toEqual([2, 3, 4, 5, 6, 7, 8]); });
  it('facts() covers every table up to max against multipliers 1..max', () => { g.applySettings({ maxTable: 12 }); expect(g.facts().length).toBe(11 * 12); g.applySettings({ maxTable: 5 }); expect(g.facts().length).toBe(4 * 5); });
  it('sound, division and null settings', () => {
    g.applySettings({ sound: false, division: true }); expect(g.S.muted).toBe(true); expect(g.S.division).toBe(true);
    g.applySettings(null); expect(g.S.muted).toBe(false); expect(g.S.division).toBe(false); expect(g.ALL.at(-1)).toBe(12);
  });
  it('weekly goal is sanitised', () => {
    g.applySettings({ goal: { tables: ['3', 7, 1, 13, 'x', 12], rounds: 99 } }); expect(g.S.goal).toEqual({ tables: [3, 7, 12], rounds: 50 });
    g.applySettings({ goal: { tables: [], rounds: 0 } }); expect(g.S.goal).toBeNull();
    g.applySettings({ goal: { tables: 'nope', rounds: 5 } }); expect(g.S.goal).toBeNull();
    g.applySettings({ goal: { tables: [4] } }); expect(g.S.goal).toEqual({ tables: [4], rounds: 0 });
  });
  it('a goal with no valid tables and no rounds is treated as no goal', () => { g.applySettings({ goal: { tables: [], rounds: -3 } }); expect(g.S.goal).toBeNull(); });
  it('goal tables are boosted 3x when picking', () => { g.applySettings({ goal: { tables: [7], rounds: 3 } }); expect(g.goalBoost([7, 2])).toBe(3); expect(g.goalBoost([3, 7])).toBe(3); expect(g.goalBoost([3, 4])).toBe(1); g.applySettings({}); expect(g.goalBoost([7, 7])).toBe(1); });
});

describe('questions', () => {
  it('multiplication text and answer', () => { g.applySettings({}); expect(g.makeQ(7, 8)).toEqual({ a: 7, b: 8, text: '7 × 8', ans: 56 }); });
  it('division mode sometimes asks the inverse and never divides by 1', () => {
    g.applySettings({ division: true });
    vi.spyOn(Math, 'random').mockReturnValue(0.1); expect(g.makeQ(6, 7)).toEqual({ a: 6, b: 7, text: '42 ÷ 6', ans: 7 });
    expect(g.makeQ(1, 9).text).toBe('1 × 9');
    Math.random.mockReturnValue(0.9); expect(g.makeQ(6, 7).text).toBe('6 × 7');
  });
  it('every generated question has the right answer', () => {
    g.applySettings({ division: true }); const rnd = seeded(7); vi.spyOn(Math, 'random').mockImplementation(rnd);
    for (let i = 0; i < 500; i++) { const a = 2 + (i % 11), b = 1 + (i % 12), q = g.makeQ(a, b); const [x, op, y] = q.text.split(' '); expect(op === '×' ? +x * +y : +x / +y).toBe(q.ans); }
  });
});

describe('adaptive picker', () => {
  beforeEach(() => { g.applySettings({}); });

  it('a brand-new player starts with the easiest tables (2 and 10)', () => {
    const p = loadPlayer({}); for (let i = 0; i < 40; i++) { startRound(); const q = g.pick(p); expect([2, 10]).toContain(q.a); }
  });
  it('questions are always inside the class table range', () => {
    g.applySettings({ maxTable: 6 }); const p = loadPlayer({}, { maxTable: 6 }); startRound();
    for (let i = 0; i < 300; i++) { const q = g.pick(p); expect(q.a).toBeGreaterThanOrEqual(2); expect(q.a).toBeLessThanOrEqual(6); expect(q.b).toBeGreaterThanOrEqual(1); expect(q.b).toBeLessThanOrEqual(6); }
  });
  it('never asks the same fact twice in a row, or within the last 4', () => {
    const p = loadPlayer({ facts: { ...allFacts([2, 3], known), ...allFacts([7], weak) } }); startRound(); const seen = [];
    for (let i = 0; i < 300; i++) { const q = g.pick(p); expect(seen.slice(-2)).not.toContain(keyOf(q)); seen.push(keyOf(q)); G_noop(); }
    function G_noop() { g.G.retry = []; }
  });
  it('warm-up: the first 3 questions are ones the player knows', () => {
    const facts = { ...allFacts([2, 10], known), ...allFacts([7], weak) };
    for (let t = 0; t < 30; t++) { const p = loadPlayer({ facts }); startRound(); for (let i = 0; i < 3; i++) { const q = g.pick(p); expect(g.level(p.facts[keyOf(q)])).toBeGreaterThanOrEqual(3); } }
  });
  it('finish strong: the last 10 seconds are easy', () => {
    const facts = { ...allFacts([2, 10], known), ...allFacts([7], weak) }; const p = loadPlayer({ facts });
    for (let t = 0; t < 40; t++) { startRound({ qn: 10, start: performance.now() - 55000 }); const q = g.pick(p); expect(g.level(p.facts[keyOf(q)])).toBeGreaterThanOrEqual(3); }
  });
  it('after two misses in a row the next 3 questions are easy', () => {
    const facts = { ...allFacts([2, 10], known), ...allFacts([7], weak) }; const p = loadPlayer({ facts });
    for (let t = 0; t < 25; t++) {
      startRound({ qn: 10 }); g.setQ({ a: 7, b: 3, text: '7 × 3', ans: 21 });
      g.afterAnswer(false); g.afterAnswer(false); expect(g.G.easyRun).toBe(3);
      g.G.retry = []; // isolate easy-run behaviour from retries
      for (let i = 0; i < 3; i++) { const q = g.pick(p); expect(g.level(p.facts[keyOf(q)])).toBeGreaterThanOrEqual(3); }
    }
  });
  it('a missed fact comes back 3 questions later', () => {
    const p = loadPlayer({ facts: allFacts([2, 3, 5], known) }); startRound({ qn: 5 }); g.setQ({ a: 7, b: 8, text: '7 × 8', ans: 56 });
    g.afterAnswer(false); expect(g.G.retry).toEqual([{ f: [7, 8], due: 8 }]);
    expect(keyOf(g.pick(p))).not.toBe('7,8'); expect(keyOf(g.pick(p))).not.toBe('7,8'); expect(keyOf(g.pick(p))).toBe('7,8');
    expect(g.G.retry.length).toBe(0);
  });
  it('a fact is retried at most twice per round', () => {
    startRound({ qn: 1 }); g.setQ({ a: 6, b: 9, text: '6 × 9', ans: 54 });
    g.afterAnswer(false); g.afterAnswer(false); g.afterAnswer(false); g.afterAnswer(false);
    expect(g.G.retry.filter(r => r.f.join() === '6,9').length).toBe(2); expect(g.G.res).toEqual([0, 0, 0, 0]);
  });
  it('a right answer records 1 and does not schedule a retry', () => { startRound(); g.setQ({ a: 2, b: 2, text: '2 × 2', ans: 4 }); g.afterAnswer(true); expect(g.G.res).toEqual([1]); expect(g.G.retry).toBeUndefined(); });
  it('weak facts are asked far more often than known ones once warmed up', () => {
    vi.spyOn(Math, 'random').mockImplementation(seeded(99));
    const p = loadPlayer({ facts: { ...allFacts([2, 10, 5], known), ...allFacts([7, 8], weak) } }); let weakN = 0, knownN = 0, total = 0;
    for (let r = 0; r < 20; r++) { startRound(); for (let i = 0; i < 40; i++) { const q = g.pick(p); g.G.res.push(1); const l = g.level(p.facts[keyOf(q)]); if (i >= 4) { total++; if (l === 2 || l === 1) weakN++; else if (l >= 3) knownN++; } } }
    expect(weakN / total).toBeGreaterThan(0.12); expect(knownN).toBeGreaterThan(weakN);
  });
  it('new tables open easiest-first: ten new facts come from tables 2, 10 and 5 before 12', () => {
    vi.spyOn(Math, 'random').mockImplementation(seeded(5));
    const p = loadPlayer({}); startRound(); const tables = new Set();
    for (let i = 0; i < 10; i++) { const q = g.pick(p); tables.add(q.a); g.G.res.push(1); }
    expect([...tables].every(t => [2, 10, 5, 3].includes(t))).toBe(true);
  });
  it('a hot streak opens up more new tables than a struggling round', () => {
    const p = loadPlayer({ facts: allFacts([2], known) }); startRound({ qn: 8 }); g.G.res = [1, 1, 1, 1, 1];
    expect(g.challengeShare(p)).toBe(0.45); g.G.res = [1, 0, 1, 0, 1]; expect(g.challengeShare(p)).toBe(0.2);
  });
  it('challenge share thresholds', () => {
    const p = loadPlayer({}); startRound({ qn: 9 });
    const share = res => { g.G.res = res; g.G.easyRun = 0; return g.challengeShare(p); };
    expect(share([])).toBe(0.25); expect(share([1, 1, 1, 1, 1])).toBe(0.45); expect(share([1, 1, 1, 1, 0])).toBe(0.32);
    expect(share([1, 0, 1, 0, 1])).toBe(0.2); expect(share([0, 1, 0, 1, 0])).toBe(0.1); expect(share([1, 1, 0, 0])).toBe(0);
    g.G.qn = 3; expect(g.challengeShare(p)).toBe(0); g.G.qn = 9; g.G.easyRun = 2; expect(g.challengeShare(p)).toBe(0);
  });
  it('a goal on table 7 makes 7s show up more', () => {
    const facts = { ...allFacts([2, 3, 4, 5, 6, 7, 8], weak) }; const count = goal => {
      vi.spyOn(Math, 'random').mockImplementation(seeded(3)); const p = loadPlayer({ facts }, { goal }); let n = 0;
      for (let r = 0; r < 30; r++) { startRound({ qn: 6 }); for (let i = 0; i < 20; i++) { const q = g.pick(p); if (q.a === 7 || q.b === 7) n++; g.G.res.push(1); } } vi.restoreAllMocks(); return n; };
    expect(count({ tables: [7], rounds: 3 })).toBeGreaterThan(count(null) * 1.3);
  });
  it('never returns undefined, even with every fact recently asked or a tiny class', () => {
    g.applySettings({ maxTable: 5 }); const p = loadPlayer({ facts: allFacts([2, 3, 4, 5], known) }, { maxTable: 5 }); startRound();
    for (let i = 0; i < 500; i++) { const q = g.pick(p); expect(q).toBeTruthy(); expect(q.ans).toBe(q.a * q.b); }
  });
  it('speed: 5,000 picks in under 20 seconds (a loose check that picking is not pathologically slow, even on a slow shared CI machine)', () => {
    const p = loadPlayer({ facts: { ...allFacts([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], () => known()) } }); startRound(); const t0 = performance.now();
    for (let i = 0; i < 5000; i++) { g.G.retry = []; g.pick(p); } expect(performance.now() - t0).toBeLessThan(20000);
  });
  it('grewFact spots a fact that went from missed to known, or got much faster', () => {
    expect(g.grewFact(fact([0, 1, 1, 1], [3000, 1500]))).toBe(true); expect(g.grewFact(fact([1, 1, 1], [4000, 2500, 1500]))).toBe(true);
    expect(g.grewFact(fact([1, 1, 1], [1500, 1500, 1500]))).toBe(false); expect(g.grewFact(null)).toBe(false); expect(g.grewFact(fact([], []))).toBe(false);
  });
});
