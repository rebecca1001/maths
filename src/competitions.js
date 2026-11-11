// Competitions (School and School Plus plans). Teachers and schools provide the prizes; the app runs the competition.
// The real database scores competitions in SQL (round_log). This module holds:
//  - the words the screens use
//  - compSummary(): the same scoring for the browser-only demo
//  - studentView(): what the student's home screen card shows
export const PAID_PLANS = ['school', 'school_plus'];
export const PLAN_NAMES = { free: 'Free', school: 'School', school_plus: 'School Plus' };
export const KINDS = {
  top_player: { label: 'Top player', who: 'Students in one class', blurb: 'The student with the most wins.', scope: 'class', target: false },
  class_target: { label: 'Class goal', who: 'One class together', blurb: 'The class works together to reach a target.', scope: 'class', target: true },
  school_target: { label: 'School goal', who: 'The whole school together', blurb: 'Every class adds to one school total.', scope: 'school', target: true },
  class_race: { label: 'Class race', who: 'Classes against each other', blurb: 'Classes race, ranked by the amount per student, so small classes have a fair chance.', scope: 'school', target: false },
};
export const unit = (m, n) => (m === 'correct' ? (n === 1 ? 'correct answer' : 'correct answers') : (n === 1 ? 'star' : 'stars'));
const DAY = 864e5;
const fmt = (n) => Number(n || 0).toLocaleString('en-CA', { maximumFractionDigits: 1 });
export { fmt as fmtNum };

// 'YYYY-MM-DD' in the browser's own time zone
export function dayStr(t) { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
const dayStart = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).getTime(); };
export const time = (v) => (typeof v === 'number' ? v : Date.parse(v));
// The last day a competition counts (ends_at is midnight after the end date)
export const lastDay = (c) => new Date(time(c.ends_at) - 1);
export function shortDate(t) { return new Date(t).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }); }
export function whenText(c, now = Date.now()) {
  const s = time(c.starts_at), e = time(c.ends_at);
  if (c.status === 'upcoming' || now < s) { const d = Math.ceil((s - now) / DAY); return d <= 1 ? 'Starts tomorrow' : `Starts in ${d} days`; }
  if (c.status === 'ended' || now >= e) return `Finished ${shortDate(Math.min(e - 1, now))}`;
  const d = Math.ceil((e - now) / DAY);
  return d <= 1 ? 'Last day!' : `${d} days left`;
}

// ---------------------------------------------------------------------------
// Demo scoring (mirrors public._comp_summary in the database)
// students: [{id, class_id, name, real_name, data:{rounds, skin, demo}}], classes: [{id, name, archived_at}]
// ---------------------------------------------------------------------------
// opts.includeDemo: count demo students (the browser-only demo is all demo students); opts.now for tests
export function compSummary(c, students, classes, meId, teacher, opts = {}) {
  const now = opts.now ?? Date.now();
  const end = c.ended_at && time(c.ended_at) < time(c.ends_at) ? Math.max(time(c.ended_at), time(c.starts_at)) : time(c.ends_at);
  const status = now < time(c.starts_at) ? 'upcoming' : now >= end ? 'ended' : 'active';
  const live = new Set(classes.filter((x) => !x.archived_at).map((x) => x.id));
  const rows = students
    .filter((s) => live.has(s.class_id) && (!c.class_id || s.class_id === c.class_id) && (opts.includeDemo || !(s.data && s.data.demo)))
    .map((s) => {
      const v = ((s.data && s.data.rounds) || [])
        .filter((r) => typeof r.d === 'number' && r.d >= time(c.starts_at) && r.d < end)
        .reduce((t, r) => t + (c.measure === 'correct' ? (r.c || 0) : (r.stars ?? Math.round((r.pts ?? (r.c || 0) * 30) / 10))), 0);
      return { id: s.id, class_id: s.class_id, name: s.name, real_name: s.real_name || null, skin: (s.data && s.data.skin) || 'blob', v };
    });
  const me = rows.find((r) => r.id === meId);
  const meClass = (students.find((s) => s.id === meId) || {}).class_id || null;
  const total = rows.reduce((t, r) => t + r.v, 0);
  const out = {
    id: c.id, kind: c.kind, measure: c.measure, target: c.target ?? null, title: c.title, prize: c.prize,
    class_id: c.class_id || null, class_name: (classes.find((x) => x.id === c.class_id) || {}).name || null,
    scope: c.class_id ? 'class' : 'school', starts_at: new Date(time(c.starts_at)).toISOString(), ends_at: new Date(end).toISOString(),
    status, ended_early: !!(c.ended_at && time(c.ended_at) < time(c.ends_at)), created_by: c.created_by || null,
    total, reached: null, me: me ? me.v : 0, rank: null, players: null, my_class_total: 0, standings: null, classes: null,
  };
  const byClass = () => classes.filter((x) => live.has(x.id)).map((x) => {
    const rs = rows.filter((r) => r.class_id === x.id), v = rs.reduce((t, r) => t + r.v, 0);
    return { id: x.id, name: x.name, v, students: rs.length, per: Math.round((v / Math.max(rs.length, 1)) * 10) / 10, mine: x.id === meClass };
  });
  if (c.kind === 'top_player') {
    out.players = rows.length;
    if (meId) out.rank = 1 + rows.filter((r) => r.v > out.me).length;
    out.standings = rows.filter((r) => teacher || r.v > 0).sort((a, b) => b.v - a.v || a.name.localeCompare(b.name)).slice(0, teacher ? 500 : 3)
      .map((r) => ({ id: r.id, name: r.name, skin: r.skin, v: r.v, real_name: teacher ? r.real_name : null }));
  } else if (c.kind === 'class_target' || c.kind === 'school_target') {
    out.reached = total >= c.target;
    if (meClass) out.my_class_total = rows.filter((r) => r.class_id === meClass).reduce((t, r) => t + r.v, 0);
    if (c.kind === 'school_target') out.classes = byClass().sort((a, b) => b.v - a.v || a.name.localeCompare(b.name)).map(({ per, mine, ...x }) => x);
  } else if (c.kind === 'class_race') {
    out.classes = byClass().filter((x) => x.students > 0).sort((a, b) => b.per - a.per || a.name.localeCompare(b.name));
    if (meClass) {
      const mine = out.classes.find((x) => x.mine);
      out.my_class_total = mine ? mine.v : 0;
      if (mine) out.rank = 1 + out.classes.filter((x) => x.per > mine.per).length;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// What a student sees on their home screen for one competition
// returns {title, kindLabel, main, sub, pct (0-100 or null), prize, when, done, win}
// ---------------------------------------------------------------------------
export function studentView(c, now = Date.now()) {
  const u = (n) => unit(c.measure, n), when = whenText(c, now), ended = c.status === 'ended', upcoming = c.status === 'upcoming';
  const v = { title: c.title, kindLabel: KINDS[c.kind] ? KINDS[c.kind].label : 'Competition', main: '', sub: '', pct: null, prize: c.prize, when, done: ended, win: false };
  if (upcoming) {
    v.main = c.kind === 'top_player' ? `Who will earn the most ${u(2)} in your class?`
      : c.kind === 'class_target' ? `Your class's goal: ${fmt(c.target)} ${u(c.target)} together`
        : c.kind === 'school_target' ? `School goal: ${fmt(c.target)} ${u(c.target)} together`
          : `Which class will earn the most ${u(2)} per student?`;
    v.sub = `Get ready! It starts ${shortDate(time(c.starts_at))}.`;
    return v;
  }
  if (c.kind === 'top_player') {
    const lead = (c.standings || [])[0], leadV = lead ? lead.v : 0;
    v.main = `You: ${fmt(c.me)} ${u(c.me)}${c.me > 0 ? ` · #${c.rank} of ${c.players}` : ''}`;
    v.pct = leadV ? Math.min(100, (c.me / leadV) * 100) : 0;
    if (ended) { v.win = c.rank === 1 && c.me > 0; v.sub = v.win ? 'You won! Your teacher will give you the prize.' : lead ? `Winner: ${lead.name} with ${fmt(leadV)} ${u(leadV)}` : 'Nobody played.'; }
    else if (c.me === 0) v.sub = 'Play a round to join in!';
    else if (c.rank === 1) v.sub = "You're in the lead! Keep going.";
    else v.sub = `${fmt(leadV - c.me)} ${u(leadV - c.me)} behind #1 (${lead.name})`;
  } else if (c.kind === 'class_target' || c.kind === 'school_target') {
    const who = c.kind === 'class_target' ? 'Class' : 'School';
    v.main = `${who} total: ${fmt(c.total)} of ${fmt(c.target)} ${u(c.target)}`;
    v.pct = Math.min(100, (c.total / c.target) * 100);
    v.win = !!c.reached;
    if (c.reached) v.sub = ended ? 'Goal reached! Well done, everyone.' : 'Goal reached! 🎉 Keep playing to go even further.';
    else if (ended) v.sub = `Not quite this time: ${fmt(c.target - c.total)} short.`;
    else v.sub = c.kind === 'class_target'
      ? `You've added ${fmt(c.me)}. ${fmt(c.target - c.total)} to go!`
      : `Your class has added ${fmt(c.my_class_total)}, you've added ${fmt(c.me)}. ${fmt(c.target - c.total)} to go!`;
  } else if (c.kind === 'class_race') {
    const cls = c.classes || [], lead = cls[0], mine = cls.find((x) => x.mine);
    v.main = mine ? `Your class is #${c.rank} of ${cls.length}` : 'Your class has not played yet';
    v.pct = lead && lead.per ? Math.min(100, ((mine ? mine.per : 0) / lead.per) * 100) : 0;
    if (ended) { v.win = c.rank === 1; v.sub = lead ? (v.win ? 'Your class won! 🎉' : `Winner: ${lead.name}`) : 'Nobody played.'; }
    else if (!mine) v.sub = 'Play a round to help your class!';
    else v.sub = `${fmt(mine.per)} ${u(2)} per student · ${c.rank === 1 ? 'in the lead!' : `leader ${lead.name}: ${fmt(lead.per)}`}`;
  }
  return v;
}

// ---------------------------------------------------------------------------
// Quick picks for teachers: ready-made competitions, prize ideas, timeframes, suggested targets
// ---------------------------------------------------------------------------
const pad = (n) => String(n).padStart(2, '0');
const ds = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; };
// Each returns [start, last day] as 'YYYY-MM-DD', starting today
export const TIMEFRAMES = [
  { id: 'week', label: '1 week', range: (t) => [ds(t), ds(addDays(t, 6))] },
  { id: '2weeks', label: '2 weeks', range: (t) => [ds(t), ds(addDays(t, 13))] },
  { id: 'month', label: 'Rest of this month', range: (t) => { const end = new Date(t.getFullYear(), t.getMonth() + 1, 0); return [ds(t), ds(addDays(t, 6) > end ? addDays(t, 6) : end)]; } },
  { id: '30days', label: '30 days', range: (t) => [ds(t), ds(addDays(t, 29))] },
  { id: '6weeks', label: '6 weeks', range: (t) => [ds(t), ds(addDays(t, 41))] },
];
export const PRIZES = {
  class: ['$10 gift card', '$20 gift card', 'Homework pass', 'Lunch with the teacher', 'Certificate and a shout-out at assembly', 'First pick of the class prize box'],
  team: ['Pizza party', 'Extra recess for the class', 'Class movie afternoon', 'Choose the class game on Friday', 'Pyjama day', 'Trophy for the winning class'],
};
// perStudent: target per student for the whole competition (goal presets)
export const PRESETS = [
  { id: 'week_star', label: 'Star of the week', kind: 'top_player', measure: 'stars', time: 'week', prize: '$10 gift card', blurb: 'Most stars in a week' },
  { id: 'month_champ', label: 'Monthly champion', kind: 'top_player', measure: 'stars', time: 'month', prize: '$20 gift card', blurb: 'Most stars this month' },
  { id: 'hard_worker', label: 'Hardest worker', kind: 'top_player', measure: 'correct', time: '2weeks', prize: 'Homework pass', blurb: 'Most correct answers in 2 weeks, rewards effort over speed' },
  { id: 'class_stars', label: 'Class star challenge', kind: 'class_target', measure: 'stars', time: '2weeks', prize: 'Extra recess for the class', perStudent: 1000, blurb: 'The class reaches a star target together' },
  { id: 'pizza_goal', label: 'Pizza party goal', kind: 'class_target', measure: 'correct', time: '30days', prize: 'Pizza party', perStudent: 600, blurb: 'The class reaches a correct-answer target' },
  { id: 'school_drive', label: 'School star drive', kind: 'school_target', measure: 'stars', time: '30days', prize: 'Pizza party for the whole school', perStudent: 1500, blurb: 'Every class adds to one school total' },
  { id: 'class_race', label: 'Class race of the month', kind: 'class_race', measure: 'stars', time: 'month', prize: 'Trophy for the winning class', blurb: 'Classes race, ranked per student' },
];
// A round-looking number: 1,234 -> 1,250; 23,456 -> 23,500
export function niceNumber(n) {
  if (!(n > 0)) return 0;
  const step = n < 1000 ? 50 : n < 10000 ? 250 : n < 100000 ? 500 : 5000;
  return Math.max(step, Math.round(n / step) * step);
}
// School days between two 'YYYY-MM-DD' dates (Mon-Fri, inclusive)
export function schoolDays(start, end) {
  const [a, b] = [start, end].map((s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); });
  if (isNaN(a) || isNaN(b) || b < a) return 0;
  let n = 0; for (let d = new Date(a); d <= b; d.setDate(d.getDate() + 1)) { const w = d.getDay(); if (w > 0 && w < 6) n++; }
  return n;
}
// Easy / steady / stretch targets for a goal, from the number of students and school days
// (a 1-minute round is worth about 50 stars and 20 correct answers; 2, 3 or 5 rounds per school day)
export function suggestTargets(measure, students, start, end) {
  const days = schoolDays(start, end), kids = Math.max(1, students || 0), per = measure === 'correct' ? 20 : 50;
  if (!days) return [];
  return [['Easy', 2], ['Steady', 3], ['Stretch', 5]].map(([label, rounds]) => ({ label, rounds, value: niceNumber(kids * days * rounds * per) }));
}
