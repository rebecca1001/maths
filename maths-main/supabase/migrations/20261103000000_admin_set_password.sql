-- Passwords without email: a school admin can give a teacher at their school a new (temporary) password.
-- Teachers then change it themselves in Settings.
create or replace function public.admin_set_password(p_teacher uuid, p_password text) returns json
language plpgsql volatile security definer set search_path = public, extensions as $$
begin
  if not public.is_school_admin() then return json_build_object('error', 'not_admin'); end if;
  if p_password is null or length(p_password) < 8 then return json_build_object('error', 'too_short'); end if;
  if not exists (select 1 from public.teachers where id = p_teacher and school_id = public.my_school()) then
    return json_build_object('error', 'not_found');
  end if;
  update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')), updated_at = now()
   where id = p_teacher;
  return json_build_object('ok', true);
end $$;
revoke all on function public.admin_set_password(uuid, text) from public, anon;
grant execute on function public.admin_set_password(uuid, text) to authenticated;
