import { __test as g } from '../src/game.js';
// A deterministic random generator (so statistical tests do not flake).
export function seeded(seed = 12345) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
export const fact = (rights, times, last = Date.now()) => ({ r: rights, t: times, last });
// A fully "known" fact (accuracy 100%, ~1.2 s) and a weak one (60% right, slow)
export const known = () => fact([1, 1, 1, 1, 1], [1100, 1200, 1300, 1200, 1100]);
export const weak = () => fact([0, 1, 0, 1, 1], [5200, 4800, 5400]);
export function loadPlayer(data = {}, settings = {}, classmates = []) {
  g.applyState({ class: { id: 'c1', name: 'Test class', settings }, me: { id: 'me', name: 'Comet Fox', data }, classmates });
  return g.S.players.me;
}
export function startRound(extra = {}) {
  g.resetRecent();
  g.setG({ mode: 'round', start: performance.now(), len: 60000, c: 0, n: 0, ms: 0, log: [], res: [], qn: 0, ...extra });
  return g.G;
}
