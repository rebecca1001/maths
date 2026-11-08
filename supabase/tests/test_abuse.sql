-- Regression tests for 20261108000000_login_throttle_and_star_validation.sql. Any failure raises an exception.
\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
create temp table a (k text primary key, v text);
grant all on a to anon, authenticated;

insert into auth.users values ('bbbbbbbb-0000-0000-0000-000000000001','a@school.ca');
insert into public.schools (name) values ('Abuse School');
insert into public.teachers (id, school_id, name, role) select 'bbbbbbbb-0000-0000-0000-000000000001', id, 'A', 'admin' from public.schools where name='Abuse School';
insert into public.classes (school_id, teacher_id, name) select id, 'bbbbbbbb-0000-0000-0000-000000000001', 'Class ' || g from public.schools, generate_series(1,5) g where name='Abuse School';
insert into public.students (class_id, name) select c.id, 'Kid ' || g from public.classes c, generate_series(1,3) g where c.name like 'Class %';
-- remember: class 1 code + its first kid's pin, class 2, 3 (for the login tests), and tokens for the save tests
insert into a select 'code1', code from public.classes where name='Class 1';
insert into a select 'code2', code from public.classes where name='Class 2';
insert into a select 'code3', code from public.classes where name='Class 3';
insert into a select 'pin1', s.pin from public.students s join public.classes c on c.id=s.class_id where c.name='Class 1' and s.name='Kid 1';
insert into a select 'pin2', s.pin from public.students s join public.classes c on c.id=s.class_id where c.name='Class 2' and s.name='Kid 1';
insert into a select 'pin3', s.pin from public.students s join public.classes c on c.id=s.class_id where c.name='Class 3' and s.name='Kid 1';

-- ---------- login throttle ----------
set role anon;
do $$
declare code1 text := (select v from a where k='code1'); pin1 text := (select v from a where k='pin1'); r json;
begin
  -- no device address (e.g. headers missing): old rule, 100 wrong tries per class
  perform set_config('request.headers', '', true);
  if (public.student_login(code1, pin1)->>'token') is null then raise exception 'FAIL baseline login'; end if;
end $$;
reset role;

-- 100 wrong tries from device A on class 1 blocks A there, but another device still gets in
insert into public.login_failures (class_code, ip) select (select v from a where k='code1'), '10.0.0.1' from generate_series(1,100);
set role anon;
do $$
declare code1 text := (select v from a where k='code1'); pin1 text := (select v from a where k='pin1');
begin
  perform set_config('request.headers', '{"cf-connecting-ip":"10.0.0.1"}', true);
  if (public.student_login(code1, pin1)->>'error') <> 'too_many_tries' then raise exception 'FAIL device A not blocked after 100 wrong tries'; end if;
  perform set_config('request.headers', '{"cf-connecting-ip":"10.0.0.2"}', true);
  if (public.student_login(code1, pin1)->>'token') is null then raise exception 'FAIL a different device was locked out by device A'; end if;
  raise notice 'one device cannot lock the class for everyone else: true';
  -- spoofing the forwarded-for list does not help when the gateway header is present
  perform set_config('request.headers', '{"cf-connecting-ip":"10.0.0.1","x-forwarded-for":"1.2.3.4"}', true);
  if (public.student_login(code1, pin1)->>'error') <> 'too_many_tries' then raise exception 'FAIL x-forwarded-for overrode cf-connecting-ip'; end if;
  -- the blocked device can still try a different class (its limit there is separate)...
  perform set_config('request.headers', '{"cf-connecting-ip":"10.0.0.1"}', true);
  if (public.student_login((select v from a where k='code2'), (select v from a where k='pin2'))->>'token') is null then raise exception 'FAIL device A blocked on an unrelated class'; end if;
  raise notice 'per-class device limit is per class: true';
end $$;
reset role;

-- class-wide ceiling of 400 from many devices blocks everyone on that class
insert into public.login_failures (class_code, ip) select (select v from a where k='code3'), '10.1.' || (g/200) || '.' || (g%200) from generate_series(1,400) g;
set role anon;
do $$
begin
  perform set_config('request.headers', '{"cf-connecting-ip":"10.9.9.9"}', true);
  if (public.student_login((select v from a where k='code3'), (select v from a where k='pin3'))->>'error') <> 'too_many_tries' then raise exception 'FAIL class-wide ceiling not enforced'; end if;
  raise notice 'class-wide ceiling of 400 enforced: true';
end $$;
reset role;

-- 300 wrong tries from one device spread across many classes blocks it everywhere
insert into public.login_failures (class_code, ip) select 'ZZ' || (g % 50), '10.7.7.7' from generate_series(1,300) g;
set role anon;
do $$
begin
  perform set_config('request.headers', '{"cf-connecting-ip":"10.7.7.7"}', true);
  if (public.student_login((select v from a where k='code2'), (select v from a where k='pin2'))->>'error') <> 'too_many_tries' then raise exception 'FAIL scanning many classes not blocked'; end if;
  raise notice 'scanning many classes from one device is blocked: true';
  -- no header at all: falls back to 100 per class
  perform set_config('request.headers', '', true);
end $$;
reset role;
delete from public.login_failures;
insert into public.login_failures (class_code, ip) select (select v from a where k='code2'), null from generate_series(1,100);
set role anon;
do $$
begin
  perform set_config('request.headers', '', true);
  if (public.student_login((select v from a where k='code2'), (select v from a where k='pin2'))->>'error') <> 'too_many_tries' then raise exception 'FAIL fallback class limit of 100 not enforced'; end if;
  raise notice 'without a device address the 100-per-class limit still applies: true';
end $$;
reset role;
delete from public.login_failures;

-- ---------- star validation ----------
-- test helper: lets the test read a student's saved data by token without table access (removed at the end)
create function public.t_data(p_tok text) returns jsonb language sql security definer as $$ select s.data from public.students s join public.student_sessions ss on ss.student_id=s.id where ss.token=p_tok $$;
grant execute on function public.t_data(text) to anon;

insert into a select 'pin_k2', s.pin from public.students s join public.classes c on c.id=s.class_id where c.name='Class 1' and s.name='Kid 2';
set role anon;
insert into a select 'tok', public.student_login((select v from a where k='code1'), (select v from a where k='pin_k2'))->>'token';
do $$ begin perform set_config('request.headers', '', true); end $$;
reset role;
-- helper to read this kid's saved rounds
create or replace function pg_temp.rounds() returns jsonb language sql as $$ select data->'rounds' from public.students s join public.classes c on c.id=s.class_id where c.name='Class 1' and s.name='Kid 2' $$;
create or replace function pg_temp.rp() returns text language sql as $$ select data->>'rankPaid' from public.students s join public.classes c on c.id=s.class_id where c.name='Class 1' and s.name='Kid 2' $$;

set role anon;
do $$
declare tok text := (select v from a where k='tok'); ms bigint := (extract(epoch from now())*1000)::bigint; j json; saved jsonb; i int;
begin
  -- 1) an honest round (20/22 at 2.5 s = 822 pts = 82 stars) is stored as sent
  perform public.student_save(tok, jsonb_build_object('rounds', jsonb_build_array(jsonb_build_object('d',ms-1000,'c',20,'n',22,'ms',2500,'len',60,'pts',822,'stars',82,'best',3,'boss',false))));
  saved := (public.t_data(tok)->'rounds');
  if (saved->0->>'stars')::int <> 82 or (saved->0->>'pts')::int <> 822 then raise exception 'FAIL honest round changed: %', saved; end if;
  raise notice 'honest round stored unchanged (82 stars): true';

  -- 2) an inflated round is rescored from what actually happened, not from the stars the browser claims
  perform public.student_save(tok, jsonb_build_object('rounds', jsonb_build_array(
    jsonb_build_object('d',ms-1000,'c',20,'n',22,'ms',2500,'len',60,'pts',822,'stars',82),
    jsonb_build_object('d',ms-2000,'c',20,'n',22,'ms',2500,'len',9999,'pts',99999,'stars',99999))));
  saved := (public.t_data(tok)->'rounds');
  if (saved->1->>'stars')::int <> 82 or (saved->1->>'len')::int <> 60 then raise exception 'FAIL inflated round not rescored: %', saved; end if;
  raise notice 'claimed 99999 stars is stored as 82: true';

  -- 3) impossible speed (200 right in 1 ms each) is capped at what a person can do
  perform public.student_save(tok, jsonb_build_object('rounds', saved || jsonb_build_array(jsonb_build_object('d',ms-3000,'c',200,'n',200,'ms',1,'len',60,'stars',100))));
  saved := (public.t_data(tok)->'rounds');
  if (saved->2->>'c')::int > 150 or (saved->2->>'stars')::int > 100 or (saved->2->>'ms')::int < 400 then raise exception 'FAIL impossible speed accepted: %', saved->2; end if;
  raise notice 'impossible speed is capped: true';

  -- 4) editing a round the server already has changes nothing
  perform public.student_save(tok, jsonb_build_object('rounds', jsonb_build_array(jsonb_build_object('d',ms-1000,'c',99,'n',99,'ms',500,'len',60,'stars',5000))));
  saved := (public.t_data(tok)->'rounds');
  if (saved->0->>'stars')::int <> 82 then raise exception 'FAIL an old round was edited: %', saved; end if;
  raise notice 'old rounds cannot be edited: true';

  -- 5) a future date is clamped to now
  perform public.student_save(tok, jsonb_build_object('rounds', saved || jsonb_build_array(jsonb_build_object('d',ms+86400000::bigint*30,'c',5,'n',5,'ms',3000,'len',60))));
  saved := (public.t_data(tok)->'rounds');
  if exists (select 1 from jsonb_array_elements(saved) r where (r->>'d')::bigint > ms + 5000) then raise exception 'FAIL future date kept'; end if;
  raise notice 'future dates are clamped: true';
end $$;
reset role;

-- 6) flooding: 50 new rounds in one save keeps only what the elapsed time allows, and a second flood right after gets nothing
update public.students set data = '{}', round_credit_at = null where id = (select student_id from public.student_sessions where token=(select v from a where k='tok'));
set role anon;
do $$
declare tok text := (select v from a where k='tok'); ms bigint := (extract(epoch from now())*1000)::bigint; cnt int; arr jsonb := '[]'::jsonb; i int; sid uuid;
begin
  for i in 1..50 loop arr := arr || jsonb_build_array(jsonb_build_object('d',ms-i*1000,'c',20,'n',22,'ms',2500,'len',60,'stars',82)); end loop;
  perform public.student_save(tok, jsonb_build_object('rounds', arr));
  cnt := jsonb_array_length(public.t_data(tok)->'rounds');
  if cnt > 6 or cnt < 1 then raise exception 'FAIL flood kept % rounds', cnt; end if;
  raise notice 'flood of 50 rounds keeps % (max 6): true', cnt;
  arr := '[]'::jsonb;
  for i in 51..60 loop arr := arr || jsonb_build_array(jsonb_build_object('d',ms-i*1000,'c',20,'n',22,'ms',2500,'len',60,'stars',82)); end loop;
  perform public.student_save(tok, jsonb_build_object('rounds', (public.t_data(tok)->'rounds') || arr));
  if jsonb_array_length(public.t_data(tok)->'rounds') <> cnt then raise exception 'FAIL second flood accepted'; end if;
  raise notice 'a second flood straight after gets nothing: true';
end $$;
reset role;

-- 7) time passing earns new rounds: pretend the last credit was 100 s ago -> 2 rounds allowed
update public.students set round_credit_at = now() - interval '100 seconds' where id = (select student_id from public.student_sessions where token=(select v from a where k='tok'));
set role anon;
do $$
declare tok text := (select v from a where k='tok'); ms bigint := (extract(epoch from now())*1000)::bigint; before_n int; after_n int; arr jsonb := '[]'::jsonb; i int;
begin
  before_n := jsonb_array_length(public.t_data(tok)->'rounds');
  for i in 1..5 loop arr := arr || jsonb_build_array(jsonb_build_object('d',ms+i,'c',15,'n',16,'ms',3000,'len',60)); end loop;
  perform public.student_save(tok, jsonb_build_object('rounds', (public.t_data(tok)->'rounds') || arr));
  after_n := jsonb_array_length(public.t_data(tok)->'rounds');
  if after_n - before_n <> 2 then raise exception 'FAIL expected exactly 2 new rounds after 100 s, got %', after_n - before_n; end if;
  raise notice '100 seconds earns 2 rounds: true';
end $$;
reset role;

-- 8) rank: it can only go up, and bonus stars are bounded by rank progress
update public.students set data = '{"rankPaid":3}', round_credit_at = null where id = (select student_id from public.student_sessions where token=(select v from a where k='tok'));
set role anon;
do $$
declare tok text := (select v from a where k='tok'); ms bigint := (extract(epoch from now())*1000)::bigint; saved jsonb; rp text;
begin
  perform public.student_save(tok, jsonb_build_object('rankPaid', 1));
  rp := (public.t_data(tok)->>'rankPaid');
  if rp <> '3' then raise exception 'FAIL rank went down to %', rp; end if;
  raise notice 'rank cannot go down: true';
  -- rank 3 -> 5 earns (10+20)+(10+25)=65 bonus stars on top of 86 base: a claim of 2000 is cut to 151
  perform public.student_save(tok, jsonb_build_object('rankPaid', 5, 'rounds', jsonb_build_array(jsonb_build_object('d',ms,'c',10,'n',10,'ms',3000,'len',60,'stars',2000))));
  saved := (public.t_data(tok)->'rounds');
  if (saved->0->>'stars')::int <> 151 then raise exception 'FAIL rank bonus not bounded: %', saved; end if;
  raise notice 'rank bonus bounded (2000 claimed, 151 kept): true';
  -- a boss win adds 25
  perform public.student_save(tok, jsonb_build_object('rankPaid', 5, 'rounds', saved || jsonb_build_array(jsonb_build_object('d',ms-5000,'c',10,'n',10,'ms',3000,'len',60,'stars',500,'boss',true))));
  saved := (public.t_data(tok)->'rounds');
  if not exists (select 1 from jsonb_array_elements(saved) r where (r->>'stars')::int = 111) then raise exception 'FAIL boss round should be 86+25=111: %', saved; end if;
  raise notice 'boss win adds exactly 25: true';
end $$;
reset role;
drop function public.t_data(text);
