-- A student's real name, for their teachers only.
-- Teachers and admins at the school can read and change it (existing row level security on students).
-- It is never sent to students: student_login and student_state only return the space name.
alter table public.students add column if not exists real_name text check (real_name is null or length(real_name) between 1 and 80);
