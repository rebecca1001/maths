-- Pilot scorecards (MathWizz owner only)
-- A pilot is one class trying MathWizz for a few weeks against agreed success criteria. If it meets 3 of the 4,
-- the school moves to a paid plan. The scorecard is worked out from round_log (server-checked rounds):
--   1 usage        70% of students play on 3+ days a week, in 75% of the pilot weeks (3 of 4)
--   2 fluency      class average correct answers per minute up 15%+ (latest 7 days of the pilot vs the baseline)
--   3 every child  70% of students beat their own baseline correct answers per minute
--   4 competitions 60% of the class plays during a competition that runs in the pilot
--   bonus          another teacher asks to join (ticked by hand)
-- Rounds last one minute, so correct answers per round = correct answers per minute. Demo students are left out.

create table if not exists public.pilots (
  id            uuid primary key default gen_random_uuid(),
  class_id      uuid not null references public.classes (id) on delete cascade,
  starts_on     date not null,
  ends_on       date not null,
  baseline_days int not null default 14 check (baseline_days between 3 and 60),
  bonus         boolean not null default false,
  notes         text not null default '' check (length(notes) <= 1000),
  created_at    timestamptz not null default now(),
  check (ends_on >= starts_on and ends_on - starts_on <= 120)
);
alter table public.pilots enable row level security;
revoke all on public.pilots from public, anon, authenticated;

create or replace function public._pilot_scorecard(p public.pilots) returns json
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  tz constant text := 'America/Vancouver';
  v_start timestamptz := p.starts_on::timestamp at time zone tz;
  v_end   timestamptz := (p.ends_on + 1)::timestamp at time zone tz;
  v_base  timestamptz := v_start - make_interval(days => p.baseline_days);
  v_upto  timestamptz := least(now(), v_end);
  v_recent timestamptz := greatest(v_start, least(now(), v_end) - interval '7 days');
  v_school uuid; v_n int; v_weeks int; v_need int; v_weeks_met int := 0;
  v_usage json; v_base_cpm numeric; v_now_cpm numeric; v_change numeric;
  v_elig int; v_impr int; v_comps json; v_best numeric; v_phase text; v_met int := 0;
  c1 boolean; c2 boolean; c3 boolean; c4 boolean;
begin
  select school_id into v_school from public.classes where id = p.class_id;
  select count(*) into v_n from public.students s where s.class_id = p.class_id and coalesce(s.data ->> 'demo', '') <> 'true';
  v_weeks := greatest(1, ceil((p.ends_on - p.starts_on + 1) / 7.0)::int);
  v_need := ceil(v_weeks * 0.75)::int;
  v_phase := case when now() < v_start then 'before' when now() >= v_end then 'finished' else 'running' end;

  -- 1) usage per pilot week: students who played on 3 or more different days that week
  select coalesce(json_agg(json_build_object('i', w.i, 'from', w.wfrom, 'to', w.wto, 'state', w.state, 'active', w.active,
                                             'students', v_n, 'pct', w.pct, 'met', w.state = 'done' and w.pct >= 70) order by w.i), '[]'),
         coalesce(sum(case when w.state = 'done' and w.pct >= 70 then 1 else 0 end), 0)
    into v_usage, v_weeks_met
  from (
    select g.i, g.wfrom, g.wto,
           case when now() < g.wfrom then 'future' when now() < g.wto then 'now' else 'done' end as state,
           a.active, case when v_n = 0 then 0 else round(100.0 * a.active / v_n) end as pct
      from (select i, v_start + i * interval '7 days' as wfrom, least(v_start + (i + 1) * interval '7 days', v_end) as wto
              from generate_series(0, v_weeks - 1) i) g
      cross join lateral (
        select count(*) as active from (
          select rl.student_id from public.round_log rl
            join public.students s on s.id = rl.student_id and s.class_id = p.class_id and coalesce(s.data ->> 'demo', '') <> 'true'
           where rl.d >= g.wfrom and rl.d < g.wto
           group by rl.student_id having count(distinct (rl.d at time zone tz)::date) >= 3) x) a
  ) w;

  -- 2) and 3) correct answers per minute: each student's average, baseline vs the latest 7 days of the pilot
  with per as (
    select s.id,
           avg(rl.correct) filter (where rl.d >= v_base and rl.d < v_start) as b,
           count(*) filter (where rl.d >= v_base and rl.d < v_start) as bn,
           avg(rl.correct) filter (where rl.d >= v_recent and rl.d < v_upto) as r,
           count(*) filter (where rl.d >= v_recent and rl.d < v_upto) as rn
      from public.students s
      left join public.round_log rl on rl.student_id = s.id
     where s.class_id = p.class_id and coalesce(s.data ->> 'demo', '') <> 'true'
     group by s.id)
  select round(avg(b) filter (where bn > 0), 2), round(avg(r) filter (where rn > 0), 2),
         count(*) filter (where bn >= 2 and rn >= 2), count(*) filter (where bn >= 2 and rn >= 2 and r > b)
    into v_base_cpm, v_now_cpm, v_elig, v_impr
    from per;
  v_change := case when v_base_cpm > 0 and v_now_cpm is not null and now() >= v_start then round(100 * (v_now_cpm / v_base_cpm - 1), 1) end;

  -- 4) competitions running during the pilot: share of the class who played while each one ran
  select coalesce(json_agg(x order by x.pct desc), '[]'), max(x.pct) into v_comps, v_best from (
    select c.title, c.kind, greatest(c.starts_at, v_start) as cfrom, least(public._comp_end(c), v_end) as cto,
           case when v_n = 0 then 0 else round(100.0 * (
             select count(distinct rl.student_id) from public.round_log rl
               join public.students s on s.id = rl.student_id and s.class_id = p.class_id and coalesce(s.data ->> 'demo', '') <> 'true'
              where rl.d >= greatest(c.starts_at, v_start) and rl.d < least(public._comp_end(c), v_end, now())) / v_n) end as pct
      from public.competitions c
     where c.school_id = v_school and (c.class_id is null or c.class_id = p.class_id)
       and c.starts_at < v_end and public._comp_end(c) > v_start) x;

  c1 := v_weeks_met >= v_need;
  c2 := coalesce(v_change >= 15, false);
  c3 := v_elig > 0 and v_impr * 100.0 / v_elig >= 70;
  c4 := coalesce(v_best >= 60, false);
  v_met := c1::int + c2::int + c3::int + c4::int;

  return json_build_object(
    'phase', v_phase, 'students', v_n, 'met', v_met, 'needed', 3, 'passed', v_met >= 3,
    'usage', json_build_object('met', c1, 'weeks', v_usage, 'weeks_met', v_weeks_met, 'weeks_needed', v_need,
                               'still_possible', v_weeks_met + (select count(*) from json_array_elements(v_usage) e where e ->> 'state' <> 'done') >= v_need),
    'fluency', json_build_object('met', c2, 'baseline', v_base_cpm, 'now', v_now_cpm, 'change', v_change, 'target', 15),
    'every_child', json_build_object('met', c3, 'eligible', v_elig, 'improved', v_impr,
                                     'pct', case when v_elig > 0 then round(v_impr * 100.0 / v_elig) end, 'target', 70),
    'competitions', json_build_object('met', c4, 'list', v_comps, 'best', v_best, 'target', 60),
    'bonus', p.bonus);
end $$;
revoke all on function public._pilot_scorecard(public.pilots) from public, anon, authenticated;

create or replace function public.super_pilots() returns json
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if not public.is_super_admin() then return json_build_object('error', 'not_allowed'); end if;
  return json_build_object('pilots', coalesce((
    select json_agg(json_build_object(
             'id', p.id, 'class_id', p.class_id, 'class_name', c.name, 'school_name', s.name,
             'starts_on', p.starts_on, 'ends_on', p.ends_on, 'baseline_days', p.baseline_days, 'bonus', p.bonus, 'notes', p.notes,
             'score', public._pilot_scorecard(p)) order by p.starts_on desc)
      from public.pilots p join public.classes c on c.id = p.class_id join public.schools s on s.id = c.school_id), '[]'));
end $$;
revoke all on function public.super_pilots() from public, anon;
grant execute on function public.super_pilots() to authenticated;

-- Create (no id) or update a pilot. p: {id?, class_id, starts_on, ends_on, baseline_days?, bonus?, notes?}
create or replace function public.super_pilot_save(p jsonb) returns json
language plpgsql volatile security definer set search_path = public, extensions as $$
declare v_id uuid; v_class uuid; v_start date; v_end date; v_days int; r public.pilots;
begin
  if not public.is_super_admin() then return json_build_object('error', 'not_allowed'); end if;
  begin
    v_id := nullif(p ->> 'id', '')::uuid; v_class := (p ->> 'class_id')::uuid;
    v_start := (p ->> 'starts_on')::date; v_end := (p ->> 'ends_on')::date;
  exception when others then return json_build_object('error', 'bad_input'); end;
  v_days := coalesce(public.safe_num(p ->> 'baseline_days', 3, 60)::int, 14);
  if not exists (select 1 from public.classes where id = v_class) then return json_build_object('error', 'bad_class'); end if;
  if v_start is null or v_end is null or v_end < v_start or v_end - v_start > 120 then return json_build_object('error', 'bad_dates'); end if;
  if v_id is null then
    insert into public.pilots (class_id, starts_on, ends_on, baseline_days, bonus, notes)
    values (v_class, v_start, v_end, v_days, coalesce((p ->> 'bonus')::boolean, false), left(coalesce(p ->> 'notes', ''), 1000))
    returning * into r;
  else
    update public.pilots set class_id = v_class, starts_on = v_start, ends_on = v_end, baseline_days = v_days,
           bonus = coalesce((p ->> 'bonus')::boolean, bonus), notes = left(coalesce(p ->> 'notes', notes), 1000)
     where id = v_id returning * into r;
    if r.id is null then return json_build_object('error', 'not_found'); end if;
  end if;
  return json_build_object('ok', true, 'id', r.id);
end $$;
revoke all on function public.super_pilot_save(jsonb) from public, anon;
grant execute on function public.super_pilot_save(jsonb) to authenticated;

create or replace function public.super_pilot_delete(p_id uuid) returns json
language plpgsql volatile security definer set search_path = public, extensions as $$
begin
  if not public.is_super_admin() then return json_build_object('error', 'not_allowed'); end if;
  delete from public.pilots where id = p_id;
  return json_build_object('ok', found);
end $$;
revoke all on function public.super_pilot_delete(uuid) from public, anon;
grant execute on function public.super_pilot_delete(uuid) to authenticated;
