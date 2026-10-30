-- Minimal stand-in for the parts of Supabase the migration uses, for local testing only.
-- Like Supabase, pgcrypto is installed in the "extensions" schema (not public).
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
create schema extensions;
create extension pgcrypto schema extensions;
grant usage on schema extensions to anon, authenticated;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated;
