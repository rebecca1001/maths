-- Class Top 10 and school Top 10 now count stars the same way (Sam, 13 Nov: 4,915 on the class board vs 6,811 on the school board).
-- The school board counted every round this week from round_log; the class board counted from each student's saved rounds,
-- which keep only the last 60, so heavy players lost their early-week rounds. Now both use round_log (demo rounds excluded).
-- student_state also returns me_week_stars, so the "you" row matches; minutes played still come from the saved rounds.
create or replace function public.student_state(p_token text)
returns json language plpgsql stable security definer set search_path to 'public','extensions' as $$
declare me public.students; wk timestamptz := public._week_start(); since numeric := extract(epoch from public._week_start()) * 1000;
begin
  me := public._student_from_token(p_token);
  if me.id is null then return json_build_object('error', 'signed_out'); end if;
  return json_build_object(
    'me', json_build_object('id', me.id, 'name', me.name, 'data', me.data),
    'me_week_stars', (select coalesce(sum(l.stars), 0)::int from public.round_log l where l.student_id = me.id and l.d >= wk and not l.demo),
    'class', (select json_build_object('id', c.id, 'name', c.name, 'settings', c.settings) from public.classes c where c.id = me.class_id),
    'classmates', coalesce((
      select json_agg(json_build_object('id', s.id, 'name', s.name,
               'data', json_build_object('skin', coalesce(s.data ->> 'skin', 'blob'), 'wkStars', coalesce(ls.stars, 0), 'wkMins', w.mins)) order by s.created_at)
      from public.students s
      left join lateral (
        select sum(l.stars)::int as stars from public.round_log l where l.student_id = s.id and l.d >= wk and not l.demo
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
create index if not exists round_log_student_idx on public.round_log (student_id, d);
