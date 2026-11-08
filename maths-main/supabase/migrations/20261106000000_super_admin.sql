-- Super admin: one owner account can see every school, class and student, with login and retention data.
-- Only accounts listed in public.super_admins can use it. Nobody can read or change that list through the app.

create table if not exists public.super_admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.super_admins enable row level security;  -- no policies: invisible to the app
revoke all on public.super_admins from anon, authenticated;

insert into public.super_admins (user_id)
select id from auth.users where lower(email) = 'rebecca@strategically.co'
on conflict do nothing;

create or replace function public.is_super_admin() returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select auth.uid() is not null and exists (select 1 from public.super_admins where user_id = auth.uid())
$$;
revoke all on function public.is_super_admin() from public, anon;
grant execute on function public.is_super_admin() to authenticated;

-- When each student last logged in, and last saved progress (played a round, bought something)
alter table public.students add column if not exists last_login_at timestamptz;
alter table public.students add column if not exists last_seen_at timestamptz;

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
  update public.students set last_login_at = now(), last_seen_at = now() where id = st.id;
  return json_build_object('token', t, 'student_id', st.id);
end $$;

create or replace function public.student_save(p_token text, p_data jsonb) returns json
language plpgsql volatile security definer set search_path = public, extensions as $$
declare me public.students;
begin
  me := public._student_from_token(p_token);
  if me.id is null then return json_build_object('error', 'signed_out'); end if;
  if jsonb_typeof(p_data) <> 'object' then return json_build_object('error', 'bad_data'); end if;
  update public.students set data = p_data - 'pin' - 'name' - 'id', last_seen_at = now() where id = me.id;
  return json_build_object('ok', true);
end $$;

-- Everything the super admin page needs, in one call. Students' game data is summarised, not sent whole.
create or replace function public.super_overview() returns json
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if not public.is_super_admin() then return json_build_object('error', 'not_allowed'); end if;
  return json_build_object(
    'now', (extract(epoch from now()) * 1000)::bigint,
    'schools', coalesce((select json_agg(json_build_object('id', s.id, 'name', s.name, 'created_at', s.created_at) order by s.name)
                         from public.schools s), '[]'),
    'teachers', coalesce((select json_agg(json_build_object('id', t.id, 'school_id', t.school_id, 'name', t.name, 'email', t.email,
                                                            'role', t.role, 'created_at', t.created_at) order by t.name)
                          from public.teachers t), '[]'),
    'classes', coalesce((select json_agg(json_build_object('id', c.id, 'school_id', c.school_id, 'teacher_id', c.teacher_id, 'name', c.name,
                                                           'code', c.code, 'archived_at', c.archived_at, 'created_at', c.created_at) order by c.name)
                         from public.classes c), '[]'),
    'students', coalesce((
      select json_agg(json_build_object(
        'id', st.id, 'class_id', st.class_id, 'name', st.name, 'real_name', st.real_name,
        'created_at', st.created_at, 'last_login_at', st.last_login_at, 'last_seen_at', st.last_seen_at,
        'demo', coalesce(st.data ->> 'demo', '') = 'true',
        'stars', case when (st.data ->> 'coins') ~ '^[0-9.]+$' then round((st.data ->> 'coins')::numeric) else 0 end,
        'rounds', rs.n, 'mins', rs.mins, 'first_round', rs.first_d, 'last_round', rs.last_d, 'days', rs.days) order by st.created_at)
      from public.students st
      left join lateral (
        select count(*) as n,
               coalesce(round(sum(x.len) / 60), 0) as mins,
               min(x.d)::bigint as first_d, max(x.d)::bigint as last_d,
               coalesce(json_agg(distinct to_char(to_timestamp(x.d / 1000) at time zone 'America/Vancouver', 'YYYY-MM-DD')), '[]') as days
        from (select (r ->> 'd')::numeric as d, coalesce(nullif(r ->> 'len', '')::numeric, 60) as len
              from jsonb_array_elements(case when jsonb_typeof(st.data -> 'rounds') = 'array' then st.data -> 'rounds' else '[]'::jsonb end) r
              where (r ->> 'd') ~ '^[0-9.]+$') x
      ) rs on true), '[]')
  );
end $$;
revoke all on function public.super_overview() from public, anon;
grant execute on function public.super_overview() to authenticated;
