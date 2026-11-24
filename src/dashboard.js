// Teacher view numbers and the minimum-rounds rule.
// Pure functions (no DOM) so they can be tested. A student's rounds: [{ d: ms timestamp, c: right, n: answered, len: seconds }].
const DAY = 864e5;

const dayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
export const recent = (rounds, now = Date.now()) => (rounds || []).filter((r) => r && r.d >= now - 7 * DAY && r.d <= now + DAY);

// Different days played in the last 7 days
export function daysPlayed(rounds, now = Date.now()) { return new Set(recent(rounds, now).map((r) => dayKey(r.d))).size; }

// Share of answers right in the last 7 days (0-1), or null when nothing was played
export function accuracy(rounds, now = Date.now()) {
  const rs = recent(rounds, now), n = rs.reduce((s, r) => s + (r.n || 0), 0);
  return n ? rs.reduce((s, r) => s + (r.c || 0), 0) / n : null;
}

// Correct answers per minute in the last 7 days (rounds are 1 minute, so this is speed and accuracy in one number)
export function correctPerMin(rounds, now = Date.now()) {
  const rs = recent(rounds, now), mins = rs.reduce((s, r) => s + (r.len || 60) / 60, 0);
  return mins ? rs.reduce((s, r) => s + (r.c || 0), 0) / mins : null;
}

// 'up', 'down' or 'flat': the last 3 proper rounds against the 3 before them (needs 4+ rounds)
export function trend(rounds) {
  const rs = (rounds || []).filter((r) => r && r.n >= 8).map((r) => (r.c || 0) / ((r.len || 60) / 60));
  if (rs.length < 4) return null;
  const last = rs.slice(-3), before = rs.slice(-6, -3);
  const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length, diff = avg(last) - avg(before);
  return diff >= 1 ? 'up' : diff <= -1 ? 'down' : 'flat';
}

// A label next to each child's name (teacher-only; students never see it): On track, or Needs assistance with the reason(s).
// Judged over THIS WEEK (Monday to Sunday), never over today, so a day off or a Monday does not flag anyone.
//   Low accuracy: very few answers right this week (needs enough answers to judge). Kept low on purpose:
//                 a child who finds maths hard but plays plenty of rounds is on track, because the effort is there.
//   Low activity: far fewer rounds this week than the daily target x school days already finished this week.
export const STATUS = {
  help: ['Needs assistance', 'Very low accuracy or very few rounds this week'],
  ok: ['On track', 'Playing enough and getting a fair share right this week'],
};
export const REASON = { accuracy: 'Low accuracy', activity: 'Low activity' };
export const LOW_ACCURACY = 0.6;      // under 60% right this week...
export const MIN_ANSWERS = 15;        // ...once they have answered at least this many (about one round)
export const ACTIVITY_SHARE = 0.5;    // fewer than half the expected rounds so far this week
export const DEFAULT_TARGET = 10;     // rounds per day, when the teacher has not set one
const mondayOf = (now) => { const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); };
export const weekRounds = (rounds, now = Date.now()) => (rounds || []).filter((r) => r && r.d >= mondayOf(now) && r.d <= now + DAY);
export const roundsThisWeek = (rounds, now = Date.now()) => weekRounds(rounds, now).length;
// School days (Monday to Friday) already finished this week, not counting today: Monday 0 ... Friday 4, then 5 at the weekend
export const schoolDaysDone = (now = Date.now()) => Math.min(5, (new Date(now).getDay() + 6) % 7);
export function statusReasons(rounds, now = Date.now(), target = DEFAULT_TARGET) {
  const wr = weekRounds(rounds, now), out = [];
  const answered = wr.reduce((n, r) => n + (r.n || 0), 0), right = wr.reduce((n, r) => n + (r.c || 0), 0);
  if (answered >= MIN_ANSWERS && right / answered < LOW_ACCURACY) out.push('accuracy');
  const expected = (+target || DEFAULT_TARGET) * schoolDaysDone(now);
  if (expected > 0 && wr.length < Math.ceil(expected * ACTIVITY_SHARE)) out.push('activity');
  return out;
}
export function groupOf(rounds, now = Date.now(), target = DEFAULT_TARGET) {
  return statusReasons(rounds, now, target).length ? 'help' : 'ok';
}

// "Today" only when the last round was on today's calendar date (not just within 24 hours)
export function lastPlayedLabel(rounds, now = Date.now()) {
  if (!rounds || !rounds.length) return 'Never';
  const mid = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const days = Math.round((mid(now) - mid(rounds[rounds.length - 1].d)) / DAY);
  return days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : days + ' days ago';
}

// ---------- rounds per day (a daily target; stored as settings.minRounds so saved classes keep working) ----------
// settings.minRounds = the class minimum (0 or missing = off); settings.minFor = { studentId: n } for a different
// number for one child (0 = no minimum for them). Children can't change class settings, only teachers can.
export const MAX_MIN = 30;
const clampMin = (v) => Math.max(0, Math.min(MAX_MIN, Math.round(+v || 0)));
export function minFor(settings, id) {
  const st = settings || {}, own = st.minFor && Object.prototype.hasOwnProperty.call(st.minFor, id) ? st.minFor[id] : null;
  return own != null ? clampMin(own) : clampMin(st.minRounds);
}
export function hasOwnMin(settings, id) { return !!(settings && settings.minFor && Object.prototype.hasOwnProperty.call(settings.minFor, id)); }
// Rounds played today (a "session" is one school day)
export function roundsToday(rounds, now = Date.now()) {
  const d = new Date(now); d.setHours(0, 0, 0, 0); const from = d.getTime(), to = from + DAY;
  return (rounds || []).filter((r) => r && r.d >= from && r.d < to).length;
}
// Settings after the teacher sets the whole class (clears no one's own number) or one child (null = back to the class number)
export function withClassMin(settings, n) { return { ...(settings || {}), minRounds: clampMin(n) }; }
export function withStudentMin(settings, id, n) {
  const minForMap = { ...((settings && settings.minFor) || {}) };
  if (n == null) delete minForMap[id]; else minForMap[id] = clampMin(n);
  const out = { ...(settings || {}), minFor: minForMap };
  if (!Object.keys(minForMap).length) delete out.minFor;
  return out;
}

// ---------- settings for one child ----------
// settings.kids = { studentId: { multiplication: true|false, division: true|false, tables:[2..12], goal: { tables:[2..12], rounds } } }. Missing = the class setting.
// Only teachers can change these. Pure functions, so they can be tested.
// Times tables in play: a list of 2..12 (class: settings.tables; one child: settings.kids[id].tables). Missing or empty = the class setting.
export const cleanTables = (t) => (Array.isArray(t) ? [...new Set(t.map(Number).filter((n) => Number.isInteger(n) && n >= 2 && n <= 12))].sort((a, b) => a - b) : []);
export function classTables(settings) {
  const own = cleanTables(settings && settings.tables);
  if (own.length) return own;
  const mx = Math.min(12, Math.max(5, +(settings && settings.maxTable) || 12));
  return Array.from({ length: mx - 1 }, (_, i) => i + 2);
}
const cleanGoal = (g) => {
  if (!g || !Array.isArray(g.tables)) return null;
  const tables = [...new Set(g.tables.map(Number).filter((t) => t >= 2 && t <= 12))].sort((a, b) => a - b);
  const rounds = Math.max(0, Math.min(50, Math.round(+g.rounds || 0)));
  return tables.length || rounds ? { tables, rounds } : null;
};
export function kidOf(settings, id) {
  const k = settings && settings.kids && Object.prototype.hasOwnProperty.call(settings.kids, id) ? settings.kids[id] : null;
  const b = (v) => (typeof v === 'boolean' ? v : null);
  const tb = k ? cleanTables(k.tables) : [];
  return { multiplication: k ? b(k.multiplication) : null, division: k ? b(k.division) : null, tables: tb.length ? tb : null, goal: k ? cleanGoal(k.goal) : null };
}
// patch: { division: true|false|null, goal: {tables,rounds}|null } (null = back to the class setting; leave a key out to keep it)
export function withKid(settings, id, patch) {
  const cur = kidOf(settings, id), next = { ...cur };
  if ('multiplication' in patch) next.multiplication = typeof patch.multiplication === 'boolean' ? patch.multiplication : null;
  if ('division' in patch) next.division = typeof patch.division === 'boolean' ? patch.division : null;
  if ('tables' in patch) { const t = cleanTables(patch.tables); next.tables = t.length ? t : null; }
  if ('goal' in patch) next.goal = cleanGoal(patch.goal);
  const kids = { ...((settings && settings.kids) || {}) };
  const entry = {};
  if (next.multiplication != null) entry.multiplication = next.multiplication;
  if (next.division != null) entry.division = next.division;
  if (next.tables) entry.tables = next.tables;
  if (next.goal) entry.goal = next.goal;
  if (Object.keys(entry).length) kids[id] = entry; else delete kids[id];
  const out = { ...(settings || {}), kids };
  if (!Object.keys(kids).length) delete out.kids;
  return out;
}
// The settings one child actually plays with: the class's, with their own division and goal on top
export function effectiveSettings(settings, id) {
  const k = kidOf(settings, id), out = { ...(settings || {}) };
  if (k.division != null) out.division = k.division;
  if (k.multiplication != null) out.multiplication = k.multiplication;
  if (k.tables) out.tables = k.tables;
  if (k.goal) out.goal = k.goal;
  return out;
}
