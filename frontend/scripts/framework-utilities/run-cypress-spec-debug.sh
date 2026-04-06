#!/usr/bin/env bash
set -euo pipefail

# Enhanced script to run a specific Cypress test file with improved console logging
# Usage: $0 cypress/e2e/your-test-file.cy.js [grep-pattern]
# Example: $0 cypress/e2e/test.cy.js "should handle click"

# Check for test file argument
if [ -z "${1:-}" ]; then
  echo "Please provide a test file path"
  echo "Usage: $0 cypress/e2e/your-test-file.cy.js [grep-pattern]"
  echo "Example: $0 cypress/e2e/test.cy.js \"should handle click\""
  exit 1
fi

# Variables
TEST_FILE="$1"
GREP_PATTERN="${2:-}"
LOG_DIR="cypress/logs"
LOG_FILE="$LOG_DIR/$(basename "$TEST_FILE" .cy.js)-debug.log"

# Build grep environment variable if pattern provided
GREP_ENV=""
if [ -n "$GREP_PATTERN" ]; then
  GREP_ENV="grep=$GREP_PATTERN,"
fi

# Prepare log directory and clear previous log file
mkdir -p "$LOG_DIR"
: > "$LOG_FILE"

echo "Starting Cypress test with enhanced debugging..."
echo "Test file: $TEST_FILE"
if [ -n "$GREP_PATTERN" ]; then
  echo "Grep pattern: $GREP_PATTERN"
fi
echo "Log file: $LOG_FILE"
echo "------------------------------------------------"

# Detect OS for Xvfb usage
OS="$(uname -s)"

# Function to run the test and capture output
run_test() {
  echo "Running test... (detailed output written to $LOG_FILE)"
  if [ "$OS" = "Linux" ] && command -v xvfb-run >/dev/null 2>&1; then
    DEBUG=cypress:* xvfb-run npx start-server-and-test "npm run dev:test" "http://localhost:3456" "cypress run --headless --browser firefox --config baseUrl=http://localhost:3456 --env ${GREP_ENV}LOGGING_MODE=verbose --spec $TEST_FILE" > "$LOG_FILE" 2>&1
  else
    DEBUG=cypress:* npx start-server-and-test "npm run dev:test" "http://localhost:3456" "cypress run --headless --browser firefox --config baseUrl=http://localhost:3456 --env ${GREP_ENV}LOGGING_MODE=verbose --spec $TEST_FILE" > "$LOG_FILE" 2>&1
  fi
}

# Execute the test
run_test
EXIT_CODE=$?

# Summarize test results
echo "------------------------------------------------"
echo "Test completed with exit code $EXIT_CODE. Full logs are in $LOG_FILE"
echo "------------------------------------------------"

# Analyze and display summary
echo ""
echo "For more details, check the full log file: $LOG_FILE"
echo "To search the log file for specific information, use: grep 'search_term' $LOG_FILE"
./scripts/framework-utilities/cypress-log-analyzer.sh "$LOG_FILE"

exit $EXIT_CODE
