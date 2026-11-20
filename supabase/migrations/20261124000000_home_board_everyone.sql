-- Home Top 30 now ranks every player on MathWizz, at school and at home (Sam, 19 Nov 2026), not just home players.
-- Still shown only to children with a home account; school students keep their class and school Top 10.
-- The board carries only the made-up space name, character and total stars: never a real name, username, class or school.
-- The privacy policy (public/privacy.html) was updated to say this.
create or replace function public._home_board(me public.students) returns json
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if me.school_id is distinct from public._home_school() then return null; end if;
  return coalesce((
    select json_agg(json_build_object('id', b.id, 'name', b.name, 'skin', b.skin, 'stars', b.stars) order by b.stars desc, b.name)
      from (
        select s.id, s.name, coalesce(s.data ->> 'skin', 'blob') as skin, sum(l.stars)::int as stars
          from public.round_log l
          join public.students s on s.id = l.student_id
         where not l.demo
         group by s.id, s.name, s.data
         having sum(l.stars) > 0
         order by sum(l.stars) desc, s.name
         limit 30
      ) b), '[]');
end $$;
revoke all on function public._home_board(public.students) from public, anon, authenticated;
