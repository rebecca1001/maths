-- Tests for 20261123000000_home_accounts.sql (home plan: one account per child, own username + password). Any failure raises an exception.
\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
create temp table p (k text primary key, v text);
grant all on p to anon, authenticated;
insert into public.schools (name) values ('Home Test School');
insert into public.classes (school_id, name) select id, 'Real class' from public.schools where name='Home Test School';
insert into public.students (class_id, name, username) select id, 'School Kid', 'kid.school' from public.classes where name='Real class';

insert into p select 'school', id::text from public.schools where name='Home Test School';
insert into p select 'pin', pin from public.students where username='kid.school';

set role anon;
do $$ declare r json; t1 text; t2 text; begin
  -- bad input
  if public.home_register('ab', 'secret1', 'Comet Fox')->>'error' <> 'bad_username' then raise exception 'FAIL short username'; end if;
  if public.home_register('zoe.home', '12345', 'Comet Fox')->>'error' <> 'bad_password' then raise exception 'FAIL short password'; end if;
  -- register two children
  r := public.home_register('Zoe.Home', 'secret1', 'Comet Fox'); t1 := r->>'token';
  if t1 is null then raise exception 'FAIL register %', r; end if;
  r := public.home_register('max.home', 'secret2', 'Solar Lynx'); t2 := r->>'token';
  if t2 is null then raise exception 'FAIL register 2 %', r; end if;
  if public.home_register('zoe.home', 'other-pass', 'X')->>'error' <> 'username_taken' then raise exception 'FAIL duplicate username'; end if;
  insert into p values ('t1', t1), ('t2', t2);
  raise notice 'registering works, duplicates and short input refused: true';
  -- login
  if public.home_login('zoe.home', 'wrong-pass')->>'error' <> 'wrong_login' then raise exception 'FAIL wrong password'; end if;
  if public.home_login('nobody', 'secret1')->>'error' <> 'wrong_login' then raise exception 'FAIL unknown user'; end if;
  if public.home_login('ZOE.home', 'secret1')->>'token' is null then raise exception 'FAIL login'; end if;
  raise notice 'login: right password in, wrong password and unknown user get the same answer: true';
  -- the home school never shows in the school search, and its passwords are not readable
  if json_array_length(public.find_schools('MathWizz')) <> 0 then raise exception 'FAIL home school is searchable'; end if;
  if json_array_length(public.find_schools('Home Test')) <> 1 then raise exception 'FAIL real school not found'; end if;
  begin perform 1 from public.home_accounts; raise exception 'FAIL anon can read home_accounts'; exception when insufficient_privilege then null; end;
  raise notice 'home school hidden from search, home_accounts unreadable: true';
end $$;
reset role;

-- stars: round_log rows for both home kids and the school kid
insert into public.round_log (student_id, class_id, school_id, d, stars, correct)
  select s.id, s.class_id, s.school_id, now() - interval '1 hour', 50, 20 from public.students s where s.username = 'zoe.home';
insert into public.round_log (student_id, class_id, school_id, d, stars, correct)
  select s.id, s.class_id, s.school_id, now() - interval '2 hour', 90, 30 from public.students s where s.username = 'max.home';
insert into public.round_log (student_id, class_id, school_id, d, stars, correct)
  select s.id, s.class_id, s.school_id, now() - interval '3 hour', 400, 40 from public.students s where s.username = 'kid.school';

set role anon;
do $$ declare st json; sc json; tk text; begin
  st := public.student_state((select v from p where k='t1'));
  if (st->>'home')::boolean is not true then raise exception 'FAIL home flag %', st->>'home'; end if;
  if json_array_length(st->'home_board') < 3 then raise exception 'FAIL home board size %', st->'home_board'; end if;
  if not exists (select 1 from json_array_elements(st->'home_board') e where e->>'name' = 'School Kid' and (e->>'stars')::int = 400) then raise exception 'FAIL school student missing from the board'; end if;
  if exists (select 1 from (select (e->>'stars')::int s, lag((e->>'stars')::int) over () p from json_array_elements(st->'home_board') e) x where p < s) then raise exception 'FAIL board not best first'; end if;
  if (st->'home_board')::text ~ '(username|real_name|"school"|"class")' then raise exception 'FAIL board leaks more than name, skin, stars'; end if;
  if st->>'school_board' is not null then raise exception 'FAIL home kid has a school board'; end if;
  if json_array_length(st->'classmates') <> 0 then raise exception 'FAIL home kid has classmates'; end if;
  raise notice 'home Top 30: every player (home and school), best first, only name + character + stars: true';
  -- a school student sees no home board
  tk := public.student_login_user((select v from p where k='school')::uuid, 'kid.school', (select v from p where k='pin'))->>'token';
  sc := public.student_state(tk);
  if (sc->>'home')::boolean is not false or sc->>'home_board' is not null then raise exception 'FAIL school kid state %', sc; end if;
  raise notice 'school students unchanged (no home flag, no home board): true';
end $$;
reset role;

-- the board is capped at 30
insert into public.classes (school_id, name) select '00000000-0000-4000-8000-00000000a001', 'Home' from generate_series(1, 35);
insert into public.students (class_id, name, username)
  select c.id, 'Bulk ' || n, 'bulk' || n from (select id, row_number() over () n from public.classes where name = 'Home' and id not in (select class_id from public.students)) c;
insert into public.round_log (student_id, class_id, school_id, d, stars, correct)
  select s.id, s.class_id, s.school_id, now() - interval '5 minutes', 10 + (row_number() over ())::int, 10 from public.students s where s.username like 'bulk%';
set role anon;
do $$ declare st json; begin
  st := public.student_state((select v from p where k='t1'));
  if json_array_length(st->'home_board') <> 30 then raise exception 'FAIL cap %', json_array_length(st->'home_board'); end if;
  raise notice 'home Top 30 is capped at 30: true';
end $$;
reset role;
