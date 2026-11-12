-- Tests for 20261114000000_owner_views_any_school.sql. Any failure raises an exception.
\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
create temp table o (k text primary key, v text);
grant all on o to anon, authenticated;
insert into auth.users values ('0c0c0c0c-0000-0000-0000-000000000001','owner@ov.ca'), ('0c0c0c0c-0000-0000-0000-000000000002','teach@ov.ca');
insert into public.schools (name) values ('OV Own'), ('OV Other');
insert into public.teachers (id, school_id, name, role) select '0c0c0c0c-0000-0000-0000-000000000001', id, 'Owner', 'admin' from public.schools where name='OV Own';
insert into public.teachers (id, school_id, name, role) select '0c0c0c0c-0000-0000-0000-000000000002', id, 'Other teacher', 'admin' from public.schools where name='OV Other';
insert into public.super_admins (user_id) values ('0c0c0c0c-0000-0000-0000-000000000001');
insert into public.classes (school_id, teacher_id, name) select id, '0c0c0c0c-0000-0000-0000-000000000002', 'OV Other class' from public.schools where name='OV Other';
insert into public.students (class_id, name, real_name) select id, 'OV Kid', 'Real Kid' from public.classes where name='OV Other class';
insert into o select 'other_class', id::text from public.classes where name='OV Other class';
insert into o select 'other_school', id::text from public.schools where name='OV Other';

set role authenticated;
do $$
declare n int; r json;
begin
  -- owner can read another school's school, teachers, classes and students
  perform set_config('request.jwt.claim.sub', '0c0c0c0c-0000-0000-0000-000000000001', true);
  select count(*) into n from public.classes where school_id = (select v from o where k='other_school')::uuid; if n <> 1 then raise exception 'FAIL owner classes %', n; end if;
  select count(*) into n from public.students where class_id = (select v from o where k='other_class')::uuid; if n <> 1 then raise exception 'FAIL owner students %', n; end if;
  select count(*) into n from public.teachers where school_id = (select v from o where k='other_school')::uuid; if n <> 1 then raise exception 'FAIL owner teachers %', n; end if;
  select count(*) into n from public.schools where id = (select v from o where k='other_school')::uuid; if n <> 1 then raise exception 'FAIL owner schools %', n; end if;
  r := public.class_stats((select v from o where k='other_class')::uuid); if r->>'error' is not null then raise exception 'FAIL owner class_stats %', r; end if;
  raise notice 'owner reads any school (classes, students, teachers, class_stats): true';

  -- but cannot change it
  update public.students set real_name = 'Hacked' where class_id = (select v from o where k='other_class')::uuid;
  update public.classes set name = 'Hacked' where id = (select v from o where k='other_class')::uuid;
  delete from public.students where class_id = (select v from o where k='other_class')::uuid;
  update public.schools set name = 'Hacked' where id = (select v from o where k='other_school')::uuid;
  begin
    insert into public.students (class_id, name) values ((select v from o where k='other_class')::uuid, 'Sneaky');
    raise exception 'FAIL owner inserted into another school';
  exception when insufficient_privilege or check_violation then null; end;
end $$;
reset role;
do $$ begin
  if exists (select 1 from public.students where real_name = 'Hacked' or name = 'Sneaky') or not exists (select 1 from public.students where name = 'OV Kid')
     or exists (select 1 from public.classes where name = 'Hacked') or exists (select 1 from public.schools where name = 'Hacked') then
    raise exception 'FAIL owner changed another school'; end if;
  raise notice 'owner view is read-only: updates, deletes and inserts in other schools do nothing: true';
end $$;

set role authenticated;
do $$
declare n int;
begin
  -- an ordinary teacher still sees only their own school
  perform set_config('request.jwt.claim.sub', '0c0c0c0c-0000-0000-0000-000000000002', true);
  select count(*) into n from public.schools; if n <> 1 then raise exception 'FAIL teacher sees % schools', n; end if;
  select count(*) into n from public.classes where school_id <> (select v from o where k='other_school')::uuid; if n <> 0 then raise exception 'FAIL teacher sees other classes'; end if;
  raise notice 'ordinary teachers still see only their own school: true';
end $$;
reset role;
