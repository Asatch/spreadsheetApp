#!/usr/bin/env bash
set -e

# Wrapper to run E2E tests, using Xvfb on Linux if available.
# Using --env flag to set LOGGING_MODE=silent to suppress browser console output
OS="$(uname -s)"
if [ "$OS" = "Linux" ] && command -v xvfb-run >/dev/null 2>&1; then
  exec xvfb-run start-server-and-test "npm run dev:test" "http://localhost:3456" "cypress run --headless --browser firefox --config baseUrl=http://localhost:3456 --env LOGGING_MODE=silent"
else
  exec start-server-and-test "npm run dev:test" "http://localhost:3456" "cypress run --headless --browser firefox --config baseUrl=http://localhost:3456 --env LOGGING_MODE=silent"
fi