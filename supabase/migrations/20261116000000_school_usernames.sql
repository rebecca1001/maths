-- Per-school student usernames (TT Rock Stars style), replacing the global school-email usernames from
-- 20261115000000_student_email_login.sql (no student had one yet, 12 Nov 2026).
--   Login = find your school (remembered on the device) + username + password.
--   Username is unique within the school only, stored without any domain: "franklin.joshua".
--   The child may type "franklin.joshua" or their whole school email "franklin.joshua@sd54.bc.ca": everything after @ is ignored.
--   Teachers paste school emails (username = the part before @) or names (username = surname.firstname, a number added on a clash).
-- The class code + 4-digit code login (student_login) is unchanged, and every student keeps a 4-digit code.

-- ---------- students.school_id (kept in step with the class, so usernames can be unique per school) ----------
alter table public.students add column if not exists school_id uuid references public.schools (id) on delete cascade;
-- backfill without the write trigger, so existing students' updated_at is left alone
alter table public.students disable trigger students_before_write;
update public.students s set school_id = c.school_id from public.classes c where c.id = s.class_id and s.school_id is distinct from c.school_id;
alter table public.students enable trigger students_before_write;
create or replace function public._student_school() returns trigger
language plpgsql set search_path = public, extensions as $$
begin
  new.school_id := (select school_id from public.classes where id = new.class_id);
  return new;
end $$;
drop trigger if exists students_school on public.students;
-- on every insert and update, so school_id can never be set to anything but the class's school
create trigger students_school before insert or update on public.students
  for each row execute function public._student_school();

-- ---------- usernames: per school, no domain ----------
drop index if exists public.students_username_key;
alter table public.students drop constraint if exists students_username_check;
update public.students set username = split_part(username, '@', 1) where username like '%@%';
alter table public.students add constraint students_username_check check (username is null or username ~ '^[a-z0-9._''-]{1,40}$');
create unique index if not exists students_school_username_key on public.students (school_id, username) where username is not null;

-- What the child typed -> the stored form: " Franklin.Joshua@SD54.bc.ca " -> "franklin.joshua"; null if nothing usable
create or replace function public.norm_username(p text) returns text
language sql immutable set search_path = public, extensions as $$
  select nullif(left(regexp_replace(split_part(lower(regexp_replace(coalesce(p, ''), '\s', '', 'g')), '@', 1), '[^a-z0-9._''-]', '', 'g'), 40), '')
$$;
grant execute on function public.norm_username(text) to anon, authenticated;

-- One name part for a username: "Zoë-Anne" -> "zoe-anne", "O'Brien" -> "obrien"
create or replace function public._slug(p text) returns text
language sql immutable set search_path = public, extensions as $$
  select regexp_replace(translate(lower(coalesce(p, '')),
    'àáâãäåāèéêëēìíîïīòóôõöøōùúûüūýÿçñß', 'aaaaaaaeeeeeiiiiiooooooouuuuuyycns'), '[^a-z0-9-]', '', 'g')
$$;
revoke all on function public._slug(text) from public, anon, authenticated;

-- ---------- teachers: add students (emails or names), with a dry run for the review screen ----------
-- p_rows: [{ "email": "...", "first": "Joshua", "last": "Franklin", "name": "Cosmic Fox" }]  (name = the space name the app picked)
-- Username: the email's part before @ if there is an email, otherwise surname.firstname (+2, 3 ... if taken at this school).
-- Returns { added: [...], skipped: [{ row, why }] }. With p_dry_run nothing is saved and passcodes are left out.
create or replace function public.add_school_students(p_class uuid, p_rows jsonb, p_dry_run boolean default false) returns json
language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  r jsonb; i int := 0; v_school uuid; u text; base text; real text; nm text; f text; l text; k int;
  taken text[] := '{}'; added jsonb := '[]'::jsonb; skipped jsonb := '[]'::jsonb; st public.students;
begin
  if auth.uid() is null then return json_build_object('error', 'not_allowed'); end if;
  select school_id into v_school from public.classes where id = p_class and school_id = public.my_school() and archived_at is null;
  if v_school is null then return json_build_object('error', 'not_allowed'); end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 200 then return json_build_object('error', 'bad_data'); end if;
  select coalesce(array_agg(username), '{}') into taken from public.students where school_id = v_school and username is not null;
  for r in select value from jsonb_array_elements(p_rows) loop
    i := i + 1; base := null;
    f := left(trim(coalesce(r ->> 'first', '')), 40); l := left(trim(coalesce(r ->> 'last', '')), 40);
    nm := left(trim(coalesce(r ->> 'name', '')), 60); if nm = '' then nm := 'Space Cadet'; end if;
    if coalesce(r ->> 'email', '') like '%@%' then
      u := public.norm_username(r ->> 'email');
      if u is null then skipped := skipped || jsonb_build_array(jsonb_build_object('row', i, 'why', 'bad_email')); continue; end if;
      if u = any(taken) then skipped := skipped || jsonb_build_array(jsonb_build_object('row', i, 'username', u, 'why', 'already_added')); continue; end if;
      real := nullif(trim(f || ' ' || l), '');
      if real is null and u ~ '^[a-z''-]+\.[a-z''-]+$' then -- school emails are surname.firstname
        real := initcap(split_part(u, '.', 2)) || ' ' || initcap(split_part(u, '.', 1));
      end if;
    else
      base := left(public._slug(l), 24) || '.' || left(public._slug(f), 14);
      base := trim(both '.' from base);
      if base = '' then skipped := skipped || jsonb_build_array(jsonb_build_object('row', i, 'why', 'no_name')); continue; end if;
      u := base; k := 1;
      while u = any(taken) loop k := k + 1; u := base || k; end loop;
      real := nullif(trim(f || ' ' || l), '');
    end if;
    taken := taken || u;
    if p_dry_run then
      added := added || jsonb_build_array(jsonb_build_object('row', i, 'username', u, 'real_name', real, 'renamed', base is not null and u <> base));
      continue;
    end if;
    insert into public.students (class_id, name, real_name, username, passcode)
    values (p_class, nm, left(real, 80), u, public.new_passcode())
    returning * into st;
    added := added || jsonb_build_array(jsonb_build_object('row', i, 'id', st.id, 'name', st.name, 'real_name', st.real_name, 'pin', st.pin,
                                                           'data', st.data, 'username', st.username, 'passcode', st.passcode));
  end loop;
  return json_build_object('added', added, 'skipped', skipped);
end $$;
revoke all on function public.add_school_students(uuid, jsonb, boolean) from public, anon;
grant execute on function public.add_school_students(uuid, jsonb, boolean) to authenticated;

-- Teacher gives a student a username (e.g. one of Ms Berry's code students), changes it, or makes a new password (p_username null).
-- Same student row, so stars, streak and history carry over, and their 4-digit code keeps working.
create or replace function public.set_student_login(p_student uuid, p_email text) returns json
language plpgsql volatile security definer set search_path = public, extensions as $$
declare u text := public.norm_username(p_email); st public.students;
begin
  if auth.uid() is null then return json_build_object('error', 'not_allowed'); end if;
  select s.* into st from public.students s where s.id = p_student and s.school_id = public.my_school();
  if st.id is null then return json_build_object('error', 'not_allowed'); end if;
  if p_email is not null and trim(p_email) <> '' then
    if u is null then return json_build_object('error', 'bad_username'); end if;
    if exists (select 1 from public.students where school_id = st.school_id and username = u and id <> st.id) then
      return json_build_object('error', 'already_added'); end if;
    update public.students set username = u, passcode = coalesce(passcode, public.new_passcode()) where id = st.id returning * into st;
  else
    if st.username is null then return json_build_object('error', 'bad_username'); end if;
    update public.students set passcode = public.new_passcode() where id = st.id returning * into st;
    delete from public.student_sessions where student_id = st.id; -- a new password signs the old one out
  end if;
  return json_build_object('ok', true, 'username', st.username, 'passcode', st.passcode);
end $$;
revoke all on function public.set_student_login(uuid, text) from public, anon;
grant execute on function public.set_student_login(uuid, text) to authenticated;

-- ---------- students: school + username + password ----------
create or replace function public.student_login_user(p_school uuid, p_username text, p_passcode text) returns json
language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  u text := public.norm_username(p_username);
  pc text := regexp_replace(lower(coalesce(p_passcode, '')), '[^a-z0-9]', '', 'g');
  key text := 'user:' || coalesce(p_school::text, '?') || ':' || coalesce(u, '?');
  v_ip text := public._client_ip();
  st public.students; t text;
begin
  -- throttle: 10 wrong tries per username per 10 minutes, and 300 per device per 10 minutes (shared with code logins)
  if (select count(*) from public.login_failures where class_code = key and at > now() - interval '10 minutes') >= 10 then
    return json_build_object('error', 'too_many_tries');
  end if;
  if v_ip is not null and (select count(*) from public.login_failures where ip = v_ip and at > now() - interval '10 minutes') >= 300 then
    return json_build_object('error', 'too_many_tries');
  end if;
  if u is not null and p_school is not null then
    -- passcode compared without dashes or spaces: "Blue Tiger 42" = "blue-tiger-42"
    select s.* into st from public.students s join public.classes c on c.id = s.class_id
     where s.school_id = p_school and s.username = u and replace(s.passcode, '-', '') = pc and c.archived_at is null;
  end if;
  if st.id is null then
    insert into public.login_failures (class_code, ip) values (key, v_ip);
    delete from public.login_failures where at < now() - interval '2 days';
    return json_build_object('error', 'wrong_login');
  end if;
  t := encode(gen_random_bytes(32), 'hex');
  insert into public.student_sessions (token, student_id) values (t, st.id);
  update public.students set last_login_at = now(), last_seen_at = now() where id = st.id;
  return json_build_object('token', t, 'student_id', st.id);
end $$;
revoke all on function public.student_login_user(uuid, text, text) from public;
grant execute on function public.student_login_user(uuid, text, text) to anon, authenticated;

-- the global-email versions are replaced by the per-school ones above
drop function if exists public.student_login_email(text, text);
drop function if exists public.add_email_students(uuid, jsonb);
