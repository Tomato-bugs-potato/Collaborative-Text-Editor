#!/bin/bash
set -e

echo "Initializing PostgreSQL master for replication"

# Create replication user and additional databases
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    -- Create replication user if it doesn't exist
    DO \$\$
    BEGIN
        IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'replicator') THEN
            CREATE ROLE replicator WITH REPLICATION LOGIN PASSWORD 'replicator_password';
        END IF;
    END
    \$\$;
    
    -- Grant necessary permissions
    GRANT CONNECT ON DATABASE $POSTGRES_DB TO replicator;

    -- Create additional databases
    SELECT 'CREATE DATABASE texteditor_collab' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'texteditor_collab')\gexec
    SELECT 'CREATE DATABASE texteditor_docs' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'texteditor_docs')\gexec
EOSQL

echo "Master replication setup completed"