#!/bin/sh
# Runs the migration + tests against a throwaway local Postgres database.
# Usage: PGHOST=/path PGPORT=5432 PGUSER=postgres sh supabase/tests/run.sh
set -e
cd "$(dirname "$0")/.."
psql -q -c "drop database if exists mmtest" -c "create database mmtest" >/dev/null
psql -q -d mmtest -v ON_ERROR_STOP=1 -f tests/supabase_stub.sql -f migrations/*.sql
psql -q -d mmtest -v ON_ERROR_STOP=1 -f tests/test.sql 2>&1
