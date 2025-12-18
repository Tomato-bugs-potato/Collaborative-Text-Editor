#!/bin/bash
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE DATABASE texteditor_docs;
    CREATE DATABASE texteditor_collab;
    GRANT ALL PRIVILEGES ON DATABASE texteditor_docs TO editor;
    GRANT ALL PRIVILEGES ON DATABASE texteditor_collab TO editor;
EOSQL
