-- Tests for 20261112000000_pilots.sql (pilot scorecards). Any failure raises an exception.
\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
create temp table pa (k text primary key, v text);
grant all on pa to anon, authenticated;

insert into auth.users values ('eeeeeeee-0000-0000-0000-000000000001','pilotadmin@x.ca'), ('eeeeeeee-0000-0000-0000-000000000009','pilotowner@x.ca');
insert into public.schools (name) values ('Pilot School');
insert into public.teachers (id, school_id, name, role) select 'eeeeeeee-0000-0000-0000-000000000001', id, 'Pilot admin', 'admin' from public.schools where name='Pilot School';
insert into public.super_admins (user_id) values ('eeeeeeee-0000-0000-0000-000000000009');
insert into public.classes (school_id, teacher_id, name) select id, 'eeeeeeee-0000-0000-0000-000000000001', 'Pilot class' from public.schools where name='Pilot School';
insert into public.students (class_id, name) select c.id, n from public.classes c, unnest(array['P Ann','P Bob','P Cat','P Dan','P Demo']) n where c.name='Pilot class';
update public.students set data = '{"demo": true}' where name = 'P Demo';
insert into pa select 'class', id::text from public.classes where name='Pilot class';
insert into pa select 'school', id::text from public.schools where name='Pilot School';
insert into pa select 'start', to_char((now() at time zone 'America/Vancouver')::date - 30, 'YYYY-MM-DD');
insert into pa select 'end', to_char((now() at time zone 'America/Vancouver')::date - 3, 'YYYY-MM-DD');

-- rounds: day k after the pilot start (negative = baseline), at 10:00 local, plus an hour per extra round
create function pg_temp.r(who text, k int, n int, correct int) returns void language sql as $$
  insert into public.round_log (student_id, class_id, school_id, d, stars, correct, demo)
  select s.id, s.class_id, (select v from pa where k='school')::uuid,
         (((select v from pa where k='start')::date + k)::timestamp + make_interval(hours => 10 + g)) at time zone 'America/Vancouver',
         correct * 3, correct, s.name = 'P Demo'
    from public.students s, generate_series(0, n - 1) g where s.name = who $$;
-- baseline: everyone averages 10 correct a minute
select pg_temp.r(x, -5, 3, 10) from unnest(array['P Ann','P Bob','P Cat','P Dan']) x;
-- weeks 1-3: all four play on 3 days (days 0-2 of each week)
select pg_temp.r(x, w * 7 + d, 1, 11) from unnest(array['P Ann','P Bob','P Cat','P Dan']) x, generate_series(0, 2) w, generate_series(0, 2) d;
-- week 4 (the last 7 days): Ann and Bob on 3 days at 13; Cat and Dan on 2 days at 9 (slower than their baseline)
select pg_temp.r(x, 21 + d, 1, 13) from unnest(array['P Ann','P Bob']) x, generate_series(0, 2) d;
select pg_temp.r('P Cat', 21 + d, 1, 9) from generate_series(0, 1) d;
select pg_temp.r('P Dan', 21 + d, 1, 9) from generate_series(0, 1) d;
-- the demo kid plays every day at 40 and must not count anywhere
select pg_temp.r('P Demo', d, 1, 40) from generate_series(-5, 27) d;
-- a class competition in days 7-13 of the pilot
insert into public.competitions (school_id, class_id, kind, measure, title, prize, starts_at, ends_at)
select (select v from pa where k='school')::uuid, (select v from pa where k='class')::uuid, 'top_player', 'stars', 'Star of the week', 'Gift card',
       (((select v from pa where k='start')::date + 7)::timestamp) at time zone 'America/Vancouver',
       (((select v from pa where k='start')::date + 14)::timestamp) at time zone 'America/Vancouver';

set role authenticated;
do $$
declare r json; s json; c json;
begin
  -- a school admin is not the owner
  perform set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000001', true);
  if public.super_pilots()->>'error' <> 'not_allowed' then raise exception 'FAIL admin saw pilots'; end if;
  if public.super_pilot_save(jsonb_build_object('class_id',(select v from pa where k='class'),'starts_on','2026-11-16','ends_on','2026-12-11'))->>'error' <> 'not_allowed' then raise exception 'FAIL admin saved'; end if;
  raise notice 'only the owner can see or save pilots: true';

  perform set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000009', true);
  if public.super_pilot_save(jsonb_build_object('class_id',(select v from pa where k='class'),'starts_on','2026-12-11','ends_on','2026-11-16'))->>'error' <> 'bad_dates' then raise exception 'FAIL bad dates'; end if;
  if public.super_pilot_save(jsonb_build_object('class_id', gen_random_uuid(),'starts_on','2026-11-16','ends_on','2026-12-11'))->>'error' <> 'bad_class' then raise exception 'FAIL bad class'; end if;
  r := public.super_pilot_save(jsonb_build_object('class_id',(select v from pa where k='class'),'starts_on',(select v from pa where k='start'),'ends_on',(select v from pa where k='end'),'notes','Ms Berry'));
  if (r->>'ok') is distinct from 'true' then raise exception 'FAIL save: %', r; end if;
  insert into pa values ('pilot', r->>'id');

  select x into c from json_array_elements(public.super_pilots()->'pilots') x where x->>'id' = (select v from pa where k='pilot');
  s := c->'score';
  if s->>'phase' <> 'finished' or (s->>'students')::int <> 4 then raise exception 'FAIL phase/students: %', s; end if;
  -- usage: weeks 1-3 at 100%, week 4 at 50% -> 3 of 4 weeks -> met
  if (s->'usage'->>'weeks_met')::int <> 3 or (s->'usage'->>'met')::boolean is not true or (s->'usage'->'weeks'->3->>'pct')::int <> 50 then raise exception 'FAIL usage: %', s->'usage'; end if;
  -- fluency: baseline 10, last week (13+13+9+9)/4 = 11 -> +10% (target 15%) -> not met
  if (s->'fluency'->>'baseline')::numeric <> 10 or (s->'fluency'->>'now')::numeric <> 11 or (s->'fluency'->>'change')::numeric <> 10 or (s->'fluency'->>'met')::boolean then raise exception 'FAIL fluency: %', s->'fluency'; end if;
  -- every child: 2 of 4 improved = 50% (target 70%) -> not met
  if (s->'every_child'->>'eligible')::int <> 4 or (s->'every_child'->>'improved')::int <> 2 or (s->'every_child'->>'met')::boolean then raise exception 'FAIL every child: %', s->'every_child'; end if;
  -- competition: all 4 played during it -> 100% -> met
  if (s->'competitions'->>'best')::numeric <> 100 or (s->'competitions'->>'met')::boolean is not true then raise exception 'FAIL competitions: %', s->'competitions'; end if;
  if (s->>'met')::int <> 2 or (s->>'passed')::boolean then raise exception 'FAIL overall: %', s; end if;
  raise notice 'scorecard: usage met, fluency +10%% not met, every child 50%% not met, competition 100%% met, 2 of 4: true';

  -- bonus ticked by hand, and notes kept
  r := public.super_pilot_save(jsonb_build_object('id',(select v from pa where k='pilot'),'class_id',(select v from pa where k='class'),'starts_on',(select v from pa where k='start'),'ends_on',(select v from pa where k='end'),'bonus',true));
  select x into c from json_array_elements(public.super_pilots()->'pilots') x where x->>'id' = (select v from pa where k='pilot');
  if (c->'score'->>'bonus')::boolean is not true or c->>'notes' <> 'Ms Berry' then raise exception 'FAIL bonus/notes: %', c; end if;
  raise notice 'bonus and notes saved: true';
end $$;
reset role;

-- Dan speeds up instead: fluency (13+13+9+15)/4 = 12.5 -> +25%, every child 3 of 4 = 75% -> passes with 4 of 4
update public.round_log set correct = 15 where student_id = (select id from public.students where name='P Dan') and correct = 9;
set role authenticated;
do $$
declare s json;
begin
  perform set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000009', true);
  select x->'score' into s from json_array_elements(public.super_pilots()->'pilots') x where x->>'id' = (select v from pa where k='pilot');
  if (s->'fluency'->>'change')::numeric <> 25 or (s->'every_child'->>'pct')::int <> 75 or (s->>'met')::int <> 4 or (s->>'passed')::boolean is not true then raise exception 'FAIL pass case: %', s; end if;
  raise notice 'pass case: 4 of 4 met, passed: true';
  if (public.super_pilot_delete((select v from pa where k='pilot')::uuid)->>'ok') <> 'true' then raise exception 'FAIL delete'; end if;
  if json_array_length(public.super_pilots()->'pilots') <> 0 then raise exception 'FAIL still listed'; end if;
  raise notice 'owner deletes a pilot: true';
end $$;
reset role;
