-- Tests for 20261109000000_progress_curves.sql (school_progress, super_progress). Any failure raises an exception.
\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
create temp table a (k text primary key, v text);
grant all on a to anon, authenticated;

insert into auth.users values
  ('cccccccc-0000-0000-0000-000000000001','admin1@p.ca'), ('cccccccc-0000-0000-0000-000000000002','teacher1@p.ca'),
  ('cccccccc-0000-0000-0000-000000000003','admin2@p.ca'), ('cccccccc-0000-0000-0000-000000000009','owner@p.ca');
insert into public.schools (name) values ('Prog School 1'), ('Prog School 2');
insert into public.teachers (id, school_id, name, role)
  select 'cccccccc-0000-0000-0000-000000000001', id, 'Admin 1', 'admin' from public.schools where name='Prog School 1';
insert into public.teachers (id, school_id, name, role)
  select 'cccccccc-0000-0000-0000-000000000002', id, 'Teacher 1', 'teacher' from public.schools where name='Prog School 1';
insert into public.teachers (id, school_id, name, role)
  select 'cccccccc-0000-0000-0000-000000000003', id, 'Admin 2', 'admin' from public.schools where name='Prog School 2';
insert into public.super_admins (user_id) values ('cccccccc-0000-0000-0000-000000000009');

insert into public.classes (school_id, teacher_id, name) select id, 'cccccccc-0000-0000-0000-000000000001', 'P1 A' from public.schools where name='Prog School 1';
insert into public.classes (school_id, teacher_id, name) select id, 'cccccccc-0000-0000-0000-000000000002', 'P1 B' from public.schools where name='Prog School 1';
insert into public.classes (school_id, teacher_id, name, archived_at) select id, 'cccccccc-0000-0000-0000-000000000001', 'P1 Old', now() from public.schools where name='Prog School 1';
insert into public.classes (school_id, teacher_id, name) select id, 'cccccccc-0000-0000-0000-000000000003', 'P2 A' from public.schools where name='Prog School 2';
insert into public.students (class_id, name) select id, 'Kid A' from public.classes where name='P1 A';
insert into public.students (class_id, name) select id, 'Kid Demo' from public.classes where name='P1 A';
insert into public.students (class_id, name) select id, 'Kid B' from public.classes where name='P1 B';
insert into public.students (class_id, name) select id, 'Kid Old' from public.classes where name='P1 Old';
insert into public.students (class_id, name) select id, 'Kid Two' from public.classes where name='P2 A';

-- rounds: ms since epoch, days ago
create function pg_temp.rd(days numeric, c int, n int, ms int) returns jsonb language sql as $$
  select jsonb_build_object('d', floor(extract(epoch from now() - days * interval '1 day') * 1000)::bigint, 'c', c, 'n', n, 'ms', ms, 'len', 60) $$;

-- Kid A: 3 weeks ago 10 right at 4 s; this week 20 right at 3 s; plus a short round (ignored), junk (ignored), and a 100-day-old round (outside the window)
update public.students set data = jsonb_build_object('rounds', jsonb_build_array(
    pg_temp.rd(21, 10, 12, 4000), pg_temp.rd(0.2, 20, 22, 3000), pg_temp.rd(0.3, 4, 5, 500), to_jsonb('junk'::text), '{"d":"x","c":"y"}'::jsonb, pg_temp.rd(100, 99, 99, 100)))
 where name='Kid A';
-- Demo student: huge numbers that must not show
update public.students set data = jsonb_build_object('demo', true, 'rounds', jsonb_build_array(pg_temp.rd(0.1, 90, 90, 600), pg_temp.rd(15, 80, 80, 700))) where name='Kid Demo';
-- Kid B (other class, same school): one round this week only
update public.students set data = jsonb_build_object('rounds', jsonb_build_array(pg_temp.rd(0.1, 8, 9, 6000))) where name='Kid B';
-- archived class and other school
update public.students set data = jsonb_build_object('rounds', jsonb_build_array(pg_temp.rd(0.1, 15, 16, 2000))) where name='Kid Old';
update public.students set data = jsonb_build_object('rounds', jsonb_build_array(pg_temp.rd(0.1, 30, 31, 1500))) where name='Kid Two';
-- a student whose data is not even an object-with-rounds must not break anything
update public.students set data = jsonb_build_object('rounds', 'not a list') where name='Kid Old';

insert into a select 'wk_old', to_char(date_trunc('week', (now() - interval '21 days') at time zone 'America/Vancouver')::date, 'YYYY-MM-DD');
insert into a select 'wk_now', to_char(date_trunc('week', (now() - interval '0.2 days') at time zone 'America/Vancouver')::date, 'YYYY-MM-DD');
insert into a select 'p1a', id::text from public.classes where name='P1 A';
insert into a select 'p1b', id::text from public.classes where name='P1 B';
insert into a select 'p1old', id::text from public.classes where name='P1 Old';
insert into a select 'p2a', id::text from public.classes where name='P2 A';

-- ---------- school admin sees only their own school ----------
set role authenticated;
do $$
declare j json; rows json; r json; n int := 0; found_a_old boolean := false; found_a_now boolean := false; found_b boolean := false;
begin
  perform set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000001', true);
  j := public.school_progress(); rows := j->'rows';
  if rows is null then raise exception 'FAIL admin got no rows: %', j; end if;
  for r in select * from json_array_elements(rows) loop
    n := n + 1;
    if (r->>'class_id') in ((select v from a where k='p2a'), (select v from a where k='p1old')) then raise exception 'FAIL leaked another school or an archived class: %', r; end if;
    if (r->>'class_id') = (select v from a where k='p1a') and (r->>'wk') = (select v from a where k='wk_old') then
      found_a_old := true;
      if (r->>'students')::int <> 1 or (r->>'rounds')::int <> 1 or (r->>'c_sum')::numeric <> 10 or (r->>'s_sum')::numeric <> 4 then raise exception 'FAIL old week for Kid A wrong: %', r; end if;
    elsif (r->>'class_id') = (select v from a where k='p1a') and (r->>'wk') = (select v from a where k='wk_now') then
      found_a_now := true;
      -- the demo student, the short round, the junk and the 100-day-old round must all be left out
      if (r->>'students')::int <> 1 or (r->>'rounds')::int <> 1 or (r->>'c_sum')::numeric <> 20 or (r->>'s_sum')::numeric <> 3 then raise exception 'FAIL this week for Kid A wrong: %', r; end if;
    elsif (r->>'class_id') = (select v from a where k='p1b') then
      found_b := true;
      if (r->>'c_sum')::numeric <> 8 or (r->>'s_sum')::numeric <> 6 then raise exception 'FAIL Kid B wrong: %', r; end if;
    else raise exception 'FAIL unexpected row: %', r;
    end if;
  end loop;
  if not (found_a_old and found_a_now and found_b) or n <> 3 then raise exception 'FAIL expected exactly 3 rows, got % (%)', n, rows; end if;
  raise notice 'school admin gets own school only, demo/short/junk/old rounds left out: true';
end $$;

-- ---------- a plain teacher, another school's admin, and the public cannot use the owner call; teachers cannot use the school call ----------
do $$
declare j json;
begin
  perform set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000002', true);
  if (public.school_progress()->>'error') <> 'not_admin' then raise exception 'FAIL teacher got school progress'; end if;
  if (public.super_progress()->>'error') <> 'not_allowed' then raise exception 'FAIL teacher got owner progress'; end if;
  perform set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000001', true);
  if (public.super_progress()->>'error') <> 'not_allowed' then raise exception 'FAIL school admin got owner progress'; end if;
  perform set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000003', true);
  j := public.school_progress();
  if json_array_length(j->'rows') <> 1 or (j->'rows'->0->>'class_id') <> (select v from a where k='p2a') then raise exception 'FAIL school 2 admin sees wrong rows: %', j; end if;
  raise notice 'role checks on both calls: true';
end $$;

-- ---------- the owner sees every school (still without demo students and archived classes) ----------
do $$
declare j json; n int;
begin
  perform set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000009', true);
  j := public.super_progress();
  select count(*) into n from json_array_elements(j->'rows') r where (r->>'class_id') in (select v from a where k in ('p1a','p1b','p2a'));
  if n <> 4 then raise exception 'FAIL owner expected 4 rows across both schools, got %: %', n, j; end if;
  if exists (select 1 from json_array_elements(j->'rows') r where (r->>'class_id') = (select v from a where k='p1old')) then raise exception 'FAIL archived class shown'; end if;
  raise notice 'owner sees all schools: true';
end $$;

-- ---------- signed out / anonymous and the internal helper are closed ----------
reset role; set role anon;
do $$
begin
  begin perform public.school_progress(); raise exception 'FAIL anon ran school_progress'; exception when insufficient_privilege then null; end;
  begin perform public.super_progress(); raise exception 'FAIL anon ran super_progress'; exception when insufficient_privilege then null; end;
  begin perform public._progress_rows(null); raise exception 'FAIL anon ran the helper'; exception when insufficient_privilege then null; end;
  raise notice 'anonymous callers are refused: true';
end $$;
reset role; set role authenticated;
do $$
begin
  begin perform public._progress_rows(null); raise exception 'FAIL signed-in user ran the helper directly'; exception when insufficient_privilege then null; end;
  raise notice 'helper cannot be called directly: true';
end $$;
reset role;
