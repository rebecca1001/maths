-- Tests for 20261111000000_competitions.sql (plans, round log, competitions). Any failure raises an exception.
\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
create temp table a (k text primary key, v text);
grant all on a to anon, authenticated;

insert into auth.users values
  ('dddddddd-0000-0000-0000-000000000001','admin@comp.ca'), ('dddddddd-0000-0000-0000-000000000002','teacher@comp.ca'),
  ('dddddddd-0000-0000-0000-000000000003','teacher2@comp.ca'), ('dddddddd-0000-0000-0000-000000000004','other@comp.ca'),
  ('dddddddd-0000-0000-0000-000000000009','owner@comp.ca');
insert into public.schools (name) values ('Comp School'), ('Far School');
insert into public.teachers (id, school_id, name, role) select 'dddddddd-0000-0000-0000-000000000001', id, 'Principal', 'admin' from public.schools where name='Comp School';
insert into public.teachers (id, school_id, name, role) select 'dddddddd-0000-0000-0000-000000000002', id, 'Teacher A', 'teacher' from public.schools where name='Comp School';
insert into public.teachers (id, school_id, name, role) select 'dddddddd-0000-0000-0000-000000000003', id, 'Teacher B', 'teacher' from public.schools where name='Comp School';
insert into public.teachers (id, school_id, name, role) select 'dddddddd-0000-0000-0000-000000000004', id, 'Other admin', 'admin' from public.schools where name='Far School';
insert into public.super_admins (user_id) values ('dddddddd-0000-0000-0000-000000000009');

insert into public.classes (school_id, teacher_id, name) select id, 'dddddddd-0000-0000-0000-000000000002', 'Class A' from public.schools where name='Comp School';
insert into public.classes (school_id, teacher_id, name) select id, 'dddddddd-0000-0000-0000-000000000003', 'Class B' from public.schools where name='Comp School';
insert into public.classes (school_id, teacher_id, name) select id, 'dddddddd-0000-0000-0000-000000000004', 'Far class' from public.schools where name='Far School';
insert into public.students (class_id, name, real_name) select id, 'Star Fox', 'Amy Real' from public.classes where name='Class A';
insert into public.students (class_id, name, real_name) select id, 'Moon Cat', 'Ben Real' from public.classes where name='Class A';
insert into public.students (class_id, name) select id, 'Demo Kid' from public.classes where name='Class A';
insert into public.students (class_id, name) select id, 'Comet Owl' from public.classes where name='Class B';
insert into public.students (class_id, name) select id, 'Far Away' from public.classes where name='Far class';
update public.students set data = '{"demo": true}' where name = 'Demo Kid';

insert into a select 'school', id::text from public.schools where name='Comp School';
insert into a select 'other_school', id::text from public.schools where name='Far School';
insert into a select 'class_a', id::text from public.classes where name='Class A';
insert into a select 'class_b', id::text from public.classes where name='Class B';
insert into a select 'other_class', id::text from public.classes where name='Far class';
insert into a select 'start', to_char((now() at time zone 'America/Vancouver')::date - 3, 'YYYY-MM-DD');
insert into a select 'end', to_char((now() at time zone 'America/Vancouver')::date + 20, 'YYYY-MM-DD');
-- student sessions
insert into public.student_sessions (token, student_id) select 'tok_amy', id from public.students where name='Star Fox';
insert into public.student_sessions (token, student_id) select 'tok_ben', id from public.students where name='Moon Cat';
insert into public.student_sessions (token, student_id) select 'tok_demo', id from public.students where name='Demo Kid';
insert into public.student_sessions (token, student_id) select 'tok_owl', id from public.students where name='Comet Owl';
insert into public.student_sessions (token, student_id) select 'tok_far', id from public.students where name='Far Away';

create function pg_temp.round(ago_ms bigint, c int, n int, ms int) returns jsonb language sql as $$
  select jsonb_build_object('d', floor(extract(epoch from now()) * 1000)::bigint - ago_ms, 'c', c, 'n', n, 'ms', ms, 'len', 60) $$;

-- ---------- plans: free schools cannot make competitions, and nobody but the owner can change a plan ----------
set role authenticated;
do $$
declare r json; ok boolean := false;
begin
  perform set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000001', true);
  r := public.competition_create(jsonb_build_object('kind','school_target','target',100,'prize','Pizza','starts_on',(select v from a where k='start'),'ends_on',(select v from a where k='end')));
  if r->>'error' is distinct from 'needs_plan' then raise exception 'FAIL free plan allowed: %', r; end if;
  if (public.competitions_list()->>'plan') <> 'free' then raise exception 'FAIL list plan'; end if;
  begin
    update public.schools set plan = 'school_plus' where id = (select v from a where k='school')::uuid;
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL admin could change own plan'; end if;
  update public.schools set name = 'Comp School' where id = (select v from a where k='school')::uuid; -- renaming still works
  r := public.super_set_plan((select v from a where k='school')::uuid, 'school_plus');
  if r->>'error' is distinct from 'not_allowed' then raise exception 'FAIL admin used super_set_plan: %', r; end if;
  raise notice 'free plan locked, plan only changeable by the owner, rename still works: true';

  perform set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000009', true);
  r := public.super_set_plan((select v from a where k='school')::uuid, 'school');
  if (r->>'ok') is distinct from 'true' then raise exception 'FAIL owner set plan: %', r; end if;
  if (select plan from public.schools where id = (select v from a where k='school')::uuid) <> 'school' then raise exception 'FAIL plan not saved'; end if;
  if not exists (select 1 from json_array_elements(public.super_overview()->'schools') x where x->>'plan' = 'school') then raise exception 'FAIL overview plan'; end if;
  if public.super_set_plan((select v from a where k='school')::uuid, 'gold')->>'error' <> 'bad_plan' then raise exception 'FAIL bad plan'; end if;
  raise notice 'owner sets plans: true';
end $$;
reset role;

-- ---------- who can make what ----------
set role authenticated;
do $$
declare r json; s text := (select v from a where k='start'); e text := (select v from a where k='end');
begin
  -- teacher A: own class yes, other class no, school-wide no
  perform set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000002', true);
  r := public.competition_create(jsonb_build_object('kind','top_player','class_id',(select v from a where k='class_a'),'prize','$20 gift card','starts_on',s,'ends_on',e));
  if r->>'id' is null or r->>'status' <> 'active' or r->>'title' <> 'Top player' then raise exception 'FAIL teacher own class: %', r; end if;
  insert into a values ('comp_top', r->>'id');
  r := public.competition_create(jsonb_build_object('kind','class_target','class_id',(select v from a where k='class_a'),'target',150,'measure','correct','prize','Extra recess','starts_on',s,'ends_on',e));
  if r->>'id' is null then raise exception 'FAIL class target: %', r; end if;
  insert into a values ('comp_ct', r->>'id');
  if public.competition_create(jsonb_build_object('kind','top_player','class_id',(select v from a where k='class_b'),'prize','x','starts_on',s,'ends_on',e))->>'error' <> 'not_your_class' then raise exception 'FAIL other class'; end if;
  if public.competition_create(jsonb_build_object('kind','school_target','target',10,'prize','x','starts_on',s,'ends_on',e))->>'error' <> 'not_admin' then raise exception 'FAIL teacher school-wide'; end if;
  if public.competition_create(jsonb_build_object('kind','top_player','class_id',(select v from a where k='other_class'),'prize','x','starts_on',s,'ends_on',e))->>'error' <> 'bad_class' then raise exception 'FAIL other school class'; end if;
  -- bad input
  if public.competition_create(jsonb_build_object('kind','top_player','class_id',(select v from a where k='class_a'),'prize','  ','starts_on',s,'ends_on',e))->>'error' <> 'no_prize' then raise exception 'FAIL no prize'; end if;
  if public.competition_create(jsonb_build_object('kind','class_target','class_id',(select v from a where k='class_a'),'prize','x','starts_on',s,'ends_on',e))->>'error' <> 'bad_target' then raise exception 'FAIL no target'; end if;
  if public.competition_create(jsonb_build_object('kind','top_player','class_id',(select v from a where k='class_a'),'prize','x','starts_on',e,'ends_on',s))->>'error' <> 'bad_dates' then raise exception 'FAIL dates backwards'; end if;
  if public.competition_create(jsonb_build_object('kind','top_player','class_id',(select v from a where k='class_a'),'prize','x','starts_on','2020-01-01','ends_on','2020-02-01'))->>'error' <> 'bad_dates' then raise exception 'FAIL dates in past'; end if;
  if public.competition_create(jsonb_build_object('kind','top_player','class_id',(select v from a where k='class_a'),'prize','x','starts_on',s,'ends_on','2099-01-01'))->>'error' <> 'bad_dates' then raise exception 'FAIL too long'; end if;
  if public.competition_create(jsonb_build_object('kind','lottery','prize','x','starts_on',s,'ends_on',e))->>'error' <> 'bad_kind' then raise exception 'FAIL kind'; end if;
  if public.competition_create(jsonb_build_object('kind','top_player','measure','minutes','class_id',(select v from a where k='class_a'),'prize','x','starts_on',s,'ends_on',e))->>'error' <> 'bad_measure' then raise exception 'FAIL measure'; end if;
  raise notice 'teachers make competitions for their own class only, input checked: true';

  -- principal: school-wide target and class race
  perform set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000001', true);
  r := public.competition_create(jsonb_build_object('kind','school_target','target',100000,'prize','Pizza party','title','Road to 100k','starts_on',s,'ends_on',e));
  if r->>'scope' <> 'school' or r->>'title' <> 'Road to 100k' then raise exception 'FAIL school target: %', r; end if;
  insert into a values ('comp_st', r->>'id');
  r := public.competition_create(jsonb_build_object('kind','class_race','prize','Trophy','starts_on',s,'ends_on',e));
  if r->>'id' is null then raise exception 'FAIL class race: %', r; end if;
  insert into a values ('comp_race', r->>'id');
  raise notice 'principals make school-wide competitions: true';
end $$;
reset role;

-- ---------- rounds are logged and counted ----------
-- a round from before the start date must not count
insert into public.round_log (student_id, class_id, school_id, d, stars, correct)
  select s.id, s.class_id, (select v from a where k='school')::uuid, now() - interval '10 days', 400, 100 from public.students s where s.name='Star Fox';
set role anon;
do $$
declare r json;
begin
  perform public.student_save('tok_amy', jsonb_build_object('rounds', jsonb_build_array(pg_temp.round(60000, 20, 22, 2500), pg_temp.round(120000, 18, 20, 3000))));
  perform public.student_save('tok_ben', jsonb_build_object('rounds', jsonb_build_array(pg_temp.round(60000, 10, 14, 4000))));
  perform public.student_save('tok_demo', jsonb_build_object('demo', true, 'rounds', jsonb_build_array(pg_temp.round(60000, 50, 50, 900))));
  perform public.student_save('tok_owl', jsonb_build_object('rounds', jsonb_build_array(pg_temp.round(60000, 25, 26, 2000))));
  perform public.student_save('tok_far', jsonb_build_object('rounds', jsonb_build_array(pg_temp.round(60000, 30, 30, 1500))));
  -- saving the same rounds again must not count them twice
  perform public.student_save('tok_amy', (public.student_state('tok_amy')->'me'->'data')::jsonb);
end $$;
reset role;
do $$
declare amy_stars int; amy_log int; dup int;
begin
  select sum((r->>'stars')::int) into amy_stars from public.students s, jsonb_array_elements(s.data->'rounds') r where s.name='Star Fox';
  select sum(stars) into amy_log from public.round_log rl join public.students s on s.id = rl.student_id where s.name='Star Fox' and rl.d > now() - interval '1 day';
  if amy_stars is null or amy_stars <> amy_log then raise exception 'FAIL log stars % vs saved %', amy_log, amy_stars; end if;
  select count(*) - count(distinct (student_id, d)) into dup from public.round_log;
  if dup <> 0 then raise exception 'FAIL duplicate rounds logged'; end if;
  if not (select bool_and(demo) from public.round_log rl join public.students s on s.id = rl.student_id where s.name='Demo Kid') then raise exception 'FAIL demo flag'; end if;
  raise notice 'every accepted round is logged once, with the same stars: true';
end $$;

-- round log is not readable directly
set role authenticated;
do $$
declare ok boolean := false;
begin
  perform set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000001', true);
  begin perform count(*) from public.round_log; exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL round_log readable'; end if;
  ok := false;
  begin perform count(*) from public.competitions; exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL competitions table readable'; end if;
  raise notice 'tables only reachable through the functions: true';
end $$;
reset role;

-- ---------- what students see ----------
insert into a select 'amy_stars', sum((r->>'stars')::int)::text from public.students s, jsonb_array_elements(s.data->'rounds') r where s.name='Star Fox';
insert into a select 'school_stars', sum(stars)::text from public.round_log rl join public.students s on s.id = rl.student_id where s.name in ('Star Fox','Moon Cat','Comet Owl') and rl.d > now() - interval '1 day';
set role anon;
do $$
declare st json; c json; amy_round_stars int; ben_stars int; top json; ct json; sc json; race json;
begin
  st := public.student_state('tok_amy');
  if json_array_length(st->'competitions') <> 4 then raise exception 'FAIL Amy sees % competitions', json_array_length(st->'competitions'); end if;
  for c in select * from json_array_elements(st->'competitions') loop
    if c->>'kind' = 'top_player' then top := c; elsif c->>'kind' = 'class_target' then ct := c; elsif c->>'kind' = 'school_target' then sc := c; else race := c; end if;
  end loop;
  amy_round_stars := (select v from a where k='amy_stars')::int;
  -- top player: Amy's stars from this competition only (the old round before the start is left out), rank 1 of 2 (demo kid left out)
  if (top->>'me')::int <> amy_round_stars then raise exception 'FAIL top me % vs %', top->>'me', amy_round_stars; end if;
  if (top->>'rank')::int <> 1 or (top->>'players')::int <> 2 then raise exception 'FAIL top rank/players: %', top; end if;
  if json_array_length(top->'standings') <> 2 or (top->'standings'->0->>'name') <> 'Star Fox' then raise exception 'FAIL top standings: %', top->'standings'; end if;
  if (top->'standings'->0->>'real_name') is not null or st::text like '%Amy Real%' or st::text like '%Ben Real%' then raise exception 'FAIL real names sent to a student'; end if;
  -- class target counts correct answers: 20 + 18 + 10 = 48 of 150
  if (ct->>'total')::int <> 48 or (ct->>'reached')::boolean then raise exception 'FAIL class target total: %', ct; end if;
  -- school target: both classes in Comp School, not the other school, not the demo kid
  ben_stars := (select v from a where k='school_stars')::int;
  if (sc->>'total')::bigint <> ben_stars then raise exception 'FAIL school total % vs %', sc->>'total', ben_stars; end if;
  if (sc->>'my_class_total')::bigint >= (sc->>'total')::bigint then raise exception 'FAIL my class total'; end if;
  -- class race: 2 classes, ranked per student
  if json_array_length(race->'classes') <> 2 or (race->>'rank') is null then raise exception 'FAIL race: %', race; end if;
  -- the other school sees none of these
  if json_array_length(public.student_state('tok_far')->'competitions') <> 0 then raise exception 'FAIL other school sees competitions'; end if;
  -- class B sees only the school-wide ones
  if json_array_length(public.student_state('tok_owl')->'competitions') <> 2 then raise exception 'FAIL class B count'; end if;
  raise notice 'students see their class and school competitions, own rank, space names only: true';
end $$;
reset role;

-- ---------- teacher lists, ending and deleting ----------
set role authenticated;
do $$
declare l json; c json; found boolean := false;
begin
  -- teacher A sees their two plus the two school-wide ones, with real names
  perform set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000002', true);
  l := public.competitions_list();
  if json_array_length(l->'competitions') <> 4 or l->>'plan' <> 'school' then raise exception 'FAIL teacher A list: %', l; end if;
  for c in select * from json_array_elements(l->'competitions') loop
    if c->>'kind' = 'top_player' and c::text like '%Amy Real%' then found := true; end if;
  end loop;
  if not found then raise exception 'FAIL teacher sees real names'; end if;
  -- teacher B cannot see teacher A's class competitions, and cannot end them
  perform set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000003', true);
  if json_array_length(public.competitions_list()->'competitions') <> 2 then raise exception 'FAIL teacher B list'; end if;
  if public.competition_end((select v from a where k='comp_top')::uuid, false)->>'error' <> 'not_allowed' then raise exception 'FAIL teacher B ended it'; end if;
  -- another school's admin cannot touch it
  perform set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000004', true);
  if public.competition_end((select v from a where k='comp_top')::uuid, true)->>'error' <> 'not_found' then raise exception 'FAIL other school ended it'; end if;
  if json_array_length(public.competitions_list()->'competitions') <> 0 then raise exception 'FAIL other school list'; end if;
  -- the creator ends it early: it keeps its results and shows as ended
  perform set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000002', true);
  if (public.competition_end((select v from a where k='comp_top')::uuid, false)->>'ok') <> 'true' then raise exception 'FAIL end'; end if;
  for c in select * from json_array_elements(public.competitions_list()->'competitions') loop
    if c->>'id' = (select v from a where k='comp_top') and (c->>'status' <> 'ended' or (c->>'ended_early')::boolean is not true or (c->>'total')::int = 0) then raise exception 'FAIL ended state: %', c; end if;
  end loop;
  -- the principal can delete any competition in the school
  perform set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000001', true);
  if (public.competition_end((select v from a where k='comp_ct')::uuid, true)->>'ok') <> 'true' then raise exception 'FAIL delete'; end if;
  if json_array_length(public.competitions_list()->'competitions') <> 3 then raise exception 'FAIL after delete'; end if;
  raise notice 'teachers see their own and school-wide competitions; only the creator or an admin can end or delete: true';
end $$;
reset role;

-- ---------- downgraded to free: students stop seeing competitions ----------
update public.schools set plan = 'free' where id = (select v from a where k='school')::uuid;
set role anon;
do $$ begin
  if json_array_length(public.student_state('tok_amy')->'competitions') <> 0 then raise exception 'FAIL free plan still shows competitions'; end if;
  raise notice 'free plan hides competitions from students: true';
end $$;
reset role;

-- ---------- helpers cannot be called directly ----------
set role authenticated;
do $$
declare ok boolean := false;
begin
  begin perform public.school_has_competitions((select v from a where k='school')::uuid); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAIL helper callable'; end if;
  raise notice 'helpers cannot be called directly: true';
end $$;
reset role;
