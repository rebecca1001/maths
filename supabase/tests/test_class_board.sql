-- Tests for the Top 10s (20261118 + 20261119): class and school boards count the same stars, all time (never reset).
\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
insert into auth.users values ('0c1b0c1b-0000-0000-0000-000000000001','t@cb.ca');
insert into public.schools (name, plan) values ('CB School', 'school');
insert into public.teachers (id, school_id, name, role) select '0c1b0c1b-0000-0000-0000-000000000001', id, 'T', 'admin' from public.schools where name='CB School';
insert into public.classes (school_id, teacher_id, name) select id, '0c1b0c1b-0000-0000-0000-000000000001', 'CB class' from public.schools where name='CB School';
-- Heavy: saved rounds hold only 1 round this week (worth 10), but the round log has 70 rounds this week (70 x 100 stars)
insert into public.students (class_id, name, data) select id, 'Heavy', jsonb_build_object('rounds', jsonb_build_array(jsonb_build_object('d', (extract(epoch from now()) * 1000)::bigint, 'stars', 10, 'len', 60))) from public.classes where name='CB class';
insert into public.students (class_id, name) select id, 'Me Kid' from public.classes where name='CB class';
insert into public.round_log (student_id, class_id, school_id, d, stars, correct, demo)
select s.id, s.class_id, c.school_id, now() - (g || ' seconds')::interval, case when s.name = 'Heavy' then 100 else 7 end, 20, false
  from public.students s join public.classes c on c.id = s.class_id cross join generate_series(1, 70) g
 where s.name in ('Heavy', 'Me Kid');
-- last week's rounds count too (the boards never reset)
insert into public.round_log (student_id, class_id, school_id, d, stars, correct, demo)
select s.id, s.class_id, c.school_id, now() - interval '8 days', 400, 20, false from public.students s join public.classes c on c.id = s.class_id where s.name = 'Heavy';
insert into public.student_sessions (token, student_id) select 'tok_cb', id from public.students where name='Me Kid';
set role anon;
do $$ declare st json; heavy int; school_heavy int; begin
  st := public.student_state('tok_cb');
  select (x->'data'->>'totStars')::int into heavy from json_array_elements(st->'classmates') x where x->>'name' = 'Heavy';
  select (x->>'stars')::int into school_heavy from json_array_elements(st->'school_board') x where x->>'name' = 'Heavy';
  if heavy <> 7400 or school_heavy <> 7400 then raise exception 'FAIL class % vs school %', heavy, school_heavy; end if;
  if (st->>'me_total_stars')::int <> 490 then raise exception 'FAIL me_total_stars %', st->>'me_total_stars'; end if;
  if (select (x->'data'->>'wkMins')::int from json_array_elements(st->'classmates') x where x->>'name' = 'Heavy') <> 1 then raise exception 'FAIL wkMins'; end if;
  raise notice 'class board and school board count the same stars, all time, never reset (every round, not just the last 60): true';
end $$;
reset role;
