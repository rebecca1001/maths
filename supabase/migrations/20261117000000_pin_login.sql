-- Username + 4-digit code login (Sam, 12 Nov 2026): no student passwords.
--   Find your school -> username (lastname.firstname) -> the 4-digit code every student already has, on a picture keypad.
--   The code is the same one the class code login uses, so Ms Berry's class keeps the same 4 digits when they get usernames.
--   Usernames are unique per school and codes unique per class, so the username finds the student and the code is the secret.
-- Guessing limits (10,000 possible codes):
--   per username: 10 wrong tries per 10 minutes and 30 per day
--   per device (network address) at one school: 500 wrong tries per day; across all schools: 1,000 per day
--   per device across every login: 300 per 10 minutes (as before)
-- Passwords: only the Trial test student had one (checked 12 Nov). They are cleared and no longer made.
-- student_login_user keeps its name and arguments so the live app keeps working; its third argument is now the code.

update public.students set passcode = null where passcode is not null;

create or replace function public.student_login_user(p_school uuid, p_username text, p_passcode text) returns json
language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  u text := public.norm_username(p_username);
  v_pin text := regexp_replace(coalesce(p_passcode, ''), '[^0-9]', '', 'g');
  key text := 'user:' || coalesce(p_school::text, '?') || ':' || coalesce(u, '?');
  school_key text := 'user:' || coalesce(p_school::text, '?') || ':%';
  v_ip text := public._client_ip();
  st public.students; t text;
begin
  if (select count(*) from public.login_failures where class_code = key and at > now() - interval '10 minutes') >= 10
     or (select count(*) from public.login_failures where class_code = key and at > now() - interval '1 day') >= 30 then
    return json_build_object('error', 'too_many_tries');
  end if;
  if v_ip is not null and (
       (select count(*) from public.login_failures where ip = v_ip and at > now() - interval '10 minutes') >= 300
    or (select count(*) from public.login_failures where ip = v_ip and class_code like school_key and at > now() - interval '1 day') >= 500
    or (select count(*) from public.login_failures where ip = v_ip and class_code like 'user:%' and at > now() - interval '1 day') >= 1000) then
    return json_build_object('error', 'too_many_tries');
  end if;
  if u is not null and p_school is not null and v_pin ~ '^[0-9]{4}$' then
    select s.* into st from public.students s join public.classes c on c.id = s.class_id
     where s.school_id = p_school and s.username = u and s.pin = v_pin and c.archived_at is null;
  end if;
  if st.id is null then
    -- same answer whether or not the username exists
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

-- Teachers add students: same as before, but no password (every student gets a 4-digit code automatically)
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
    insert into public.students (class_id, name, real_name, username)
    values (p_class, nm, left(real, 80), u)
    returning * into st;
    added := added || jsonb_build_array(jsonb_build_object('row', i, 'id', st.id, 'name', st.name, 'real_name', st.real_name, 'pin', st.pin,
                                                           'data', st.data, 'username', st.username));
  end loop;
  return json_build_object('added', added, 'skipped', skipped);
end $$;
revoke all on function public.add_school_students(uuid, jsonb, boolean) from public, anon;
grant execute on function public.add_school_students(uuid, jsonb, boolean) to authenticated;

-- Teacher gives a student a username (e.g. one of Ms Berry's class), or changes it. Same row: history and 4-digit code kept.
create or replace function public.set_student_login(p_student uuid, p_email text) returns json
language plpgsql volatile security definer set search_path = public, extensions as $$
declare u text := public.norm_username(p_email); st public.students;
begin
  if auth.uid() is null then return json_build_object('error', 'not_allowed'); end if;
  select s.* into st from public.students s where s.id = p_student and s.school_id = public.my_school();
  if st.id is null then return json_build_object('error', 'not_allowed'); end if;
  if u is null then return json_build_object('error', 'bad_username'); end if;
  if exists (select 1 from public.students where school_id = st.school_id and username = u and id <> st.id) then
    return json_build_object('error', 'already_added'); end if;
  update public.students set username = u where id = st.id returning * into st;
  return json_build_object('ok', true, 'username', st.username, 'pin', st.pin);
end $$;
revoke all on function public.set_student_login(uuid, text) from public, anon;
grant execute on function public.set_student_login(uuid, text) to authenticated;

drop function if exists public.new_passcode();
