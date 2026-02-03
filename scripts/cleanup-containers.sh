#!/bin/bash
# Cleans up all hearth agent containers and volumes

set -e

echo "🧹 Cleaning up hearth agent containers..."

# Find and remove all hearth agent containers
containers=$(docker ps -aq --filter "name=^hearth-" 2>/dev/null || true)
if [ -n "$containers" ]; then
  echo "  Removing containers..."
  docker rm -f $containers
else
  echo "  No containers found"
fi

# Find and remove all hearth agent volumes
volumes=$(docker volume ls -q --filter "name=^hearth-vol-" 2>/dev/null || true)
if [ -n "$volumes" ]; then
  echo "  Removing volumes..."
  docker volume rm $volumes
else
  echo "  No volumes found"
fi

echo "✅ Done"
