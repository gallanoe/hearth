#!/bin/bash
# Starts the self-hosted Langfuse observability stack (langfuse-web, worker,
# ClickHouse, Redis, MinIO, Postgres) plus the shared network Hearth joins.
# Run this before scripts/start-hearth.sh.

set -e

cd "$(dirname "$0")/.." || exit 1

NETWORK="hearth-observability"
PROJECT="langfuse"
COMPOSE_FILE="docker-compose.langfuse.yml"
UI_URL="http://localhost:3001"

# 1. Ensure the shared network exists (idempotent — created once, reused after).
if docker network inspect "$NETWORK" >/dev/null 2>&1; then
  echo "🔗 Network '$NETWORK' already exists"
else
  echo "🔗 Creating network '$NETWORK'..."
  docker network create "$NETWORK" >/dev/null
fi

# 2. Bring up the Langfuse stack as its own Compose project.
echo "📡 Starting Langfuse stack..."
docker compose -p "$PROJECT" -f "$COMPOSE_FILE" up -d

# 3. Wait for langfuse-web to become healthy. First boot runs DB migrations and
#    can take a minute or two, so we poll — but fail fast (with logs) if the
#    container is crash-looping instead of silently waiting out the timeout.
WEB_CID=$(docker compose -p "$PROJECT" -f "$COMPOSE_FILE" ps -q langfuse-web)

dump_web_logs() {
  echo "────────────────────────────────────────────────────────────────────"
  docker compose -p "$PROJECT" -f "$COMPOSE_FILE" logs --tail=30 langfuse-web
  echo "────────────────────────────────────────────────────────────────────"
}

echo "⏳ Waiting for Langfuse to be ready at $UI_URL ..."
for _ in $(seq 1 60); do
  if curl -sf -o /dev/null "$UI_URL/api/public/health"; then
    echo "✅ Langfuse is up — UI at $UI_URL"
    exit 0
  fi

  # Crash loop? (restart: always means any exit→restart is a real boot failure.)
  state=$(docker inspect -f '{{.State.Status}}' "$WEB_CID" 2>/dev/null || echo "unknown")
  restarts=$(docker inspect -f '{{.RestartCount}}' "$WEB_CID" 2>/dev/null || echo 0)
  if [ "$state" = "exited" ] || [ "${restarts:-0}" -ge 2 ]; then
    echo ""
    echo "❌ langfuse-web is crash-looping (state=$state, restarts=$restarts). Recent logs:"
    dump_web_logs
    exit 1
  fi

  sleep 3
done

echo ""
echo "❌ langfuse-web never reported healthy after ~3 min. Recent logs:"
dump_web_logs
exit 1
