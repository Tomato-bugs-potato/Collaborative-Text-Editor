#!/bin/bash

# Utility script to promote a PostgreSQL replica to Master
# Usage: ./scripts/promote.sh <container_name>

CONTAINER=$1

if [ -z "$CONTAINER" ]; then
  echo "Usage: ./scripts/promote.sh <container_name>"
  echo "Example: ./scripts/promote.sh postgres-replica-1"
  exit 1
fi

echo "Promoting $CONTAINER to Master..."

docker exec -it $CONTAINER pg_ctl promote

if [ $? -eq 0 ]; then
  echo "Successfully promoted $CONTAINER to Master."
  echo "The services will automatically discover the new master within 30 seconds."
else
  echo "Failed to promote $CONTAINER. Make sure the container is running and is a replica."
  exit 1
fi
