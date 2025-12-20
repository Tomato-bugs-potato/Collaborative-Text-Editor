#!/bin/bash
set -e

echo "Setting up PostgreSQL replica..."

# Check if data directory is empty (first run)
if [ -z "$(ls -A /var/lib/postgresql/data 2>/dev/null)" ]; then
    echo "Data directory is empty, performing base backup from master"
    
    # Wait for master to be ready and have all databases
    echo "Waiting for master to be fully ready with all databases..."
    until PGPASSWORD=secret psql -h $POSTGRES_MASTER_HOST -U editor -d postgres -c "SELECT 1" > /dev/null 2>&1; do
      echo "Waiting for master postgres service..."
      sleep 2
    done
    
    until PGPASSWORD=secret psql -h $POSTGRES_MASTER_HOST -U editor -d texteditor_collab -c "SELECT 1" > /dev/null 2>&1; do
      echo "Waiting for database 'texteditor_collab' on master..."
      sleep 2
    done
    
    until PGPASSWORD=secret psql -h $POSTGRES_MASTER_HOST -U editor -d texteditor_docs -c "SELECT 1" > /dev/null 2>&1; do
      echo "Waiting for database 'texteditor_docs' on master..."
      sleep 2
    done
    
    echo "Master is ready with all databases. Starting pg_basebackup..."
    
    # Perform base backup from master
    export PGPASSWORD='replicator_password'
    pg_basebackup -h $POSTGRES_MASTER_HOST -D /var/lib/postgresql/data -U replicator -v -P -R -X stream -C -S replica_slot_$(hostname)
    
    # Ensure standby.signal exists (for PostgreSQL 12+)
    touch /var/lib/postgresql/data/standby.signal
    
    # Set proper permissions
    chown -R postgres:postgres /var/lib/postgresql/data
    chmod 700 /var/lib/postgresql/data
    
    echo "Base backup completed successfully. Replica is ready."
else
    echo "Data directory is not empty, assuming replica is already configured."
fi

echo "Replica setup completed."