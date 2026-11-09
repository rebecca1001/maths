-- Progress curves: is a class / school getting faster and getting more answers right per round (not minutes played)?
-- One row per class per week (Monday start, Vancouver time) for the last 10 weeks. Each student counts equally:
-- c_sum = sum over students of that student's average correct answers per round that week
-- s_sum = sum over students of that student's average seconds per correct answer (s_n = how many students have one)
-- The page divides by the number of students, so a school figure is an average of students, not of rounds.
-- Only rounds with 8+ answers count (a couple of quick answers is not a real round). Demo students and archived classes are left out.
-- School admins get their own school; the owner gets every school. Teachers' own class curve is worked out in the browser.

create or replace function public._progress_rows(p_school uuid)
returns json language sql stable security definer set search_path = public, extensions as $$
  with first_week as (
    select (date_trunc('week', now() at time zone 'America/Vancouver') - interval '9 weeks')::date as w
  ), rr as (
    select st.id as sid, st.class_id,
           (date_trunc('week', to_timestamp(d.v / 1000.0) at time zone 'America/Vancouver'))::date as wk,
           c.v as c, ms.v as ms
    from public.students st
    join public.classes cl on cl.id = st.class_id and cl.archived_at is null
    cross join lateral jsonb_array_elements(case when jsonb_typeof(st.data -> 'rounds') = 'array' then st.data -> 'rounds' else '[]'::jsonb end) r
    cross join lateral (select public.safe_num(r ->> 'd', 0, 99999999999999) as v) d
    cross join lateral (select public.safe_num(r ->> 'c', 0, 150) as v) c
    cross join lateral (select public.safe_num(r ->> 'n', 0, 200) as v) n
    cross join lateral (select public.safe_num(r ->> 'ms', 0, 60000) as v) ms
    where (p_school is null or cl.school_id = p_school)
      and coalesce(st.data ->> 'demo', '') <> 'true'
      and jsonb_typeof(r) = 'object'
      and d.v is not null and c.v is not null and n.v is not null and ms.v is not null and n.v >= 8
  ), sw as (
    select sid, class_id, wk, count(*) as rounds, avg(c) as avg_c,
           case when sum(c) > 0 then sum(ms * c) / sum(c) / 1000 end as secs
    from rr where wk >= (select w from first_week) group by sid, class_id, wk
  )
  select coalesce(json_agg(json_build_object(
           'class_id', class_id, 'wk', to_char(wk, 'YYYY-MM-DD'), 'students', students, 'rounds', rounds,
           'c_sum', c_sum, 's_sum', s_sum, 's_n', s_n) order by class_id, wk), '[]'::json)
  from (select class_id, wk, count(*) as students, sum(rounds)::int as rounds,
               round(sum(avg_c)::numeric, 3) as c_sum, round(coalesce(sum(secs), 0)::numeric, 3) as s_sum, count(secs)::int as s_n
        from sw group by class_id, wk) x
$$;
revoke all on function public._progress_rows(uuid) from public, anon, authenticated;

create or replace function public.school_progress() returns json
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if not public.is_school_admin() then return json_build_object('error', 'not_admin'); end if;
  return json_build_object('rows', public._progress_rows(public.my_school()));
end $$;

create or replace function public.super_progress() returns json
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if not public.is_super_admin() then return json_build_object('error', 'not_allowed'); end if;
  return json_build_object('rows', public._progress_rows(null));
end $$;

revoke all on function public.school_progress(), public.super_progress() from public, anon;
grant execute on function public.school_progress(), public.super_progress() to authenticated;
