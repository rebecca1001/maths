"""MathWizz walkthrough: clicks through the whole login and the teacher side, and reports bugs and clutter.

Runs against demo mode (no database needed): build and preview first, then run this.
    npm run build && npx vite preview --port 4173 &
    python3 scripts/walkthrough.py                 # http://localhost:4173, desktop + phone
    python3 scripts/walkthrough.py --url https://... --out walkthrough-report
Needs: pip install playwright && playwright install chromium   (or pass --chrome /path/to/chrome)

What it checks on every screen it visits, at desktop (1280px) and phone (390px) widths:
  - JavaScript errors and console errors
  - the page scrolling sideways (something too wide for the screen)
  - buttons, links and fields overlapping each other, or cut off at the screen edge
  - buttons and links with no text or label
  - tap targets smaller than 32 px on phones
  - how many buttons, links and fields are on screen (a rough clutter count; over 12 is flagged)
It also checks that each step of a flow lands where it should (for example a wrong password shows an error).
Writes report.md plus a screenshot per step into the output folder. Exits 1 if any bug was found.
"""
import argparse, asyncio, json, os, sys
from playwright.async_api import async_playwright

CLUTTER_LIMIT = 12
MIN_TAP = 32

# Runs inside the page: returns layout problems and the visible controls.
AUDIT_JS = r"""
() => {
  const vis = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !el.closest('[hidden]') && s.opacity !== '0'; };
  const scope = [...document.querySelectorAll('.overlay')].find(o => !o.hidden) || document.querySelector('section.screen:not([hidden])') || document.body;
  const ctrls = [...scope.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=tab]')].filter(vis);
  const lab = el => { const l = el.closest('label') || (el.id && document.querySelector(`label[for="${el.id}"]`)); return l ? l.textContent : ''; };
  const name = el => (el.getAttribute('aria-label') || (['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName) ? lab(el) || el.placeholder : el.textContent) || el.title || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 50);
  const out = { controls: ctrls.map(name), issues: [] };
  const W = document.documentElement.clientWidth;
  if (document.documentElement.scrollWidth > W + 2) {
    const wide = [...document.querySelectorAll('body *')].filter(e => vis(e) && e.getBoundingClientRect().right > W + 2 && !e.closest('.tbl-wrap, .hm-wrap, .xbars'));
    if (wide.length) out.issues.push({ kind: 'sideways scroll', detail: `page is ${document.documentElement.scrollWidth}px wide on a ${W}px screen; widest: ${wide.slice(0, 3).map(e => e.tagName.toLowerCase() + (e.id ? '#' + e.id : e.className ? '.' + String(e.className).split(' ')[0] : '')).join(', ')}` });
  }
  ctrls.forEach(el => { if (!name(el) || name(el) === el.tagName) out.issues.push({ kind: 'no label', detail: el.outerHTML.slice(0, 80) }); });
  // fixed bars (the phone tab bar) sit over scrolling content on purpose: leave them out of the overlap checks
  const fixed = el => { for (let x = el; x && x !== document.body; x = x.parentElement) { const p = getComputedStyle(x).position; if (p === 'fixed' || p === 'sticky') return true; } return false; };
  // overlapping controls (ignoring ones nested in each other, and table/inline rows)
  for (let i = 0; i < ctrls.length; i++) for (let j = i + 1; j < ctrls.length; j++) {
    const a = ctrls[i], b = ctrls[j]; if (fixed(a) || fixed(b) || a.contains(b) || b.contains(a) || a.closest('label') === b.closest('label') && a.closest('label')) continue;
    const r = a.getBoundingClientRect(), s = b.getBoundingClientRect();
    const ox = Math.min(r.right, s.right) - Math.max(r.left, s.left), oy = Math.min(r.bottom, s.bottom) - Math.max(r.top, s.top);
    if (ox > 4 && oy > 4) out.issues.push({ kind: 'overlap', detail: `"${name(a)}" overlaps "${name(b)}"` });
  }
  // text that overlaps a control (e.g. a heading under a button)
  const texts = [...scope.querySelectorAll('h1, h2, h3, p, label')].filter(vis);
  texts.forEach(t => ctrls.forEach(c => { if (t.contains(c) || c.contains(t) || fixed(c)) return;
    const r = t.getBoundingClientRect(), s = c.getBoundingClientRect();
    const ox = Math.min(r.right, s.right) - Math.max(r.left, s.left), oy = Math.min(r.bottom, s.bottom) - Math.max(r.top, s.top);
    if (ox > 6 && oy > 6) out.issues.push({ kind: 'overlap', detail: `"${name(c)}" covers text "${t.textContent.trim().slice(0, 40)}"` }); }));
  // cut off at the screen edge
  ctrls.forEach(el => { const r = el.getBoundingClientRect(); if ((r.left < -2 || r.right > W + 2) && !el.closest('.tbl-wrap, .hm-wrap'))
    out.issues.push({ kind: 'cut off', detail: `"${name(el)}" goes past the edge of the screen` }); });
  out.small = ctrls.filter(el => { const r = el.getBoundingClientRect(); return el.tagName !== 'INPUT' && (r.height < MIN_TAP_PX || r.width < MIN_TAP_PX) && !el.closest('.tbl-wrap, .hm-wrap, .legend'); }).map(name);
  return out;
}
""".replace('MIN_TAP_PX', str(MIN_TAP))


class Run:
    def __init__(self, page, out, label):
        self.page, self.out, self.label = page, out, label
        self.steps, self.bugs, self.notes = [], [], []
        self.errors = []
        page.on('pageerror', lambda e: self.errors.append(f'JavaScript error: {e}'))
        page.on('console', lambda m: m.type == 'error' and self.errors.append(f'Console error: {m.text[:200]}'))
        page.on('requestfailed', lambda r: not r.url.startswith('data:') and self.errors.append(f'Request failed: {r.url[:120]}'))

    async def check(self, step, expect=None, why=''):
        """Audit the current screen. expect = CSS selector that should be visible after this step."""
        await self.page.wait_for_timeout(350)
        n = len(self.steps) + 1
        shot = f'{self.label}-{n:02d}.png'
        await self.page.screenshot(path=os.path.join(self.out, shot), full_page=True)
        a = await self.page.evaluate(AUDIT_JS)
        issues = list(a['issues'])
        if expect and not await self.page.is_visible(expect):
            issues.append({'kind': 'wrong place', 'detail': f'expected {expect} to show {why}'.strip()})
        for e in self.errors: issues.append({'kind': 'error', 'detail': e})
        self.errors = []
        clutter = len(a['controls'])
        notes = []
        if clutter > CLUTTER_LIMIT: notes.append(f'{clutter} buttons/links/fields on screen (cluttered?)')
        if self.label == 'phone' and a['small']: notes.append('small tap targets: ' + ', '.join(sorted(set(a['small'])))[:200])
        self.steps.append({'n': n, 'step': step, 'shot': shot, 'controls': a['controls'], 'issues': issues, 'notes': notes})
        for i in issues: self.bugs.append((n, step, i))
        for x in notes: self.notes.append((n, step, x))

    async def click(self, sel):
        try: await self.page.click(sel, timeout=3000)
        except Exception as e: self.bugs.append((len(self.steps), f'click {sel}', {'kind': 'cannot click', 'detail': str(e).splitlines()[0][:160]}))

    async def fill(self, sel, v):
        try: await self.page.fill(sel, v, timeout=3000)
        except Exception as e: self.bugs.append((len(self.steps), f'fill {sel}', {'kind': 'cannot type', 'detail': str(e).splitlines()[0][:160]}))


async def walkthrough(r: Run, url):
    p = r.page
    # ---------------- login ----------------
    await p.goto(url); await p.evaluate('localStorage.clear(); sessionStorage.clear()'); await p.goto(url)
    await r.check('First screen: who is logging in', '#whoStep')
    await r.click('#loginHelp'); await r.check('Help', '#helpOv'); await r.click('#helpClose')
    await r.click('[data-who=parent]'); await r.check('Parent', '#parentStep'); await r.click('#parentBack')
    await r.click('[data-who=student]'); await r.check('Student: email login', '#emailStep')
    await r.click('#sGo'); await r.check('Student: log in with nothing typed', '#emailFb:not(:empty)', 'an error message')
    await r.fill('#sEmail', 'fox.comet'); await r.fill('#sPass', 'x'); await r.click('#sGo')
    await r.check('Student: email without @', '#emailFb:not(:empty)', 'an error message')
    await r.fill('#sEmail', 'Fox.Comet@SD54.bc.ca'); await r.fill('#sPass', 'red-fox-11'); await r.click('#sGo'); await p.wait_for_timeout(300)
    await r.check('Student: wrong password', '#emailFb:not(:empty)', 'an error message')
    await r.click('#sShow'); await r.fill('#sPass', ' Blue-Tiger-42 '); await r.click('#sGo'); await p.wait_for_timeout(800)
    await r.check('Student: right email + password (odd capitals and spaces)', '#home:not([hidden]), #intro:not([hidden])', '(the student home)')
    if await p.is_visible('#introSkip'): await r.click('#introSkip')
    await r.click('.rail [data-tab=board]'); await r.check('Student: Top 10', '#board')
    await r.click('.rail [data-tab=logout]'); await r.check('After logging out (email device)', '#emailStep', '(email login again)')
    # class code door, as Ms Berry's class uses it
    await r.click('#toCodeLogin'); await r.check('Class code: find your school', '#schoolStep')
    await r.fill('#schoolSearch', 'Demo'); await p.wait_for_timeout(500); await r.check('Class code: school results')
    await r.click('#schoolList button'); await p.wait_for_timeout(400); await r.check('Class code: pick your class', '#classStep')
    await r.click('#classList button'); await r.check('Class code: keypad', '#pinStep')
    for d in '9876': await r.click(f'#loginPad .key >> text="{d}"')
    await p.wait_for_timeout(500); await r.check('Class code: wrong 4-digit code', '#loginFb:not(:empty)', 'an error message')
    for d in '2222': await r.click(f'#loginPad .key >> text="{d}"')
    await p.wait_for_timeout(800); await r.check('Class code: right code', '#home:not([hidden]), #intro:not([hidden])')
    if await p.is_visible('#introSkip'): await r.click('#introSkip')
    await r.click('.rail [data-tab=logout]'); await r.check('After logging out (code device: straight to class list, as before)', '#classStep')
    await r.click('#changeSchool'); await r.check('Class code: change school', '#schoolStep')
    await r.click('#useCode'); await r.check('Class code: type a class code', '#classForm')
    await r.fill('#classCode', 'ZZZZZZ'); await p.click('#classForm button[type=submit]')
    for d in '1357': await r.click(f'#loginPad .key >> text="{d}"')
    await p.wait_for_timeout(500); await r.check('Class code: class code that does not exist', '#classFb:not(:empty), #loginFb:not(:empty)', 'an error message')
    # teacher and principal doors
    await p.evaluate('localStorage.clear()'); await p.goto(url)
    await r.click('[data-who=principal]'); await r.check('Principal sign-in', '#teach')
    await r.click('#tBack'); await r.click('[data-who=teacher]'); await r.check('Teacher sign-in', '#tSignIn')
    await r.click('#tSubmit'); await r.check('Teacher: sign in with nothing typed')
    await r.click('[data-tmode=create]'); await r.check('Teacher: create account')
    await r.click('[data-tmode=signin]')
    await r.fill('#tEmail', 'walkthrough@demo.ca'); await r.fill('#tPass', 'password123'); await r.click('#tSubmit'); await p.wait_for_timeout(1200)
    if await p.is_visible('#tSetup'):
        await r.check('Teacher: set up school (first time)', '#tSetup')
        await r.fill('#tName', 'Ms Walkthrough'); await r.fill('#tSchoolName', 'Demo School'); await p.click('#tSetup button[type=submit]'); await p.wait_for_timeout(1200)
    # ---------------- teacher side ----------------
    await r.check('Teacher: class view', '#grown')
    for g in ['none', 'help', 'ok', 'flying']:
        await r.click(f'#kpis [data-group={g}]'); await r.check(f'Teacher: filter group "{g}"')
        await r.click(f'#kpis [data-group={g}]')
    await r.click('#addStudent'); await r.check('Teacher: Add students with nothing typed', '#addMsg:not(:empty)', 'a message')
    await r.fill('#addNames', 'walk.through@sd54.bc.ca\nnot-an-email@\nwalk.through@sd54\nAva S')
    await r.click('#addStudent'); await p.wait_for_timeout(600); await r.check('Teacher: add 2 good, 1 bad, 1 duplicate', '#addMsg:not(:empty)')
    await r.click('#tbl tbody tr[data-id]'); await r.check('Teacher: student details', '#gdetail')
    if await p.is_visible('[data-newpass]'):
        await r.click('[data-newpass]'); await r.check('Teacher: new password')
    if await p.is_visible('#gdEmailForm'):
        await r.fill('#gdEmail', 'oops'); await p.click('#gdEmailForm button'); await r.check('Teacher: add email login with a bad email', '#gdMsg:not(:empty)')
    await r.click('[data-gtab=goal]'); await r.check('Teacher: weekly goal')
    await r.click('[data-gtab=help]'); await r.check('Teacher: needs help')
    await r.click('[data-gtab=settings]'); await r.check('Teacher: settings')
    await r.click('[data-gtab=students]')
    if await p.is_visible('#gSchoolBtn'):
        await r.click('#gSchoolBtn'); await p.wait_for_timeout(600); await r.check('Principal: school page', '#school'); await r.click('#sBack')
    if await p.is_visible('#gSuperBtn'):
        await r.click('#gSuperBtn'); await p.wait_for_timeout(800); await r.check('Owner: all schools', '#super'); await r.click('#xBack')
    await r.click('#grownBack'); await r.check('Teacher: sign out', '#login')


def report(runs, out):
    lines = ['# MathWizz walkthrough report', '']
    total = sum(len(r.bugs) for r in runs)
    lines.append(f'**{total} possible bug(s)** across {sum(len(r.steps) for r in runs)} screens.\n')
    for r in runs:
        lines.append(f'## {r.label.title()} ({"1280" if r.label == "desktop" else "390"} px wide)\n')
        if r.bugs:
            lines.append('### Possible bugs\n')
            seen = set()
            for n, step, i in r.bugs:
                k = (i['kind'], i['detail'])
                if k in seen: continue
                seen.add(k); lines.append(f'- **{i["kind"]}** at step {n} ({step}): {i["detail"]}')
            lines.append('')
        if r.notes:
            lines.append('### Worth a look (clutter, small buttons)\n')
            for n, step, x in r.notes: lines.append(f'- Step {n} ({step}): {x}')
            lines.append('')
        lines.append('### Every screen\n')
        lines.append('| # | Step | Controls on screen | Screenshot |')
        lines.append('|---|---|---|---|')
        for s in r.steps:
            lines.append(f'| {s["n"]} | {s["step"]} | {len(s["controls"])}: {", ".join(s["controls"])[:160]} | {s["shot"]} |')
        lines.append('')
    open(os.path.join(out, 'report.md'), 'w').write('\n'.join(lines))
    json.dump([{'label': r.label, 'steps': r.steps} for r in runs], open(os.path.join(out, 'report.json'), 'w'), indent=1)
    return total


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--url', default='http://localhost:4173/')
    ap.add_argument('--out', default='walkthrough-report')
    ap.add_argument('--chrome', default=None, help='path to a Chrome/Chromium to use instead of Playwright\'s')
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    runs = []
    async with async_playwright() as pw:
        b = await pw.chromium.launch(executable_path=a.chrome, args=['--no-sandbox'])
        for label, vp in [('desktop', {'width': 1280, 'height': 800}), ('phone', {'width': 390, 'height': 844})]:
            ctx = await b.new_context(viewport=vp, color_scheme='dark', is_mobile=label == 'phone', has_touch=label == 'phone')
            r = Run(await ctx.new_page(), a.out, label)
            try: await walkthrough(r, a.url)
            except Exception as e: r.bugs.append((len(r.steps), 'walkthrough stopped', {'kind': 'crash', 'detail': str(e).splitlines()[0][:200]}))
            runs.append(r); await ctx.close()
        await b.close()
    total = report(runs, a.out)
    print(f'{total} possible bug(s). Report: {os.path.join(a.out, "report.md")}')
    sys.exit(1 if total else 0)

if __name__ == '__main__':
    asyncio.run(main())
