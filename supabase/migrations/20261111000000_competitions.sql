-- Competitions (School and School Plus plans)
-- 1) Each school gets a plan: free, school or school_plus. Only the MathWizz owner can change it.
-- 2) round_log: one row per round, written only by student_save after it has checked the round. Competitions
--    are scored from this log, so totals are exact (students.data keeps only the last 60 rounds) and cannot be
--    edited from a browser or by a teacher.
-- 3) competitions: made by teachers (their class) or school admins (a class, or the whole school).
--    kinds: top_player    one class, the student with the most wins
--           class_target  one class works together towards a target
--           school_target every class adds to one school total towards a target
--           class_race    classes race each other, ranked by amount per student (fair for class sizes)
--    measure: stars or correct answers, counted between the start and end dates (school time zone).
--    Teachers and schools provide and hand out the prizes; the app only shows the competition.

-- ---------- 1) plans ----------
alter table public.schools add column if not exists plan text not null default 'free';
do $$ begin
  alter table public.schools add constraint schools_plan_check check (plan in ('free', 'school', 'school_plus'));
exception when duplicate_object then null; end $$;

-- School admins may rename their school, but nothing else on it (not the plan or the join code)
revoke update on public.schools from authenticated;
grant update (name) on public.schools to authenticated;

create or replace function public.school_has_competitions(p_school uuid) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select coalesce((select plan in ('school', 'school_plus') from public.schools where id = p_school), false)
$$;
revoke all on function public.school_has_competitions(uuid) from public, anon, authenticated;

create or replace function public.super_set_plan(p_school uuid, p_plan text) returns json
language plpgsql volatile security definer set search_path = public, extensions as $$
begin
  if not public.is_super_admin() then return json_build_object('error', 'not_allowed'); end if;
  if p_plan not in ('free', 'school', 'school_plus') then return json_build_object('error', 'bad_plan'); end if;
  update public.schools set plan = p_plan where id = p_school;
  if not found then return json_build_object('error', 'not_found'); end if;
  return json_build_object('ok', true, 'plan', p_plan);
end $$;
revoke all on function public.super_set_plan(uuid, text) from public, anon;
grant execute on function public.super_set_plan(uuid, text) to authenticated;

-- ---------- 2) round log ----------
create table if not exists public.round_log (
  id         bigint generated always as identity primary key,
  student_id uuid not null references public.students (id) on delete cascade,
  class_id   uuid not null references public.classes (id) on delete cascade,
  school_id  uuid not null references public.schools (id) on delete cascade,
  d          timestamptz not null,
  stars      int not null check (stars between 0 and 440),
  correct    int not null check (correct between 0 and 150),
  demo       boolean not null default false,
  constraint round_log_student_round unique (student_id, d)
);
create index if not exists round_log_school_idx on public.round_log (school_id, d);
create index if not exists round_log_class_idx on public.round_log (class_id, d);
alter table public.round_log enable row level security;
revoke all on public.round_log from public, anon, authenticated;

-- Fill it from the rounds students already have (last 60 days, capped like student_state does)
insert into public.round_log (student_id, class_id, school_id, d, stars, correct, demo)
select s.id, s.class_id, c.school_id,
       to_timestamp(public.safe_num(r ->> 'd', 0, 99999999999999) / 1000.0),
       least(440, greatest(0, coalesce(public.safe_num(r ->> 'stars', 0, 440), round(public.safe_num(r ->> 'pts', 0, 1000) / 10), public.safe_num(r ->> 'c', 0, 150) * 3, 0)))::int,
       coalesce(public.safe_num(r ->> 'c', 0, 150), 0)::int,
       coalesce(s.data ->> 'demo', '') = 'true'
  from public.students s
  join public.classes c on c.id = s.class_id
  cross join lateral jsonb_array_elements(case when jsonb_typeof(s.data -> 'rounds') = 'array' then s.data -> 'rounds' else '[]'::jsonb end) r
 where jsonb_typeof(r) = 'object'
   and public.safe_num(r ->> 'd', 0, 99999999999999) between extract(epoch from now() - interval '60 days') * 1000 and extract(epoch from now()) * 1000
on conflict on constraint round_log_student_round do nothing;

-- ---------- 3) competitions ----------
create table if not exists public.competitions (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools (id) on delete cascade,
  class_id    uuid references public.classes (id) on delete cascade,
  created_by  uuid references public.teachers (id) on delete set null,
  kind        text not null check (kind in ('top_player', 'class_target', 'school_target', 'class_race')),
  measure     text not null default 'stars' check (measure in ('stars', 'correct')),
  target      int check (target is null or target between 1 and 10000000),
  title       text not null check (length(title) between 1 and 80),
  prize       text not null check (length(prize) between 1 and 200),
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  ended_at    timestamptz,
  created_at  timestamptz not null default now(),
  check (ends_at > starts_at),
  check ((kind in ('top_player', 'class_target')) = (class_id is not null)),
  check ((kind in ('class_target', 'school_target')) = (target is not null))
);
create index if not exists competitions_school_idx on public.competitions (school_id, ends_at desc);
alter table public.competitions enable row level security;
revoke all on public.competitions from public, anon, authenticated;

-- When a competition really stops counting (its end date, or earlier if it was ended early)
create or replace function public._comp_end(c public.competitions) returns timestamptz
language sql immutable as $$ select case when c.ended_at is not null and c.ended_at < c.ends_at then greatest(c.ended_at, c.starts_at) else c.ends_at end $$;
revoke all on function public._comp_end(public.competitions) from public, anon, authenticated;

-- Totals per student in scope (students with no rounds count as 0; demo students and archived classes left out)
create or replace function public._comp_values(c public.competitions)
returns table (student_id uuid, class_id uuid, name text, real_name text, skin text, v bigint)
language sql stable security definer set search_path = public, extensions as $$
  select s.id, s.class_id, s.name, s.real_name, coalesce(s.data ->> 'skin', 'blob'), coalesce(t.v, 0)::bigint
    from public.students s
    join public.classes cl on cl.id = s.class_id
    left join (
      select rl.student_id, sum(case when c.measure = 'correct' then rl.correct else rl.stars end) as v
        from public.round_log rl
       where rl.school_id = c.school_id and (c.class_id is null or rl.class_id = c.class_id)
         and rl.d >= c.starts_at and rl.d < public._comp_end(c) and not rl.demo
       group by rl.student_id
    ) t on t.student_id = s.id
   where cl.school_id = c.school_id and cl.archived_at is null and (c.class_id is null or s.class_id = c.class_id)
     and coalesce(s.data ->> 'demo', '') <> 'true'
$$;
revoke all on function public._comp_values(public.competitions) from public, anon, authenticated;

-- Everything the screens need about one competition.
--  p_student: the student looking (their own numbers and rank), or null for teachers
--  p_teacher: true adds real names and the full standings
create or replace function public._comp_summary(c public.competitions, p_student uuid, p_teacher boolean) returns json
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_end timestamptz := public._comp_end(c);
  v_status text := case when now() < c.starts_at then 'upcoming' when now() >= v_end then 'ended' else 'active' end;
  v_me_class uuid; v_me bigint := 0; v_rank int; v_n int; v_total bigint := 0; v_cls_total bigint := 0;
  v_standings json; v_classes json; v_top json; v_class_name text; v_reached boolean := null;
begin
  if p_student is not null then select class_id into v_me_class from public.students where id = p_student; end if;
  select name into v_class_name from public.classes where id = c.class_id;

  select coalesce(sum(v), 0) into v_total from public._comp_values(c);
  if p_student is not null then select coalesce(v, 0) into v_me from public._comp_values(c) where student_id = p_student; end if;
  if v_me is null then v_me := 0; end if;

  if c.kind = 'top_player' then
    select count(*) into v_n from public._comp_values(c);
    if p_student is not null then select 1 + count(*) into v_rank from public._comp_values(c) where v > v_me; end if;
    select coalesce(json_agg(x order by x.v desc, x.name), '[]') into v_standings from (
      select student_id as id, name, skin, v, case when p_teacher then real_name end as real_name
        from public._comp_values(c) where p_teacher or v > 0 order by v desc, name limit case when p_teacher then 500 else 3 end) x;
  elsif c.kind in ('class_target', 'school_target') then
    v_reached := v_total >= c.target;
    if v_me_class is not null then select coalesce(sum(v), 0) into v_cls_total from public._comp_values(c) where class_id = v_me_class; end if;
    if c.kind = 'school_target' then
      select coalesce(json_agg(x order by x.v desc, x.name), '[]') into v_classes from (
        select cl.id, cl.name, coalesce(sum(cv.v), 0) as v, count(cv.student_id) as students
          from public.classes cl left join public._comp_values(c) cv on cv.class_id = cl.id
         where cl.school_id = c.school_id and cl.archived_at is null
         group by cl.id, cl.name) x;
    end if;
  elsif c.kind = 'class_race' then
    select coalesce(json_agg(x order by x.per desc, x.name), '[]') into v_classes from (
      select cl.id, cl.name, coalesce(sum(cv.v), 0) as v, count(cv.student_id) as students,
             round(coalesce(sum(cv.v), 0)::numeric / greatest(count(cv.student_id), 1), 1) as per,
             cl.id = v_me_class as mine
        from public.classes cl join public._comp_values(c) cv on cv.class_id = cl.id
       where cl.school_id = c.school_id and cl.archived_at is null
       group by cl.id, cl.name) x;
    if v_me_class is not null then
      select coalesce(sum(v), 0) into v_cls_total from public._comp_values(c) where class_id = v_me_class;
      select 1 + count(*) into v_rank from (
        select class_id, sum(v)::numeric / greatest(count(*), 1) as per from public._comp_values(c) group by class_id) r
       where r.per > (select sum(v)::numeric / greatest(count(*), 1) from public._comp_values(c) where class_id = v_me_class);
    end if;
  end if;

  return json_build_object(
    'id', c.id, 'kind', c.kind, 'measure', c.measure, 'target', c.target, 'title', c.title, 'prize', c.prize,
    'class_id', c.class_id, 'class_name', v_class_name, 'scope', case when c.class_id is null then 'school' else 'class' end,
    'starts_at', c.starts_at, 'ends_at', v_end, 'status', v_status, 'ended_early', c.ended_at is not null and c.ended_at < c.ends_at,
    'created_by', c.created_by, 'total', v_total, 'reached', v_reached,
    'me', v_me, 'rank', v_rank, 'players', v_n, 'my_class_total', v_cls_total,
    'standings', v_standings, 'classes', v_classes);
end $$;
revoke all on function public._comp_summary(public.competitions, uuid, boolean) from public, anon, authenticated;

-- Competitions a student can see: their class's and their school's, from a week before the start until a week after the end
create or replace function public._student_competitions(me public.students) returns json
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(json_agg(public._comp_summary(c, me.id, false) order by c.ends_at), '[]')
    from public.competitions c
    join public.classes cl on cl.id = me.class_id
   where c.school_id = cl.school_id
     and public.school_has_competitions(cl.school_id)
     and (c.class_id is null or c.class_id = me.class_id)
     and c.starts_at < now() + interval '7 days'
     and public._comp_end(c) > now() - interval '7 days'
$$;
revoke all on function public._student_competitions(public.students) from public, anon, authenticated;

-- Teacher side: the school's plan and the competitions this teacher can see (admins see all of them)
create or replace function public.competitions_list() returns json
language plpgsql stable security definer set search_path = public, extensions as $$
declare v_school uuid := public.my_school(); v_admin boolean := public.is_school_admin();
begin
  if auth.uid() is null or v_school is null then return json_build_object('error', 'not_signed_in'); end if;
  return json_build_object(
    'plan', (select plan from public.schools where id = v_school),
    'competitions', coalesce((
      select json_agg(public._comp_summary(c, null, true) order by public._comp_end(c) < now(), c.starts_at desc)
        from public.competitions c
       where c.school_id = v_school
         and public._comp_end(c) > now() - interval '90 days'
         and (v_admin or c.class_id is null or c.created_by = auth.uid()
              or c.class_id in (select id from public.classes where teacher_id = auth.uid()))), '[]'));
end $$;
revoke all on function public.competitions_list() from public, anon;
grant execute on function public.competitions_list() to authenticated;

-- Make a competition. p: {kind, measure, class_id, target, title, prize, starts_on 'YYYY-MM-DD', ends_on 'YYYY-MM-DD'}
create or replace function public.competition_create(p jsonb) returns json
language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  v_school uuid := public.my_school(); v_admin boolean := public.is_school_admin();
  v_kind text := coalesce(p ->> 'kind', ''); v_measure text := coalesce(nullif(p ->> 'measure', ''), 'stars');
  v_class uuid; v_target int; v_title text; v_prize text; v_start date; v_end date; cl public.classes; c public.competitions;
  v_today date := (now() at time zone 'America/Vancouver')::date;
begin
  if auth.uid() is null or v_school is null then return json_build_object('error', 'not_signed_in'); end if;
  if not public.school_has_competitions(v_school) then return json_build_object('error', 'needs_plan'); end if;
  if v_kind not in ('top_player', 'class_target', 'school_target', 'class_race') then return json_build_object('error', 'bad_kind'); end if;
  if v_measure not in ('stars', 'correct') then return json_build_object('error', 'bad_measure'); end if;

  if v_kind in ('top_player', 'class_target') then
    begin v_class := (p ->> 'class_id')::uuid; exception when others then v_class := null; end;
    select * into cl from public.classes where id = v_class and school_id = v_school and archived_at is null;
    if cl.id is null then return json_build_object('error', 'bad_class'); end if;
    if not v_admin and cl.teacher_id is distinct from auth.uid() then return json_build_object('error', 'not_your_class'); end if;
  else
    if not v_admin then return json_build_object('error', 'not_admin'); end if;
    v_class := null;
  end if;

  if v_kind in ('class_target', 'school_target') then
    v_target := public.safe_num(p ->> 'target', 1, 10000000)::int;
    if v_target is null then return json_build_object('error', 'bad_target'); end if;
  end if;

  v_prize := left(trim(coalesce(p ->> 'prize', '')), 200);
  if v_prize = '' then return json_build_object('error', 'no_prize'); end if;
  v_title := left(trim(coalesce(p ->> 'title', '')), 80);
  if v_title = '' then
    v_title := case v_kind when 'top_player' then 'Top player' when 'class_target' then 'Class goal'
                           when 'school_target' then 'School goal' else 'Class race' end;
  end if;

  begin v_start := (p ->> 'starts_on')::date; v_end := (p ->> 'ends_on')::date; exception when others then return json_build_object('error', 'bad_dates'); end;
  if v_start is null or v_end is null or v_end < v_start or v_start < v_today - 7 or v_start > v_today + 365 or v_end - v_start > 120 then
    return json_build_object('error', 'bad_dates');
  end if;

  if (select count(*) from public.competitions where school_id = v_school and ended_at is null and ends_at > now()) >= 20 then
    return json_build_object('error', 'too_many');
  end if;

  insert into public.competitions (school_id, class_id, created_by, kind, measure, target, title, prize, starts_at, ends_at)
  values (v_school, v_class, auth.uid(), v_kind, v_measure, v_target, v_title, v_prize,
          v_start::timestamp at time zone 'America/Vancouver', (v_end + 1)::timestamp at time zone 'America/Vancouver')
  returning * into c;
  return public._comp_summary(c, null, true);
end $$;
revoke all on function public.competition_create(jsonb) from public, anon;
grant execute on function public.competition_create(jsonb) to authenticated;

-- End a competition now (it keeps its results), or delete it. The teacher who made it, or a school admin.
create or replace function public.competition_end(p_id uuid, p_delete boolean) returns json
language plpgsql volatile security definer set search_path = public, extensions as $$
declare c public.competitions;
begin
  if auth.uid() is null then return json_build_object('error', 'not_signed_in'); end if;
  select * into c from public.competitions where id = p_id and school_id = public.my_school();
  if c.id is null then return json_build_object('error', 'not_found'); end if;
  if not public.is_school_admin() and c.created_by is distinct from auth.uid() then return json_build_object('error', 'not_allowed'); end if;
  if coalesce(p_delete, false) then
    delete from public.competitions where id = c.id;
  else
    update public.competitions set ended_at = now() where id = c.id and ended_at is null;
  end if;
  return json_build_object('ok', true);
end $$;
revoke all on function public.competition_end(uuid, boolean) from public, anon;
grant execute on function public.competition_end(uuid, boolean) to authenticated;

-- Keep the log tidy: rounds older than 400 days are no longer needed (competitions last at most 121 days)
create or replace function public.purge_old_data() returns void
language sql volatile security definer set search_path = public, extensions as $$
  delete from public.classes where archived_at is not null and archived_at < now() - interval '12 months';
  delete from public.student_sessions where expires_at < now();
  delete from public.login_failures where at < now() - interval '2 days';
  delete from public.round_log where d < now() - interval '400 days';
  delete from public.competitions where coalesce(ended_at, ends_at) < now() - interval '400 days';
$$;
revoke all on function public.purge_old_data() from public, anon, authenticated;

-- ---------- student_save: also writes the round log (otherwise unchanged from 20261108) ----------
create or replace function public.student_save(p_token text, p_data jsonb)
returns json language plpgsql volatile security definer set search_path to 'public','extensions' as $$
declare
  me public.students;
  d jsonb;
  now_ms numeric := floor(extract(epoch from now()) * 1000);
  old_r jsonb; out_r jsonb := '[]'::jsonb;
  credit_from timestamptz; allowed int; used int := 0; new_credit timestamptz;
  old_rp numeric; new_rp numeric; bonus numeric := 0; t int;
  r jsonb; rd numeric; oldmatch jsonb; seen numeric[] := '{}';
  c numeric; n numeric; ms numeric; vol numeric; spd numeric; acc numeric; pts numeric; base numeric;
  is_boss boolean; extra numeric; give numeric; len int;
  v_school uuid; v_demo boolean;
begin
  me := public._student_from_token(p_token);
  if me.id is null then return json_build_object('error', 'signed_out'); end if;
  select school_id into v_school from public.classes where id = me.class_id;
  v_demo := coalesce(me.data ->> 'demo', '') = 'true';
  if p_data is null or jsonb_typeof(p_data) <> 'object' then return json_build_object('error', 'bad_data'); end if;
  d := p_data - 'pin' - 'name' - 'id';

  -- rank progress can only go up (otherwise rank rewards could be claimed again)
  old_rp := coalesce(public.safe_num(me.data ->> 'rankPaid', -1, 9), -1);
  new_rp := old_rp;
  if (d ? 'rankPaid') or (me.data ? 'rankPaid') then
    new_rp := greatest(coalesce(public.safe_num(d ->> 'rankPaid', -1, 9), old_rp), old_rp);
    d := jsonb_set(d, '{rankPaid}', to_jsonb(new_rp::int));
  end if;
  for t in greatest(old_rp + 1, 0)::int .. new_rp::int loop bonus := bonus + 10 + 5 * t; end loop;

  old_r := case when jsonb_typeof(me.data -> 'rounds') = 'array' then me.data -> 'rounds' else '[]'::jsonb end;

  if d ? 'rounds' then
    if jsonb_typeof(d -> 'rounds') <> 'array' then
      d := jsonb_set(d, '{rounds}', old_r);
    else
      -- about one new round per 45 s of real time, saving up to 5 minutes' worth
      credit_from := greatest(coalesce(me.round_credit_at, now() - interval '5 minutes'), now() - interval '5 minutes');
      allowed := floor(extract(epoch from now() - credit_from) / 45)::int;
      for r in select value from jsonb_array_elements(d -> 'rounds') loop
        if jsonb_typeof(r) <> 'object' then continue; end if;
        rd := public.safe_num(r ->> 'd', 0, 99999999999999);
        if rd is null or rd = any(seen) then continue; end if;
        seen := seen || rd;
        -- a round the server already has is kept exactly as stored (it cannot be edited)
        select o into oldmatch from jsonb_array_elements(old_r) o
         where jsonb_typeof(o) = 'object' and public.safe_num(o ->> 'd', 0, 99999999999999) = rd limit 1;
        if oldmatch is not null then out_r := out_r || jsonb_build_array(oldmatch); continue; end if;
        if used >= allowed or rd < now_ms - 14 * 86400000 then continue; end if;
        rd := least(rd, now_ms);
        c := coalesce(public.safe_num(r ->> 'c', 0, 150), 0);
        n := least(greatest(coalesce(public.safe_num(r ->> 'n', 0, 200), 0), c), 200);
        ms := coalesce(public.safe_num(r ->> 'ms', 0, 60000), 0);
        if c > 0 then
          ms := greatest(ms, 400);                 -- nobody answers a times-table question faster than this
          c := least(c, floor(60000 / ms));        -- and a round is 60 seconds long
          n := greatest(n, c);
        end if;
        if c = 0 or n = 0 then pts := 0;
        else
          vol := least(1, n / 8);
          spd := round(500 * greatest(0, least(1, (7 - ms / 1000) / 5.5)) * vol);
          acc := round(500 * power(c / n, 2) * vol);
          pts := spd + acc;
        end if;
        base := round(pts / 10);
        is_boss := (r -> 'boss') = 'true'::jsonb;
        extra := greatest(coalesce(public.safe_num(r ->> 'stars', 0, 10000), base) - base - case when is_boss then 25 else 0 end, 0);
        give := least(extra, bonus); bonus := bonus - give;
        out_r := out_r || jsonb_build_array(jsonb_build_object(
          'd', rd::bigint, 'c', c::int, 'n', n::int, 'ms', round(ms)::int, 'len', 60,
          'best', coalesce(public.safe_num(r ->> 'best', 0, 150), 0)::int, 'boss', is_boss,
          'pts', pts::int, 'stars', (base + case when is_boss then 25 else 0 end + give)::int));
        -- every accepted new round also goes in the round log that competitions are scored from
        insert into public.round_log (student_id, class_id, school_id, d, stars, correct, demo)
        values (me.id, me.class_id, v_school, to_timestamp(rd / 1000.0),
                least(440, (base + case when is_boss then 25 else 0 end + give))::int, c::int, v_demo)
        on conflict on constraint round_log_student_round do nothing;
        used := used + 1;
      end loop;
      len := jsonb_array_length(out_r);
      if len > 60 then
        select coalesce(jsonb_agg(e order by ord), '[]'::jsonb) into out_r from jsonb_array_elements(out_r) with ordinality x(e, ord) where ord > len - 60;
      end if;
      d := jsonb_set(d, '{rounds}', out_r);
      if used > 0 then new_credit := credit_from + used * interval '45 seconds'; end if;
    end if;
  end if;

  begin
    update public.students set data = d, last_seen_at = now(), round_credit_at = coalesce(new_credit, round_credit_at) where id = me.id;
  exception when check_violation then
    return json_build_object('error', 'too_large');
  end;
  return json_build_object('ok', true);
end $$;

-- ---------- student_state: also returns the student's competitions (otherwise unchanged from 20261108) ----------
create or replace function public.student_state(p_token text)
returns json language plpgsql stable security definer set search_path to 'public','extensions' as $$
declare me public.students; since numeric := extract(epoch from now() - interval '7 days') * 1000;
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
    'competitions', public._student_competitions(me)
  );
end $$;

-- ---------- super_overview: also returns each school's plan (otherwise unchanged from 20261106) ----------
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
        'stars', case when (st.data ->> 'coins') ~ '^[0-9.]+$' then round((st.data ->> 'coins')::numeric) else 0 end,
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
