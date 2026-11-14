-- Top 10s never reset (Sam, 13 Nov: "this should never reset to 0"). Class and school Top 10 now rank every star ever earned
-- (round_log, demo rounds excluded), not stars since Monday.
-- student_state: classmates carry totStars (was wkStars, this week), and me_total_stars replaces me_week_stars.
-- Note: round_log was backfilled on 10 Nov with each student's last 60 days, and rows are purged after 400 days.
create or replace function public._school_board(me public.students)
returns json language plpgsql stable security definer set search_path to 'public', 'extensions' as $$
declare v_school uuid;
begin
  select school_id into v_school from public.classes where id = me.class_id;
  if not public.school_has_competitions(v_school) then return null; end if;
  return coalesce((
    select json_agg(json_build_object('id', b.id, 'name', b.name, 'skin', b.skin, 'class', b.class_name, 'stars', b.stars) order by b.stars desc, b.name)
      from (
        select s.id, s.name, coalesce(s.data ->> 'skin', 'blob') as skin, c.name as class_name, sum(l.stars)::int as stars
          from public.round_log l
          join public.students s on s.id = l.student_id
          join public.classes c on c.id = s.class_id and c.archived_at is null
         where l.school_id = v_school and not l.demo
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
    'school_board', public._school_board(me)
  );
end $$;
