-- Student email + password login (Nov 2026), alongside the class code + 4-digit code login, which is unchanged.
-- Username = the student's school email, stored as "local@district" (franklin.joshua@sd54), so every way a child
-- types it works: franklin.joshua@sd54, franklin.joshua@sd54.bc.ca, FRANKLIN.Joshua@SD54.BC.CA.
-- Password = a school-made passcode like "blue-tiger-42". Children never choose it (no "123"), teachers can see it
-- and make a new one, and there is no email reset (the children's school emails are not inboxes they use).

alter table public.students add column if not exists username text;
alter table public.students add column if not exists passcode text;
do $$ begin
  alter table public.students add constraint students_username_check check (username is null or username ~ '^[a-z0-9._''-]{1,64}@[a-z0-9-]{1,40}$');
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.students add constraint students_passcode_check check (passcode is null or passcode ~ '^[a-z]{3,8}-[a-z]{3,8}-[0-9]{2}$');
exception when duplicate_object then null; end $$;
create unique index if not exists students_username_key on public.students (username) where username is not null;

-- "Franklin.Joshua@SD54.bc.ca " -> "franklin.joshua@sd54"; null when it is not an email
create or replace function public.norm_student_email(p text) returns text
language sql immutable set search_path = public, extensions as $$
  select case when x ~ '^[a-z0-9._''-]{1,64}@[a-z0-9-]{1,40}(\.[a-z0-9-]+)*$'
              then split_part(x, '@', 1) || '@' || split_part(split_part(x, '@', 2), '.', 1) end
    from (select lower(regexp_replace(coalesce(p, ''), '\s', '', 'g')) as x) t
$$;
grant execute on function public.norm_student_email(text) to anon, authenticated;

-- A friendly passcode: colour-animal-number, easy for a Grade 3 child to type, about 100k combinations
create or replace function public.new_passcode() returns text
language sql volatile set search_path = public, extensions as $$
  select (array['red','blue','green','gold','pink','purple','orange','silver','teal','lime','ruby','mint','coral','sky','sun','moon'])[1 + floor(random() * 16)::int]
      || '-' ||
         (array['tiger','panda','otter','falcon','koala','shark','eagle','fox','wolf','owl','lynx','hawk','bear','frog','whale','comet','rocket','dragon','zebra','llama'])[1 + floor(random() * 20)::int]
      || '-' || lpad((10 + floor(random() * 90))::int::text, 2, '0')
$$;
revoke all on function public.new_passcode() from public, anon, authenticated;

-- "franklin.joshua" -> "Joshua Franklin" (BC school emails are surname.firstname); only teachers see real names
create or replace function public._name_from_email(u text) returns text
language sql immutable set search_path = public, extensions as $$
  select case when position('.' in l) > 0
              then initcap(split_part(l, '.', 2)) || ' ' || initcap(split_part(l, '.', 1))
              else initcap(l) end
    from (select split_part(u, '@', 1) as l) t
$$;
revoke all on function public._name_from_email(text) from public, anon, authenticated;

-- ---------- teachers: add students by school email ----------
-- p_rows: [{ "email": "...", "name": "Cosmic Fox" }]  (name = the space name the app picked)
-- Returns the new students, plus the emails that could not be added and why.
create or replace function public.add_email_students(p_class uuid, p_rows jsonb) returns json
language plpgsql volatile security definer set search_path = public, extensions as $$
declare r jsonb; u text; nm text; added jsonb := '[]'::jsonb; skipped jsonb := '[]'::jsonb; st public.students; n int := 0;
begin
  if auth.uid() is null then return json_build_object('error', 'not_allowed'); end if;
  if not exists (select 1 from public.classes where id = p_class and school_id = public.my_school() and archived_at is null) then
    return json_build_object('error', 'not_allowed');
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 60 then return json_build_object('error', 'bad_data'); end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    u := public.norm_student_email(r ->> 'email');
    nm := left(trim(coalesce(r ->> 'name', '')), 60);
    if u is null then skipped := skipped || jsonb_build_array(jsonb_build_object('email', left(coalesce(r ->> 'email', ''), 80), 'why', 'not_an_email')); continue; end if;
    if exists (select 1 from public.students where username = u) then
      skipped := skipped || jsonb_build_array(jsonb_build_object('email', u, 'why', 'already_added')); continue;
    end if;
    if nm = '' then nm := 'Space Cadet'; end if;
    insert into public.students (class_id, name, real_name, username, passcode)
    values (p_class, nm, public._name_from_email(u), u, public.new_passcode())
    returning * into st;
    added := added || jsonb_build_array(jsonb_build_object('id', st.id, 'name', st.name, 'real_name', st.real_name, 'pin', st.pin,
                                                           'data', st.data, 'username', st.username, 'passcode', st.passcode));
    n := n + 1;
  end loop;
  return json_build_object('added', added, 'skipped', skipped);
end $$;
revoke all on function public.add_email_students(uuid, jsonb) from public, anon;
grant execute on function public.add_email_students(uuid, jsonb) to authenticated;

-- Teacher gives a student email login (or a new passcode). Works for students who already use a code too.
create or replace function public.set_student_login(p_student uuid, p_email text) returns json
language plpgsql volatile security definer set search_path = public, extensions as $$
declare u text := nullif(public.norm_student_email(p_email), ''); st public.students;
begin
  if auth.uid() is null then return json_build_object('error', 'not_allowed'); end if;
  select s.* into st from public.students s join public.classes c on c.id = s.class_id
   where s.id = p_student and c.school_id = public.my_school();
  if st.id is null then return json_build_object('error', 'not_allowed'); end if;
  if p_email is not null and trim(p_email) <> '' then
    if u is null then return json_build_object('error', 'not_an_email'); end if;
    if exists (select 1 from public.students where username = u and id <> st.id) then return json_build_object('error', 'already_added'); end if;
  else
    u := st.username; -- just a new passcode
    if u is null then return json_build_object('error', 'not_an_email'); end if;
  end if;
  update public.students set username = u, passcode = public.new_passcode() where id = st.id returning * into st;
  delete from public.student_sessions where student_id = st.id and p_email is null; -- a new passcode signs the old one out
  return json_build_object('ok', true, 'username', st.username, 'passcode', st.passcode);
end $$;
revoke all on function public.set_student_login(uuid, text) from public, anon;
grant execute on function public.set_student_login(uuid, text) to authenticated;

-- ---------- students: log in with school email + passcode ----------
create or replace function public.student_login_email(p_email text, p_passcode text) returns json
language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  u text := public.norm_student_email(p_email);
  pc text := lower(regexp_replace(coalesce(p_passcode, ''), '\s', '', 'g'));
  key text := 'email:' || coalesce(u, '?');
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
  if u is not null then
    select s.* into st from public.students s join public.classes c on c.id = s.class_id
     where s.username = u and s.passcode = pc and c.archived_at is null;
  end if;
  if st.id is null then
    insert into public.login_failures (class_code, ip) values (key, v_ip);
    delete from public.login_failures where at < now() - interval '2 days';
    return json_build_object('error', case when u is null then 'not_an_email' else 'wrong_login' end);
  end if;
  t := encode(gen_random_bytes(32), 'hex');
  insert into public.student_sessions (token, student_id) values (t, st.id);
  update public.students set last_login_at = now(), last_seen_at = now() where id = st.id;
  return json_build_object('token', t, 'student_id', st.id);
end $$;
revoke all on function public.student_login_email(text, text) from public;
grant execute on function public.student_login_email(text, text) to anon, authenticated;
