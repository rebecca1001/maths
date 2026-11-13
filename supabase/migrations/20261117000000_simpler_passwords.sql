-- Simpler student passwords (Sam, 12 Nov): one easy word + 2 digits, like "tiger42" (was "blue-tiger-42").
-- 64 words x 90 numbers = 5,760 per child. To keep guessing impractical, wrong tries are capped per username:
-- 10 per 10 minutes (as before) and now 30 per day. Existing passwords keep working; "New password" gives the new style.

alter table public.students drop constraint if exists students_passcode_check;
alter table public.students add constraint students_passcode_check
  check (passcode is null or passcode ~ '^[a-z]{3,8}[0-9]{2}$' or passcode ~ '^[a-z]{3,8}-[a-z]{3,8}-[0-9]{2}$');

create or replace function public.new_passcode() returns text
language sql volatile set search_path = public, extensions as $$
  select (array['tiger','panda','otter','koala','shark','eagle','fox','wolf','owl','bear','frog','whale','zebra','llama','lion','duck','goat','horse','moose','seal','crab','bee','puppy','kitten','bunny','pony','robin','camel','hippo','rocket','comet','star','moon','sun','planet','robot','ship','kite','drum','cloud','train','boat','apple','lemon','mango','pizza','cake','cookie','muffin','taco','berry','peach','melon','grape','pear','acorn','maple','river','snow','candy','jelly','pickle','banjo','tulip'])[1 + floor(random() * 64)::int] || lpad((10 + floor(random() * 90))::int::text, 2, '0')
$$;
revoke all on function public.new_passcode() from public, anon, authenticated;

-- same as before, plus a cap of 30 wrong tries per username per day
create or replace function public.student_login_user(p_school uuid, p_username text, p_passcode text) returns json
language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  u text := public.norm_username(p_username);
  pc text := regexp_replace(lower(coalesce(p_passcode, '')), '[^a-z0-9]', '', 'g');
  key text := 'user:' || coalesce(p_school::text, '?') || ':' || coalesce(u, '?');
  v_ip text := public._client_ip();
  st public.students; t text;
begin
  if (select count(*) from public.login_failures where class_code = key and at > now() - interval '10 minutes') >= 10
     or (select count(*) from public.login_failures where class_code = key and at > now() - interval '1 day') >= 30 then
    return json_build_object('error', 'too_many_tries');
  end if;
  if v_ip is not null and (select count(*) from public.login_failures where ip = v_ip and at > now() - interval '10 minutes') >= 300 then
    return json_build_object('error', 'too_many_tries');
  end if;
  if u is not null and p_school is not null then
    -- compared without dashes, spaces or capitals: "Tiger 42" = "tiger42"
    select s.* into st from public.students s join public.classes c on c.id = s.class_id
     where s.school_id = p_school and s.username = u and replace(s.passcode, '-', '') = pc and c.archived_at is null;
  end if;
  if st.id is null then
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
