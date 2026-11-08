-- A teacher can delete their own account.
--  - The only teacher at the school: the school, its classes and all its students' data are deleted too.
--  - Other teachers remain: only the login goes; their classes stay with the school (no teacher) for an admin to reassign.
--    The last admin must make someone else admin first.
create or replace function public.delete_my_account() returns json
language plpgsql volatile security definer set search_path = public, extensions as $$
declare me public.teachers; others int;
begin
  if auth.uid() is null then return json_build_object('error', 'signed_out'); end if;
  select * into me from public.teachers where id = auth.uid();
  if me.id is not null then
    select count(*) into others from public.teachers where school_id = me.school_id and id <> me.id;
    if others = 0 then
      delete from public.schools where id = me.school_id;
    elsif me.role = 'admin' and not exists (
      select 1 from public.teachers where school_id = me.school_id and role = 'admin' and id <> me.id) then
      return json_build_object('error', 'last_admin');
    end if;
  end if;
  delete from auth.users where id = auth.uid();
  return json_build_object('ok', true, 'school_deleted', me.id is not null and others = 0);
end $$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
