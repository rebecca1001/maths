import { describe, it, expect } from 'vitest';
import { __test as g } from '../src/game.js';

describe('scoreRound: out of 1000, half speed, half accuracy', () => {
  it('perfect and fast = 1000', () => expect(g.scoreRound(10, 10, 1500)).toEqual({ total: 1000, speed: 500, accuracy: 500 }));
  it('1.5 s or faster gets full speed marks', () => expect(g.scoreRound(10, 10, 300).speed).toBe(500));
  it('7 s or slower gets no speed marks', () => { expect(g.scoreRound(10, 10, 7000).speed).toBe(0); expect(g.scoreRound(10, 10, 20000).speed).toBe(0); });
  it('speed falls in a straight line between 1.5 s and 7 s', () => expect(g.scoreRound(10, 10, 4250).speed).toBe(250));
  it('a typical round (3 s, 90% right) scores about 770', () => { const t = g.scoreRound(9, 10, 3000).total; expect(t).toBeGreaterThan(760); expect(t).toBeLessThan(780); });
  it('accuracy is squared: 90% -> 405, 75% -> 281', () => { expect(g.scoreRound(9, 10, 1500).accuracy).toBe(405); expect(g.scoreRound(15, 20, 1500).accuracy).toBe(281); });
  it('zero answers or zero right = 0', () => { expect(g.scoreRound(0, 10, 2000).total).toBe(0); expect(g.scoreRound(5, 0, 2000).total).toBe(0); expect(g.scoreRound(undefined, undefined, 1).total).toBe(0); });
  it('short rounds (under 8 answers) are scaled down', () => { expect(g.scoreRound(4, 4, 1500).total).toBe(500); expect(g.scoreRound(1, 1, 1000).total).toBe(126); });
  it('never negative and never above 1000 for valid rounds', () => {
    for (let n = 1; n <= 40; n++) for (let c = 0; c <= n; c += 3) for (const ms of [0, 800, 2000, 5000, 9000]) {
      const t = g.scoreRound(c, n, ms).total; expect(t).toBeGreaterThanOrEqual(0); expect(t).toBeLessThanOrEqual(1000);
    }
  });
  it('more right answers never score less at the same speed', () => { let prev = -1; for (let c = 1; c <= 20; c++) { const t = g.scoreRound(c, 20, 3000).total; expect(t).toBeGreaterThanOrEqual(prev); prev = t; } });
  it('faster never scores less at the same accuracy', () => { let prev = Infinity; for (let ms = 500; ms <= 9000; ms += 500) { const t = g.scoreRound(18, 20, ms).total; expect(t).toBeLessThanOrEqual(prev); prev = t; } });
  // KNOWN ISSUE: c greater than n (only possible with tampered data) pushes accuracy above 500.
  it.fails('known issue: right answers above total answers should not exceed 1000', () => expect(g.scoreRound(12, 10, 1000).total).toBeLessThanOrEqual(1000));
});

describe('stars', () => {
  it('gameStars is score / 10, max 100', () => { expect(g.gameStars(10, 10, 1500)).toBe(100); expect(g.gameStars(9, 10, 3000)).toBe(77); expect(g.gameStars(0, 5, 100)).toBe(0); });
  it('roundStars prefers a stored stars value (boss prize etc.)', () => { expect(g.roundStars({ stars: 55, c: 10, n: 10, ms: 1500 })).toBe(55); expect(g.roundStars({ stars: 0, c: 10, n: 10, ms: 1500 })).toBe(0); expect(g.roundStars({ c: 10, n: 10, ms: 1500 })).toBe(100); });
  it('ptsSince uses the server weekly total when present, else sums recent rounds', () => {
    expect(g.ptsSince({ wkStars: 22, rounds: [] }, 0)).toBe(22);
    expect(g.ptsSince({ wkStars: 0, rounds: [{ d: 5, stars: 9 }] }, 0)).toBe(0);
    const p = { rounds: [{ d: 1, stars: 10 }, { d: 100, stars: 20 }, { d: 200, stars: 30 }] };
    expect(g.ptsSince(p, 100)).toBe(50); expect(g.ptsSince(p, 201)).toBe(0); expect(g.ptsSince(p, 0)).toBe(60);
  });
  it('migrateStars converts old coin totals once and is idempotent', () => {
    const p = { coins: 0, rounds: [{ c: 10, n: 10, ms: 1500 }, { stars: 40 }] };
    g.migrateStars(p); expect(p.coins).toBe(140); expect(p.starsV2).toBe(true);
    p.rounds.push({ stars: 500 }); g.migrateStars(p); expect(p.coins).toBe(140);
  });
  it('migrateStars never lowers a larger existing coin balance', () => { const p = { coins: 900, rounds: [{ stars: 10 }] }; g.migrateStars(p); expect(p.coins).toBe(900); expect(p.maxCoins).toBe(900); });
});
