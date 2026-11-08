// Example players for demo mode only (class code DEMO, codes 1111, 2222, 3333, 4444)
function seedFacts(skill, seed) {
  let s = seed;
  const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const facts = {}, now = Date.now(), easy = [1, 2, 5, 10], mid = [3, 4, 11], hard = [6, 9];
  const diff = n => easy.includes(n) ? 0 : mid.includes(n) ? 1 : hard.includes(n) ? 2 : 3;
  for (let a = 1; a <= 12; a++) for (let b = 1; b <= 12; b++) {
    const d = Math.max(0, diff(a) + (easy.includes(b) ? -1 : 0));
    const base = (1100 + d * 1400) * (1.6 - skill);
    if (r() < (d >= 2 ? .45 * (1 - skill) : .03)) continue;
    const n = 3 + Math.floor(r() * 5), miss = Math.max(.02, d * .12 * (1.3 - skill)), rs = [], t = [];
    for (let i = 0; i < n; i++) { const ok = r() > miss; rs.push(ok ? 1 : 0); if (ok) t.push(Math.round(base * (.7 + r() * .7))); }
    facts[a + ',' + b] = { r: rs, t: t.slice(-5), last: now - Math.floor(r() * 5 * 864e5) };
  }
  return facts;
}

export function seedDemoStudents() {
  const now = Date.now();
  const mk = (name, pin, skill, seed, skin, coins, scores) => ({
    id: 'demo-' + pin, name, pin,
    data: {
      demo: true, placed: true, facts: seedFacts(skill, seed), skin, owned: ['blob', skin], rockets: ['classic'], rocket: 'classic',
      coins, badges: [],
      rounds: scores.map((c, i) => ({ d: now - (scores.length - i) * 864e5 * .9, c, n: c + Math.round(3 * (1 - skill)) + 1, ms: Math.round(52000 / c), len: 60 })),
    },
  });
  return [
    mk('Comet Fox', '1111', .55, 11, 'ninja', 64, [14, 16, 15, 19, 21]),
    mk('Nova Falcon', '2222', .85, 23, 'astro', 212, [24, 27, 26, 30, 33]),
    mk('Lunar Otter', '3333', .7, 37, 'dj', 131, [18, 20, 22, 25, 24]),
    mk('Rocket Panda', '4444', .35, 51, 'mint', 38, [9, 11, 12, 12, 15]),
  ];
}
