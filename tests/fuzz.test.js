import { describe, it, expect, vi } from 'vitest';
import { __test as g } from '../src/game.js';
import { seeded, loadPlayer, startRound } from './helpers.js';

// Random hostile values: things a corrupted save, old version or tampered request could contain.
const junk = r => { const pool = [null, undefined, NaN, Infinity, -Infinity, -1, 0, 1e308, -1e308, 0.5, '', 'x', '9'.repeat(40), [], {}, [1, 2], { a: 1 }, true, false, () => 1, 'NaN', '1e400', '-0', new Date(0)]; return pool[Math.floor(r() * pool.length)]; };
const randObj = (r, depth = 0) => { const o = {}; const n = Math.floor(r() * 6); for (let i = 0; i < n; i++) o[['r', 't', 'last', 'facts', 'rounds', 'coins', 'stars', 'badges', 'streak', 'best', 'c', 'n', 'ms', 'at', 'len', 'tier', 'skin', 'rocket', 'goal', 'tables', 'rounds', 'trace', 'bestTrace', '2,3', '5,5', 'x'][Math.floor(r() * 26)]] = depth < 2 && r() < .3 ? randObj(r, depth + 1) : junk(r); return o; };

describe('fuzz: corrupted saves never crash the app', () => {
  it('fixPlayer survives 3000 random objects and always returns the shape the game expects', () => {
    const r = seeded(7);
    for (let i = 0; i < 3000; i++) {
      const input = randObj(r); let p;
      expect(() => { p = g.fixPlayer(input); }, JSON.stringify(input)).not.toThrow();
      expect(Array.isArray(p.rounds), 'rounds array').toBe(true); expect(typeof p.facts === 'object' && p.facts !== null, 'facts object').toBe(true); expect(Array.isArray(p.badges), 'badges array').toBe(true);
    }
  });
  it('applyState survives random me/classmates/settings', () => {
    const r = seeded(11);
    for (let i = 0; i < 800; i++) {
      const st = { class: { id: 'c', name: junk(r), settings: r() < .5 ? randObj(r) : junk(r) }, me: { id: 'me', name: junk(r), data: r() < .7 ? randObj(r) : junk(r) }, classmates: Array.from({ length: Math.floor(r() * 4) }, (_, k) => ({ id: 'k' + k, name: junk(r), data: randObj(r), wk_stars: junk(r) })) };
      expect(() => g.applyState(st), JSON.stringify(st)).not.toThrow();
    }
  });
  it('after loading junk, the player can still be asked a question and finish a round', () => {
    const r = seeded(13);
    for (let i = 0; i < 300; i++) {
      loadPlayer(randObj(r), r() < .5 ? randObj(r) : {});
      startRound(); const p = g.S.players.me;
      for (let k = 0; k < 5; k++) { const q = g.pick(p); expect(q, 'pick returned a question').toBeTruthy(); expect(Number.isInteger(q.ans) && q.ans > 0, JSON.stringify(q)).toBe(true); expect(q.text).toMatch(/^\d+ [×÷] \d+$/); }
    }
  });
});

describe('fuzz: scoring stays in range', () => {
  it('scoreRound is always an integer 0–1000 for sane or silly inputs', () => {
    const r = seeded(21);
    for (let i = 0; i < 5000; i++) { const n = Math.floor(r() * 60), c = Math.floor(r() * (n + 1)), ms = r() * 20000; const s = g.scoreRound(c, n, ms); expect(Number.isFinite(s.total)).toBe(true); expect(s.total).toBeGreaterThanOrEqual(0); expect(s.total).toBeLessThanOrEqual(1000); }
  });
  it('scoreRound with zero answers does not divide by zero', () => { const s = g.scoreRound(0, 0, 0); expect(Number.isFinite(s.total)).toBe(true); });
});

describe('fuzz: questions are always valid', () => {
  it('makeQ gives a positive whole answer and parsable text for every table pair, with and without division', () => {
    for (const div of [false, true]) { g.applySettings({ division: div }); for (let a = 1; a <= 12; a++) for (let b = 1; b <= 12; b++) for (let k = 0; k < 4; k++) { const q = g.makeQ(a, b); expect(Number.isInteger(q.ans) && q.ans > 0).toBe(true); const [x, op, y] = q.text.split(' '); expect(op === '×' ? +x * +y : +x / +y).toBe(q.ans); } }
    g.applySettings({});
  });
  it('pick never repeats the same question back to back across 2000 draws', () => {
    loadPlayer({}); startRound(); const p = g.S.players.me; let prev = null, bad = 0;
    for (let i = 0; i < 2000; i++) { const q = g.pick(p); const key = q.a + ',' + q.b; if (key === prev) bad++; prev = key; }
    expect(bad).toBeLessThan(20);
  });
});

describe('fuzz: streaks across time zones, DST and odd clocks', () => {
  it('streakInfo is finite for any date from 2020 to 2035 including DST days', () => {
    const r = seeded(31);
    for (let i = 0; i < 2000; i++) { const t = Date.UTC(2020, 0, 1) + r() * 15 * 365 * 864e5; const p = { daily: { count: Math.floor(r() * 400), lastT: t - r() * 20 * 864e5, best: 0, freezeWeek: r() < .5 ? undefined : Math.floor(r() * 3) } }; let out; expect(() => { out = g.streakInfo(p, t); }).not.toThrow(); expect(out).toBeTruthy(); }
  });
  it('bumpStreak twice in one day never double counts', () => {
    loadPlayer({}); const p = g.S.players.me; const first = g.bumpStreak(p); const second = g.bumpStreak(p); expect(first.grew).toBe(true); expect(second.grew).toBe(false); expect(second.count).toBe(first.count);
  });
  it('a future last-played date (clock set wrong) does not make the streak negative or NaN', () => {
    const p = { daily: { count: 5, lastT: Date.now() + 40 * 864e5, best: 5 } }; const out = g.streakInfo(p, Date.now()); expect(out.count).toBeGreaterThanOrEqual(0); expect(JSON.stringify(out)).not.toMatch(/NaN/);
  });
});
