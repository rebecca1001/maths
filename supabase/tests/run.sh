#!/bin/sh
# Runs the migrations + tests against a throwaway local Postgres database.
# Usage: PGHOST=/path PGPORT=5432 PGUSER=postgres sh supabase/tests/run.sh
set -e
cd "$(dirname "$0")/.."
psql -q -c "drop database if exists mmtest" -c "create database mmtest" >/dev/null
# Supabase's default search_path includes the extensions schema
psql -q -c "alter database mmtest set search_path = \"\$user\", public, extensions" >/dev/null
psql -q -d mmtest -v ON_ERROR_STOP=1 -f tests/supabase_stub.sql
for f in migrations/*.sql; do psql -q -d mmtest -v ON_ERROR_STOP=1 -f "$f"; done
psql -q -d mmtest -v ON_ERROR_STOP=1 -f tests/test.sql 2>&1
