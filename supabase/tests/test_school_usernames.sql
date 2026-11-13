-- Tests for 20261116000000_school_usernames.sql (per-school usernames, TT Rock Stars style). Any failure raises an exception.
\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
create temp table e (k text primary key, v text);
grant all on e to anon, authenticated;
insert into auth.users values ('0e0e0e0e-0000-0000-0000-000000000001','t@user.ca'), ('0e0e0e0e-0000-0000-0000-000000000002','far@user.ca');
insert into public.schools (name) values ('User School'), ('User Far');
insert into public.teachers (id, school_id, name, role) select '0e0e0e0e-0000-0000-0000-000000000001', id, 'T', 'teacher' from public.schools where name='User School';
insert into public.teachers (id, school_id, name, role) select '0e0e0e0e-0000-0000-0000-000000000002', id, 'F', 'admin' from public.schools where name='User Far';
insert into public.classes (school_id, teacher_id, name) select id, '0e0e0e0e-0000-0000-0000-000000000001', 'User class' from public.schools where name='User School';
insert into public.classes (school_id, teacher_id, name) select id, '0e0e0e0e-0000-0000-0000-000000000002', 'User far class' from public.schools where name='User Far';
-- an existing class-code student (like Ms Berry's class)
insert into public.students (class_id, name) select id, 'Old Code Kid' from public.classes where name='User class';
insert into e select 'school', id::text from public.schools where name='User School';
insert into e select 'far', id::text from public.schools where name='User Far';
insert into e select 'class', id::text from public.classes where name='User class';
insert into e select 'farclass', id::text from public.classes where name='User far class';
insert into e select 'code', code from public.classes where name='User class';
insert into e select 'old', id::text from public.students where name='Old Code Kid';
insert into e select 'oldpin', pin from public.students where name='Old Code Kid';

do $$ begin
  if public.norm_username(' Franklin.Joshua@SD54.bc.ca ') <> 'franklin.joshua' or public.norm_username('franklin.joshua') <> 'franklin.joshua'
     or public.norm_username('FRANKLIN . joshua') <> 'franklin.joshua' or public.norm_username('  ') is not null then
    raise exception 'FAIL norm_username'; end if;
  if public._slug('Zoë-Anne') <> 'zoe-anne' or public._slug('O''Brien') <> 'obrien' then raise exception 'FAIL slug'; end if;
  if (select school_id::text from public.students where name='Old Code Kid') <> (select v from e where k='school') then raise exception 'FAIL school_id backfill/trigger'; end if;
  raise notice 'usernames: any capitals, spaces or email domain -> franklin.joshua; accents and apostrophes cleaned; students know their school: true';
end $$;

set role authenticated;
do $$
declare r json; a json;
begin
  perform set_config('request.jwt.claim.sub', '0e0e0e0e-0000-0000-0000-000000000001', true);
  -- dry run (review screen) saves nothing
  r := public.add_school_students((select v from e where k='class')::uuid,
        '[{"email":"Franklin.Joshua@sd54.bc.ca"},{"first":"Ava","last":"Smith"},{"first":"Ava","last":"Smith"},{"first":"","last":""},{"email":"12345@sd54.bc.ca","first":"Mia","last":"Chen"}]'::jsonb, true);
  if json_array_length(r->'added') <> 4 or json_array_length(r->'skipped') <> 1 or r->'skipped'->0->>'why' <> 'no_name' then raise exception 'FAIL dry run %', r; end if;
  if r->'added'->0->>'username' <> 'franklin.joshua' or r->'added'->0->>'real_name' <> 'Joshua Franklin' then raise exception 'FAIL email row %', r; end if;
  if r->'added'->1->>'username' <> 'smith.ava' or r->'added'->2->>'username' <> 'smith.ava2' or (r->'added'->2->>'renamed')::boolean is not true then raise exception 'FAIL name rows %', r; end if;
  if r->'added'->3->>'username' <> '12345' or r->'added'->3->>'real_name' <> 'Mia Chen' then raise exception 'FAIL number email %', r; end if;
  if r->'added'->0->>'passcode' is not null then raise exception 'FAIL dry run made a passcode'; end if;
  if exists (select 1 from public.students where username is not null) then raise exception 'FAIL dry run saved'; end if;
  raise notice 'review step: emails -> part before @, names -> surname.firstname, clashes numbered, blanks flagged, nothing saved: true';
  -- for real
  r := public.add_school_students((select v from e where k='class')::uuid,
        '[{"email":"Franklin.Joshua@sd54.bc.ca","name":"Cosmic Fox"},{"first":"Ava","last":"Smith","name":"Nova Owl"},{"email":"franklin.joshua@sd54"}]'::jsonb);
  if json_array_length(r->'added') <> 2 or r->'skipped'->0->>'why' <> 'already_added' then raise exception 'FAIL add %', r; end if;
  a := r->'added'->0;
  if a->>'username' <> 'franklin.joshua' or a->>'name' <> 'Cosmic Fox' or a->>'pin' !~ '^[0-9]{4}$' or (a::jsonb) ? 'passcode' then raise exception 'FAIL added row %', a; end if;
  insert into e values ('pass', a->>'pin'), ('kid', a->>'id');
  raise notice 'teacher adds students; same email twice is skipped; every student also has a 4-digit code: true';
  -- other schools cannot add here or touch these students
  perform set_config('request.jwt.claim.sub', '0e0e0e0e-0000-0000-0000-000000000002', true);
  if public.add_school_students((select v from e where k='class')::uuid, '[{"first":"X","last":"Y"}]')->>'error' <> 'not_allowed' then raise exception 'FAIL other school added'; end if;
  if public.set_student_login((select v from e where k='kid')::uuid, null)->>'error' <> 'not_allowed' then raise exception 'FAIL other school reset'; end if;
  -- the same username is fine at a different school
  r := public.add_school_students((select v from e where k='farclass')::uuid, '[{"email":"franklin.joshua@sd99.bc.ca","name":"Far Fox"}]');
  if r->'added'->0->>'username' <> 'franklin.joshua' then raise exception 'FAIL same username other school %', r; end if;
  insert into e values ('farpass', r->'added'->0->>'pin');
  raise notice 'usernames are per school: another school can have its own franklin.joshua, and cannot touch ours: true';
end $$;

set role anon;
do $$
declare r json; ok boolean := false;
begin
  -- the child types their username or whole email, and the password with odd spaces and capitals
  r := public.student_login_user((select v from e where k='school')::uuid, 'Franklin.Joshua@sd54.bc.ca', ' ' || upper(replace((select v from e where k='pass'), '-', ' ')) || ' ');
  if r->>'token' is null then raise exception 'FAIL login %', r; end if;
  if (public.student_state(r->>'token')->'me'->>'name') <> 'Cosmic Fox' then raise exception 'FAIL state after login'; end if;
  if public.student_login_user((select v from e where k='school')::uuid, 'franklin.joshua', (select v from e where k='pass'))->>'token' is null then raise exception 'FAIL plain username'; end if;
  -- right username + password, wrong school: no
  if public.student_login_user((select v from e where k='far')::uuid, 'franklin.joshua', (select v from e where k='pass'))->>'error' <> 'wrong_login' then raise exception 'FAIL cross-school login'; end if;
  if public.student_login_user((select v from e where k='school')::uuid, 'franklin.joshua', 'red-fox-11')->>'error' <> 'wrong_login' then raise exception 'FAIL wrong passcode'; end if;
  -- Ms Berry's class: class code + 4-digit code login still works, unchanged
  r := public.student_login((select v from e where k='code'), (select v from e where k='oldpin'));
  if r->>'token' is null then raise exception 'FAIL old code login %', r; end if;
  begin perform public.add_school_students((select v from e where k='class')::uuid, '[]'); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL anon can add students'; end if;
  raise notice 'school + username + 4-digit code login (any capitals, spaces, dashes, email form); wrong school refused; class code login unchanged: true';
end $$;

do $$ declare i int; r json; begin
  for i in 1..10 loop perform public.student_login_user((select v from e where k='school')::uuid, 'smith.ava', 'wrong-guess-00'); end loop;
  r := public.student_login_user((select v from e where k='school')::uuid, 'smith.ava', 'wrong-guess-00');
  if r->>'error' <> 'too_many_tries' then raise exception 'FAIL throttle %', r; end if;
  raise notice 'after 10 wrong tries a username is paused for 10 minutes: true';
end $$;

reset role;
set role authenticated;
do $$
declare r json; old text;
begin
  perform set_config('request.jwt.claim.sub', '0e0e0e0e-0000-0000-0000-000000000001', true);
  -- no passwords any more: an empty username is refused (a new code comes from "New code")
  r := public.set_student_login((select v from e where k='kid')::uuid, null);
  if r->>'error' <> 'bad_username' then raise exception 'FAIL empty username %', r; end if;
  -- give an existing code student a username too: same row, so history carries over, and their code still works
  r := public.set_student_login((select v from e where k='old')::uuid, 'Lee.Sam@sd54.bc.ca');
  if r->>'username' <> 'lee.sam' or r->>'pin' <> (select v from e where k='oldpin') then raise exception 'FAIL username for code kid %', r; end if;
  if public.set_student_login((select v from e where k='old')::uuid, 'franklin.joshua')->>'error' <> 'already_added' then raise exception 'FAIL duplicate on set'; end if;
  -- a teacher cannot move a student into another school by writing school_id
  update public.students set school_id = (select v from e where k='far')::uuid where id = (select v from e where k='old')::uuid;
  if (select school_id::text from public.students where id = (select v from e where k='old')::uuid) <> (select v from e where k='school') then raise exception 'FAIL school_id writable'; end if;
  raise notice 'teacher gives a code student a username (same student, code still works); school_id follows the class: true';
end $$;
reset role;
set role anon;
do $$ begin
  if public.student_login((select v from e where k='code'), (select v from e where k='oldpin'))->>'token' is null then raise exception 'FAIL code login after username'; end if;
  raise notice 'code student given a username can still use the class code: true';
end $$;
reset role;
