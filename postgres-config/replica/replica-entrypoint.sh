#!/bin/bash
set -e

echo "=== PostgreSQL Replica Entrypoint ==="

# Check if data directory is empty or not initialized
if [ -z "$(ls -A /var/lib/postgresql/data 2>/dev/null)" ] || [ ! -f "/var/lib/postgresql/data/PG_VERSION" ]; then
    echo "Data directory is empty or not initialized. Setting up as replica..."
    
    # Wait for master to be ready
    echo "Waiting for master to be ready..."
    until PGPASSWORD=secret pg_isready -h "$POSTGRES_MASTER_HOST" -U editor -q; do
        echo "Waiting for master at $POSTGRES_MASTER_HOST..."
        sleep 2
    done
    
    echo "Master is accepting connections. Waiting for databases to be created..."
    
    # Wait for all required databases to exist
    for db in texteditor texteditor_docs texteditor_collab; do
        until PGPASSWORD=secret psql -h "$POSTGRES_MASTER_HOST" -U editor -d "$db" -c "SELECT 1" > /dev/null 2>&1; do
            echo "Waiting for database '$db' on master..."
            sleep 3
        done
        echo "Database '$db' is ready on master."
    done
    
    # Wait for replication user
    until PGPASSWORD=secret psql -h "$POSTGRES_MASTER_HOST" -U editor -d postgres -c "SELECT 1 FROM pg_roles WHERE rolname='replicator'" | grep -q 1; do
        echo "Waiting for replicator user on master..."
        sleep 2
    done
    
    echo "Master is fully ready. Starting pg_basebackup..."
    
    # Clean any partial data
    rm -rf /var/lib/postgresql/data/*
    
    # Perform base backup
    PGPASSWORD='replicator_password' pg_basebackup \
        -h "$POSTGRES_MASTER_HOST" \
        -D /var/lib/postgresql/data \
        -U replicator \
        -v -P -R -X stream
    
    # Ensure standby.signal exists (for PostgreSQL 12+)
    touch /var/lib/postgresql/data/standby.signal
    
    # Set proper permissions
    chown -R postgres:postgres /var/lib/postgresql/data
    chmod 700 /var/lib/postgresql/data
    
    echo "=== Replica setup completed! ==="
else
    echo "Data directory already initialized. Starting as-is..."
fi

# Call the original PostgreSQL entrypoint
exec docker-entrypoint.sh "$@"
