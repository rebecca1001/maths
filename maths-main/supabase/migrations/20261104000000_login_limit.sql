-- A class of ~30 logging in together makes typos: allow 100 wrong codes per class per 10 minutes (was 30).
create or replace function public.student_login(p_class_code text, p_pin text) returns json
language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  cc text := upper(trim(coalesce(p_class_code, '')));
  st public.students;
  t text;
begin
  -- at most 100 wrong tries per class code every 10 minutes (a whole class logging in at once makes typos)
  if (select count(*) from public.login_failures where class_code = cc and at > now() - interval '10 minutes') >= 100 then
    return json_build_object('error', 'too_many_tries');
  end if;
  select s.* into st from public.students s join public.classes c on c.id = s.class_id
   where c.code = cc and c.archived_at is null and s.pin = trim(coalesce(p_pin, ''));
  if st.id is null then
    insert into public.login_failures (class_code) values (cc);
    delete from public.login_failures where at < now() - interval '1 day';
    if not exists (select 1 from public.classes where code = cc and archived_at is null) then
      return json_build_object('error', 'no_class');
    end if;
    return json_build_object('error', 'wrong_code');
  end if;
  t := encode(gen_random_bytes(32), 'hex');
  insert into public.student_sessions (token, student_id) values (t, st.id);
  return json_build_object('token', t, 'student_id', st.id);
end $$;
