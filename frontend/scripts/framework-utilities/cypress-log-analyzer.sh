#!/bin/bash

# test-jq.sh - Extract test results from Cypress log files
# Usage: ./test-jq.sh [OPTIONS] [LOG_FILE]

# Define color codes for better readability
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Default options
VERBOSE=false
LOG_FILE=""

# Function to display usage information
show_help() {
    echo "Usage: $0 [OPTIONS] [LOG_FILE]"
    echo ""
    echo "Extract test results from Cypress log files."
    echo ""
    echo "Options:"
    echo "  -h, --help      Display this help message and exit"
    echo "  -v, --verbose   Display more detailed information"
    echo "  -l, --list      List available log files in cypress/logs"
    echo ""
    echo "If LOG_FILE is not provided, it defaults to cypress/logs/navigation-mode-transitions-debug.log"
    echo ""
    echo "Examples:"
    echo "  $0                                # Use default log file"
    echo "  $0 cypress/logs/my-test-debug.log # Specify a different log file"
    echo "  $0 -v                            # Show verbose output with default log file"
    echo "  $0 -l                            # List available log files"
    exit 0
}

# Function to list available log files
list_logs() {
    echo "Available log files in cypress/logs:"
    echo "-----------------------------------"
    if [ -d "cypress/logs" ]; then
        find cypress/logs -name "*-debug.log" -type f | sort | while read -r file; do
            echo "$(basename "$file")"
        done
    else
        echo "No cypress/logs directory found."
    fi
    exit 0
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            show_help
            ;;
        -l|--list)
            list_logs
            ;;
        *)
            LOG_FILE="$1"
            shift
            ;;
    esac
done

# Set default log file if not provided
if [ -z "$LOG_FILE" ]; then
    LOG_FILE="cypress/logs/navigation-mode-transitions-debug.log"
fi

# Check if log file exists
if [ ! -f "$LOG_FILE" ]; then
    # If the file doesn't exist, try prepending "cypress/logs/"
    LOG_FILE="cypress/logs/$LOG_FILE"
    if [ ! -f "$LOG_FILE" ]; then
        echo -e "${RED}Error: Log file $LOG_FILE does not exist.${NC}"
        echo "Use '$0 -l' to list available log files."
        exit 1
    fi
fi

echo ""
echo -e "${BOLD}Test Results Summary from $LOG_FILE:${NC}"
echo "====================================================="

# Extract the spec results line from the log file
SPEC_LINE=$(grep -m 1 "spec results:" "$LOG_FILE")

if [ -z "$SPEC_LINE" ]; then
    echo -e "${RED}No test results found in log file.${NC}"
    exit 1
fi

# Extract file name - Improved pattern matching
SPEC_FILE=$(echo "$SPEC_LINE" | grep -o "name: '[^']*\|name: \"[^\"]*" | head -n 1 | sed "s/name: ['\"]//")

# If we couldn't get the name directly, try to extract it from the relative path
if [ -z "$SPEC_FILE" ]; then
    SPEC_FILE=$(echo "$SPEC_LINE" | grep -o "relative: '[^']*\|relative: \"[^\"]*" | head -n 1 | sed "s/relative: ['\"]//")
    # Extract just the filename from the path
    SPEC_FILE=$(basename "$SPEC_FILE" 2>/dev/null)
fi

# If we still can't get the name, extract it from the log file name itself
if [ -z "$SPEC_FILE" ]; then
    SPEC_FILE=$(basename "$LOG_FILE" | sed 's/-debug\.log$//')
fi

# Extract test statistics using specific regex patterns
SUITES=$(echo "$SPEC_LINE" | grep -o 'stats:.*suites: [0-9]*' | grep -o 'suites: [0-9]*' | awk '{print $2}')
TESTS=$(echo "$SPEC_LINE" | grep -o 'stats:.*tests: [0-9]*' | grep -o 'tests: [0-9]*' | awk '{print $2}' | head -n 1)
PASSES=$(echo "$SPEC_LINE" | grep -o 'stats:.*passes: [0-9]*' | grep -o 'passes: [0-9]*' | awk '{print $2}')
FAILURES=$(echo "$SPEC_LINE" | grep -o 'stats:.*failures: [0-9]*' | grep -o 'failures: [0-9]*' | awk '{print $2}')
PENDING=$(echo "$SPEC_LINE" | grep -o 'stats:.*pending: [0-9]*' | grep -o 'pending: [0-9]*' | awk '{print $2}')
SKIPPED=$(echo "$SPEC_LINE" | grep -o 'stats:.*skipped: [0-9]*' | grep -o 'skipped: [0-9]*' | awk '{print $2}')

# Raw duration in milliseconds
RAW_DURATION=$(echo "$SPEC_LINE" | grep -o 'duration: [0-9]*' | grep -o '[0-9]*' | head -n 1)

# Convert milliseconds to seconds with 2 decimal places
if [ -n "$RAW_DURATION" ]; then
    # Integer division first to get seconds
    SECONDS=$((RAW_DURATION / 1000))
    # Get the remaining milliseconds
    MILLISECONDS=$((RAW_DURATION % 1000))
    # Format as seconds.milliseconds
    DURATION_SEC="${SECONDS}.$(printf "%02d" $((MILLISECONDS / 10)))"
fi

# Format and print test summary
echo -e "${BOLD}Spec File:${NC} $SPEC_FILE"
echo ""
echo -e "${BOLD}Test Statistics:${NC}"
echo "---------------------------------------------"
echo -e "Suites:   ${BOLD}$SUITES${NC}"
echo -e "Tests:    ${BOLD}$TESTS${NC}"
echo -e "Passes:   ${GREEN}${BOLD}$PASSES${NC}"

if [ "$FAILURES" != "0" ] && [ -n "$FAILURES" ]; then
    echo -e "Failures: ${RED}${BOLD}$FAILURES${NC}"
else
    echo -e "Failures: ${GREEN}${BOLD}$FAILURES${NC}"
fi

if [ -n "$PENDING" ] && [ "$PENDING" != "0" ]; then
    echo -e "Pending:  ${YELLOW}${BOLD}$PENDING${NC}"
else
    echo -e "Pending:  ${BOLD}$PENDING${NC}"
fi

if [ -n "$SKIPPED" ] && [ "$SKIPPED" != "0" ]; then
    echo -e "Skipped:  ${BLUE}${BOLD}$SKIPPED${NC}"
else
    echo -e "Skipped:  ${BOLD}$SKIPPED${NC}"
fi

echo -e "Duration: ${BOLD}${DURATION_SEC:-unknown}s${NC}"
echo ""

# Extract and display test states
echo -e "${BOLD}Individual Test Results:${NC}"
echo "---------------------------------------------"

# Count the occurrences of each state in the tests array
PASSED_COUNT=$(echo "$SPEC_LINE" | grep -o "state: 'passed'\|state: \"passed\"" | wc -l)
FAILED_COUNT=$(echo "$SPEC_LINE" | grep -o "state: 'failed'\|state: \"failed\"" | wc -l)
PENDING_COUNT=$(echo "$SPEC_LINE" | grep -o "state: 'pending'\|state: \"pending\"" | wc -l)
SKIPPED_COUNT=$(echo "$SPEC_LINE" | grep -o "state: 'skipped'\|state: \"skipped\"" | wc -l)

# If we found tests with each state in the array, show their count
if [ $PASSED_COUNT -gt 0 ]; then
    echo -e "✅ Passed:  ${GREEN}${BOLD}$PASSED_COUNT${NC} tests"
fi

if [ $FAILED_COUNT -gt 0 ]; then
    echo -e "❌ Failed:  ${RED}${BOLD}$FAILED_COUNT${NC} tests"
fi

if [ $PENDING_COUNT -gt 0 ]; then
    echo -e "⏳ Pending: ${YELLOW}${BOLD}$PENDING_COUNT${NC} tests"
fi

if [ $SKIPPED_COUNT -gt 0 ]; then
    echo -e "⏭️ Skipped: ${BLUE}${BOLD}$SKIPPED_COUNT${NC} tests"
fi


echo ""
echo -e "${BOLD}For more details, check the full log file:${NC} $LOG_FILE"
echo "====================================================="

# Print a summary message based on test results
if [ "$FAILURES" = "0" ] || [ -z "$FAILURES" ]; then
    echo -e "${GREEN}${BOLD}✅ All tests passed!${NC}"
    exit 0
else
    echo -e "${RED}${BOLD}❌ Some tests failed!${NC}"
    exit 1  # Non-zero exit code if any tests failed
fi