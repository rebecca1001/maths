-- Mission Multiply: fill a demo class with 20 example students and 3 weeks of play, for presentations.
-- 1. Change the email below if you sign in to Mission Multiply with a different one.
-- 2. Paste this whole file into Supabase > SQL Editor and click Run.
-- Run it again on the day you present: it deletes and rebuilds "Demo class (Grade 5)" so the dates are fresh.
do $$
declare
  v_email   text := 'rebecca@strategically.co';
  v_teacher uuid; v_school uuid; v_class uuid;
  now_ms    bigint := (extract(epoch from now()) * 1000)::bigint;
  day_ms    bigint := 86400000;
  wk_start  bigint := (extract(epoch from date_trunc('week', now())) * 1000)::bigint;  -- Monday
  reals  text[] := array['Ava M','Liam T','Olivia K','Noah P','Emma R','Lucas B','Sophia W','Ethan C','Mia H','Jack D',
                         'Isla G','Leo F','Chloe S','Owen J','Harper L','Wyatt N','Amelia Q','Mason V','Ella Y','Hunter Z'];
  spaces text[] := array['Comet Fox','Nova Falcon','Lunar Otter','Rocket Panda','Stellar Owl','Orbit Tiger','Galaxy Koala','Meteor Wolf','Astro Penguin','Solar Shark',
                         'Quantum Lynx','Cosmic Hawk','Nebula Dolphin','Turbo Ranger','Zippy Pilot','Blazing Voyager','Starry Racer','Electric Explorer','Galactic Rider','Super Dragon'];
  skins  text[] := array['ninja','astro','dj','mint','wizard','robo','pirate','royal','blob','mint','astro','ninja','dj','wizard','robo','pirate','blob','astro','ninja','mint'];
  -- skill 0..1 (higher = faster and more accurate); activity: 2 = keen, 1 = regular, 0 = hasn't played this week
  skill  numeric[] := array[.85,.9,.7,.35,.75,.6,.8,.5,.65,.3,.7,.55,.95,.45,.6,.8,.25,.5,.7,.6];
  active int[]     := array[2,2,1,1,2,1,2,0,1,1,1,2,2,0,1,1,1,0,2,1];
  i int; a int; b int; k int; n int; d int; sk numeric; base numeric; ok boolean;
  facts jsonb; rounds jsonb; rs jsonb; ts jsonb; coins int; ago bigint; nr int;
  c int; tot int; msper int; acc numeric; pts int; sp int; ac int;
begin
  select t.id, t.school_id into v_teacher, v_school from public.teachers t where lower(t.email) = lower(v_email);
  if v_teacher is null then raise exception 'No Mission Multiply teacher with the email %. Change it at the top and run again.', v_email; end if;
  delete from public.classes where school_id = v_school and name = 'Demo class (Grade 5)';
  insert into public.classes (school_id, teacher_id, name, settings)
  values (v_school, v_teacher, 'Demo class (Grade 5)',
          '{"maxTable":10,"division":false,"sound":true,"battles":false,"goal":{"tables":[6,7],"rounds":5}}')
  returning id into v_class;
  perform setseed(0.42);
  for i in 1..20 loop
    sk := skill[i];
    -- every fact 2-10 x 1-10: recent tries (right/wrong) and seconds taken
    facts := '{}'::jsonb;
    for a in 2..10 loop for b in 1..10 loop
      d := case when a in (2,5,10) then 0 when a in (3,4) then 1 when a in (6,8,9) then 2 else 3 end + case when b in (1,2,5,10) then -1 else 0 end;
      d := greatest(d, 0);
      continue when d >= 2 and random() < .4 * (1 - sk);           -- weaker students haven't met every hard fact yet
      base := (1100 + d * 1300) * (1.65 - sk);
      n := 3 + floor(random() * 5)::int; rs := '[]'; ts := '[]';
      for k in 1..n loop
        ok := random() > greatest(.02, d * .13 * (1.25 - sk));
        rs := rs || to_jsonb(case when ok then 1 else 0 end);
        if ok then ts := ts || to_jsonb(round(base * (.7 + random() * .7))::int); end if;
      end loop;
      while jsonb_array_length(ts) > 5 loop ts := ts - 0; end loop;
      facts := facts || jsonb_build_object(a || ',' || b, jsonb_build_object('r', rs, 't', ts, 'last', now_ms - floor(random() * 6 * day_ms)::bigint));
    end loop; end loop;
    -- rounds over the last 3 weeks, getting a little faster over time
    rounds := '[]'; coins := 0;
    nr := case active[i] when 2 then 14 + floor(random() * 6)::int when 1 then 8 + floor(random() * 4)::int else 5 + floor(random() * 3)::int end;
    for k in 1..nr loop
      if active[i] = 0 then ago := 7 * day_ms + floor(random() * 14 * day_ms)::bigint;
      elsif k > nr - (case active[i] when 2 then 6 else 3 end) then ago := floor(random() * greatest(now_ms - wk_start, 3600000))::bigint;  -- this week
      else ago := 2 * day_ms + floor(random() * 19 * day_ms)::bigint; end if;
      msper := round((1300 + (1 - sk) * 4200) * (1.12 - .2 * (21 * day_ms - ago)::numeric / (21 * day_ms)) * (.9 + random() * .2))::int;
      acc := least(.99, greatest(.55, .62 + sk * .36 + (random() - .5) * .08));
      c := greatest(4, round(56000.0 / msper * acc)::int);
      tot := greatest(c, round(c / acc)::int);
      sp := round(500 * greatest(0, least(1, (7 - msper / 1000.0) / 5.5)) * least(1, tot / 8.0));
      ac := round(500 * (c::numeric / tot) ^ 2 * least(1, tot / 8.0));
      pts := sp + ac;
      rounds := rounds || jsonb_build_object('d', now_ms - ago, 'c', c, 'n', tot, 'ms', msper, 'len', 60, 'best', least(c, 3 + floor(random() * 10)::int),
                                              'boss', random() < .3, 'pts', pts, 'stars', round(pts / 10.0)::int);
      coins := coins + round(pts / 10.0)::int;
    end loop;
    rounds := (select jsonb_agg(r order by (r ->> 'd')::bigint) from jsonb_array_elements(rounds) r);
    insert into public.students (class_id, name, real_name, data)
    values (v_class, spaces[i], reals[i], jsonb_build_object(
      'placed', true, 'facts', facts, 'rounds', rounds, 'skin', skins[i], 'owned', jsonb_build_array('blob', skins[i]),
      'rockets', jsonb_build_array('classic'), 'rocket', 'classic', 'coins', coins, 'maxCoins', coins, 'starsV2', true, 'badges', '[]'::jsonb, 'demo', true));
  end loop;
  raise notice 'Demo class ready: %', (select code from public.classes where id = v_class);
end $$;

select 'Demo class (Grade 5) is ready. Class code: ' || code as result
from public.classes where name = 'Demo class (Grade 5)' order by created_at desc limit 1;
