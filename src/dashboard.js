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

// A label next to each child's name: Not playing / Needs help / On track / Flying
export const STATUS = {
  none: ['Not playing', 'No rounds in the last 7 days'],
  help: ['Needs help', 'Playing, but under 80% right this week'],
  ok: ['On track', 'Playing and getting most right'],
  flying: ['Flying', 'Played 3+ days this week, 90%+ right'],
};
export function groupOf(rounds, now = Date.now()) {
  if (!recent(rounds, now).length) return 'none';
  const acc = accuracy(rounds, now);
  if (acc != null && acc < 0.8) return 'help';
  if (daysPlayed(rounds, now) >= 3 && acc >= 0.9) return 'flying';
  return 'ok';
}

// ---------- minimum rounds each time they play ----------
// settings.minRounds = the class minimum (0 or missing = off); settings.minFor = { studentId: n } for a different
// number for one child (0 = no minimum for them). Children can't change class settings, only teachers can.
export const MAX_MIN = 10;
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
