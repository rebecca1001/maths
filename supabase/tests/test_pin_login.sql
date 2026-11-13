-- Tests for 20261117000000_pin_login.sql (school + username + 4-digit code, no passwords). Any failure raises an exception.
\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
create temp table p (k text primary key, v text);
grant all on p to anon, authenticated;
insert into auth.users values ('0f0f0f0f-0000-0000-0000-000000000001','pin@user.ca');
insert into public.schools (name) values ('Pin School'), ('Pin Other');
insert into public.teachers (id, school_id, name, role) select '0f0f0f0f-0000-0000-0000-000000000001', id, 'T', 'teacher' from public.schools where name='Pin School';
insert into public.classes (school_id, teacher_id, name) select id, '0f0f0f0f-0000-0000-0000-000000000001', 'Pin class' from public.schools where name='Pin School';
-- a class-code student (like Ms Berry's class) who already has a 4-digit code
insert into public.students (class_id, name) select id, 'Berry Kid' from public.classes where name='Pin class';
insert into p select 'school', id::text from public.schools where name='Pin School';
insert into p select 'other', id::text from public.schools where name='Pin Other';
insert into p select 'class', id::text from public.classes where name='Pin class';
insert into p select 'code', code from public.classes where name='Pin class';
insert into p select 'kid', id::text from public.students where name='Berry Kid';
insert into p select 'pin', pin from public.students where name='Berry Kid';

do $$ begin
  if exists (select 1 from pg_proc where proname = 'new_passcode') then raise exception 'FAIL new_passcode still exists'; end if;
  if exists (select 1 from public.students where passcode is not null) then raise exception 'FAIL passwords left'; end if;
  raise notice 'no student passwords left, and none can be made: true';
end $$;

set role authenticated;
do $$ declare r json; begin
  perform set_config('request.jwt.claim.sub', '0f0f0f0f-0000-0000-0000-000000000001', true);
  -- Ms Berry's class: the teacher gives an existing student a username; the code stays the same
  r := public.set_student_login((select v from p where k='kid')::uuid, 'Berry.Kid');
  if r->>'username' <> 'berry.kid' or r->>'pin' <> (select v from p where k='pin') then raise exception 'FAIL give username %', r; end if;
  -- new students get a username and a 4-digit code, no password
  r := public.add_school_students((select v from p where k='class')::uuid, '[{"first":"Emma","last":"Smith","name":"Star Owl"}]');
  if r->'added'->0->>'username' <> 'smith.emma' or r->'added'->0->>'pin' !~ '^[0-9]{4}$' or (r->'added'->0)::jsonb ? 'passcode' then raise exception 'FAIL add %', r; end if;
  insert into p values ('newpin', r->'added'->0->>'pin');
  if exists (select 1 from public.students where passcode is not null) then raise exception 'FAIL add made a password'; end if;
  raise notice 'existing student gets a username and keeps the same 4 digits; new students get username + code, no password: true';
end $$;
reset role;

set role anon;
do $$ declare r json; bad text; begin
  -- username + the same 4 digits as always
  r := public.student_login_user((select v from p where k='school')::uuid, ' Berry.Kid ', (select v from p where k='pin'));
  if r->>'token' is null then raise exception 'FAIL pin login %', r; end if;
  if public.student_login_user((select v from p where k='school')::uuid, 'smith.emma', (select v from p where k='newpin'))->>'token' is null then raise exception 'FAIL new student login'; end if;
  -- the class code login still works with the same digits
  if public.student_login((select v from p where k='code'), (select v from p where k='pin'))->>'token' is null then raise exception 'FAIL class code login'; end if;
  -- wrong school, wrong code, made-up username: all the same answer
  if public.student_login_user((select v from p where k='other')::uuid, 'berry.kid', (select v from p where k='pin'))->>'error' <> 'wrong_login' then raise exception 'FAIL other school'; end if;
  bad := case when (select v from p where k='pin') = '0000' then '0001' else '0000' end;
  if public.student_login_user((select v from p where k='school')::uuid, 'berry.kid', bad)->>'error' <> 'wrong_login' then raise exception 'FAIL wrong code'; end if;
  if public.student_login_user((select v from p where k='school')::uuid, 'nobody.here', bad)->>'error' <> 'wrong_login' then raise exception 'FAIL unknown username gives a different answer'; end if;
  if public.student_login_user((select v from p where k='school')::uuid, 'berry.kid', '12')->>'error' <> 'wrong_login' then raise exception 'FAIL short code'; end if;
  raise notice 'username + 4-digit code logs in; wrong school, wrong code or unknown username all say wrong_login: true';
end $$;
reset role;

-- per username: 30 wrong tries a day (spread out so the 10-minute rule does not trigger first)
insert into public.login_failures (class_code, ip, at)
  select 'user:' || (select v from p where k='school') || ':smith.emma', null, now() - interval '1 hour' from generate_series(1, 30);
set role anon;
do $$ begin
  if public.student_login_user((select v from p where k='school')::uuid, 'smith.emma', (select v from p where k='newpin'))->>'error' <> 'too_many_tries' then raise exception 'FAIL daily username cap'; end if;
  raise notice 'after 30 wrong tries in a day a username is paused: true';
end $$;
reset role;

-- per device at one school: 500 wrong tries a day across all usernames (stops trying one code on every username)
insert into public.login_failures (class_code, ip, at)
  select 'user:' || (select v from p where k='school') || ':kid' || g, '9.9.9.9', now() - interval '2 hours' from generate_series(1, 500) g;
set role anon;
do $$ declare r json; begin
  perform set_config('request.headers', '{"x-real-ip":"9.9.9.9"}', true);
  r := public.student_login_user((select v from p where k='school')::uuid, 'berry.kid', (select v from p where k='pin'));
  if r->>'error' <> 'too_many_tries' then raise exception 'FAIL device school cap %', r; end if;
  -- another device at the same school is not affected
  perform set_config('request.headers', '{"x-real-ip":"8.8.8.8"}', true);
  if public.student_login_user((select v from p where k='school')::uuid, 'berry.kid', (select v from p where k='pin'))->>'token' is null then raise exception 'FAIL other device blocked'; end if;
  raise notice 'one device: 500 wrong tries a day at a school, then paused; other devices still log in: true';
end $$;
reset role;
