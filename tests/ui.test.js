import { describe, it, expect, vi, beforeAll } from 'vitest';
import { boot } from '../src/game.js';

const visible = () => [...document.querySelectorAll('main > section, body > section, section[id]')].filter(s => !s.hidden).map(s => s.id);
const settle = () => new Promise(r => setTimeout(r, 30));

describe('screens (demo mode, real page markup)', () => {
  it('the student side opens on the login screen and nothing else', async () => {
    const err = vi.spyOn(console, 'error'); await boot(); await settle();
    expect(document.getElementById('login').hidden).toBe(false);
    for (const id of ['home', 'play', 'results', 'teach', 'grown', 'school', 'super']) expect(document.getElementById(id).hidden, id).toBe(true);
    expect(err).not.toHaveBeenCalled();
  });
  it('the login keypad has 12 keys including Delete and Enter', () => {
    const keys = [...document.querySelectorAll('#loginPad .key')].map(k => k.textContent); expect(keys.length).toBe(12); expect(keys).toEqual(expect.arrayContaining(['Delete', 'Enter', '0', '9']));
  });
  it('the play keypad matches', () => expect(document.querySelectorAll('#pad .key').length).toBe(12));
  it('the teacher address opens the teacher screen', async () => {
    history.pushState({}, '', '/?teacher=1'); await boot(); await settle(); expect(document.getElementById('teach').hidden).toBe(false); expect(document.getElementById('login').hidden).toBe(true); history.pushState({}, '', '/');
  });
  it('the privacy page exists and names the data handling', async () => {
    const { readFileSync } = await import('node:fs'); const html = readFileSync('public/privacy.html', 'utf8'); expect(html.toLowerCase()).toContain('privacy'); expect(html).toMatch(/Canada/i);
  });
  it('privacy policy has no unfilled [bracket] placeholders left', async () => {
    const { readFileSync } = await import('node:fs'); const html = readFileSync('public/privacy.html', 'utf8').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ''); const left = html.match(/\[[^\]\n]{2,60}\]/g) || []; expect(left, 'unfilled placeholders: ' + left.join(' | ')).toEqual([]);
  });
});
