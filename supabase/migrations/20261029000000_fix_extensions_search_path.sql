-- Fix: on Supabase, pgcrypto (gen_random_bytes) lives in the "extensions" schema.
-- Functions pinned to search_path = public could not find it, so student logins failed.
alter function public.my_school() set search_path = public, extensions;
alter function public.is_school_admin() set search_path = public, extensions;
alter function public.new_class_code() set search_path = public, extensions;
alter function public.new_student_pin(uuid) set search_path = public, extensions;
alter function public.classes_before_insert() set search_path = public, extensions;
alter function public.students_before_write() set search_path = public, extensions;
alter function public.create_school(text, text) set search_path = public, extensions;
alter function public.join_school(text, text) set search_path = public, extensions;
alter function public._student_from_token(text) set search_path = public, extensions;
alter function public.student_login(text, text) set search_path = public, extensions;
alter function public.student_logout(text) set search_path = public, extensions;
alter function public.student_state(text) set search_path = public, extensions;
alter function public.student_save(text, jsonb) set search_path = public, extensions;
alter function public.challenge_create(text, uuid, bigint) set search_path = public, extensions;
alter function public.challenge_score(text, uuid, jsonb) set search_path = public, extensions;
alter function public.purge_old_data() set search_path = public, extensions;
