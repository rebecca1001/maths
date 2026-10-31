# Mission Multiply

Times tables practice for BC classrooms (grades 3 to 7). Kids log in with a **class code** and their own **4-digit code**, play 1-minute rounds that adapt to what they know, earn stars, unlock characters and rockets, climb from Ground to Galaxy, and race the ghost of their own best round. Teachers sign in with email, set up classes, print code cards and see each student's progress.

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
2. Name it `mission-multiply`, set a strong database password (save it somewhere safe), and pick the region **Canada (Central)**. Keeping data in Canada makes school district privacy reviews (PIAs) much easier.
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
- After 30 wrong codes for a class in 10 minutes, logins for that class pause.
- **Archiving** a class stops its students logging in. Archived classes are deleted after 12 months (see step 3).

### Class settings (teacher dashboard)

- **Tables up to**: 10 × 10 (BC curriculum, the default for new classes) or 12 × 12
- **Division**: mixes division into rounds
- **Sound**: game sounds on or off

## Run the database tests

The tests need a local PostgreSQL 16 server. They load a small stand-in for Supabase's `auth` schema, apply the migration, and check that schools are kept separate, student login and battles work, and anon users are blocked.

```bash
PGHOST=localhost PGPORT=5432 PGUSER=postgres npm run test:db
```

## Build

```bash
npm run build   # outputs to dist/
```
