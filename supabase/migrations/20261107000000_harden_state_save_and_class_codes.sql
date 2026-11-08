-- Hardening found by the Nov 2026 test pass (already applied to the live database).
-- 1) One student's junk saved data must never break classmates' student_state.
-- 2) student_save returns clean errors for null / oversize data.
-- 3) Class codes are always uppercase, 4-12 letters/digits (a lowercase code could never be logged into).
-- 4) Trigger functions are not callable through the public API.

create or replace function public.safe_num(t text, lo numeric, hi numeric)
returns numeric language plpgsql immutable set search_path to 'public','extensions' as $$
begin
  if t is null or t !~ '^-?[0-9]+(\.[0-9]+)?$' then return null; end if;
  return least(greatest(t::numeric, lo), hi);
exception when others then return null;
end $$;
revoke all on function public.safe_num(text, numeric, numeric) from public, anon, authenticated;

create or replace function public.student_state(p_token text)
returns json language plpgsql stable security definer set search_path to 'public','extensions' as $$
declare me public.students; since numeric := extract(epoch from now() - interval '7 days') * 1000;
begin
  me := public._student_from_token(p_token);
  if me.id is null then return json_build_object('error', 'signed_out'); end if;
  return json_build_object(
    'me', json_build_object('id', me.id, 'name', me.name, 'data', me.data),
    'class', (select json_build_object('id', c.id, 'name', c.name, 'settings', c.settings) from public.classes c where c.id = me.class_id),
    'classmates', coalesce((
      select json_agg(json_build_object('id', s.id, 'name', s.name,
               'data', json_build_object('skin', coalesce(s.data ->> 'skin', 'blob'), 'wkStars', w.stars, 'wkMins', w.mins)) order by s.created_at)
      from public.students s
      left join lateral (
        select coalesce(sum(coalesce(public.safe_num(r ->> 'stars', 0, 10000), round(public.safe_num(r ->> 'pts', 0, 100000) / 10), public.safe_num(r ->> 'c', 0, 3000) * 3, 0)), 0)::int as stars,
               coalesce(round(sum(coalesce(public.safe_num(r ->> 'len', 0, 3600), 60)) / 60), 0)::int as mins
        from jsonb_array_elements(case when jsonb_typeof(s.data -> 'rounds') = 'array' then s.data -> 'rounds' else '[]'::jsonb end) r
        where jsonb_typeof(r) = 'object' and public.safe_num(r ->> 'd', 0, 99999999999999) >= since
      ) w on true
      where s.class_id = me.class_id and s.id <> me.id), '[]')
  );
end $$;

create or replace function public.student_save(p_token text, p_data jsonb)
returns json language plpgsql security definer set search_path to 'public','extensions' as $$
declare me public.students;
begin
  me := public._student_from_token(p_token);
  if me.id is null then return json_build_object('error', 'signed_out'); end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then return json_build_object('error', 'bad_data'); end if;
  begin
    update public.students set data = p_data - 'pin' - 'name' - 'id', last_seen_at = now() where id = me.id;
  exception when check_violation then
    return json_build_object('error', 'too_large');
  end;
  return json_build_object('ok', true);
end $$;

create or replace function public.classes_code_check()
returns trigger language plpgsql set search_path to 'public','extensions' as $$
begin
  new.code := upper(trim(coalesce(new.code, '')));
  if new.code !~ '^[A-Z0-9]{4,12}$' then raise exception 'invalid class code'; end if;
  return new;
end $$;
drop trigger if exists classes_code_check on public.classes;
create trigger classes_code_check before insert or update of code on public.classes
  for each row execute function public.classes_code_check();

revoke all on function public.classes_code_check() from public, anon, authenticated;
revoke all on function public.classes_before_insert() from public, anon, authenticated;
revoke all on function public.students_before_write() from public, anon, authenticated;
