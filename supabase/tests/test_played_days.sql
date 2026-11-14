-- Tests for 20261120000000_played_days.sql: played days come from round_log, not the last 60 saved rounds.
\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
insert into auth.users values ('0c1c0c1c-0000-0000-0000-000000000001','t@pd.ca');
insert into public.schools (name, plan) values ('PD School', 'school');
insert into public.teachers (id, school_id, name, role) select '0c1c0c1c-0000-0000-0000-000000000001', id, 'T', 'admin' from public.schools where name='PD School';
insert into public.classes (school_id, teacher_id, name) select id, '0c1c0c1c-0000-0000-0000-000000000001', 'PD class' from public.schools where name='PD School';
insert into public.students (class_id, name) select id, 'PD Kid' from public.classes where name='PD class';
-- played 1, 2 and 5 days ago (real), 3 days ago (demo: must not count), 30 days ago (too old)
insert into public.round_log (student_id, class_id, school_id, d, stars, correct, demo)
select s.id, s.class_id, c.school_id, now() - x.ago, 5, 10, x.demo
  from public.students s join public.classes c on c.id = s.class_id
  cross join (values (interval '1 day', false), (interval '2 days', false), (interval '5 days', false), (interval '3 days', true), (interval '30 days', false)) x(ago, demo)
 where s.name = 'PD Kid';
insert into public.student_sessions (token, student_id) select 'tok_pd', id from public.students where name='PD Kid';
set role anon;
do $$ declare st json; n int; begin
  st := public.student_state('tok_pd');
  n := json_array_length(st->'played_days');
  if n <> 3 then raise exception 'FAIL played_days % %', n, st->'played_days'; end if;
  raise notice 'student_state played_days counts real days in the last 21 days only: true';
end $$;
reset role;
set role authenticated;
do $$ declare r json; n int; begin
  perform set_config('request.jwt.claim.sub', '0c1c0c1c-0000-0000-0000-000000000001', true);
  r := public.class_stats((select id from public.classes where name='PD class'));
  n := json_array_length(r->'students'->0->'days');
  if n <> 3 then raise exception 'FAIL class_stats days % %', n, r; end if;
  raise notice 'class_stats days: true';
end $$;
reset role;
