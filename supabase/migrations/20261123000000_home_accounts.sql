-- Home plan (Sam, 19 Nov 2026): a family can register one account per child with their own username and password.
--   A hidden school "MathWizz Home" holds every home child. Each child gets their own private one-student class, so every
--   existing screen, save, round log and badge keeps working unchanged. The school never appears in the school search.
--   Home children see one Top 30 across home players only (school students are never shown to strangers: schools were
--   told in the privacy pack that boards stay inside the class and school).
-- Passwords are stored as bcrypt hashes (pgcrypto) in home_accounts, which no client can read.
-- Guessing limits: per username 10 wrong tries per 10 minutes and 30 per day; per device 100 per 10 minutes and 500 per day.
-- Registration limit: 20 new accounts per device per day.

insert into public.schools (id, name, plan)
values ('00000000-0000-4000-8000-00000000a001', 'MathWizz Home', 'free')
on conflict (id) do nothing;

create table if not exists public.home_accounts (
  student_id uuid primary key references public.students (id) on delete cascade,
  pass_hash  text not null,
  created_at timestamptz not null default now()
);
alter table public.home_accounts enable row level security;
revoke all on public.home_accounts from public, anon, authenticated;

create or replace function public._home_school() returns uuid language sql immutable as $$
  select '00000000-0000-4000-8000-00000000a001'::uuid
$$;
revoke all on function public._home_school() from public, anon, authenticated;

-- the home school is not a real school: keep it out of the school search
create or replace function public.find_schools(p_query text) returns json
language plpgsql stable security definer set search_path = public, extensions as $$
declare q text := trim(coalesce(p_query, ''));
begin
  if length(q) < 2 then return '[]'::json; end if;
  return coalesce((
    select json_agg(json_build_object('id', s.id, 'name', s.name) order by s.name)
    from (select s.id, s.name from public.schools s
          where s.name ilike '%' || q || '%'
            and s.id <> public._home_school()
            and exists (select 1 from public.classes c where c.school_id = s.id and c.archived_at is null)
          order by s.name limit 12) s), '[]'::json);
end $$;
revoke all on function public.find_schools(text) from public;
grant execute on function public.find_schools(text) to anon, authenticated;

-- Register a child: username + password (+ the space name the app made up). Returns a session token, like a login.
create or replace function public.home_register(p_username text, p_password text, p_name text) returns json
language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  u text := public.norm_username(p_username);
  nm text := left(trim(coalesce(p_name, '')), 60);
  v_ip text := public._client_ip();
  v_class uuid; st public.students; t text;
begin
  if u is null or length(u) < 3 or u !~ '^[a-z0-9._-]+$' then return json_build_object('error', 'bad_username'); end if;
  if length(coalesce(p_password, '')) < 6 or length(p_password) > 72 then return json_build_object('error', 'bad_password'); end if;
  if nm = '' then nm := 'Space Cadet'; end if;
  if v_ip is not null and (select count(*) from public.login_failures where ip = v_ip and class_code = 'home-reg' and at > now() - interval '1 day') >= 20 then
    return json_build_object('error', 'too_many_tries');
  end if;
  if exists (select 1 from public.students where school_id = public._home_school() and username = u) then
    return json_build_object('error', 'username_taken');
  end if;
  insert into public.login_failures (class_code, ip) values ('home-reg', v_ip);
  insert into public.classes (school_id, name, code, settings) values (public._home_school(), 'Home', public.new_class_code(),
    '{"maxTable": 12, "division": false, "sound": true, "battles": false}') returning id into v_class;
  insert into public.students (class_id, name, username) values (v_class, nm, u) returning * into st;
  insert into public.home_accounts (student_id, pass_hash) values (st.id, crypt(p_password, gen_salt('bf', 8)));
  t := encode(gen_random_bytes(32), 'hex');
  insert into public.student_sessions (token, student_id) values (t, st.id);
  update public.students set last_login_at = now(), last_seen_at = now() where id = st.id;
  return json_build_object('token', t, 'student_id', st.id);
end $$;
revoke all on function public.home_register(text, text, text) from public;
grant execute on function public.home_register(text, text, text) to anon, authenticated;

-- Log in with username + password. One answer for a wrong username or a wrong password.
create or replace function public.home_login(p_username text, p_password text) returns json
language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  u text := public.norm_username(p_username);
  key text := 'home:' || coalesce(u, '?');
  v_ip text := public._client_ip();
  st public.students; t text;
begin
  if (select count(*) from public.login_failures where class_code = key and at > now() - interval '10 minutes') >= 10
     or (select count(*) from public.login_failures where class_code = key and at > now() - interval '1 day') >= 30 then
    return json_build_object('error', 'too_many_tries');
  end if;
  if v_ip is not null and (
       (select count(*) from public.login_failures where ip = v_ip and class_code like 'home:%' and at > now() - interval '10 minutes') >= 100
    or (select count(*) from public.login_failures where ip = v_ip and class_code like 'home:%' and at > now() - interval '1 day') >= 500) then
    return json_build_object('error', 'too_many_tries');
  end if;
  if u is not null and p_password is not null then
    select s.* into st from public.students s join public.home_accounts h on h.student_id = s.id
     where s.school_id = public._home_school() and s.username = u and h.pass_hash = crypt(p_password, h.pass_hash);
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
revoke all on function public.home_login(text, text) from public;
grant execute on function public.home_login(text, text) to anon, authenticated;

-- Top 30 across every home player, by stars earned (round_log, demo rounds excluded). Only for home children.
create or replace function public._home_board(me public.students) returns json
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if me.school_id is distinct from public._home_school() then return null; end if;
  return coalesce((
    select json_agg(json_build_object('id', b.id, 'name', b.name, 'skin', b.skin, 'stars', b.stars) order by b.stars desc, b.name)
      from (
        select s.id, s.name, coalesce(s.data ->> 'skin', 'blob') as skin, sum(l.stars)::int as stars
          from public.round_log l
          join public.students s on s.id = l.student_id
         where l.school_id = public._home_school() and not l.demo
         group by s.id, s.name, s.data
         having sum(l.stars) > 0
         order by sum(l.stars) desc, s.name
         limit 30
      ) b), '[]');
end $$;
revoke all on function public._home_board(public.students) from public, anon, authenticated;

-- student_state: home children get home = true and the Top 30 (home_board); everyone else gets null, as before
create or replace function public.student_state(p_token text)
returns json language plpgsql stable security definer set search_path to 'public','extensions' as $$
declare me public.students; since numeric := extract(epoch from public._week_start()) * 1000;
begin
  me := public._student_from_token(p_token);
  if me.id is null then return json_build_object('error', 'signed_out'); end if;
  return json_build_object(
    'me', json_build_object('id', me.id, 'name', me.name, 'data', me.data),
    'me_total_stars', (select coalesce(sum(l.stars), 0)::int from public.round_log l where l.student_id = me.id and not l.demo),
    'class', (select json_build_object('id', c.id, 'name', c.name, 'settings', c.settings) from public.classes c where c.id = me.class_id),
    'classmates', coalesce((
      select json_agg(json_build_object('id', s.id, 'name', s.name,
               'data', json_build_object('skin', coalesce(s.data ->> 'skin', 'blob'), 'totStars', coalesce(ls.stars, 0), 'wkMins', w.mins)) order by s.created_at)
      from public.students s
      left join lateral (
        select sum(l.stars)::int as stars from public.round_log l where l.student_id = s.id and not l.demo
      ) ls on true
      left join lateral (
        select coalesce(round(sum(coalesce(public.safe_num(r ->> 'len', 0, 60), 60)) / 60), 0)::int as mins
        from jsonb_array_elements(case when jsonb_typeof(s.data -> 'rounds') = 'array' then s.data -> 'rounds' else '[]'::jsonb end) r
        where jsonb_typeof(r) = 'object' and public.safe_num(r ->> 'd', 0, 99999999999999) >= since
      ) w on true
      where s.class_id = me.class_id and s.id <> me.id), '[]'),
    'competitions', public._student_competitions(me),
    'school_board', public._school_board(me),
    'played_days', public._played_days(me.id, 21),
    'home', me.school_id = public._home_school(),
    'home_board', public._home_board(me)
  );
end $$;
