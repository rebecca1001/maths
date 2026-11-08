process.env.TZ = 'America/Vancouver'; // dates in the game use local time; pin it so tests behave the same everywhere
// Load the real page markup so game.js can bind to its elements, then keep the app in demo mode (no network).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach } from 'vitest';
const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)[1].replace(/<script[\s\S]*?<\/script>/gi, '');
document.body.innerHTML = body;
window.scrollTo = () => {};
window.HTMLElement.prototype.scrollIntoView = () => {};
beforeEach(() => { try { localStorage.clear(); sessionStorage.clear(); } catch (e) {} });
