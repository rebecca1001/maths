-- Minimum rounds each time they play: one safe way to change it.
-- Teachers at the school, and the owner (super admin) for ANY school, can set the class minimum or one student's own
-- number. Only settings.minRounds and settings.minFor change; everything else in the class stays as it is
-- (the owner's view of other schools stays read-only for everything else).
create or replace function public.set_class_minimum(p_class uuid, p_student uuid, p_n int) returns json
language plpgsql volatile security definer set search_path = public, extensions as $$
declare c public.classes; st jsonb; m jsonb;
begin
  if auth.uid() is null then return json_build_object('error', 'not_allowed'); end if;
  select * into c from public.classes where id = p_class and archived_at is null;
  if c.id is null or (c.school_id is distinct from public.my_school() and not public.is_super_admin()) then
    return json_build_object('error', 'not_allowed');
  end if;
  st := coalesce(c.settings, '{}'::jsonb);
  if p_student is null then
    st := st || jsonb_build_object('minRounds', greatest(0, least(10, coalesce(p_n, 0))));
  else
    if not exists (select 1 from public.students where id = p_student and class_id = p_class) then return json_build_object('error', 'not_allowed'); end if;
    m := coalesce(st -> 'minFor', '{}'::jsonb);
    if jsonb_typeof(m) <> 'object' then m := '{}'::jsonb; end if;
    if p_n is null then m := m - p_student::text; else m := m || jsonb_build_object(p_student::text, greatest(0, least(10, p_n))); end if;
    st := case when m = '{}'::jsonb then st - 'minFor' else st || jsonb_build_object('minFor', m) end;
  end if;
  update public.classes set settings = st where id = p_class;
  return json_build_object('ok', true, 'settings', st);
end $$;
revoke all on function public.set_class_minimum(uuid, uuid, int) from public, anon;
grant execute on function public.set_class_minimum(uuid, uuid, int) to authenticated;
