import { describe, it, expect } from 'vitest';
import { rowsFromPlayers, series, change, chartHTML, miniHTML, cellsHTML, mondayKey } from '../src/progress.js';

const DAY = 864e5;
// Monday 2 Nov 2026, noon local time: a fixed "now" so weeks are predictable
const NOW = new Date(2026, 10, 9, 12).getTime();
const at = (daysAgo) => NOW - daysAgo * DAY;
const rnd = (daysAgo, c, ms = 3000, n = c + 2) => ({ d: at(daysAgo), c, n, ms, len: 60 });

describe('progress curves', () => {
  it('groups rounds into Monday weeks and averages per student, not per round', () => {
    const busy = { rounds: [rnd(1, 10), rnd(1.1, 10), rnd(1.2, 10), rnd(1.3, 10)] };   // 4 rounds of 10
    const quiet = { rounds: [rnd(2, 20)] };                                              // 1 round of 20
    const rows = rowsFromPlayers([busy, quiet], NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ students: 2, rounds: 5 });
    const s = series(rows);
    expect(s[0].c).toBeCloseTo(15, 5);            // (10 + 20) / 2, not the round average (12)
  });

  it('ignores short rounds (under 8 answers) and bad data', () => {
    const rows = rowsFromPlayers([{ rounds: [rnd(1, 5, 3000, 5), { d: 'x', c: 3, n: 9, ms: 1 }, null, { d: at(1), c: -1, n: 9, ms: 100 }] }], NOW);
    expect(rows).toEqual([]);
  });

  it('seconds per correct answer weights by correct answers within a student', () => {
    const p = { rounds: [rnd(1, 10, 2000), rnd(1.1, 30, 4000)] };   // (2*10 + 4*30) / 40 = 3.5
    expect(series(rowsFromPlayers([p], NOW))[0].secs).toBeCloseTo(3.5, 5);
  });

  it('shows more correct answers and faster answers as getting better', () => {
    const p = { rounds: [rnd(30, 10, 4500), rnd(23, 12, 4200), rnd(16, 14, 3800), rnd(9, 17, 3400), rnd(2, 20, 3000)] };
    const s = series(rowsFromPlayers([p], NOW));
    expect(s.length).toBeGreaterThanOrEqual(4);
    const ch = change(s);
    expect(ch.dc).toBeCloseTo(10, 5);
    expect(ch.faster).toBeCloseTo(1.5, 5);
    expect(ch.verdict).toBe('better');
    expect(chartHTML(s)).toContain('Getting better');
  });

  it('flags slipping, and flat', () => {
    const down = series(rowsFromPlayers([{ rounds: [rnd(20, 20, 3000), rnd(2, 12, 4000)] }], NOW));
    expect(change(down).verdict).toBe('worse');
    const flat = series(rowsFromPlayers([{ rounds: [rnd(20, 15, 3000), rnd(2, 15.2 | 0, 3000)] }], NOW));
    expect(change(flat).verdict).toBe('flat');
  });

  it('needs two different weeks before it draws a curve', () => {
    const one = series(rowsFromPlayers([{ rounds: [rnd(1, 15), rnd(2, 16)] }], NOW));
    expect(change(one)).toBeNull();
    expect(chartHTML(one)).toContain('Not enough rounds yet');
    expect(miniHTML(one)).toContain('Not enough data');
    expect(cellsHTML(one)[0]).toContain('–');
  });

  it('combines class rows into a school the same way (students weighted equally)', () => {
    const a = [{ wk: '2026-11-02', students: 1, rounds: 3, c_sum: 10, s_sum: 4, s_n: 1 }, { wk: '2026-11-09', students: 1, rounds: 3, c_sum: 12, s_sum: 3.8, s_n: 1 }];
    const b = [{ wk: '2026-11-02', students: 3, rounds: 9, c_sum: 60, s_sum: 9, s_n: 3 }, { wk: '2026-11-09', students: 3, rounds: 9, c_sum: 66, s_sum: 8.4, s_n: 3 }];
    const s = series([...a, ...b]);
    expect(s).toHaveLength(2);
    expect(s[0].c).toBeCloseTo(70 / 4, 5);
    expect(s[0].secs).toBeCloseTo(13 / 4, 5);
    expect(s[1].students).toBe(4);
  });

  it('a mistimed or hostile row cannot break the page', () => {
    const s = series([{ wk: '2026-11-02', students: 'x', rounds: null, c_sum: undefined, s_sum: NaN, s_n: -1 }]);
    expect(() => chartHTML(s)).not.toThrow();
    expect(() => miniHTML(s)).not.toThrow();
  });

  it('weeks start on Monday', () => {
    expect(mondayKey(new Date(2026, 10, 8, 23).getTime())).toBe('2026-11-02');   // Sunday
    expect(mondayKey(new Date(2026, 10, 9, 0, 5).getTime())).toBe('2026-11-09'); // Monday
  });
});
