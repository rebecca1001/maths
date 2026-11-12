-- Tests for 20261115000000_student_email_login.sql. Any failure raises an exception.
\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
create temp table e (k text primary key, v text);
grant all on e to anon, authenticated;
insert into auth.users values ('0d0d0d0d-0000-0000-0000-000000000001','t@email.ca'), ('0d0d0d0d-0000-0000-0000-000000000002','far@email.ca');
insert into public.schools (name) values ('Email School'), ('Email Far');
insert into public.teachers (id, school_id, name, role) select '0d0d0d0d-0000-0000-0000-000000000001', id, 'T', 'teacher' from public.schools where name='Email School';
insert into public.teachers (id, school_id, name, role) select '0d0d0d0d-0000-0000-0000-000000000002', id, 'F', 'admin' from public.schools where name='Email Far';
insert into public.classes (school_id, teacher_id, name) select id, '0d0d0d0d-0000-0000-0000-000000000001', 'Email class' from public.schools where name='Email School';
insert into public.students (class_id, name) select id, 'Old Code Kid' from public.classes where name='Email class';
insert into e select 'class', id::text from public.classes where name='Email class';
insert into e select 'code', code from public.classes where name='Email class';
insert into e select 'old', id::text from public.students where name='Old Code Kid';
insert into e select 'oldpin', pin from public.students where name='Old Code Kid';

do $$ begin
  if public.norm_student_email(' Franklin.Joshua@SD54.bc.ca ') <> 'franklin.joshua@sd54' or public.norm_student_email('franklin.joshua@sd54') <> 'franklin.joshua@sd54'
     or public.norm_student_email('franklin.joshua') is not null or public.norm_student_email('a b@c') <> 'ab@c' then
    raise exception 'FAIL norm_student_email'; end if;
  if public._name_from_email('franklin.joshua@sd54') <> 'Joshua Franklin' then raise exception 'FAIL name from email'; end if;
  if public.new_passcode() !~ '^[a-z]{3,8}-[a-z]{3,8}-[0-9]{2}$' then raise exception 'FAIL passcode format'; end if;
  raise notice 'emails normalised (any domain form), names Joshua Franklin, passcodes like blue-tiger-42: true';
end $$;

set role authenticated;
do $$
declare r json; a json;
begin
  perform set_config('request.jwt.claim.sub', '0d0d0d0d-0000-0000-0000-000000000001', true);
  r := public.add_email_students((select v from e where k='class')::uuid,
        '[{"email":"Franklin.Joshua@sd54.bc.ca","name":"Cosmic Fox"},{"email":"not an email","name":"X"},{"email":"franklin.joshua@sd54","name":"Dup"},{"email":"smith.ava@sd54.bc.ca","name":"Nova Owl"}]'::jsonb);
  if json_array_length(r->'added') <> 2 or json_array_length(r->'skipped') <> 2 then raise exception 'FAIL add_email_students %', r; end if;
  a := r->'added'->0;
  if a->>'username' <> 'franklin.joshua@sd54' or a->>'real_name' <> 'Joshua Franklin' or a->>'name' <> 'Cosmic Fox' or a->>'pin' !~ '^[0-9]{4}$' then raise exception 'FAIL added row %', a; end if;
  insert into e values ('pass', a->>'passcode'), ('kid', a->>'id');
  if r->'skipped'->1->>'why' <> 'already_added' then raise exception 'FAIL duplicate not caught %', r; end if;
  raise notice 'teacher adds students by email; bad and duplicate emails are skipped with a reason: true';
  -- another school cannot add to this class or touch these students
  perform set_config('request.jwt.claim.sub', '0d0d0d0d-0000-0000-0000-000000000002', true);
  if public.add_email_students((select v from e where k='class')::uuid, '[{"email":"x.y@sd54","name":"A"}]')->>'error' <> 'not_allowed' then raise exception 'FAIL other school added'; end if;
  if public.set_student_login((select v from e where k='kid')::uuid, null)->>'error' <> 'not_allowed' then raise exception 'FAIL other school reset'; end if;
  raise notice 'other schools cannot add or reset: true';
end $$;

set role anon;
do $$
declare r json; ok boolean := false;
begin
  -- the child types their email any way and the passcode, with odd spaces and capitals
  r := public.student_login_email('FRANKLIN.joshua@sd54', ' ' || upper((select v from e where k='pass')) || ' ');
  if r->>'token' is null then raise exception 'FAIL email login %', r; end if;
  if (public.student_state(r->>'token')->'me'->>'name') <> 'Cosmic Fox' then raise exception 'FAIL state after email login'; end if;
  if public.student_login_email('franklin.joshua@sd54.bc.ca', 'red-fox-11')->>'error' <> 'wrong_login' then raise exception 'FAIL wrong passcode'; end if;
  if public.student_login_email('franklin.joshua', 'x')->>'error' <> 'not_an_email' then raise exception 'FAIL not an email'; end if;
  -- the old class code + 4-digit code login still works, unchanged
  r := public.student_login((select v from e where k='code'), (select v from e where k='oldpin'));
  if r->>'token' is null then raise exception 'FAIL old code login %', r; end if;
  -- the passcode never reaches students
  if public.student_state(r->>'token')::text like '%' || (select v from e where k='pass') || '%' then raise exception 'FAIL passcode leaked'; end if;
  begin perform public.add_email_students((select v from e where k='class')::uuid, '[]'); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL anon can add students'; end if;
  raise notice 'email + passcode login works (any capitals, spaces, domain form); old code login unchanged; passcodes never shown to students: true';
end $$;

do $$ declare i int; r json; begin
  for i in 1..10 loop perform public.student_login_email('smith.ava@sd54', 'wrong-guess-00'); end loop;
  r := public.student_login_email('smith.ava@sd54', 'wrong-guess-00');
  if r->>'error' <> 'too_many_tries' then raise exception 'FAIL email throttle %', r; end if;
  raise notice 'after 10 wrong tries an email is paused for 10 minutes: true';
end $$;

reset role;
set role authenticated;
do $$
declare r json; old text;
begin
  perform set_config('request.jwt.claim.sub', '0d0d0d0d-0000-0000-0000-000000000001', true);
  old := (select v from e where k='pass');
  r := public.set_student_login((select v from e where k='kid')::uuid, null);
  if r->>'passcode' is null or r->>'passcode' = old then raise exception 'FAIL new passcode %', r; end if;
  -- give an existing code-login student an email login too (their code still works)
  r := public.set_student_login((select v from e where k='old')::uuid, 'lee.sam@sd54.bc.ca');
  if r->>'username' <> 'lee.sam@sd54' then raise exception 'FAIL add email to code kid %', r; end if;
  if public.set_student_login((select v from e where k='old')::uuid, 'franklin.joshua@sd54')->>'error' <> 'already_added' then raise exception 'FAIL duplicate on set'; end if;
  raise notice 'teacher makes a new passcode, or adds email login to a code student: true';
end $$;
reset role;
