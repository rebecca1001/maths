-- 1. Send each student only what the Top 10 needs about classmates (name, character, stars and minutes this week),
--    worked out here instead of sending every classmate's full history to every device.
-- 2. Battles were removed from the game: drop the battle table and functions.

create or replace function public.student_state(p_token text) returns json
language plpgsql stable security definer set search_path = public, extensions as $$
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
        select coalesce(sum(coalesce((r ->> 'stars')::numeric, round((r ->> 'pts')::numeric / 10), (r ->> 'c')::numeric * 3, 0)), 0)::int as stars,
               coalesce(round(sum(coalesce((r ->> 'len')::numeric, 60)) / 60), 0)::int as mins
        from jsonb_array_elements(case when jsonb_typeof(s.data -> 'rounds') = 'array' then s.data -> 'rounds' else '[]'::jsonb end) r
        where (r ->> 'd') ~ '^[0-9.]+$' and (r ->> 'd')::numeric >= since
      ) w on true
      where s.class_id = me.class_id and s.id <> me.id), '[]')
  );
end $$;

create or replace function public.purge_old_data() returns void
language sql volatile security definer set search_path = public, extensions as $$
  delete from public.classes where archived_at is not null and archived_at < now() - interval '12 months';
  delete from public.student_sessions where expires_at < now();
  delete from public.login_failures where at < now() - interval '1 day';
$$;
revoke all on function public.purge_old_data() from public, anon, authenticated;

drop function if exists public.challenge_create(text, uuid, bigint);
drop function if exists public.challenge_score(text, uuid, jsonb);
drop table if exists public.challenges;

-- Old battle notes in students' saved data are no longer used
update public.students set data = data - 'seenBattles' where data ? 'seenBattles';
