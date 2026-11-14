# MathWizz

Times tables practice for BC classrooms (grades 3 to 7). Kids find their **school**, tap their **class**, and type their own **4-digit code** (a class code can be typed instead), play 1-minute rounds that adapt to what they know, earn stars, unlock characters and rockets, climb from Ground to Galaxy, and race the ghost of their own best round. Teachers sign in with email, set up classes, print code cards and see each student's progress.

Every student plays under a made-up space name (for example "Comet Fox"). Teachers can add each child's real name, which only teachers and admins at that school can see. It is never sent to students or shown in the game.

## Try it with no setup (demo mode)

```bash
npm install
npm run dev
```

Open the address it prints. Without Supabase keys the app runs in **demo mode**: everything is saved in your browser only.

- Students: class code `DEMO`, then `1111`, `2222`, `3333` or `4444`
- Teachers: tap **Teachers**, enter any email and an 8+ character password, tap **Create account**

## Set it up for real schools

You need two free accounts: **Supabase** (database and teacher logins) and a static web host (**Vercel** or **Netlify**).

### 1. Create the Supabase project (in Canada)

1. Go to <https://supabase.com>, sign up, and click **New project**.
2. Name it `mathwizz`, set a strong database password (save it somewhere safe), and pick the region **Canada (Central)**. Keeping data in Canada makes school district privacy reviews (PIAs) much easier.
3. When it's ready, open **SQL Editor**, click **New query**, paste the whole file `supabase/migrations/20261028000000_init.sql`, and click **Run**. If you set up the database before 29 Oct 2026, also run `supabase/migrations/20261029000000_fix_extensions_search_path.sql` (new installs don't need it, but it is safe to run).
4. Open **Project Settings → API** and copy the **Project URL** and the **anon public** key.

### 2. Teacher sign-in settings

In Supabase, open **Authentication**:

- **URL Configuration**: set **Site URL** to your website address (from step 4), and add it under **Redirect URLs**.
- **Providers → Email**: turn **Confirm email** OFF unless you have set up an email sender (for example Resend). Supabase's built-in email only reaches members of your Supabase team. Without email, a school admin resets teachers' passwords from the School page, and teachers change their own in Settings.
- Optional: **Providers → Google** and **Providers → Azure** (Microsoft) let teachers use their school accounts. Each needs a client ID and secret from Google Cloud or Microsoft Entra; Supabase's page for each provider links to the steps.

### 3. Delete old data automatically

In Supabase open **Database → Extensions**, enable **pg_cron**, then run this in the **SQL Editor**:

```sql
select cron.schedule('purge-old-data', '0 3 * * *', $$select public.purge_old_data()$$);
```

Every night this deletes classes archived more than 12 months ago (with their students), expired logins and old failed-login records.

### 4. Put the website online

1. Push this folder to GitHub (it already is, if you're reading this there).
2. Go to <https://vercel.com> (or Netlify), choose **Add New → Project**, and import the GitHub repo. It detects Vite automatically.
3. Under **Environment Variables**, add:
   - `VITE_SUPABASE_URL` = the Project URL from step 1
   - `VITE_SUPABASE_ANON_KEY` = the anon public key from step 1
4. Click **Deploy**. Put the address it gives you into Supabase's **Site URL** (step 2).

The anon key is meant to be public. All data is protected by the database rules in the migration, not by hiding the key.

### 5. First teacher

1. Open the website, tap **Teachers**, enter your email and a password, tap **Create account**, and confirm your email.
2. Sign in, enter your name, choose **My school is new**, and type the school name. You become the school's admin.
3. Your first class is created. Rename it by adding a new class, then type your students' names (one per line) under **Add students** and tap **Print login cards**.
4. Other teachers at your school create their own account and choose **Join my school** with the school code shown on your dashboard.

## Web address

The live site is **https://mathwizz.co** (teachers: https://mathwizz.co/?teacher=1), served by Vercel. Supabase Auth's Site URL and Redirect URLs must include https://mathwizz.co.

## Privacy

The privacy policy is at `/privacy` (file `public/privacy.html`), linked from both login screens. Fill in the [bracketed] details before schools use it. Teachers can download their class's data (Students tab) and delete their own account (Settings tab).

## How it works

| Part | Where |
| --- | --- |
| Page markup | `index.html` |
| Game, screens, teacher dashboard | `src/game.js` |
| Styles | `src/style.css` |
| Data layer (Supabase or demo) | `src/api.js` |
| Database tables, security rules, student login functions | `supabase/migrations/` |
| Database tests | `supabase/tests/` |

### Security model

- **Teachers** use Supabase Auth. Row level security means a teacher can only see and change classes and students in **their own school**.
- **Students** have no Auth account. They log in through the `student_login` database function with a class code and 4-digit code, and get a random session token. Every other student action (`student_state`, `student_save`) checks that token.
- The public (anon) role has **no direct access to any table**.
- Students see their own full progress. For classmates they only get a name, character, and stars and minutes played this week (for the Top 10). Nothing else about classmates reaches their device.
- Wrong codes are counted per device and per class: 100 per device per class in 10 minutes (300 per day), 300 per device across all classes in 10 minutes, and a class-wide ceiling of 400 in 10 minutes (1,200 per day). One noisy device cannot lock the rest of the class out. If the device address isn't available the old rule applies (100 per class in 10 minutes, 300 per day).
- Saved rounds are checked on the server: scores are recomputed from correct/answered/speed, speed is capped at a human limit, new rounds are limited to about one per 45 seconds of real time, old rounds can't be edited, and rank bonus stars are bounded by rank progress (see `supabase/migrations/20261108000000_...`).
- **Archiving** a class stops its students logging in. Archived classes are deleted after 12 months (see step 3).

### Class settings (teacher dashboard)

- **Tables up to**: 10 × 10 (BC curriculum, the default for new classes) or 12 × 12
- **Division**: mixes division into rounds
- **Sound**: game sounds on or off

## Tests

```bash
npm test          # 130+ unit tests: scoring, fluency levels, streaks, the adaptive question picker, data loading, demo data layer, screens
npm run test:db   # database rules (needs local PostgreSQL 16, see below)
npm run test:all  # both
```

The same checks run automatically on GitHub for every push to `main` or `staging` and every pull request (`.github/workflows/test.yml`).

## Staging

Pushing to the `staging` branch makes Vercel build a preview site at its own address, separate from https://mathwizz.co. It uses the same Supabase project, so test with the **Trial** school only (never real classes). Merge `staging` into `main` to go live.

## Run the database tests

The tests need a local PostgreSQL 16 server. They load a small stand-in for Supabase's `auth` schema, apply the migration, and check that schools are kept separate, student login and battles work, and anon users are blocked.

```bash
PGHOST=localhost PGPORT=5432 PGUSER=postgres npm run test:db
```

## Build

```bash
npm run build   # outputs to dist/
```

## Progress curves
Teachers see a **Class progress** curve on the Students tab. School admins see a **School progress** curve and one line per class on the School page. The owner sees every school and class on **All schools**. They show whether students are getting faster and getting more answers right per round (minutes played are not counted): average correct answers per round and seconds per correct answer, by week, for the last 10 weeks. Each student counts equally, rounds under 8 answers are ignored, and demo students and archived classes are left out. School and owner curves come from `school_progress()` / `super_progress()` (migration `20261109000000_progress_curves.sql`); the class curve is worked out in the browser (`src/progress.js`).


## Walkthrough script (finds bugs and clutter)

`scripts/walkthrough.py` clicks through every login path in demo mode, at desktop and phone widths: the TT Rock Stars funnel (Log in / Register, School / Family / Tutor, Student / Teacher, find your school, username + 4-digit code, typed or tapped), wrong usernames and codes, back arrows, refresh, log out, the temporary 4-digit code login (class list, `?classlist`), Register a new school, teacher sign-in, and the teacher adding students, giving usernames and printing cards, then a newly added student logging in. It flags JavaScript errors, screens landing in the wrong place, overlaps, sideways scrolling, unlabelled buttons and clutter.

```
npm run build && npx vite preview --port 4173 &
pip install playwright && playwright install chromium
python3 scripts/walkthrough.py            # writes walkthrough-report/report.md + screenshots
```

It reports JavaScript/console errors, sideways scrolling, overlapping or cut-off buttons, unlabelled fields, steps that land on the wrong screen, small tap targets on phones, and screens with more than 12 controls. Exit code 1 means it found a possible bug.

## Logging in (Nov 2026)

- **First screen asks who is logging in:** Student, Teacher, Principal or Parent (TT Rock Stars style). Teacher and Principal open the same sign-in; the account's role decides what they see. Parent is "coming soon".
- **Students:** school email + password. The email works however it is typed (`franklin.joshua@sd54`, `@sd54.bc.ca`, any capitals); it is stored as `franklin.joshua@sd54`. The password is made by the school (`blue-tiger-42`), printed on the login card, visible to the teacher, never chosen by the child. 10 wrong tries pause that email for 10 minutes.
- **Class code login is unchanged** (school → class → 4-digit code). A device that already uses it (it remembers the school) goes straight there, exactly as before. Everyone else can reach it with "Log in with a class code" (first screen and corner of the email screen).
- **Teachers:** paste school emails into Add students (names still give 4-digit codes). Real names come from the email (surname.firstname → Firstname Surname). New password button per student; "Add email login" for students who use a code (their code keeps working).
- Migration `20261115000000_student_email_login.sql` (`username`, `passcode`, `student_login_email`, `add_email_students`, `set_student_login`). Tests: `supabase/tests/test_email_login.sql`, `tests/login.test.js`.

## Simple teacher view, Top 10 and streaks (Nov 2026)

- **Teacher view:** a minimum-rounds panel at the top (one number for the whole class, "each time they play" = each day), and one table per student: Today (rounds today against their minimum), last played, days played (7 days), rounds (all), accuracy, correct per minute, stars earned, trend. A student can have their own minimum (or none) in their details. Stored in `classes.settings` as `minRounds` and `minFor` (teachers only can change it); the student's Play screen shows "2 of 3 rounds · 1 to go". Logic: `src/dashboard.js`. (The four group cards were removed 12 Nov.)
- **Stars earned:** teachers and the owner view see stars earned from `round_log` (never goes down when a student shops). Students still spend their balance in the shop.
- **Top 10:** students see the class Top 10, and on School / School Plus plans a school Top 10, ranked on stars earned since Monday. Nobody sees their rank outside the top 10.
- **Streak:** Duolingo-style card on the Play screen. Counts school days only: weekends, BC stat holidays and breaks (`NO_SCHOOL` in `src/game.js`, update each year) never break it, and one missed school day a week is covered by a freeze.
- **Owner view of any school:** the owner (super admin) gets a School picker in the class bar and sees the same teacher view for any school, read-only (no adding students, settings, goals or code changes). Migration `20261114000000_owner_views_any_school.sql` adds SELECT-only policies; writes stay limited to the owner's own school. Every teacher-side list is filtered by school id. Tests: `supabase/tests/test_owner_view.sql`.
- Migration: `supabase/migrations/20261113000000_simple_teacher_and_boards.sql` (`class_stats`, `_school_board`, `student_state`, `super_overview`). Tests: `supabase/tests/test_boards.sql`, `tests/dashboard.test.js`.

## Competitions (paused in the app since Nov 2026; database kept)
- Each school has a `plan` (`free`, `school`, `school_plus`). Only the MathWizz owner changes it, on the **All schools** page. School admins can still rename their school but cannot change the plan.
- Teachers make competitions for their own class (**Top player**, **Class goal**); school admins can also make school-wide ones (**School goal**, **Class race**, ranked per student). They count stars or correct answers between two dates. Teachers and schools provide the prizes.
- Students see a card on their home screen with how close they or their class are, from a week before the start to a week after the end. Only space names are shown to students.
- Scoring uses `round_log`, written only by `student_save` after it checks each round, so totals are exact and cannot be edited from a browser. Demo students are left out.
- Migration: `supabase/migrations/20261111000000_competitions.sql`. Tests: `supabase/tests/test_competitions.sql`, `tests/competitions.test.js`.

## Pilot scorecards (owner only)
- On the **All schools** page, **Pilots** tracks one class against the agreed success criteria (3 of 4 met moves the school to a paid plan): regular use (70% play 3+ days a week in 3 of 4 weeks), class fluency (+15% correct answers per minute against the baseline), every child improves (70% beat their own baseline), competitions (60% of the class plays during one), plus a bonus ticked by hand when another teacher asks to join.
- **Copy Friday update** gives a plain-text summary to paste into the weekly email.
- Scored from `round_log`; demo students left out. Migration `20261112000000_pilots.sql`, tests `supabase/tests/test_pilots.sql` and `tests/pilot.test.js`.
