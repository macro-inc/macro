#!/bin/bash
set -e

# Test script for get-project-name action
# Run from repo root: .github/actions/get-project-name/test.sh

echo "Testing get-project-name action..."
echo ""

# Array of test cases: service-name:expected-project-name
TEST_CASES=(
  "document-storage-service:cloud-storage-service"
  "document-storage:document-storage"
  "authentication-service:authentication-service"
  "comms-service:comms-service"
  "search-service:search-service"
  "opensearch:opensearch"
)

FAILED=0
PASSED=0

for test_case in "${TEST_CASES[@]}"; do
  SERVICE_NAME="${test_case%%:*}"
  EXPECTED="${test_case##*:}"

  # Use the actual script
  if PROJECT_NAME=$(.github/actions/get-project-name/get-project-name.sh "$SERVICE_NAME" 2>&1); then
    if [ "$PROJECT_NAME" == "$EXPECTED" ]; then
      echo "✅ PASS: $SERVICE_NAME -> $PROJECT_NAME"
      ((PASSED++))
    else
      echo "❌ FAIL: $SERVICE_NAME -> Expected: '$EXPECTED', Got: '$PROJECT_NAME'"
      ((FAILED++))
    fi
  else
    echo "❌ FAIL: Service '$SERVICE_NAME' error: $PROJECT_NAME"
    ((FAILED++))
  fi
done

echo ""
echo "Results: $PASSED passed, $FAILED failed"

if [ $FAILED -gt 0 ]; then
  exit 1
fi

echo "All tests passed! ✅"
