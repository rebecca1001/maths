-- Student login: the dot in a username is optional (16 Nov 2026).
-- A login card said test.demo but only testdemo worked; now both do.

create or replace function public.student_login_user(p_school uuid, p_username text, p_passcode text) returns json
language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  u text := public.norm_username(p_username);
  v_pin text := regexp_replace(coalesce(p_passcode, ''), '[^0-9]', '', 'g');
  key text := 'user:' || coalesce(p_school::text, '?') || ':' || coalesce(u, '?');
  school_key text := 'user:' || coalesce(p_school::text, '?') || ':%';
  v_ip text := public._client_ip();
  st public.students; t text;
begin
  if (select count(*) from public.login_failures where class_code = key and at > now() - interval '10 minutes') >= 10
     or (select count(*) from public.login_failures where class_code = key and at > now() - interval '1 day') >= 30 then
    return json_build_object('error', 'too_many_tries');
  end if;
  if v_ip is not null and (
       (select count(*) from public.login_failures where ip = v_ip and at > now() - interval '10 minutes') >= 300
    or (select count(*) from public.login_failures where ip = v_ip and class_code like school_key and at > now() - interval '1 day') >= 500
    or (select count(*) from public.login_failures where ip = v_ip and class_code like 'user:%' and at > now() - interval '1 day') >= 1000) then
    return json_build_object('error', 'too_many_tries');
  end if;
  if u is not null and p_school is not null and v_pin ~ '^[0-9]{4}$' then
    -- dots are optional: smith.ava and smithava both log in (an exact match wins)
    select s.* into st from public.students s join public.classes c on c.id = s.class_id
     where s.school_id = p_school and s.pin = v_pin and c.archived_at is null
       and (s.username = u or replace(s.username, '.', '') = replace(u, '.', ''))
     order by (s.username = u) desc
     limit 1;
  end if;
  if st.id is null then
    -- same answer whether or not the username exists
    insert into public.login_failures (class_code, ip) values (key, v_ip);
    delete from public.login_failures where at < now() - interval '2 days';
    return json_build_object('error', 'wrong_login');
  end if;
  t := encode(gen_random_bytes(32), 'hex');
  insert into public.student_sessions (token, student_id) values (t, st.id);
  update public.students set last_login_at = now(), last_seen_at = now() where id = st.id;
  return json_build_object('token', t, 'student_id', st.id);
end $$;
revoke all on function public.student_login_user(uuid, text, text) from public;
grant execute on function public.student_login_user(uuid, text, text) to anon, authenticated;
