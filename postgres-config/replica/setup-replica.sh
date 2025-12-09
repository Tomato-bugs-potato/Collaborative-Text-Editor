#!/bin/bash
set -e

echo "Setting up PostgreSQL replica"

# Wait for master to be ready
until pg_isready -h $POSTGRES_MASTER_HOST -U $POSTGRES_USER; do
  echo "Waiting for master database to be ready..."
  sleep 2
done

echo "Master is ready, starting replica setup"

# Check if data directory is empty (first run)
if [ -z "$(ls -A /var/lib/postgresql/data)" ]; then
    echo "Data directory is empty, performing base backup from master"
    
    # Perform base backup from master
    pg_basebackup -h $POSTGRES_MASTER_HOST -D /var/lib/postgresql/data -U replicator -v -P -W -R
    
    # Create standby signal file (for PostgreSQL 12+)
    touch /var/lib/postgresql/data/standby.signal
    
    # Set proper permissions
    chown -R postgres:postgres /var/lib/postgresql/data
    chmod 700 /var/lib/postgresql/data
    
    echo "Base backup completed"
else
    echo "Data directory is not empty, assuming replica is already configured"
fi

echo "Replica setup completed"