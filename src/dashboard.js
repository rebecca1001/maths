// Teacher view: which group each student is in, and the few numbers a teacher needs.
// Pure functions (no DOM) so they can be tested. A student's rounds: [{ d: ms timestamp, c: right, n: answered, len: seconds }].
const DAY = 864e5;

export const GROUPS = [
  { id: 'none', label: 'Not playing', hint: 'No rounds in the last 7 days' },
  { id: 'help', label: 'Needs help', hint: 'Playing, but under 80% right' },
  { id: 'ok', label: 'On track', hint: 'Playing and getting most right' },
  { id: 'flying', label: 'Flying', hint: 'Played 3+ days this week, 90%+ right' },
];

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

export function groupOf(rounds, now = Date.now()) {
  if (!recent(rounds, now).length) return 'none';
  const acc = accuracy(rounds, now);
  if (acc != null && acc < 0.8) return 'help';
  if (daysPlayed(rounds, now) >= 3 && acc >= 0.9) return 'flying';
  return 'ok';
}

// Count per group, in GROUPS order
export function groupCounts(players, now = Date.now()) {
  const n = Object.fromEntries(GROUPS.map((g) => [g.id, 0]));
  players.forEach((p) => { n[groupOf(p.rounds, now)]++; });
  return n;
}
