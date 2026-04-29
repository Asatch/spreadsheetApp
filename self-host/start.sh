#!/usr/bin/env bash
# Launch the sc self-host server and open the browser.
# Works on macOS and Linux — requires python3 (preinstalled on both).

set -e
cd "$(dirname "$0")"

mkdir -p persist

# Detect browser opener
if command -v xdg-open &>/dev/null; then
  OPEN=xdg-open
elif command -v open &>/dev/null; then
  OPEN=open
else
  OPEN=""
fi

PORT=21845
URL="http://localhost:$PORT"

# Check if port is already in use
if command -v lsof &>/dev/null && lsof -i ":$PORT" &>/dev/null; then
  echo "Port $PORT already in use — opening browser to existing server."
  [ -n "$OPEN" ] && "$OPEN" "$URL"
  exit 0
fi

echo "Starting sc on $URL ..."

python3 server.py &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null; wait $SERVER_PID 2>/dev/null' EXIT INT TERM
sleep 0.3

[ -n "$OPEN" ] && "$OPEN" "$URL" &

wait $SERVER_PID
