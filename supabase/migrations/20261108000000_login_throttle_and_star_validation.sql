-- Found by the Nov 2026 test pass.
-- 1) Login throttle: one noisy or hostile device could lock a whole class out (100 wrong tries per class per
--    10 minutes was shared by everyone), and a guesser got 100 PIN tries per class every 10 minutes forever.
--    Now: 100 per device per class, 300 per device across all classes, and a higher class-wide ceiling (400).
--    If the device address is not available the old rule (100 per class) still applies.
-- 2) Weekly Top 10 stars came straight from whatever the browser saved. student_save now validates new rounds:
--    scores are recomputed from correct/answered/speed, speed is capped at a human limit, new rounds are rate limited
--    (about one per 45 s of real time), old rounds cannot be edited, rank bonus stars are bounded by rank progress,
--    and the rank can only go up.

alter table public.login_failures add column if not exists ip text;
create index if not exists login_failures_ip_idx on public.login_failures (ip, at);
alter table public.students add column if not exists round_credit_at timestamptz;

-- The caller's address as seen by the API gateway (null if not present)
create or replace function public._client_ip()
returns text language plpgsql stable set search_path to 'public','extensions' as $$
declare h json; x text; parts text[];
begin
  begin h := nullif(current_setting('request.headers', true), '')::json; exception when others then return null; end;
  if h is null then return null; end if;
  x := nullif(trim(coalesce(h->>'cf-connecting-ip', '')), '');
  if x is null then x := nullif(trim(coalesce(h->>'x-real-ip', '')), ''); end if;
  if x is null then
    parts := string_to_array(coalesce(h->>'x-forwarded-for', ''), ',');
    if array_length(parts, 1) > 0 then x := nullif(trim(parts[array_length(parts, 1)]), ''); end if;
  end if;
  return left(x, 64);
end $$;
revoke all on function public._client_ip() from public, anon, authenticated;

create or replace function public.student_login(p_class_code text, p_pin text) returns json
language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  cc text := upper(trim(coalesce(p_class_code, '')));
  st public.students;
  t text;
  v_ip text := public._client_ip();
  v_class_10m int; v_class_day int;
begin
  -- class-wide ceilings (everyone on the class): 400 per 10 minutes and 1200 per day when we can tell devices apart,
  -- otherwise the old 100 per 10 minutes and 300 per day
  v_class_10m := case when v_ip is null then 100 else 400 end;
  v_class_day := case when v_ip is null then 300 else 1200 end;
  if (select count(*) from public.login_failures where class_code = cc and at > now() - interval '10 minutes') >= v_class_10m
     or (select count(*) from public.login_failures where class_code = cc and at > now() - interval '1 day') >= v_class_day then
    return json_build_object('error', 'too_many_tries');
  end if;
  if v_ip is not null then
    -- this device on this class: 100 per 10 minutes and 300 per day (a whole class behind one school connection still fits)
    if (select count(*) from public.login_failures where class_code = cc and ip = v_ip and at > now() - interval '10 minutes') >= 100
       or (select count(*) from public.login_failures where class_code = cc and ip = v_ip and at > now() - interval '1 day') >= 300 then
      return json_build_object('error', 'too_many_tries');
    end if;
    -- this device across every class: 300 per 10 minutes (stops scanning many classes)
    if (select count(*) from public.login_failures where ip = v_ip and at > now() - interval '10 minutes') >= 300 then
      return json_build_object('error', 'too_many_tries');
    end if;
  end if;
  select s.* into st from public.students s join public.classes c on c.id = s.class_id
   where c.code = cc and c.archived_at is null and s.pin = trim(coalesce(p_pin, ''));
  if st.id is null then
    insert into public.login_failures (class_code, ip) values (cc, v_ip);
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

create or replace function public.student_save(p_token text, p_data jsonb)
returns json language plpgsql volatile security definer set search_path to 'public','extensions' as $$
declare
  me public.students;
  d jsonb;
  now_ms numeric := floor(extract(epoch from now()) * 1000);
  old_r jsonb; out_r jsonb := '[]'::jsonb;
  credit_from timestamptz; allowed int; used int := 0; new_credit timestamptz;
  old_rp numeric; new_rp numeric; bonus numeric := 0; t int;
  r jsonb; rd numeric; oldmatch jsonb; seen numeric[] := '{}';
  c numeric; n numeric; ms numeric; vol numeric; spd numeric; acc numeric; pts numeric; base numeric;
  is_boss boolean; extra numeric; give numeric; len int;
begin
  me := public._student_from_token(p_token);
  if me.id is null then return json_build_object('error', 'signed_out'); end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then return json_build_object('error', 'bad_data'); end if;
  d := p_data - 'pin' - 'name' - 'id';

  -- rank progress can only go up (otherwise rank rewards could be claimed again)
  old_rp := coalesce(public.safe_num(me.data ->> 'rankPaid', -1, 9), -1);
  new_rp := old_rp;
  if (d ? 'rankPaid') or (me.data ? 'rankPaid') then
    new_rp := greatest(coalesce(public.safe_num(d ->> 'rankPaid', -1, 9), old_rp), old_rp);
    d := jsonb_set(d, '{rankPaid}', to_jsonb(new_rp::int));
  end if;
  for t in greatest(old_rp + 1, 0)::int .. new_rp::int loop bonus := bonus + 10 + 5 * t; end loop;

  old_r := case when jsonb_typeof(me.data -> 'rounds') = 'array' then me.data -> 'rounds' else '[]'::jsonb end;

  if d ? 'rounds' then
    if jsonb_typeof(d -> 'rounds') <> 'array' then
      d := jsonb_set(d, '{rounds}', old_r);
    else
      -- about one new round per 45 s of real time, saving up to 5 minutes' worth
      credit_from := greatest(coalesce(me.round_credit_at, now() - interval '5 minutes'), now() - interval '5 minutes');
      allowed := floor(extract(epoch from now() - credit_from) / 45)::int;
      for r in select value from jsonb_array_elements(d -> 'rounds') loop
        if jsonb_typeof(r) <> 'object' then continue; end if;
        rd := public.safe_num(r ->> 'd', 0, 99999999999999);
        if rd is null or rd = any(seen) then continue; end if;
        seen := seen || rd;
        -- a round the server already has is kept exactly as stored (it cannot be edited)
        select o into oldmatch from jsonb_array_elements(old_r) o
         where jsonb_typeof(o) = 'object' and public.safe_num(o ->> 'd', 0, 99999999999999) = rd limit 1;
        if oldmatch is not null then out_r := out_r || jsonb_build_array(oldmatch); continue; end if;
        if used >= allowed or rd < now_ms - 14 * 86400000 then continue; end if;
        rd := least(rd, now_ms);
        c := coalesce(public.safe_num(r ->> 'c', 0, 150), 0);
        n := least(greatest(coalesce(public.safe_num(r ->> 'n', 0, 200), 0), c), 200);
        ms := coalesce(public.safe_num(r ->> 'ms', 0, 60000), 0);
        if c > 0 then
          ms := greatest(ms, 400);                 -- nobody answers a times-table question faster than this
          c := least(c, floor(60000 / ms));        -- and a round is 60 seconds long
          n := greatest(n, c);
        end if;
        if c = 0 or n = 0 then pts := 0;
        else
          vol := least(1, n / 8);
          spd := round(500 * greatest(0, least(1, (7 - ms / 1000) / 5.5)) * vol);
          acc := round(500 * power(c / n, 2) * vol);
          pts := spd + acc;
        end if;
        base := round(pts / 10);
        is_boss := (r -> 'boss') = 'true'::jsonb;
        extra := greatest(coalesce(public.safe_num(r ->> 'stars', 0, 10000), base) - base - case when is_boss then 25 else 0 end, 0);
        give := least(extra, bonus); bonus := bonus - give;
        out_r := out_r || jsonb_build_array(jsonb_build_object(
          'd', rd::bigint, 'c', c::int, 'n', n::int, 'ms', round(ms)::int, 'len', 60,
          'best', coalesce(public.safe_num(r ->> 'best', 0, 150), 0)::int, 'boss', is_boss,
          'pts', pts::int, 'stars', (base + case when is_boss then 25 else 0 end + give)::int));
        used := used + 1;
      end loop;
      len := jsonb_array_length(out_r);
      if len > 60 then
        select coalesce(jsonb_agg(e order by ord), '[]'::jsonb) into out_r from jsonb_array_elements(out_r) with ordinality x(e, ord) where ord > len - 60;
      end if;
      d := jsonb_set(d, '{rounds}', out_r);
      if used > 0 then new_credit := credit_from + used * interval '45 seconds'; end if;
    end if;
  end if;

  begin
    update public.students set data = d, last_seen_at = now(), round_credit_at = coalesce(new_credit, round_credit_at) where id = me.id;
  exception when check_violation then
    return json_build_object('error', 'too_large');
  end;
  return json_build_object('ok', true);
end $$;

-- Reading side: same plausible limits as defence in depth (a round is at most 440 stars: 100 + boss 25 + all rank rewards 315)
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
        select coalesce(sum(coalesce(public.safe_num(r ->> 'stars', 0, 440), round(public.safe_num(r ->> 'pts', 0, 1000) / 10), public.safe_num(r ->> 'c', 0, 150) * 3, 0)), 0)::int as stars,
               coalesce(round(sum(coalesce(public.safe_num(r ->> 'len', 0, 60), 60)) / 60), 0)::int as mins
        from jsonb_array_elements(case when jsonb_typeof(s.data -> 'rounds') = 'array' then s.data -> 'rounds' else '[]'::jsonb end) r
        where jsonb_typeof(r) = 'object' and public.safe_num(r ->> 'd', 0, 99999999999999) >= since
      ) w on true
      where s.class_id = me.class_id and s.id <> me.id), '[]')
  );
end $$;

-- keep the public API surface exactly as before
revoke all on function public.student_login(text, text), public.student_save(text, jsonb), public.student_state(text) from public;
grant execute on function public.student_login(text, text), public.student_save(text, jsonb), public.student_state(text) to anon, authenticated;
