-- Simpler teacher view and leaderboards (Nov 2026)
-- 1) class_stats: per student, stars EARNED (never goes down when stars are spent in the shop), stars earned
--    this week and total rounds, all from round_log (server-checked, not editable from a browser).
-- 2) student_state: the class Top 10 now counts stars earned this week from Monday (school time zone), and
--    schools on a paid plan also get a school Top 10 (space names only, top 10 only, demo students left out).
-- 3) super_overview: 'stars' is now stars earned (was the spendable balance); the balance is still sent as 'balance'.

-- Monday 00:00 this week, America/Vancouver
create or replace function public._week_start() returns timestamptz
language sql stable set search_path = public, extensions as $$
  select date_trunc('week', now() at time zone 'America/Vancouver') at time zone 'America/Vancouver'
$$;
revoke all on function public._week_start() from public, anon, authenticated;

-- ---------- 1) class_stats ----------
create or replace function public.class_stats(p_class uuid) returns json
language plpgsql stable security definer set search_path = public, extensions as $$
declare v_school uuid; wk timestamptz := public._week_start();
begin
  if auth.uid() is null then return json_build_object('error', 'not_allowed'); end if;
  select school_id into v_school from public.classes where id = p_class;
  if v_school is null or v_school is distinct from public.my_school() then return json_build_object('error', 'not_allowed'); end if;
  return json_build_object('students', coalesce((
    select json_agg(json_build_object('id', s.id,
             'stars_total', coalesce(x.total, 0), 'stars_week', coalesce(x.week, 0), 'rounds_total', coalesce(x.n, 0)))
      from public.students s
      left join lateral (
        select sum(l.stars)::int as total, sum(l.stars) filter (where l.d >= wk)::int as week, count(*)::int as n
          from public.round_log l where l.student_id = s.id
      ) x on true
     where s.class_id = p_class), '[]'));
end $$;
revoke all on function public.class_stats(uuid) from public, anon;
grant execute on function public.class_stats(uuid) to authenticated;

-- ---------- 2) school Top 10 ----------
create or replace function public._school_board(me public.students) returns json
language plpgsql stable security definer set search_path = public, extensions as $$
declare v_school uuid; wk timestamptz := public._week_start();
begin
  select school_id into v_school from public.classes where id = me.class_id;
  if not public.school_has_competitions(v_school) then return null; end if; -- School and School Plus only
  return coalesce((
    select json_agg(json_build_object('id', b.id, 'name', b.name, 'skin', b.skin, 'class', b.class_name, 'stars', b.stars) order by b.stars desc, b.name)
      from (
        select s.id, s.name, coalesce(s.data ->> 'skin', 'blob') as skin, c.name as class_name, sum(l.stars)::int as stars
          from public.round_log l
          join public.students s on s.id = l.student_id
          join public.classes c on c.id = s.class_id and c.archived_at is null
         where l.school_id = v_school and l.d >= wk and not l.demo
         group by s.id, s.name, s.data, c.name
         having sum(l.stars) > 0
         order by sum(l.stars) desc, s.name
         limit 10
      ) b), '[]');
end $$;
revoke all on function public._school_board(public.students) from public, anon, authenticated;

create or replace function public.student_state(p_token text)
returns json language plpgsql stable security definer set search_path to 'public','extensions' as $$
declare me public.students; since numeric := extract(epoch from public._week_start()) * 1000;
begin
  me := public._student_from_token(p_token);
  if me.id is null then return json_build_object('error', 'signed_out'); end if;
  return json_build_object(
    'me', json_build_object('id', me.id, 'name', me.name, 'data', me.data),
    'class', (select json_build_object('id', c.id, 'name', c.name, 'settings', c.settings) from public.classes c where c.id = me.class_id),
    'classmates', coalesce((
      select json_agg(json_build_object('id', s.id, 'name', s.name,
               'data', json_build_object('skin', coalesce(s.data ->> 'skin', 'blob'), 'wkStars', w.stars, 'wkMins', w.mins)) order by s.created_at)
      from public.students s
      left join lateral (
        select coalesce(sum(coalesce(public.safe_num(r ->> 'stars', 0, 440), round(public.safe_num(r ->> 'pts', 0, 1000) / 10), public.safe_num(r ->> 'c', 0, 150) * 3, 0)), 0)::int as stars,
               coalesce(round(sum(coalesce(public.safe_num(r ->> 'len', 0, 60), 60)) / 60), 0)::int as mins
        from jsonb_array_elements(case when jsonb_typeof(s.data -> 'rounds') = 'array' then s.data -> 'rounds' else '[]'::jsonb end) r
        where jsonb_typeof(r) = 'object' and public.safe_num(r ->> 'd', 0, 99999999999999) >= since
      ) w on true
      where s.class_id = me.class_id and s.id <> me.id), '[]'),
    'competitions', public._student_competitions(me),
    'school_board', public._school_board(me)
  );
end $$;

-- ---------- 3) super_overview: stars earned ----------
create or replace function public.super_overview() returns json
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if not public.is_super_admin() then return json_build_object('error', 'not_allowed'); end if;
  return json_build_object(
    'now', (extract(epoch from now()) * 1000)::bigint,
    'schools', coalesce((select json_agg(json_build_object('id', s.id, 'name', s.name, 'plan', s.plan, 'created_at', s.created_at) order by s.name)
                         from public.schools s), '[]'),
    'teachers', coalesce((select json_agg(json_build_object('id', t.id, 'school_id', t.school_id, 'name', t.name, 'email', t.email,
                                                            'role', t.role, 'created_at', t.created_at) order by t.name)
                          from public.teachers t), '[]'),
    'classes', coalesce((select json_agg(json_build_object('id', c.id, 'school_id', c.school_id, 'teacher_id', c.teacher_id, 'name', c.name,
                                                           'code', c.code, 'archived_at', c.archived_at, 'created_at', c.created_at) order by c.name)
                         from public.classes c), '[]'),
    'students', coalesce((
      select json_agg(json_build_object(
        'id', st.id, 'class_id', st.class_id, 'name', st.name, 'real_name', st.real_name,
        'created_at', st.created_at, 'last_login_at', st.last_login_at, 'last_seen_at', st.last_seen_at,
        'demo', coalesce(st.data ->> 'demo', '') = 'true',
        'stars', coalesce((select sum(l.stars) from public.round_log l where l.student_id = st.id), 0)::int,
        'balance', case when (st.data ->> 'coins') ~ '^[0-9.]+$' then round((st.data ->> 'coins')::numeric) else 0 end,
        'rounds', rs.n, 'mins', rs.mins, 'first_round', rs.first_d, 'last_round', rs.last_d, 'days', rs.days) order by st.created_at)
      from public.students st
      left join lateral (
        select count(*) as n,
               coalesce(round(sum(x.len) / 60), 0) as mins,
               min(x.d)::bigint as first_d, max(x.d)::bigint as last_d,
               coalesce(json_agg(distinct to_char(to_timestamp(x.d / 1000) at time zone 'America/Vancouver', 'YYYY-MM-DD')), '[]') as days
        from (select (r ->> 'd')::numeric as d, coalesce(nullif(r ->> 'len', '')::numeric, 60) as len
              from jsonb_array_elements(case when jsonb_typeof(st.data -> 'rounds') = 'array' then st.data -> 'rounds' else '[]'::jsonb end) r
              where (r ->> 'd') ~ '^[0-9.]+$') x
      ) rs on true), '[]')
  );
end $$;
