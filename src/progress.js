// Progress curves: are students getting faster, and getting more answers right per round? (Not minutes played.)
// Pure functions only (no page access), so they can be tested on their own.
//
// A "row" is one class in one week:
//   { wk:'YYYY-MM-DD' (Monday), students, rounds, c_sum, s_sum, s_n }
//   c_sum = sum over students of that student's average correct answers per round that week
//   s_sum = sum over students of that student's average seconds per correct answer (s_n = students that have one)
// Every student counts equally, so one very busy child cannot swing a class or a school.
// Only rounds with 8+ answers count. The database makes the same rows for schools (see progress_curves.sql).

export const WEEKS = 10;
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDay = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export function mondayKey(t) { const d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return ymd(d); }
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const weekLabel = (wk) => { const d = parseDay(wk); return `${MON[d.getMonth()]} ${d.getDate()}`; };
const weeksBetween = (a, b) => Math.round((parseDay(b) - parseDay(a)) / (7 * 864e5));

// Rows for one class, worked out in the browser from the students' saved rounds
export function rowsFromPlayers(players, now = Date.now()) {
  const first = parseDay(mondayKey(now)); first.setDate(first.getDate() - 7 * (WEEKS - 1));
  const firstKey = ymd(first), by = {};
  for (const p of players) {
    const per = {};
    for (const r of (p && p.rounds) || []) {
      if (!r || !(r.n >= 8) || !(r.c >= 0) || !(r.ms >= 0) || typeof r.d !== 'number') continue;
      const wk = mondayKey(r.d); if (wk < firstKey) continue;
      const w = per[wk] || (per[wk] = { rounds: 0, c: 0, mc: 0 });
      w.rounds++; w.c += r.c; w.mc += r.ms * r.c;
    }
    for (const [wk, w] of Object.entries(per)) {
      const o = by[wk] || (by[wk] = { wk, students: 0, rounds: 0, c_sum: 0, s_sum: 0, s_n: 0 });
      o.students++; o.rounds += w.rounds; o.c_sum += w.c / w.rounds;
      if (w.c > 0) { o.s_sum += w.mc / w.c / 1000; o.s_n++; }
    }
  }
  return Object.values(by);
}

// Combine rows (one class, a whole school, or everything) into one point per week
export function series(rows) {
  const by = {};
  for (const r of rows || []) {
    const o = by[r.wk] || (by[r.wk] = { wk: r.wk, students: 0, rounds: 0, c_sum: 0, s_sum: 0, s_n: 0 });
    o.students += +r.students || 0; o.rounds += +r.rounds || 0; o.c_sum += +r.c_sum || 0; o.s_sum += +r.s_sum || 0; o.s_n += +r.s_n || 0;
  }
  return Object.values(by).sort((a, b) => (a.wk < b.wk ? -1 : 1)).map((o) => ({
    wk: o.wk, students: o.students, rounds: o.rounds,
    c: o.students ? o.c_sum / o.students : null,
    secs: o.s_n ? o.s_sum / o.s_n : null,
  }));
}

// First week with data against the latest week. Positive dc = more right per round; positive faster = quicker answers.
export function change(s) {
  const pc = s.filter((x) => x.c != null), ps = s.filter((x) => x.secs != null);
  if (pc.length < 2) return null;
  const a = pc[0], b = pc[pc.length - 1];
  const sa = ps.length >= 2 ? ps[0] : null, sb = ps.length >= 2 ? ps[ps.length - 1] : null;
  const dc = b.c - a.c, faster = sa && sb ? sa.secs - sb.secs : null;
  const better = (dc > 0.5 ? 1 : dc < -0.5 ? -1 : 0) + (faster == null ? 0 : faster > 0.2 ? 1 : faster < -0.2 ? -1 : 0);
  const verdict = better > 0 ? 'better' : better < 0 ? 'worse' : 'flat';
  return { from: a.wk, to: b.wk, c0: a.c, c1: b.c, dc, s0: sa && sa.secs, s1: sb && sb.secs, faster, verdict, weeks: weeksBetween(a.wk, b.wk) };
}
export const VERDICT = { better: 'Getting better', worse: 'Slipping', flat: 'About the same' };
const f1 = (n) => n.toFixed(1);
const signed = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toFixed(1);

// A line chart. valueKey: 'c' (up is better) or 'secs' (drawn upside down, so a rising line always means better)
function lineSVG(s, valueKey, label, unit) {
  const pts = s.filter((x) => x[valueKey] != null);
  const W = 300, H = 120, L = 34, R = 10, T = 12, B = 22;
  if (pts.length < 2) return `<div class="pc-empty muted small">${label}: needs rounds in 2 different weeks.</div>`;
  const vals = pts.map((x) => x[valueKey]);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const padv = Math.max((hi - lo) * 0.15, valueKey === 'c' ? 0.5 : 0.2); lo = Math.max(0, lo - padv); hi += padv;
  const span = weeksBetween(pts[0].wk, pts[pts.length - 1].wk) || 1;
  const X = (wk) => L + (weeksBetween(pts[0].wk, wk) / span) * (W - L - R);
  const frac = (v) => (valueKey === 'secs' ? (hi - v) / (hi - lo) : (v - lo) / (hi - lo));
  const Y = (v) => T + (1 - frac(v)) * (H - T - B);
  const line = pts.map((x) => `${X(x.wk).toFixed(1)},${Y(x[valueKey]).toFixed(1)}`).join(' ');
  const dots = pts.map((x) => `<circle cx="${X(x.wk).toFixed(1)}" cy="${Y(x[valueKey]).toFixed(1)}" r="3.5" fill="var(--accent)"><title>Week of ${weekLabel(x.wk)}: ${f1(x[valueKey])} ${unit} · ${x.students} student${x.students === 1 ? '' : 's'} · ${x.rounds} round${x.rounds === 1 ? '' : 's'}</title></circle>`).join('');
  const top = valueKey === 'secs' ? lo : hi, bot = valueKey === 'secs' ? hi : lo;
  return `<svg class="pc-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}, ${f1(vals[0])} to ${f1(vals[vals.length - 1])} ${unit}">
    <line x1="${L}" y1="${T}" x2="${W - R}" y2="${T}" class="pc-grid"/><line x1="${L}" y1="${H - B}" x2="${W - R}" y2="${H - B}" class="pc-grid"/>
    <text x="${L - 5}" y="${T + 4}" text-anchor="end" class="pc-t">${f1(top)}</text><text x="${L - 5}" y="${H - B + 4}" text-anchor="end" class="pc-t">${f1(bot)}</text>
    <text x="${L}" y="${H - 6}" text-anchor="start" class="pc-t">${weekLabel(pts[0].wk)}</text><text x="${W - R}" y="${H - 6}" text-anchor="end" class="pc-t">${weekLabel(pts[pts.length - 1].wk)}</text>
    <polyline points="${line}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>${dots}</svg>`;
}

// The full card body: a one-line verdict, the two numbers, and the two curves
export function chartHTML(s) {
  const ch = change(s);
  if (!ch) return '<p class="muted">Not enough rounds yet. The curve appears once students have played rounds in at least 2 different weeks.</p>';
  const head = `<div class="pc-head"><span class="pc-verdict ${ch.verdict}">${VERDICT[ch.verdict]}</span><span class="muted small">Week of ${weekLabel(ch.from)} → week of ${weekLabel(ch.to)}</span></div>`;
  const nums = `<div class="pc-nums">
    <div><span class="label">Correct answers per round</span><b>${f1(ch.c0)} → ${f1(ch.c1)}</b><small class="${ch.dc > 0.5 ? 'up' : ch.dc < -0.5 ? 'down' : ''}">${signed(ch.dc)}</small></div>
    <div><span class="label">Seconds per correct answer</span>${ch.faster == null ? '<b>–</b>' : `<b>${f1(ch.s0)} → ${f1(ch.s1)}</b><small class="${ch.faster > 0.2 ? 'up' : ch.faster < -0.2 ? 'down' : ''}">${Math.abs(ch.faster) < 0.05 ? 'no change' : f1(Math.abs(ch.faster)) + ' s ' + (ch.faster > 0 ? 'faster' : 'slower')}</small>`}</div></div>`;
  const charts = `<div class="pc-charts"><figure><figcaption>Correct answers per round <span class="muted">(higher is better)</span></figcaption>${lineSVG(s, 'c', 'Correct answers per round', 'correct per round')}</figure>
    <figure><figcaption>Speed <span class="muted">(higher on the chart is faster)</span></figcaption>${lineSVG(s, 'secs', 'Seconds per correct answer', 's per answer')}</figure></div>`;
  return head + nums + charts + '<p class="muted small pc-note">Each student counts equally: the average of each student\'s rounds that week, rounds with 8 or more answers only. Minutes played are not counted.</p>';
}

// Tiny trend for tables: the correct-answers curve plus a verdict word
export function miniHTML(s) {
  const ch = change(s);
  if (!ch) return '<span class="muted small">Not enough data</span>';
  const pts = s.filter((x) => x.c != null), vals = pts.map((x) => x.c), lo = Math.min(...vals), hi = Math.max(...vals), sp = Math.max(hi - lo, 0.5);
  const W = 70, H = 24, span = weeksBetween(pts[0].wk, pts[pts.length - 1].wk) || 1;
  const line = pts.map((x) => `${(3 + (weeksBetween(pts[0].wk, x.wk) / span) * (W - 6)).toFixed(1)},${(H - 3 - ((x.c - lo) / sp) * (H - 6)).toFixed(1)}`).join(' ');
  return `<span class="pc-mini"><svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true"><polyline points="${line}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg><span class="pc-verdict ${ch.verdict}">${VERDICT[ch.verdict]}</span></span>`;
}
// Table cells: "12.4 → 15.1 (+2.7)" and "4.1 → 3.4 s"
export function cellsHTML(s) {
  const ch = change(s);
  if (!ch) return ['<td class="r muted">–</td>', '<td class="r muted">–</td>'];
  return [`<td class="r">${f1(ch.c0)} → <b>${f1(ch.c1)}</b> <small class="${ch.dc > 0.5 ? 'up' : ch.dc < -0.5 ? 'down' : ''}">${signed(ch.dc)}</small></td>`,
    ch.faster == null ? '<td class="r muted">–</td>' : `<td class="r">${f1(ch.s0)} → <b>${f1(ch.s1)}</b> s <small class="${ch.faster > 0.2 ? 'up' : ch.faster < -0.2 ? 'down' : ''}">${Math.abs(ch.faster) < 0.05 ? '' : f1(Math.abs(ch.faster)) + (ch.faster > 0 ? ' faster' : ' slower')}</small></td>`];
}
