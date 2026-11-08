-- Regression tests for 20261107000000_harden_state_save_and_class_codes.sql. Any failure raises an exception.
\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
create temp table h (k text primary key, v text);
grant all on h to anon, authenticated;

insert into auth.users values ('aaaaaaaa-0000-0000-0000-000000000001','h@school.ca');
insert into public.schools (name) values ('Hardening School');
insert into public.teachers (id, school_id, name, role) select 'aaaaaaaa-0000-0000-0000-000000000001', id, 'H', 'admin' from public.schools where name='Hardening School';
insert into public.classes (school_id, teacher_id, name) select id, 'aaaaaaaa-0000-0000-0000-000000000001', 'H class' from public.schools where name='Hardening School';
insert into h select 'code', code from public.classes where name='H class';
insert into public.students (class_id, name) select id, 'Ann' from public.classes where name='H class';
insert into public.students (class_id, name) select id, 'Bob' from public.classes where name='H class';
insert into h select 'pin_ann', pin from public.students where name='Ann';
insert into h select 'pin_bob', pin from public.students where name='Bob';

set role anon;
insert into h select 'tok_ann', public.student_login((select v from h where k='code'), (select v from h where k='pin_ann'))->>'token';
insert into h select 'tok_bob', public.student_login((select v from h where k='code'), (select v from h where k='pin_bob'))->>'token';

do $$
declare
  ta text := (select v from h where k='tok_ann'); tb text := (select v from h where k='tok_bob'); ms text := (extract(epoch from now())*1000)::bigint::text;
  j json; p text; payloads text[];
begin
  -- 1) poisoned payloads never break a classmate's state
  payloads := array[
    '{"rounds":[{"d":"'||ms||'","stars":"abc"}]}', '{"rounds":"oops"}', '{"rounds":[1,"x",null,{"d":"abc"},{"d":"1e3"},{"d":"12.5.5"}]}',
    '{"rounds":[{"d":"'||ms||'","stars":1e300,"len":1e300},{"d":"'||ms||'","stars":-5,"len":-9}]}', '{"rounds":[[],{},{"d":null,"stars":null}]}'];
  foreach p in array payloads loop
    perform public.student_save(tb, p::jsonb);
    j := public.student_state(ta);
    if j->>'error' is not null then raise exception 'FAIL poisoned payload broke classmate state: %', p; end if;
  end loop;
  raise notice 'poisoned payloads cannot break classmates: true';

  -- 2) weekly stars/minutes maths (rounds are validated and rescored by the server: c/n/ms decide the stars)
  --    A: 10/10 at 3.0 s = 864 pts = 86 stars; B: 4/4 at 2.0 s = 477 pts = 48 stars; C is 8 days old, so it is not in the week
  perform public.student_save(tb, jsonb_build_object('rounds', jsonb_build_array(
    jsonb_build_object('d',ms,'c',10,'n',10,'ms',3000,'len',60), jsonb_build_object('d',(ms::bigint-1)::text,'c',4,'n',4,'ms',2000,'len',60),
    jsonb_build_object('d',((extract(epoch from now())-8*86400)*1000)::bigint::text,'c',10,'n',10,'ms',3000))));
  j := public.student_state(ta);
  if (j->'classmates'->0->'data'->>'wkStars')::int <> 134 or (j->'classmates'->0->'data'->>'wkMins')::int <> 2 then raise exception 'FAIL weekly maths: %', j; end if;
  raise notice 'weekly stars=134 mins=2: true';

  -- 3) clean errors for bad saves
  if (public.student_save(ta, null)->>'error') <> 'bad_data' then raise exception 'FAIL null data'; end if;
  if (public.student_save(ta, '[1]'::jsonb)->>'error') <> 'bad_data' then raise exception 'FAIL array data'; end if;
  if (public.student_save(ta, jsonb_build_object('blob', repeat('x', 450000)))->>'error') <> 'too_large' then raise exception 'FAIL oversize'; end if;
  if (public.student_save(ta, '{"skin":"cat"}'::jsonb)->>'ok') <> 'true' then raise exception 'FAIL normal save'; end if;
  raise notice 'null/array/oversize saves return clean errors: true';

  -- 4) trigger functions are not callable by the public
  begin perform public.classes_before_insert(); raise exception 'FAIL anon can call classes_before_insert';
  exception when insufficient_privilege then raise notice 'anon blocked from trigger functions: true'; end;
end $$;
reset role;

-- 5) class codes always uppercase 4-12 letters/digits
do $$
declare sid uuid := (select id from public.schools where name='Hardening School'); cid uuid := (select id from public.classes where name='H class'); t text; code0 text := (select v from h where k='code');
begin
  update public.classes set code='abc999' where id=cid;
  if (select code from public.classes where id=cid) <> 'ABC999' then raise exception 'FAIL lowercase update not uppercased'; end if;
  begin update public.classes set code='' where id=cid; raise exception 'FAIL blank code accepted'; exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  begin update public.classes set code='A B!' where id=cid; raise exception 'FAIL symbols accepted'; exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  begin insert into public.classes (school_id, name, code) values (sid, 'x', 'abc'); raise exception 'FAIL 3-char code accepted'; exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  insert into public.classes (school_id, name, code) values (sid, 'y', 'mixedcase1') returning code into t;
  if t <> 'MIXEDCASE1' then raise exception 'FAIL insert not uppercased'; end if;
  raise notice 'class codes uppercase 4-12 alnum only: true';
end $$;
