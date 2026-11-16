-- Remove the School Plus plan (16 Nov 2026). Plans are now: free, school.
-- Any school on School Plus moves to School (only the Trial school at the time).

update public.schools set plan = 'school' where plan = 'school_plus';

alter table public.schools drop constraint if exists schools_plan_check;
alter table public.schools add constraint schools_plan_check check (plan in ('free', 'school'));

create or replace function public.school_has_competitions(p_school uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public', 'extensions'
as $function$
  select coalesce((select plan = 'school' from public.schools where id = p_school), false)
$function$;

create or replace function public.super_set_plan(p_school uuid, p_plan text)
 returns json
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
begin
  if not public.is_super_admin() then return json_build_object('error', 'not_allowed'); end if;
  if p_plan not in ('free', 'school') then return json_build_object('error', 'bad_plan'); end if;
  update public.schools set plan = p_plan where id = p_school;
  if not found then return json_build_object('error', 'not_found'); end if;
  return json_build_object('ok', true, 'plan', p_plan);
end $function$;
