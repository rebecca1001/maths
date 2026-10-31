-- Local test of the migration's rules. Run after supabase_stub.sql + the migration.
\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
create temp table t (k text primary key, v text);
grant all on t to anon, authenticated;

insert into auth.users values
 ('11111111-1111-1111-1111-111111111111','a@school.ca'),
 ('22222222-2222-2222-2222-222222222222','b@other.ca'),
 ('33333333-3333-3333-3333-333333333333','c@school.ca');

-- Teacher A creates a school and a class with 3 students
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select 'create_school ok: ' || (public.create_school('Smithers Elementary','Ms A') is not null);
insert into public.classes (name) values ('Grade 5 Ravens');
insert into t select 'class', id::text from public.classes;
insert into t select 'code', code from public.classes;
select 'class code format ok: ' || (code ~ '^[A-HJ-NP-Z2-9]{6}$') from public.classes;
insert into public.students (class_id, name) select id, 'Comet Fox' from public.classes;
insert into public.students (class_id, name) select id, 'Nova Falcon' from public.classes;
insert into public.students (class_id, name) select id, 'Lunar Otter' from public.classes;
select 'pins ok: ' || bool_and(pin ~ '^[0-9]{4}$') || ' distinct=' || (count(distinct pin) = 3) from public.students;
insert into t select 'pin_fox', pin from public.students where name = 'Comet Fox';
insert into t select 'id_fox', id::text from public.students where name = 'Comet Fox';
insert into t select 'id_nova', id::text from public.students where name = 'Nova Falcon';
insert into t select 'pin_nova', pin from public.students where name = 'Nova Falcon';
select 'join code: ' || (join_code ~ '^[0-9A-F]{8}$') from public.schools;
insert into t select 'join', join_code from public.schools;

-- Teacher C joins school A with the join code and can see the class
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
select 'join_school ok: ' || (public.join_school((select v from t where k='join'),'Mr C') is not null);
select 'teacher C sees class: ' || (count(*) = 1) from public.classes;
select 'teacher C sees 3 students: ' || (count(*) = 3) from public.students;

-- Teacher B at another school sees nothing of school A
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select 'create_school B ok: ' || (public.create_school('Other School','Ms B') is not null);
select 'teacher B sees 0 classes: ' || (count(*) = 0) from public.classes;
select 'teacher B sees 0 students: ' || (count(*) = 0) from public.students;
select 'teacher B sees 1 school: ' || (count(*) = 1) from public.schools;
do $$ begin
  begin
    insert into public.students (class_id, name) values ((select v::uuid from t where k='class'), 'Intruder');
    raise notice 'FAIL: teacher B inserted into school A';
  exception when others then raise notice 'teacher B blocked from adding to school A: true';
  end;
end $$;
update public.students set name = 'Hacked';

select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select 'teacher B could not rename A students: ' || not exists (select 1 from public.students where name = 'Hacked');

-- Real names: teachers at the school only
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
update public.students set real_name = 'Ava Smith' where name = 'Comet Fox';
select 'teacher A sees real name: ' || ((select real_name from public.students where name = 'Comet Fox') = 'Ava Smith');
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select 'teacher B (other school) cannot see it: ' || not exists (select 1 from public.students where real_name is not null);
reset role;
set role authenticated;

-- Anonymous visitor: no direct table access at all
reset role;
set role anon;
select set_config('request.jwt.claim.sub','',false);
do $$ begin
  begin perform 1 from public.students; raise notice 'FAIL: anon read students';
  exception when insufficient_privilege then raise notice 'anon blocked from students table: true'; end;
  begin perform 1 from public.student_sessions; raise notice 'FAIL: anon read sessions';
  exception when insufficient_privilege then raise notice 'anon blocked from sessions table: true'; end;
end $$;

-- Student login
select 'wrong code: ' || public.student_login((select v from t where k='code'), '0000')::text;
select 'no class: ' || public.student_login('ZZZZZZ', '1234')::text;
insert into t select 'tok_fox', (public.student_login(lower((select v from t where k='code')), (select v from t where k='pin_fox')) ->> 'token');
select 'fox token issued (class code not case sensitive): ' || (length(v) = 64) from t where k='tok_fox';
insert into t select 'tok_nova', (public.student_login((select v from t where k='code'), (select v from t where k='pin_nova')) ->> 'token');

-- State: me with facts, classmates without facts
select 'save ok: ' || public.student_save((select v from t where k='tok_fox'), '{"coins": 42, "facts": {"7,8": {"r": [1]}}, "rounds": [], "pin": "9999"}')::text;
select 'state me coins: ' || (public.student_state((select v from t where k='tok_fox')) -> 'me' -> 'data' ->> 'coins');
select 'pin not stored in data: ' || ((public.student_state((select v from t where k='tok_fox')) -> 'me' -> 'data') ->> 'pin' is null);
select 'classmates count 2: ' || (json_array_length(public.student_state((select v from t where k='tok_nova')) -> 'classmates') = 2);
select 'classmate facts hidden: ' || not exists (
  select 1 from json_array_elements(public.student_state((select v from t where k='tok_nova')) -> 'classmates') e where (e -> 'data')::jsonb ? 'facts');
select 'classmates get only skin + week totals: ' || not exists (
  select 1 from json_array_elements(public.student_state((select v from t where k='tok_nova')) -> 'classmates') e
  where exists (select 1 from jsonb_object_keys((e -> 'data')::jsonb) k where k not in ('skin','wkStars','wkMins')));
select 'real name never sent to students: ' || (position('Ava' in public.student_state((select v from t where k='tok_fox'))::text) = 0
  and position('Ava' in public.student_state((select v from t where k='tok_nova'))::text) = 0);
select 'my own data still complete: ' || ((public.student_state((select v from t where k='tok_fox')) -> 'me' -> 'data') ->> 'coins' = '42');
select 'bad token: ' || public.student_state('nope')::text;

-- Week totals for the Top 10
select public.student_save((select v from t where k='tok_fox'), json_build_object('coins', 42, 'skin', 'ninja', 'rounds', json_build_array(
  json_build_object('d', (extract(epoch from now()) * 1000)::bigint, 'c', 20, 'stars', 75, 'len', 60),
  json_build_object('d', (extract(epoch from now()) * 1000)::bigint - 3600000, 'c', 18, 'pts', 700, 'len', 60),
  json_build_object('d', (extract(epoch from now() - interval '10 days') * 1000)::bigint, 'c', 30, 'stars', 999, 'len', 60)))::jsonb);
select 'fox week stars/mins as nova sees them: ' || (select (e -> 'data')::text from json_array_elements(public.student_state((select v from t where k='tok_nova')) -> 'classmates') e
  where e ->> 'id' = (select v from t where k='id_fox'));
select 'battle table gone: ' || (to_regclass('public.challenges') is null);

-- Logout ends the session
select public.student_logout((select v from t where k='tok_fox'));
select 'after logout: ' || public.student_state((select v from t where k='tok_fox'))::text;

-- Brute force guard
do $$ declare i int; r json; begin
  for i in 1..35 loop r := public.student_login('ABCDEF', lpad(i::text,4,'0')); end loop;
  raise notice 'after 35 bad tries: %', r;
end $$;

-- School admin
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
select 'non-admin cannot change roles: ' || public.admin_set_role('33333333-3333-3333-3333-333333333333','admin')::text;
select 'non-admin cannot set passwords: ' || public.admin_set_password('11111111-1111-1111-1111-111111111111','hacked1234')::text;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select 'admin sees both teachers with emails: ' || (count(*) = 2) from public.teachers where email is not null;
select 'last admin cannot step down: ' || public.admin_set_role('11111111-1111-1111-1111-111111111111','teacher')::text;
select 'make C admin: ' || public.admin_set_role('33333333-3333-3333-3333-333333333333','admin')::text;
select 'admin sets C password: ' || public.admin_set_password('33333333-3333-3333-3333-333333333333','newpass123')::text;
select 'too short refused: ' || public.admin_set_password('33333333-3333-3333-3333-333333333333','abc')::text;
reset role;
select 'C password works (bcrypt): ' || (select encrypted_password = extensions.crypt('newpass123', encrypted_password) and encrypted_password like '$2a$%' from auth.users where id = '33333333-3333-3333-3333-333333333333');
set role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select 'other school admin cannot set C password: ' || public.admin_set_password('33333333-3333-3333-3333-333333333333','hacked1234')::text;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select 'admin cannot remove self: ' || public.admin_remove_teacher('11111111-1111-1111-1111-111111111111')::text;
insert into t select 'oldjoin', join_code from public.schools;
select 'new school code: ' || ((public.admin_new_join_code() ->> 'join_code') <> (select v from t where k='oldjoin'));
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select 'other school admin cannot remove C: ' || public.admin_remove_teacher('33333333-3333-3333-3333-333333333333')::text;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
update public.classes set teacher_id = '33333333-3333-3333-3333-333333333333';
select 'assign class to C: ' || (select teacher_id = '33333333-3333-3333-3333-333333333333' from public.classes);
select 'remove C: ' || public.admin_remove_teacher('33333333-3333-3333-3333-333333333333')::text;
select 'class kept, no teacher: ' || (select teacher_id is null from public.classes);
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
select 'removed teacher sees 0 classes: ' || (count(*) = 0) from public.classes;
reset role;
set role anon;
do $$ begin
  begin perform public.admin_set_role(gen_random_uuid(),'admin'); raise notice 'FAIL: anon admin_set_role';
  exception when insufficient_privilege then raise notice 'anon blocked from admin functions: true'; end;
end $$;

-- Delete my account
reset role;
insert into auth.users values ('44444444-4444-4444-4444-444444444444','d@school.ca'),('55555555-5555-5555-5555-555555555555','e@solo.ca');
insert into t select 'join2', s.join_code from public.schools s join public.teachers tt on tt.school_id = s.id where tt.id = '11111111-1111-1111-1111-111111111111';
set role authenticated;
select set_config('request.jwt.claim.sub','44444444-4444-4444-4444-444444444444',false);
select public.join_school((select v from t where k='join2'),'Mr D') is not null;
insert into public.classes (name) values ('D class');
select 'teacher D deletes account: ' || public.delete_my_account()::text;
reset role;
select 'D login gone: ' || not exists (select 1 from auth.users where id = '44444444-4444-4444-4444-444444444444');
select 'D class kept, no teacher: ' || exists (select 1 from public.classes where name = 'D class' and teacher_id is null);
select 'school A still there: ' || exists (select 1 from public.teachers where id = '11111111-1111-1111-1111-111111111111');
-- solo teacher: school and students go with them
set role authenticated;
select set_config('request.jwt.claim.sub','55555555-5555-5555-5555-555555555555',false);
select public.create_school('Solo School','Ms E') is not null;
insert into public.classes (name) values ('E class');
insert into public.students (class_id, name) select id, 'Solo Kid' from public.classes where name = 'E class';
select 'solo teacher deletes account: ' || public.delete_my_account()::text;
reset role;
select 'solo school, class and student gone: ' || (not exists (select 1 from public.schools where name = 'Solo School') and not exists (select 1 from public.students where name = 'Solo Kid'));
set role anon;
do $$ begin
  begin perform public.delete_my_account(); raise notice 'FAIL: anon delete_my_account';
  exception when insufficient_privilege then raise notice 'anon blocked from delete_my_account: true'; end;
end $$;
reset role;

-- Archived class: students can no longer log in or play
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
update public.classes set archived_at = now();
reset role;
set role anon;
select 'archived class state: ' || public.student_state((select v from t where k='tok_nova'))::text;

-- Anon cannot call teacher-only or internal functions
do $$ begin
  begin perform public.create_school('x','y'); raise notice 'FAIL: anon create_school';
  exception when insufficient_privilege then raise notice 'anon blocked from create_school: true'; end;
  begin perform public._student_from_token('x'); raise notice 'FAIL: anon internal fn';
  exception when insufficient_privilege then raise notice 'anon blocked from internal function: true'; end;
end $$;
reset role;
