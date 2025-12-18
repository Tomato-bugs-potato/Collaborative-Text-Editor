#!/bin/bash
# Enhanced healthcheck that verifies all databases are created
# This ensures replicas don't try to sync before databases exist

pg_isready -U editor || exit 1

# Check if all required databases exist
psql -U editor -d postgres -tc "SELECT 1 FROM pg_database WHERE datname='texteditor'" | grep -q 1 || exit 1
psql -U editor -d postgres -tc "SELECT 1 FROM pg_database WHERE datname='texteditor_docs'" | grep -q 1 || exit 1
psql -U editor -d postgres -tc "SELECT 1 FROM pg_database WHERE datname='texteditor_collab'" | grep -q 1 || exit 1

# Check if replication user exists
psql -U editor -d postgres -tc "SELECT 1 FROM pg_roles WHERE rolname='replicator'" | grep -q 1 || exit 1

echo "Master is fully ready with all databases and replication user"
exit 0
