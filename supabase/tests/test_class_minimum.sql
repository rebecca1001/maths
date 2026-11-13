-- Tests for 20261116000000_class_minimum.sql. Any failure raises an exception.
\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
create temp table m (k text primary key, v text);
grant all on m to anon, authenticated;
insert into auth.users values ('0e0e0e0e-0000-0000-0000-000000000001','owner@min.ca'), ('0e0e0e0e-0000-0000-0000-000000000002','t@min.ca'), ('0e0e0e0e-0000-0000-0000-000000000003','far@min.ca');
insert into public.schools (name) values ('Min Own'), ('Min Other'), ('Min Far');
insert into public.teachers (id, school_id, name, role) select '0e0e0e0e-0000-0000-0000-000000000001', id, 'Owner', 'admin' from public.schools where name='Min Own';
insert into public.teachers (id, school_id, name, role) select '0e0e0e0e-0000-0000-0000-000000000002', id, 'T', 'teacher' from public.schools where name='Min Other';
insert into public.teachers (id, school_id, name, role) select '0e0e0e0e-0000-0000-0000-000000000003', id, 'F', 'admin' from public.schools where name='Min Far';
insert into public.super_admins (user_id) values ('0e0e0e0e-0000-0000-0000-000000000001');
insert into public.classes (school_id, teacher_id, name, settings) select id, '0e0e0e0e-0000-0000-0000-000000000002', 'Min class', '{"maxTable":10,"sound":true}' from public.schools where name='Min Other';
insert into public.students (class_id, name) select id, 'Min Kid' from public.classes where name='Min class';
insert into m select 'class', id::text from public.classes where name='Min class';
insert into m select 'kid', id::text from public.students where name='Min Kid';

set role authenticated;
do $$
declare r json;
begin
  -- the school's own teacher
  perform set_config('request.jwt.claim.sub', '0e0e0e0e-0000-0000-0000-000000000002', true);
  r := public.set_class_minimum((select v from m where k='class')::uuid, null, 3);
  if (r->'settings'->>'minRounds')::int <> 3 or (r->'settings'->>'maxTable')::int <> 10 then raise exception 'FAIL teacher class min %', r; end if;
  r := public.set_class_minimum((select v from m where k='class')::uuid, (select v from m where k='kid')::uuid, 5);
  if (r->'settings'->'minFor'->>(select v from m where k='kid'))::int <> 5 then raise exception 'FAIL teacher student min %', r; end if;
  raise notice 'teacher sets class and student minimum, other settings kept: true';
  -- the owner, from another school
  perform set_config('request.jwt.claim.sub', '0e0e0e0e-0000-0000-0000-000000000001', true);
  r := public.set_class_minimum((select v from m where k='class')::uuid, null, 99);
  if (r->'settings'->>'minRounds')::int <> 10 then raise exception 'FAIL owner class min / clamp %', r; end if;
  r := public.set_class_minimum((select v from m where k='class')::uuid, (select v from m where k='kid')::uuid, null);
  if (r->'settings')::jsonb ? 'minFor' then raise exception 'FAIL owner clear student min %', r; end if;
  raise notice 'owner sets minimums in any school (clamped to 10, clearing works): true';
  -- a teacher at another school cannot
  perform set_config('request.jwt.claim.sub', '0e0e0e0e-0000-0000-0000-000000000003', true);
  if public.set_class_minimum((select v from m where k='class')::uuid, null, 1)->>'error' <> 'not_allowed' then raise exception 'FAIL other school changed it'; end if;
  -- the owner still cannot change anything else in another school
  perform set_config('request.jwt.claim.sub', '0e0e0e0e-0000-0000-0000-000000000001', true);
  update public.classes set name = 'Hacked' where id = (select v from m where k='class')::uuid;
  raise notice 'other schools blocked: true';
end $$;
reset role;
do $$ begin
  if exists (select 1 from public.classes where name = 'Hacked') then raise exception 'FAIL owner renamed a class in another school'; end if;
  if (select (settings->>'minRounds')::int from public.classes where name = 'Min class') <> 10 then raise exception 'FAIL final state'; end if;
  raise notice 'owner still cannot change anything else: true';
end $$;
set role anon;
do $$ declare ok boolean := false; begin
  begin perform public.set_class_minimum((select v from m where k='class')::uuid, null, 1); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL anon can set minimum'; end if;
end $$;
reset role;
