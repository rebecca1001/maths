// Pilot scorecards (MathWizz owner only). A pilot class tries MathWizz against agreed success criteria;
// meeting 3 of the 4 moves the school to a paid plan. The database works out the scorecard
// (public._pilot_scorecard); demoPilotScore() mirrors it for the browser-only demo.
const DAY = 864e5;
const pct = (n) => (n == null ? '–' : `${Math.round(n)}%`);
const num = (n) => (n == null ? '–' : Number(n).toLocaleString('en-CA', { maximumFractionDigits: 1 }));
const sign = (n) => (n == null ? '–' : `${n >= 0 ? '+' : ''}${num(n)}%`);
const dayStart = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d).getTime(); };
export const shortDay = (s) => new Date(dayStart(s)).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });

// The four criteria as display rows: {key, label, target, value, detail, state}
// state: met | missed | progress (still running, not met yet) | waiting (no data yet)
export function pilotRows(score) {
  const fin = score.phase === 'finished', before = score.phase === 'before';
  const st = (met, hasData, possible = true) => (met ? 'met' : before || !hasData ? 'waiting' : fin || !possible ? 'missed' : 'progress');
  const u = score.usage, f = score.fluency, e = score.every_child, c = score.competitions;
  const doneWeeks = (u.weeks || []).filter((w) => w.state === 'done').length;
  const last = (u.weeks || []).filter((w) => w.state !== 'future').slice(-1)[0];
  const best = (c.list || [])[0];
  return [
    { key: 'usage', label: 'Regular use', target: `70% play 3+ days a week, in ${u.weeks_needed} of ${(u.weeks || []).length} weeks`,
      value: `${u.weeks_met} of ${doneWeeks} finished week${doneWeeks === 1 ? '' : 's'} met`,
      detail: last ? `${last.state === 'now' ? 'This week so far' : 'Latest week'}: ${pct(last.pct)} (${last.active} of ${last.students})` : 'Starts with the first pilot week',
      state: st(u.met, doneWeeks > 0, u.still_possible) },
    { key: 'fluency', label: 'Class fluency', target: '+15% correct answers per minute',
      value: f.change == null ? '–' : `${sign(f.change)}`,
      detail: `Baseline ${num(f.baseline)} → now ${num(f.now)} correct per minute`,
      state: st(f.met, f.change != null) },
    { key: 'every_child', label: 'Every child improves', target: '70% beat their own baseline',
      value: e.pct == null ? '–' : pct(e.pct),
      detail: e.eligible ? `${e.improved} of ${e.eligible} students with rounds in both periods` : 'Needs 2+ rounds per student in the baseline and the latest week',
      state: st(e.met, !!e.eligible) },
    { key: 'competitions', label: 'Competitions', target: '60% of the class plays during one',
      value: best ? pct(c.best) : 'None yet',
      detail: best ? `Best: "${best.title}"${(c.list || []).length > 1 ? ` (${c.list.length} run)` : ''}` : 'Run a class competition during the pilot',
      state: st(c.met, !!best) },
  ];
}

export function pilotHeadline(score) {
  if (score.phase === 'before') return { text: 'Not started', state: 'waiting' };
  if (score.phase === 'finished') return score.passed ? { text: `Passed: ${score.met} of 4 met`, state: 'met' } : { text: `Not passed: ${score.met} of 4 met (needs 3)`, state: 'missed' };
  return { text: `${score.met} of 4 met so far (needs 3)`, state: score.met >= 3 ? 'met' : 'progress' };
}

// Which pilot week it is, e.g. "Week 2 of 4"
export function weekLabel(p, now = Date.now()) {
  const s = dayStart(p.starts_on), weeks = Math.max(1, Math.ceil((dayStart(p.ends_on) - s + DAY) / (7 * DAY)));
  if (now < s) return 'Starts ' + shortDay(p.starts_on);
  if (now >= dayStart(p.ends_on) + DAY) return 'Finished';
  return `Week ${Math.min(weeks, Math.floor((now - s) / (7 * DAY)) + 1)} of ${weeks}`;
}

// Plain-text Friday update for the teacher and principal
export function weeklyText(p, now = Date.now()) {
  const sc = p.score, rows = pilotRows(sc), mark = { met: 'met', missed: 'not met', progress: 'not yet', waiting: 'no data yet' };
  const lines = [
    `${p.school_name}: MathWizz pilot, ${p.class_name}`,
    `${weekLabel(p, now)} (${shortDay(p.starts_on)} to ${shortDay(p.ends_on)})`,
    '',
    ...rows.map((r, i) => `${i + 1}. ${r.label}: ${r.value}. ${r.detail}. Target: ${r.target}. (${mark[r.state]})`),
  ];
  if (sc.bonus) lines.push('Bonus: another teacher has asked to use MathWizz.');
  lines.push('', `${pilotHeadline(sc).text}.`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Demo scoring (mirrors the database). students: [{id, class_id, data:{rounds:[{d,c}], demo}}]
// competitions: raw demo competitions [{class_id, title, kind, starts_at, ends_at, ended_at}]
// ---------------------------------------------------------------------------
export function demoPilotScore(p, students, competitions, opts = {}) {
  const now = opts.now ?? Date.now();
  const start = dayStart(p.starts_on), end = dayStart(p.ends_on) + DAY, base = start - (p.baseline_days || 14) * DAY;
  const upto = Math.min(now, end), recent = Math.max(start, upto - 7 * DAY);
  const kids = students.filter((s) => s.class_id === p.class_id && (opts.includeDemo || !(s.data && s.data.demo)));
  const n = kids.length, rounds = (s) => ((s.data && s.data.rounds) || []).filter((r) => typeof r.d === 'number');
  const weeks = Math.max(1, Math.ceil((end - start) / (7 * DAY))), need = Math.ceil(weeks * 0.75);
  const phase = now < start ? 'before' : now >= end ? 'finished' : 'running';
  const wk = Array.from({ length: weeks }, (_, i) => {
    const from = start + i * 7 * DAY, to = Math.min(start + (i + 1) * 7 * DAY, end);
    const active = kids.filter((s) => new Set(rounds(s).filter((r) => r.d >= from && r.d < to).map((r) => new Date(r.d).toDateString())).size >= 3).length;
    const state = now < from ? 'future' : now < to ? 'now' : 'done', p100 = n ? Math.round((100 * active) / n) : 0;
    return { i, from: new Date(from).toISOString(), to: new Date(to).toISOString(), state, active, students: n, pct: p100, met: state === 'done' && p100 >= 70 };
  });
  const weeksMet = wk.filter((w) => w.met).length;
  const avg = (a) => (a.length ? a.reduce((t, x) => t + x, 0) / a.length : null);
  const per = kids.map((s) => {
    const b = rounds(s).filter((r) => r.d >= base && r.d < start).map((r) => r.c || 0), r = rounds(s).filter((x) => x.d >= recent && x.d < upto).map((x) => x.c || 0);
    return { b: avg(b), bn: b.length, r: avg(r), rn: r.length };
  });
  const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100);
  const baseCpm = r2(avg(per.filter((x) => x.bn > 0).map((x) => x.b))), nowCpm = r2(avg(per.filter((x) => x.rn > 0).map((x) => x.r)));
  const change = baseCpm > 0 && nowCpm != null && now >= start ? Math.round(1000 * (nowCpm / baseCpm - 1)) / 10 : null;
  const elig = per.filter((x) => x.bn >= 2 && x.rn >= 2), impr = elig.filter((x) => x.r > x.b).length;
  const comps = competitions
    .filter((c) => (!c.class_id || c.class_id === p.class_id) && Date.parse(c.starts_at) < end && Date.parse(c.ended_at || c.ends_at) > start)
    .map((c) => {
      const from = Math.max(Date.parse(c.starts_at), start), to = Math.min(Date.parse(c.ended_at || c.ends_at), end, now);
      const played = kids.filter((s) => rounds(s).some((r) => r.d >= from && r.d < to)).length;
      return { title: c.title, kind: c.kind, pct: n ? Math.round((100 * played) / n) : 0 };
    })
    .sort((a, b) => b.pct - a.pct);
  const best = comps.length ? comps[0].pct : null;
  const c1 = weeksMet >= need, c2 = change != null && change >= 15, c3 = elig.length > 0 && (impr * 100) / elig.length >= 70, c4 = best != null && best >= 60;
  const met = [c1, c2, c3, c4].filter(Boolean).length;
  return {
    phase, students: n, met, needed: 3, passed: met >= 3,
    usage: { met: c1, weeks: wk, weeks_met: weeksMet, weeks_needed: need, still_possible: weeksMet + wk.filter((w) => w.state !== 'done').length >= need },
    fluency: { met: c2, baseline: baseCpm, now: nowCpm, change, target: 15 },
    every_child: { met: c3, eligible: elig.length, improved: impr, pct: elig.length ? Math.round((impr * 100) / elig.length) : null, target: 70 },
    competitions: { met: c4, list: comps, best, target: 60 },
    bonus: !!p.bonus,
  };
}
