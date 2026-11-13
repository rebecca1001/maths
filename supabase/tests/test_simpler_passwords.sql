-- Tests for 20261117000000_simpler_passwords.sql. Any failure raises an exception.
\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
do $$ declare i int; p text; seen text[] := '{}'; begin
  for i in 1..500 loop p := public.new_passcode();
    if p !~ '^[a-z]{3,8}[0-9]{2}$' then raise exception 'FAIL format %', p; end if;
    if not p = any(seen) then seen := seen || p; end if; end loop;
  if array_length(seen, 1) < 400 then raise exception 'FAIL too few different passwords'; end if;
  raise notice 'passwords are one easy word + 2 digits, like tiger42: true';
end $$;
insert into auth.users values ('0f0f0f0f-0000-0000-0000-000000000001','pw@user.ca');
insert into public.schools (name) values ('Pw School');
insert into public.teachers (id, school_id, name, role) select '0f0f0f0f-0000-0000-0000-000000000001', id, 'T', 'admin' from public.schools where name='Pw School';
insert into public.classes (school_id, teacher_id, name) select id, '0f0f0f0f-0000-0000-0000-000000000001', 'Pw class' from public.schools where name='Pw School';
create temp table pw (k text primary key, v text);
grant all on pw to anon, authenticated;
insert into pw select 'school', id::text from public.schools where name='Pw School';
-- an old-style password still works, and the new style works typed with a space and capitals
insert into public.students (class_id, name, username, passcode) select id, 'Old Pw', 'old.pw', 'blue-tiger-42' from public.classes where name='Pw class';
insert into public.students (class_id, name, username, passcode) select id, 'New Pw', 'new.pw', 'tiger42' from public.classes where name='Pw class';
set role anon;
do $$ declare s uuid := (select v from pw where k='school')::uuid; i int; begin
  if public.student_login_user(s, 'old.pw', 'blue-tiger-42')->>'token' is null then raise exception 'FAIL old style'; end if;
  if public.student_login_user(s, 'new.pw', 'Tiger 42')->>'token' is null then raise exception 'FAIL new style'; end if;
  raise notice 'old blue-tiger-42 passwords still work; tiger42 works as "Tiger 42": true';
end $$;
reset role;
-- 30 wrong tries in a day (spread out, so the 10-minute limit isn't what stops it) pause the username until tomorrow
insert into public.login_failures (class_code, at) select 'user:' || (select id from public.schools where name='Pw School') || ':new.pw', now() - (i || ' hours')::interval from generate_series(1, 30) i;
set role anon;
do $$ declare s uuid := (select v from pw where k='school')::uuid; begin
  if public.student_login_user(s, 'new.pw', 'tiger42')->>'error' <> 'too_many_tries' then raise exception 'FAIL daily cap'; end if;
  if public.student_login_user(s, 'old.pw', 'blue-tiger-42')->>'token' is null then raise exception 'FAIL cap leaked to another username'; end if;
  raise notice 'after 30 wrong tries in a day a username is paused, others are not: true';
end $$;
reset role;
