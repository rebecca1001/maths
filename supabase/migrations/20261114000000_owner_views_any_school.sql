-- Owner (super admin) can open the teacher view of ANY school, read-only.
-- Extra SELECT policies only: Postgres ORs them with the existing ones, so the owner can read every school's
-- schools, teachers, classes and students rows. Insert, update and delete are still limited to the owner's own
-- school by the existing policies (an UPDATE/DELETE needs a matching USING clause from a policy for that command).
-- The app always filters by school, so the owner's own school pages still show only their school.

create policy schools_owner_read on public.schools for select to authenticated using (public.is_super_admin());
create policy teachers_owner_read on public.teachers for select to authenticated using (public.is_super_admin());
create policy classes_owner_read on public.classes for select to authenticated using (public.is_super_admin());
create policy students_owner_read on public.students for select to authenticated using (public.is_super_admin());

-- class_stats: the owner may read any class too
create or replace function public.class_stats(p_class uuid) returns json
language plpgsql stable security definer set search_path = public, extensions as $$
declare v_school uuid; wk timestamptz := public._week_start();
begin
  if auth.uid() is null then return json_build_object('error', 'not_allowed'); end if;
  select school_id into v_school from public.classes where id = p_class;
  if v_school is null or (v_school is distinct from public.my_school() and not public.is_super_admin()) then
    return json_build_object('error', 'not_allowed');
  end if;
  return json_build_object('students', coalesce((
    select json_agg(json_build_object('id', s.id,
             'stars_total', coalesce(x.total, 0), 'stars_week', coalesce(x.week, 0), 'rounds_total', coalesce(x.n, 0)))
      from public.students s
      left join lateral (
        select sum(l.stars)::int as total, sum(l.stars) filter (where l.d >= wk)::int as week, count(*)::int as n
          from public.round_log l where l.student_id = s.id
      ) x on true
     where s.class_id = p_class), '[]'));
end $$;
