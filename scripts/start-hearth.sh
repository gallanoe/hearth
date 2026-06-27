#!/bin/bash
# Builds and starts the Hearth app (and its Postgres).
# Start the observability stack first with scripts/start-observability.sh so
# traces have somewhere to go.

set -e

cd "$(dirname "$0")/.." || exit 1

NETWORK="hearth-observability"
PROJECT="hearth"
APP_URL="http://localhost:3000"

# Hearth's compose references the shared network as external; make sure it exists
# so `up` doesn't fail if observability hasn't been started yet.
if ! docker network inspect "$NETWORK" >/dev/null 2>&1; then
  echo "🔗 Creating network '$NETWORK' (start observability for full tracing)..."
  docker network create "$NETWORK" >/dev/null
fi

echo "🏠 Building and starting Hearth..."
docker compose -p "$PROJECT" up -d --build

echo "✅ Hearth is up — API at $APP_URL"
