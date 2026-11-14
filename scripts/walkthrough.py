"""MathWizz walkthrough: clicks through every login path (TTRS funnel, 4-digit code, Register, teacher) and the teacher side, and reports bugs and clutter.

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
  // the back arrow sits beside a centred title whose box spans the card: not a real overlap
  texts.forEach(t => ctrls.forEach(c => { if (t.contains(c) || c.contains(t) || fixed(c) || (['loginBack', 'tBack'].includes(c.id) && /^H[12]$/.test(t.tagName))) return;
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


async def fresh(p, url, keep_demo=True):
    """A new device: forget the remembered school and login, keep the demo data."""
    await p.goto(url)
    await p.evaluate("""k => { const d = localStorage.getItem('mm.demo.db.v1'); localStorage.clear(); sessionStorage.clear(); if (k && d) localStorage.setItem('mm.demo.db.v1', d); }""", keep_demo)
    await p.goto(url); await p.wait_for_timeout(400)


async def tap(r, digits):
    for d in digits: await r.click(f'#loginPad .key[data-d="{d}"]')
    await r.page.wait_for_timeout(700)


async def logged_in(p):
    return await p.is_visible('#home:not([hidden])') or await p.is_visible('#intro:not([hidden])')


async def skip_intro(r):
    if await r.page.is_visible('#introSkip'): await r.click('#introSkip')


async def student_door(r):
    """Log in > School > Student"""
    await r.click('#gateLogin'); await r.click('#kSchool'); await r.click('#rStudent')


async def walkthrough(r: Run, url):
    p = r.page
    # ================= A. new device, student with a username (TTRS funnel) =================
    await fresh(p, url, keep_demo=False)
    fox_pin = await p.evaluate("() => JSON.parse(localStorage.getItem('mm.demo.db.v1') || '{}').students?.[0]?.pin || ''")
    await r.check('A1 First screen on a new device: Log in / Register', '#gateStep:not([hidden])')
    await r.click('#loginHelp'); await r.check('A2 Help', '#helpOv:not([hidden])'); await r.click('#helpClose')
    await r.click('#gateLogin'); await r.check('A3 Log in: School / Family / Tutor', '#kindStep:not([hidden])')
    await r.click('#kFamily'); await r.check('A4 Family: coming soon', '#soonStep:not([hidden])'); await r.click('#loginBack')
    await r.click('#kTutor'); await r.check('A5 Tutor: coming soon', '#soonStep:not([hidden])'); await r.click('#loginBack')
    await r.click('#kSchool'); await r.check('A6 School: Student / Teacher', '#roleStep:not([hidden])')
    await r.click('#rStudent'); await r.check('A7 Student: find your school', '#schoolStep:not([hidden])')
    await r.fill('#schoolSearch', 'zzqq'); await p.wait_for_timeout(500); await r.check('A8 School search with no match', '#schoolList:has-text("No school found")', '"No school found" message')
    await r.fill('#schoolSearch', 'Demo'); await p.wait_for_timeout(500); await r.check('A9 School search results', '#schoolList button')
    await r.click('#schoolList button'); await r.check('A10 That school\'s student login: username + keypad', '#userStep:not([hidden])')
    await tap(r, '1'); await r.check('A11 Tapping the code with no username', '#loginFb:not(:empty)', 'a "type your username" message')
    await r.fill('#sUser', 'nobody.here'); await tap(r, fox_pin or '1234'); await r.check('A12 Unknown username, real code', '#loginFb:not(:empty)', 'an error message')
    await r.fill('#sUser', 'Fox.Comet'); await tap(r, '0000' if fox_pin != '0000' else '1111'); await r.check('A13 Right username, wrong code', '#loginFb:not(:empty)', 'an error message')
    await r.fill('#sUser', ' Fox.Comet@SD54.bc.ca ')
    await p.focus('#sUser'); await p.keyboard.press('Tab')
    for d in fox_pin: await p.keyboard.press(d)   # a child using the keyboard instead of tapping
    await p.wait_for_timeout(900)
    if not await logged_in(p):
        r.bugs.append((len(r.steps), 'A14 typing the code on the keyboard', {'kind': 'keyboard', 'detail': 'typing the 4 digits on a keyboard did not log in (only tapping works?)'}))
        await tap(r, fox_pin)
    await r.check('A14 Right username (as a whole email, odd capitals/spaces) + right code', '#home:not([hidden]), #intro:not([hidden])', '(the student home)')
    await skip_intro(r)
    await p.reload(); await p.wait_for_timeout(900)
    await r.check('A15 Refresh while logged in stays logged in', '#home:not([hidden]), #intro:not([hidden])')
    await skip_intro(r)
    await r.click('.rail [data-tab=board]'); await r.check('A16 Top 10 (all-time stars, never resets)', '#board')
    t = await p.inner_text('#tab-board') if await p.query_selector('#tab-board') else await p.inner_text('#home')
    if 'Monday' in t or 'this week' in t.lower(): r.bugs.append((len(r.steps), 'A16 Top 10', {'kind': 'wording', 'detail': 'the Top 10 still mentions a weekly reset'}))
    await r.click('.rail [data-tab=logout]'); await r.check('A17 Log out goes back to Log in / Register', '#gateStep:not([hidden])')
    await student_door(r); await r.check('A18 Log in > School > Student again skips the school search (remembered)', '#userStep:not([hidden])')
    await p.reload(); await p.wait_for_timeout(500); await r.check('A19 Reopening the app on this device opens on the school login', '#userStep:not([hidden])')
    # back arrow chain
    await r.click('#loginBack'); await r.check('A20 Back from the school login: find your school (school forgotten)', '#schoolStep:not([hidden])')
    await r.click('#loginBack'); await r.check('A21 Back: Student / Teacher', '#roleStep:not([hidden])')
    await r.click('#loginBack'); await r.check('A22 Back: School / Family / Tutor', '#kindStep:not([hidden])')
    await r.click('#loginBack'); await r.check('A23 Back: Log in / Register', '#gateStep:not([hidden])')
    if await p.is_visible('#loginBack'): r.bugs.append((len(r.steps), 'A23', {'kind': 'wrong place', 'detail': 'back arrow still showing on the first screen'}))

    # ================= B. Ms Berry's class: temporary 4-digit code login =================
    await fresh(p, url)
    await r.click('#gateCode'); await r.check('B1 Log in with a 4-digit code: find your school', '#schoolStep:not([hidden])')
    await r.fill('#schoolSearch', 'Demo'); await p.wait_for_timeout(500); await r.click('#schoolList button')
    await r.check('B2 Pick your class (no links under it)', '#classStep:not([hidden])')
    for gone in ['#toUserLogin', '#classTeacher']:
        if await p.query_selector(gone): r.bugs.append((len(r.steps), 'B2', {'kind': 'still there', 'detail': f'{gone} should be removed'}))
    await r.click('#classList button'); await r.check('B3 Keypad for the class', '#pinStep:not([hidden])')
    await tap(r, '9876'); await r.check('B4 Wrong 4-digit code', '#loginFb:not(:empty)', 'an error message')
    await tap(r, '2222'); await r.check('B5 Right code', '#home:not([hidden]), #intro:not([hidden])')
    await skip_intro(r)
    await r.click('.rail [data-tab=logout]'); await r.check('B6 Log out (code device): Log in / Register', '#gateStep:not([hidden])')
    await r.click('#gateCode'); await r.check('B7 4-digit code again: straight to the class list (school remembered)', '#classStep:not([hidden])')
    await p.reload(); await p.wait_for_timeout(500); await r.check('B8 Reopening a code device: the class list', '#classStep:not([hidden])')
    await r.click('#loginBack'); await r.check('B9 Back from the class list', '#schoolStep:not([hidden]), #gateStep:not([hidden])')
    await fresh(p, url); await p.goto(url.rstrip('/') + '/?classlist'); await p.wait_for_timeout(500)
    await r.check('B10 mathwizz.co/?classlist on a new device: find your school, then the class list', '#schoolStep:not([hidden])')

    # ================= C. Register a new school =================
    await fresh(p, url)
    await r.click('#gateRegister'); await r.check('C1 Register: School / Family / Tutor', '#kindStep:not([hidden])')
    await r.click('#kSchool'); await r.check('C2 Register > School: create a teacher account', '#teach:not([hidden])')
    await r.click('#tSubmit'); await r.check('C3 Create account with nothing typed', '#tFb:not(:empty), #tEmail:invalid', 'a message or the browser\'s required-field prompt')
    await r.fill('#tEmail', 'new.principal@school.ca'); await r.fill('#tPass', 'short'); await r.click('#tSubmit'); await p.wait_for_timeout(400)
    await r.check('C4 Password too short', '#tFb:not(:empty), #tPass:invalid', 'a message')
    await r.fill('#tPass', 'longenough123'); await r.click('#tSubmit'); await p.wait_for_timeout(1000)
    await r.check('C5 Set up your school: set up or join', '#tSetup:not([hidden])')
    await p.click('#tSetup button[type=submit]'); await p.wait_for_timeout(400); await r.check('C6 Continue with nothing typed', '#tSetupFb:not(:empty), #tName:invalid', 'a message')
    await r.fill('#tName', 'Ms Principal'); await r.fill('#tSchoolName', 'Demo School'); await p.click('#tSetup button[type=submit]'); await p.wait_for_timeout(1200)
    await r.check('C7 After setting up: the teacher view', '#grown:not([hidden])')
    await r.click('#grownBack'); await p.wait_for_timeout(500); await r.check('C8 Teacher signs out: where do they land?', '#gateStep:not([hidden]), #teach:not([hidden])')

    # ================= D. Teacher sign-in =================
    await fresh(p, url)
    await r.click('#gateLogin'); await r.click('#kSchool'); await r.click('#rTeacher'); await r.check('D1 Log in > School > Teacher: sign in', '#tSignIn:not([hidden])')
    await r.click('#tBack'); await r.check('D2 Back from teacher sign-in', '#roleStep:not([hidden]), #gateStep:not([hidden])')
    await r.click('#rTeacher') if await p.is_visible('#rTeacher') else None
    if not await p.is_visible('#tSignIn'): await r.click('#gateLogin'); await r.click('#kSchool'); await r.click('#rTeacher')
    await r.fill('#tEmail', 'walkthrough@demo.ca'); await r.fill('#tPass', 'password123'); await r.click('#tSubmit'); await p.wait_for_timeout(1200)
    if await p.is_visible('#tSetup'):
        await r.check('D3 Teacher: set up school (first time)', '#tSetup')
        await r.fill('#tName', 'Ms Walkthrough'); await r.fill('#tSchoolName', 'Demo School'); await p.click('#tSetup button[type=submit]'); await p.wait_for_timeout(1200)
    # ---------------- teacher side ----------------
    await r.check('Teacher: class view', '#grown')
    await p.select_option('#minClass', '3'); await r.check('Teacher: class minimum 3 rounds', '#kpis .mintoday')
    # ================= E. teacher adds students, gives usernames, prints cards; a new student logs in =================
    await r.click('#addStudent'); await r.check('E1 Check list with nothing pasted', '#addMsg:not(:empty)', 'a message')
    await r.fill('#addNames', 'walk.through@sd54.bc.ca\nAva Smith\nLee, Noah\nAva Smith\nfox.comet@sd54.bc.ca\n@@@')
    await r.click('#addStudent'); await p.wait_for_timeout(700)
    await r.check('E2 Review: email, names, a clash, a duplicate, junk', '#addReview:not([hidden])')
    await r.click('#addSwap'); await p.wait_for_timeout(600); await r.check('E3 Swap first and last names', '#addReview:not([hidden])')
    await r.click('#addSwap'); await p.wait_for_timeout(600)
    await r.click('#addConfirm'); await p.wait_for_timeout(800); await r.check('E4 Students added', '#addMsg:not(:empty)')
    new_kid = await p.evaluate("""() => { const d = JSON.parse(localStorage.getItem('mm.demo.db.v1')); const s = d.students.find(x => x.username === 'smith.ava'); return s ? s.pin : ''; }""")
    if await p.is_visible('#giveAll'):
        await r.click('#giveAll'); await p.wait_for_timeout(500); await r.check('E5 Give everyone a username: review', '#unameReview:not([hidden])')
        if await p.is_visible('#uConfirm'):
            await r.click('#uConfirm'); await p.wait_for_timeout(800); await r.check('E6 Usernames given')
        elif await p.is_visible('#uCancel'): await r.click('#uCancel')
    await r.click('#showCards'); await p.wait_for_timeout(500); await r.check('E7 Login cards', '#codecards:not([hidden])')
    cards = await p.evaluate("() => [...document.querySelectorAll('#codecards .codecard')].map(c => c.innerText.replace(/\\s+/g, ' ').trim())")
    no_user = [c for c in cards if 'sername' not in c]
    if no_user: r.notes.append((len(r.steps), 'E7 Login cards', f'{len(no_user)} card(s) with no username, e.g. "{no_user[0][:90]}"'))
    await r.click('[data-gtab=goal]'); await r.check('Teacher: weekly goal')
    await r.click('[data-gtab=help]'); await r.check('Teacher: needs help')
    await r.click('[data-gtab=settings]'); await r.check('Teacher: settings')
    await r.click('[data-gtab=students]')
    if await p.is_visible('#gSchoolBtn'):
        await r.click('#gSchoolBtn'); await p.wait_for_timeout(600); await r.check('Principal: school page', '#school'); await r.click('#sBack')
    if await p.is_visible('#gSuperBtn'):
        await r.click('#gSuperBtn'); await p.wait_for_timeout(800); await r.check('Owner: all schools', '#super'); await r.click('#xBack')
    await r.click('#grownBack'); await r.check('Teacher: sign out', '#login:not([hidden]), #teach:not([hidden])')
    # the student the teacher just added logs in with the username + code from their card
    if new_kid:
        await fresh(p, url); await student_door(r); await r.fill('#schoolSearch', 'Demo'); await p.wait_for_timeout(500); await r.click('#schoolList button')
        await r.fill('#sUser', 'smith.ava'); await tap(r, new_kid)
        await r.check('F1 A student just added by the teacher logs in from their card', '#home:not([hidden]), #intro:not([hidden])')


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
