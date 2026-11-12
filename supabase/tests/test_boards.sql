-- Tests for 20261113000000_simple_teacher_and_boards.sql (class_stats, school Top 10, stars earned). Any failure raises an exception.
\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
create temp table b (k text primary key, v text);
grant all on b to anon, authenticated;

insert into auth.users values
  ('0b0a0b0a-0000-0000-0000-000000000001','t1@boards.ca'), ('0b0a0b0a-0000-0000-0000-000000000002','far@boards.ca'),
  ('0b0a0b0a-0000-0000-0000-000000000009','owner@boards.ca');
insert into public.schools (name, plan) values ('Board School', 'free'), ('Board Far', 'free');
insert into public.teachers (id, school_id, name, role) select '0b0a0b0a-0000-0000-0000-000000000001', id, 'Teacher', 'admin' from public.schools where name='Board School';
insert into public.teachers (id, school_id, name, role) select '0b0a0b0a-0000-0000-0000-000000000002', id, 'Far', 'admin' from public.schools where name='Board Far';
insert into public.super_admins (user_id) values ('0b0a0b0a-0000-0000-0000-000000000009');
insert into public.classes (school_id, teacher_id, name) select id, '0b0a0b0a-0000-0000-0000-000000000001', 'Board A' from public.schools where name='Board School';
insert into public.classes (school_id, teacher_id, name) select id, '0b0a0b0a-0000-0000-0000-000000000001', 'Board B' from public.schools where name='Board School';
insert into public.students (class_id, name, data) select id, 'Spender', '{"coins": 50}' from public.classes where name='Board A';
insert into public.students (class_id, name) select id, 'Quiet' from public.classes where name='Board A';
insert into public.students (class_id, name, data) select id, 'Demo Board', '{"demo": true}' from public.classes where name='Board A';
insert into public.students (class_id, name) select id, 'Other Class' from public.classes where name='Board B';
insert into b select 'school', id::text from public.schools where name='Board School';
insert into b select 'class_a', id::text from public.classes where name='Board A';
insert into public.student_sessions (token, student_id) select 'tok_spend', id from public.students where name='Spender';

-- Spender: 300 stars earned this week + 200 last month (but only 50 left after shopping); Other Class: 120 this week
insert into public.round_log (student_id, class_id, school_id, d, stars, correct, demo)
select s.id, s.class_id, c.school_id, x.d, x.stars, 20, false
  from public.students s join public.classes c on c.id = s.class_id
  cross join (values (now() - interval '1 minute', 300), (now() - interval '30 days', 200)) x(d, stars)
 where s.name = 'Spender';
insert into public.round_log (student_id, class_id, school_id, d, stars, correct, demo)
select s.id, s.class_id, c.school_id, now() - interval '1 minute', 120, 10, false from public.students s join public.classes c on c.id = s.class_id where s.name = 'Other Class';
insert into public.round_log (student_id, class_id, school_id, d, stars, correct, demo)
select s.id, s.class_id, c.school_id, now() - interval '1 minute', 999 % 440, 10, true from public.students s join public.classes c on c.id = s.class_id where s.name = 'Demo Board';

set role authenticated;
do $$
declare r json; st json;
begin
  -- teacher in the school: stars earned, not the balance
  perform set_config('request.jwt.claim.sub', '0b0a0b0a-0000-0000-0000-000000000001', true);
  r := public.class_stats((select v from b where k='class_a')::uuid);
  select x into st from json_array_elements(r->'students') x join public.students s on s.id = (x->>'id')::uuid where s.name = 'Spender';
  if (st->>'stars_total')::int <> 500 or (st->>'stars_week')::int <> 300 or (st->>'rounds_total')::int <> 2 then raise exception 'FAIL class_stats spender %', st; end if;
  select x into st from json_array_elements(r->'students') x join public.students s on s.id = (x->>'id')::uuid where s.name = 'Quiet';
  if (st->>'stars_total')::int <> 0 or (st->>'rounds_total')::int <> 0 then raise exception 'FAIL class_stats quiet %', st; end if;
  raise notice 'class_stats counts stars earned (500), not the balance (50): true';

  -- another school's teacher cannot read it
  perform set_config('request.jwt.claim.sub', '0b0a0b0a-0000-0000-0000-000000000002', true);
  if public.class_stats((select v from b where k='class_a')::uuid)->>'error' is distinct from 'not_allowed' then raise exception 'FAIL other school read class_stats'; end if;
  raise notice 'other schools cannot read class_stats: true';
end $$;

set role anon;
do $$
declare ok boolean := false;
begin
  begin perform public.class_stats((select v from b where k='class_a')::uuid); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL anon can call class_stats'; end if;
  -- free school: no school board
  if (public.student_state('tok_spend')->'school_board') is not null and json_typeof(public.student_state('tok_spend')->'school_board') <> 'null' then
    raise exception 'FAIL free school got a school board'; end if;
  raise notice 'anon blocked, free schools get no school Top 10: true';
end $$;

reset role;
update public.schools set plan = 'school' where name = 'Board School';
set role anon;
do $$
declare sb json;
begin
  sb := public.student_state('tok_spend')->'school_board';
  if json_array_length(sb) <> 2 then raise exception 'FAIL school board length %', sb; end if;
  if sb->0->>'name' <> 'Spender' or (sb->0->>'stars')::int <> 300 or sb->1->>'name' <> 'Other Class' then raise exception 'FAIL school board order %', sb; end if;
  if sb::text like '%Demo Board%' or sb::text like '%Quiet%' then raise exception 'FAIL demo or zero-star student on board'; end if;
  raise notice 'paid school Top 10: this week only, ranked, no demo or zero-star kids: true';
end $$;

reset role;
set role authenticated;
do $$
declare st json;
begin
  perform set_config('request.jwt.claim.sub', '0b0a0b0a-0000-0000-0000-000000000009', true);
  select x into st from json_array_elements(public.super_overview()->'students') x where x->>'name' = 'Spender';
  if (st->>'stars')::int <> 500 or (st->>'balance')::int <> 50 then raise exception 'FAIL super_overview stars %', st; end if;
  raise notice 'owner view shows stars earned 500 and balance 50: true';
end $$;
reset role;
