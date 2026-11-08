-- Mission Multiply: initial schema
-- Schools have teachers; teachers have classes; classes have students.
-- Teachers sign in with Supabase Auth (email/password or Google/Microsoft).
-- Students never get an Auth account: they log in with their class code + a 4-digit code,
-- through the security-definer functions at the bottom, which hand back a session token.
-- Students' real names are never stored: only the made-up space name the game generates.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.schools (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(name) between 2 and 120),
  join_code   text not null unique default upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8)),
  created_at  timestamptz not null default now()
);

create table public.teachers (
  id          uuid primary key references auth.users (id) on delete cascade,
  school_id   uuid not null references public.schools (id) on delete cascade,
  name        text not null check (length(name) between 1 and 80),
  role        text not null default 'teacher' check (role in ('teacher', 'admin')),
  created_at  timestamptz not null default now()
);

create table public.classes (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null references public.schools (id) on delete cascade,
  teacher_id   uuid references public.teachers (id) on delete set null,
  name         text not null check (length(name) between 1 and 80),
  code         text not null unique,
  settings     jsonb not null default '{"maxTable": 10, "division": false, "sound": true, "battles": true}',
  archived_at  timestamptz,
  created_at   timestamptz not null default now()
);

create table public.students (
  id          uuid primary key default gen_random_uuid(),
  class_id    uuid not null references public.classes (id) on delete cascade,
  name        text not null check (length(name) between 1 and 60),
  pin         text not null check (pin ~ '^[0-9]{4}$'),
  data        jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (class_id, pin),
  check (pg_column_size(data) < 400000)
);
create index students_class_idx on public.students (class_id);

create table public.student_sessions (
  token       text primary key,
  student_id  uuid not null references public.students (id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '180 days'
);
create index student_sessions_student_idx on public.student_sessions (student_id);

create table public.challenges (
  id            uuid primary key default gen_random_uuid(),
  class_id      uuid not null references public.classes (id) on delete cascade,
  from_student  uuid not null references public.students (id) on delete cascade,
  to_student    uuid not null references public.students (id) on delete cascade,
  seed          bigint not null,
  scores        jsonb not null default '{}',
  created_at    timestamptz not null default now()
);
create index challenges_class_idx on public.challenges (class_id, created_at desc);

-- Failed student logins, used to slow down code guessing
create table public.login_failures (
  id          bigserial primary key,
  class_code  text not null,
  at          timestamptz not null default now()
);
create index login_failures_idx on public.login_failures (class_code, at);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- The school of the signed-in teacher (null for students and strangers)
create or replace function public.my_school() returns uuid
language sql stable security definer set search_path = public, extensions as $$
  select school_id from public.teachers where id = auth.uid()
$$;

create or replace function public.is_school_admin() returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from public.teachers where id = auth.uid() and role = 'admin')
$$;

-- Class codes: 6 characters, no look-alike letters (no O/0, I/1/L)
create or replace function public.new_class_code() returns text
language plpgsql volatile set search_path = public, extensions as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  c text;
begin
  loop
    c := '';
    for i in 1..6 loop
      c := c || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.classes where code = c);
  end loop;
  return c;
end $$;

-- A 4-digit code that is unique in the class and not too easy (no 1111, 1234, 4321)
create or replace function public.new_student_pin(p_class uuid) returns text
language plpgsql volatile set search_path = public, extensions as $$
declare
  p text;
  tries int := 0;
begin
  loop
    p := lpad(floor(random() * 10000)::int::text, 4, '0');
    tries := tries + 1;
    exit when tries > 500;
    continue when p ~ '^(\d)\1{3}$' or position(p in '0123456789') > 0 or position(p in '9876543210') > 0;
    exit when not exists (select 1 from public.students where class_id = p_class and pin = p);
  end loop;
  if tries > 500 then raise exception 'class is full'; end if;
  return p;
end $$;

create or replace function public.classes_before_insert() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  new.school_id := coalesce(new.school_id, public.my_school());
  new.teacher_id := coalesce(new.teacher_id, auth.uid());
  if new.code is null or new.code = '' then new.code := public.new_class_code(); end if;
  new.code := upper(new.code);
  return new;
end $$;
create trigger classes_before_insert before insert on public.classes
  for each row execute function public.classes_before_insert();

create or replace function public.students_before_write() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if tg_op = 'INSERT' and (new.pin is null or new.pin = '') then
    new.pin := public.new_student_pin(new.class_id);
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger students_before_write before insert or update on public.students
  for each row execute function public.students_before_write();

-- ---------------------------------------------------------------------------
-- Row level security: teachers see only their own school. Students and the
-- public (anon) get no table access at all; they go through the functions below.
-- ---------------------------------------------------------------------------
alter table public.schools          enable row level security;
alter table public.teachers         enable row level security;
alter table public.classes          enable row level security;
alter table public.students         enable row level security;
alter table public.student_sessions enable row level security;
alter table public.challenges       enable row level security;
alter table public.login_failures   enable row level security;

create policy schools_read on public.schools for select to authenticated
  using (id = public.my_school());
create policy schools_admin_update on public.schools for update to authenticated
  using (id = public.my_school() and public.is_school_admin())
  with check (id = public.my_school());

create policy teachers_read on public.teachers for select to authenticated
  using (school_id = public.my_school());
create policy teachers_update_self on public.teachers for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and school_id = public.my_school() and role = (select role from public.teachers t where t.id = auth.uid()));

create policy classes_all on public.classes for all to authenticated
  using (school_id = public.my_school())
  with check (school_id = public.my_school());

create policy students_all on public.students for all to authenticated
  using (class_id in (select id from public.classes where school_id = public.my_school()))
  with check (class_id in (select id from public.classes where school_id = public.my_school()));

create policy challenges_read on public.challenges for select to authenticated
  using (class_id in (select id from public.classes where school_id = public.my_school()));
create policy challenges_delete on public.challenges for delete to authenticated
  using (class_id in (select id from public.classes where school_id = public.my_school()));

revoke all on all tables in schema public from anon;
revoke all on public.student_sessions, public.login_failures from authenticated;
grant select, insert, update, delete on public.classes, public.students to authenticated;
grant select, update on public.schools, public.teachers to authenticated;
grant select, delete on public.challenges to authenticated;

-- ---------------------------------------------------------------------------
-- Teacher onboarding
-- ---------------------------------------------------------------------------
-- First teacher at a school: creates the school and becomes its admin
create or replace function public.create_school(p_school_name text, p_teacher_name text) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare s uuid;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  if exists (select 1 from public.teachers where id = auth.uid()) then raise exception 'already in a school'; end if;
  insert into public.schools (name) values (trim(p_school_name)) returning id into s;
  insert into public.teachers (id, school_id, name, role) values (auth.uid(), s, trim(p_teacher_name), 'admin');
  return s;
end $$;

-- Other teachers join with the school's join code
create or replace function public.join_school(p_join_code text, p_teacher_name text) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare s uuid;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  if exists (select 1 from public.teachers where id = auth.uid()) then raise exception 'already in a school'; end if;
  select id into s from public.schools where join_code = upper(trim(p_join_code));
  if s is null then raise exception 'school code not found'; end if;
  insert into public.teachers (id, school_id, name) values (auth.uid(), s, trim(p_teacher_name));
  return s;
end $$;

revoke all on function public.create_school(text, text), public.join_school(text, text) from public, anon;
grant execute on function public.create_school(text, text), public.join_school(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Student functions (callable without an account; the token proves who you are)
-- ---------------------------------------------------------------------------
create or replace function public._student_from_token(p_token text) returns public.students
language sql stable security definer set search_path = public, extensions as $$
  select s.* from public.student_sessions ss
  join public.students s on s.id = ss.student_id
  join public.classes c on c.id = s.class_id
  where ss.token = p_token and ss.expires_at > now() and c.archived_at is null
$$;

-- Log in with class code + 4-digit code. Returns a session token.
create or replace function public.student_login(p_class_code text, p_pin text) returns json
language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  cc text := upper(trim(coalesce(p_class_code, '')));
  st public.students;
  t text;
begin
  -- at most 30 wrong tries per class code every 10 minutes
  if (select count(*) from public.login_failures where class_code = cc and at > now() - interval '10 minutes') >= 30 then
    return json_build_object('error', 'too_many_tries');
  end if;
  select s.* into st from public.students s join public.classes c on c.id = s.class_id
   where c.code = cc and c.archived_at is null and s.pin = trim(coalesce(p_pin, ''));
  if st.id is null then
    insert into public.login_failures (class_code) values (cc);
    delete from public.login_failures where at < now() - interval '1 day';
    if not exists (select 1 from public.classes where code = cc and archived_at is null) then
      return json_build_object('error', 'no_class');
    end if;
    return json_build_object('error', 'wrong_code');
  end if;
  t := encode(gen_random_bytes(32), 'hex');
  insert into public.student_sessions (token, student_id) values (t, st.id);
  return json_build_object('token', t, 'student_id', st.id);
end $$;

create or replace function public.student_logout(p_token text) returns void
language sql volatile security definer set search_path = public, extensions as $$
  delete from public.student_sessions where token = p_token
$$;

-- Everything the game needs after login: me (full), classmates (no per-fact data), class settings, battles
create or replace function public.student_state(p_token text) returns json
language plpgsql stable security definer set search_path = public, extensions as $$
declare me public.students;
begin
  me := public._student_from_token(p_token);
  if me.id is null then return json_build_object('error', 'signed_out'); end if;
  return json_build_object(
    'me', json_build_object('id', me.id, 'name', me.name, 'data', me.data),
    'class', (select json_build_object('id', c.id, 'name', c.name, 'settings', c.settings) from public.classes c where c.id = me.class_id),
    'classmates', coalesce((select json_agg(json_build_object('id', s.id, 'name', s.name, 'data', s.data - 'facts') order by s.created_at)
                            from public.students s where s.class_id = me.class_id and s.id <> me.id), '[]'),
    'challenges', coalesce((select json_agg(json_build_object('id', ch.id, 'from', ch.from_student, 'to', ch.to_student, 'seed', ch.seed,
                                                              'scores', ch.scores, 'd', (extract(epoch from ch.created_at) * 1000)::bigint))
                            from public.challenges ch
                            where ch.class_id = me.class_id and (ch.from_student = me.id or ch.to_student = me.id)
                              and ch.created_at > now() - interval '21 days'), '[]')
  );
end $$;

-- Save my own game data (stars, rounds, facts, characters...)
create or replace function public.student_save(p_token text, p_data jsonb) returns json
language plpgsql volatile security definer set search_path = public, extensions as $$
declare me public.students;
begin
  me := public._student_from_token(p_token);
  if me.id is null then return json_build_object('error', 'signed_out'); end if;
  if jsonb_typeof(p_data) <> 'object' then return json_build_object('error', 'bad_data'); end if;
  update public.students set data = p_data - 'pin' - 'name' - 'id' where id = me.id;
  return json_build_object('ok', true);
end $$;

-- Start a battle against a classmate. Returns the new challenge id.
create or replace function public.challenge_create(p_token text, p_to uuid, p_seed bigint) returns json
language plpgsql volatile security definer set search_path = public, extensions as $$
declare me public.students; cid uuid;
begin
  me := public._student_from_token(p_token);
  if me.id is null then return json_build_object('error', 'signed_out'); end if;
  if p_to = me.id or not exists (select 1 from public.students where id = p_to and class_id = me.class_id) then
    return json_build_object('error', 'not_in_class');
  end if;
  if coalesce((select (settings ->> 'battles')::boolean from public.classes where id = me.class_id), true) = false then
    return json_build_object('error', 'battles_off');
  end if;
  insert into public.challenges (class_id, from_student, to_student, seed) values (me.class_id, me.id, p_to, p_seed) returning id into cid;
  return json_build_object('id', cid);
end $$;

-- Record my score in a battle I am part of
create or replace function public.challenge_score(p_token text, p_challenge uuid, p_score jsonb) returns json
language plpgsql volatile security definer set search_path = public, extensions as $$
declare me public.students;
begin
  me := public._student_from_token(p_token);
  if me.id is null then return json_build_object('error', 'signed_out'); end if;
  update public.challenges set scores = scores || jsonb_build_object(me.id::text, p_score)
   where id = p_challenge and (from_student = me.id or to_student = me.id) and not (scores ? me.id::text);
  if not found then return json_build_object('error', 'not_found'); end if;
  return json_build_object('ok', true);
end $$;

revoke all on function public._student_from_token(text) from public, anon, authenticated;
revoke all on function public.student_login(text, text), public.student_logout(text), public.student_state(text),
  public.student_save(text, jsonb), public.challenge_create(text, uuid, bigint), public.challenge_score(text, uuid, jsonb) from public;
grant execute on function public.student_login(text, text), public.student_logout(text), public.student_state(text),
  public.student_save(text, jsonb), public.challenge_create(text, uuid, bigint), public.challenge_score(text, uuid, jsonb)
  to anon, authenticated;
revoke all on function public.my_school(), public.is_school_admin(), public.new_class_code(), public.new_student_pin(uuid) from public, anon;
grant execute on function public.my_school(), public.is_school_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- Data retention: run daily (Supabase cron / pg_cron) - see README
-- Deletes classes archived more than 12 months ago (students, battles and sessions go with them)
-- ---------------------------------------------------------------------------
create or replace function public.purge_old_data() returns void
language sql volatile security definer set search_path = public, extensions as $$
  delete from public.classes where archived_at is not null and archived_at < now() - interval '12 months';
  delete from public.student_sessions where expires_at < now();
  delete from public.challenges where created_at < now() - interval '60 days';
$$;
revoke all on function public.purge_old_data() from public, anon, authenticated;
