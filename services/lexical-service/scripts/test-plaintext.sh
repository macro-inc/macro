#!/bin/bash

# Check if document ID is provided
if [ $# -eq 0 ]; then
    echo "Usage: $0 <docId>"
    echo "Example: $0 doc123"
    exit 1
fi

DOC_ID=$1
BASE_URL="http://localhost:8931"
AUTH_KEY="local"

curl -v \
  -H "x-internal-auth-key: $AUTH_KEY" \
  -H "Accept: application/json" \
  "$BASE_URL/plaintext/$DOC_ID"

echo
