-- Days a student really played, from round_log (the full history), not from the last 60 rounds kept on the device.
-- Fixes the Duolingo-style week boxes (a heavy player's last 60 rounds only reached back one day, so earlier days showed
-- grey while the streak number was right) and the teacher table's "Days (7 days)".
-- student_state gets played_days (last 21 days) and class_stats gets days (last 14) per student: 'YYYY-MM-DD' in Vancouver time.
-- Demo rows are excluded, like the Top 10s.
create or replace function public._played_days(p_student uuid, p_days int) returns json
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(json_agg(d order by d), '[]'::json) from (
    select distinct to_char(l.d at time zone 'America/Vancouver', 'YYYY-MM-DD') as d
      from public.round_log l
     where l.student_id = p_student and not l.demo and l.d > now() - make_interval(days => p_days)
  ) x
$$;
revoke all on function public._played_days(uuid, int) from public, anon, authenticated;

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
    'played_days', public._played_days(me.id, 21)
  );
end $$;

create or replace function public.class_stats(p_class uuid) returns json
language plpgsql stable security definer set search_path = public, extensions as $$
declare v_school uuid; wk timestamptz := public._week_start();
begin
  if auth.uid() is null then return json_build_object('error', 'not_allowed'); end if;
  select school_id into v_school from public.classes where id = p_class;
  if v_school is null or (v_school is distinct from public.my_school() and not public.is_super_admin()) then
    return json_build_object('error', 'not_allowed');
  end if;
  return json_build_object('students', coalesce((
    select json_agg(json_build_object('id', s.id,
             'stars_total', coalesce(x.total, 0), 'stars_week', coalesce(x.week, 0), 'rounds_total', coalesce(x.n, 0),
             'days', public._played_days(s.id, 14)))
      from public.students s
      left join lateral (
        select sum(l.stars)::int as total, sum(l.stars) filter (where l.d >= wk)::int as week, count(*)::int as n
          from public.round_log l where l.student_id = s.id
      ) x on true
     where s.class_id = p_class), '[]'));
end $$;
