import { describe, it, expect, vi, afterEach } from 'vitest';
import { __test as g } from '../src/game.js';
import { seeded, fact, known, weak, loadPlayer, startRound } from './helpers.js';
afterEach(() => vi.restoreAllMocks());

describe('loading the server state (applyState)', () => {
  const state = (over = {}) => ({
    class: { id: 'c1', name: 'Ravens', settings: { maxTable: 10, sound: false } },
    me: { id: 'me', name: 'Comet Fox', data: { skin: 'ninja', coins: 12, rounds: [{ c: 10, n: 10, ms: 1500 }], facts: { '2,3': known() } } },
    classmates: [{ id: 'k1', name: 'Nova Falcon', data: { skin: 'astro', totStars: 40, wkMins: 3 } }, { id: 'k2', name: 'Lunar Otter', data: { skin: 'dj', totStars: 0, wkMins: 0 } }],
    ...over,
  });
  it('builds me + classmates in order, and applies class settings', () => {
    g.applyState(state()); expect(g.S.current).toBe('me'); expect(g.S.order).toEqual(['me', 'k1', 'k2']);
    expect(g.ALL.at(-1)).toBe(10); expect(g.S.muted).toBe(true); expect(g.S.players.me.skin).toBe('ninja');
  });
  it('classmates only carry safe fields: no facts, no rounds', () => {
    g.applyState(state()); const k = g.S.players.k1; expect(k.facts).toEqual({}); expect(k.rounds).toEqual([]); expect(k.totStars).toBe(40); expect(k.name).toBe('Nova Falcon');
  });
  it('the Top 10 uses server all-time totals and hides players with 0 stars', () => {
    g.applyState(state()); const pts = Object.values(g.S.players).map(p => [p.name, g.boardStars(p)]);
    expect(Object.fromEntries(pts)['Nova Falcon']).toBe(40); expect(Object.fromEntries(pts)['Lunar Otter']).toBe(0);
  });
  it('fills in a brand-new student with an empty record', () => {
    g.applyState(state({ me: { id: 'me', name: 'X', data: {} } })); const p = g.S.players.me;
    expect(p).toMatchObject({ rockets: ['classic'], rocket: 'classic', owned: ['blob'], facts: {}, rounds: [], placed: false, starsV2: true });
  });
  it('keepMe retains the live player object (so in-progress state is not lost on refresh)', () => {
    g.applyState(state()); const mine = g.S.players.me; mine.coins = 999; g.applyState(state(), true); expect(g.S.players.me).toBe(mine); expect(g.S.players.me.coins).toBe(999);
  });
  it('keepMe ignores a different student', () => { g.applyState(state()); const old = g.S.players.me; g.applyState(state({ me: { id: 'other', name: 'Z', data: {} } }), true); expect(g.S.players.other).not.toBe(old); });
  it('survives a class with no classmates and missing settings', () => {
    expect(() => g.applyState({ class: { id: 'c', name: 'C', settings: null }, me: { id: 'm', name: 'M', data: {} }, classmates: [] })).not.toThrow(); expect(g.ALL.at(-1)).toBe(12);
  });
  it('legacy data: removes retired badges and fields', () => {
    const p = g.fixPlayer({ badges: ['duelwin', 'first'], seenBattles: 3, rounds: [], facts: {} }); expect(p.badges).toEqual(['first']); expect('seenBattles' in p).toBe(false);
  });
  it('null rounds/facts/badges become safe defaults', () => {
    expect(() => g.fixPlayer({ rounds: null, facts: null, badges: null })).not.toThrow();
  });
  it('tampered saves (wrong types) cannot crash the student\'s own login', () => {
    for (const bad of [{ rounds: 'oops' }, { rounds: { a: 1 } }, { rounds: [null, 5, 'x', [], { c: 1, n: 1, ms: 1000 }] }, { facts: 'x' }, { facts: [1, 2] },
      { facts: { '2,3': 'x', '3,3': { r: 'a', t: [] }, '4,4': null, '5,5': { r: [1], t: [900] } } }, { badges: 'x' }, { owned: 5, rockets: 'r' }]) {
      const p = g.fixPlayer({ facts: {}, rounds: [], ...bad });
      expect(Array.isArray(p.rounds) && Array.isArray(p.badges) && Array.isArray(p.owned) && Array.isArray(p.rockets)).toBe(true);
      expect(() => { Object.values(p.facts).forEach(f => g.level(f)); p.rounds.forEach(r => g.roundStars(r)); g.checkBadges(p); }).not.toThrow();
    }
    expect(Object.keys(g.fixPlayer({ facts: { '2,3': 'x', '5,5': { r: [1], t: [900] } }, rounds: [] }).facts)).toEqual(['5,5']);
  });
});

describe('safety of anything shown on screen or exported', () => {
  it('esc neutralises HTML', () => {
    const bad = '<img src=x onerror=alert(1)>"\'&'; const out = g.esc(bad);
    expect(out).not.toMatch(/[<>"']/); expect(out).toContain('&lt;img'); expect(out).toContain('&amp;');
    const div = document.createElement('div'); div.innerHTML = out; expect(div.querySelector('img')).toBeNull();
  });
  it('esc copes with numbers', () => expect(g.esc(42)).toBe('42'));
  it('csvCell wraps commas, quotes and newlines and doubles quotes', () => {
    expect(g.csvCell('a,b')).toBe('"a,b"'); expect(g.csvCell('say "hi"')).toBe('"say ""hi"""'); expect(g.csvCell('l1\nl2')).toBe('"l1\nl2"'); expect(g.csvCell(null)).toBe(''); expect(g.csvCell(undefined)).toBe(''); expect(g.csvCell(0)).toBe('0'); expect(g.csvCell('plain')).toBe('plain');
  });
  it('csvCell stops spreadsheet formulas', () => { for (const f of ['=1+1', '+1', '-1', '@SUM(A1)']) expect(g.csvCell(f).startsWith("'")).toBe(true); expect(g.csvCell('=HYPERLINK("x","y")')).toBe('"\'=HYPERLINK(""x"",""y"")"'); });
  it('csvCell also neutralises a leading tab or carriage return (Excel treats them as formula starters)', () => { expect(g.csvCell('\t=cmd').startsWith("'")).toBe(true); expect(g.csvCell('\r=cmd').startsWith("'")).toBe(true); });
});

describe('space names', () => {
  it('are two-word, unique within the class, and never collide even with many players', () => {
    vi.spyOn(Math, 'random').mockImplementation(seeded(8)); loadPlayer({}); const names = new Set();
    for (let i = 0; i < 300; i++) { const n = g.spaceName(); expect(n).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+( \d+)?$/); g.S.players['p' + i] = { name: n }; names.add(n); }
    expect(names.size).toBe(300);
  });
});
