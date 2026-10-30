-- School admin: teacher emails, admin-only actions (roles, removing teachers, new school code)

-- Store each teacher's email so admins can see who is who
alter table public.teachers add column if not exists email text;
update public.teachers t set email = u.email from auth.users u where u.id = t.id and t.email is null;

create or replace function public.teachers_set_email() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  new.email := (select email from auth.users where id = new.id);
  return new;
end $$;
drop trigger if exists teachers_set_email on public.teachers;
create trigger teachers_set_email before insert on public.teachers
  for each row execute function public.teachers_set_email();

-- Make a teacher an admin, or an admin a teacher (a school always keeps at least one admin)
create or replace function public.admin_set_role(p_teacher uuid, p_role text) returns json
language plpgsql volatile security definer set search_path = public, extensions as $$
begin
  if not public.is_school_admin() then return json_build_object('error', 'not_admin'); end if;
  if p_role not in ('teacher', 'admin') then return json_build_object('error', 'bad_role'); end if;
  if not exists (select 1 from public.teachers where id = p_teacher and school_id = public.my_school()) then
    return json_build_object('error', 'not_found');
  end if;
  if p_role = 'teacher' and not exists (
    select 1 from public.teachers where school_id = public.my_school() and role = 'admin' and id <> p_teacher) then
    return json_build_object('error', 'last_admin');
  end if;
  update public.teachers set role = p_role where id = p_teacher;
  return json_build_object('ok', true);
end $$;

-- Remove a teacher from the school. Their classes stay, with no teacher, so the admin can reassign them.
create or replace function public.admin_remove_teacher(p_teacher uuid) returns json
language plpgsql volatile security definer set search_path = public, extensions as $$
begin
  if not public.is_school_admin() then return json_build_object('error', 'not_admin'); end if;
  if p_teacher = auth.uid() then return json_build_object('error', 'not_self'); end if;
  delete from public.teachers where id = p_teacher and school_id = public.my_school();
  if not found then return json_build_object('error', 'not_found'); end if;
  return json_build_object('ok', true);
end $$;

-- New school code (the old one stops working), e.g. after removing a teacher
create or replace function public.admin_new_join_code() returns json
language plpgsql volatile security definer set search_path = public, extensions as $$
declare c text;
begin
  if not public.is_school_admin() then return json_build_object('error', 'not_admin'); end if;
  c := upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8));
  update public.schools set join_code = c where id = public.my_school();
  return json_build_object('join_code', c);
end $$;

revoke all on function public.teachers_set_email() from public, anon, authenticated;
revoke all on function public.admin_set_role(uuid, text), public.admin_remove_teacher(uuid), public.admin_new_join_code() from public, anon;
grant execute on function public.admin_set_role(uuid, text), public.admin_remove_teacher(uuid), public.admin_new_join_code() to authenticated;

-- New classes no longer have battles
alter table public.classes alter column settings set default '{"maxTable": 10, "division": false, "sound": true, "battles": false}';
