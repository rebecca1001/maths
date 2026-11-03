-- Student login by picking: find your school, tap your class, type your 4-digit code.
-- Only school names and active class names are shown, and only through these two functions.

-- Schools whose name matches what the student typed (at least 2 letters), that have an active class
create or replace function public.find_schools(p_query text) returns json
language plpgsql stable security definer set search_path = public, extensions as $$
declare q text := trim(regexp_replace(coalesce(p_query, ''), '[%_\\]', '', 'g'));
begin
  if length(q) < 2 then return '[]'::json; end if;
  return coalesce((
    select json_agg(json_build_object('id', s.id, 'name', s.name) order by s.name)
    from (select s.id, s.name from public.schools s
          where s.name ilike '%' || q || '%'
            and exists (select 1 from public.classes c where c.school_id = s.id and c.archived_at is null)
          order by s.name limit 12) s), '[]'::json);
end $$;

-- Active classes at a school: name and code (the code is what the login uses)
create or replace function public.school_classes(p_school uuid) returns json
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(json_agg(json_build_object('name', c.name, 'code', c.code) order by c.name), '[]'::json)
  from public.classes c where c.school_id = p_school and c.archived_at is null;
$$;

revoke all on function public.find_schools(text), public.school_classes(uuid) from public;
grant execute on function public.find_schools(text), public.school_classes(uuid) to anon, authenticated;

-- Classes can now be picked from a list, so also cap wrong codes per class per day (as well as per 10 minutes)
create or replace function public.student_login(p_class_code text, p_pin text) returns json
language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  cc text := upper(trim(coalesce(p_class_code, '')));
  st public.students;
  t text;
begin
  if (select count(*) from public.login_failures where class_code = cc and at > now() - interval '10 minutes') >= 100
     or (select count(*) from public.login_failures where class_code = cc and at > now() - interval '1 day') >= 300 then
    return json_build_object('error', 'too_many_tries');
  end if;
  select s.* into st from public.students s join public.classes c on c.id = s.class_id
   where c.code = cc and c.archived_at is null and s.pin = trim(coalesce(p_pin, ''));
  if st.id is null then
    insert into public.login_failures (class_code) values (cc);
    delete from public.login_failures where at < now() - interval '2 days';
    if not exists (select 1 from public.classes where code = cc and archived_at is null) then
      return json_build_object('error', 'no_class');
    end if;
    return json_build_object('error', 'wrong_code');
  end if;
  t := encode(gen_random_bytes(32), 'hex');
  insert into public.student_sessions (token, student_id) values (t, st.id);
  return json_build_object('token', t, 'student_id', st.id);
end $$;

-- Keep failed-login records for 2 days (the daily cap needs them)
create or replace function public.purge_old_data() returns void
language sql volatile security definer set search_path = public, extensions as $$
  delete from public.classes where archived_at is not null and archived_at < now() - interval '12 months';
  delete from public.student_sessions where expires_at < now();
  delete from public.login_failures where at < now() - interval '2 days';
$$;
revoke all on function public.purge_old_data() from public, anon, authenticated;
