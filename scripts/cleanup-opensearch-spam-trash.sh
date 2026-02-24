#!/bin/bash
set -euo pipefail

# Cleans up SPAM and TRASH emails from the OpenSearch emails index.
# These emails were indexed before the Feb 3 fix (96e7b58f9) that prevents
# spam/trash from being indexed going forward.
#
# Usage:
#   ./scripts/cleanup-opensearch-spam-trash.sh dev
#   ./scripts/cleanup-opensearch-spam-trash.sh prod
#   DRY_RUN=true ./scripts/cleanup-opensearch-spam-trash.sh prod

DRY_RUN="${DRY_RUN:-false}"
ENV="${1:-}"

if [ -z "$ENV" ]; then
  echo "Usage: $0 <dev|prod>"
  exit 1
fi

case "$ENV" in
  dev)
    OPENSEARCH_URL="https://search-macro-opensearch-dev-bno46cbggd3a6y4zkcnx4ohj4m.us-east-1.es.amazonaws.com"
    SECRET_ID="macro-opensearch-password-dev"
    ;;
  prod)
    OPENSEARCH_URL="https://localhost:9200"
    SECRET_ID="macro-opensearch-password-prod"
    echo "NOTE: Prod requires an active SSH tunnel to the VPC."
    echo "  ssh -L 9200:vpc-macro-opensearch-prod-yicl3rjwlq7opnh5hllwgskytq.us-east-1.es.amazonaws.com:443 \\"
    echo "    -i ~/.ssh/gab-opensearch-tunnel.pem -N ec2-user@<PUBLIC_IP>"
    echo ""
    ;;
  *)
    echo "Unknown environment: $ENV (expected dev or prod)"
    exit 1
    ;;
esac

CURL_OPTS="-s"
if [ "$ENV" = "prod" ]; then
  CURL_OPTS="$CURL_OPTS -k"
fi

PASSWORD=$(aws secretsmanager get-secret-value --secret-id "$SECRET_ID" --query 'SecretString' --output text)
AUTH=$(echo -n "macrouser:${PASSWORD}" | base64)

query() {
  local method="$1"
  local path="$2"
  local data="${3:-}"

  local args=($CURL_OPTS -X "$method" -H "Authorization: Basic $AUTH" -H "Content-Type: application/json" "${OPENSEARCH_URL}${path}")
  if [ -n "$data" ]; then
    args+=(-d "$data")
  fi

  curl "${args[@]}"
}

SPAM_TRASH_QUERY='{"query":{"bool":{"minimum_should_match":1,"should":[{"term":{"labels":"SPAM"}},{"term":{"labels":"TRASH"}}]}}}'

echo "=== OpenSearch Spam/Trash Cleanup ($ENV) ==="
echo ""

# Count SPAM
SPAM_COUNT=$(query POST "/emails/_search" '{"query":{"bool":{"filter":[{"term":{"labels":"SPAM"}}]}},"size":0,"track_total_hits":true}' | python3 -c "import sys,json; print(json.load(sys.stdin)['hits']['total']['value'])")
echo "SPAM emails:  $SPAM_COUNT"

# Count TRASH
TRASH_COUNT=$(query POST "/emails/_search" '{"query":{"bool":{"filter":[{"term":{"labels":"TRASH"}}]}},"size":0,"track_total_hits":true}' | python3 -c "import sys,json; print(json.load(sys.stdin)['hits']['total']['value'])")
echo "TRASH emails: $TRASH_COUNT"

TOTAL=$((SPAM_COUNT + TRASH_COUNT))
echo "Total to delete: ~$TOTAL (may overlap if an email has both labels)"
echo ""

# Sample a few
echo "=== Sample SPAM emails ==="
query POST "/emails/_search" '{"query":{"bool":{"filter":[{"term":{"labels":"SPAM"}}]}},"size":3,"_source":["sender","subject","labels","user_id"]}' | python3 -m json.tool --no-ensure-ascii 2>/dev/null | head -40
echo ""

if [ "$DRY_RUN" = "true" ]; then
  echo "=== DRY RUN — no changes made ==="
  exit 0
fi

read -p "Proceed with deletion? (yes/no): " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
  echo "Aborted."
  exit 0
fi

echo ""
echo "=== Deleting SPAM and TRASH emails ==="
RESULT=$(query POST "/emails/_delete_by_query" "$SPAM_TRASH_QUERY")
echo "$RESULT" | python3 -m json.tool 2>/dev/null || echo "$RESULT"

DELETED=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('deleted', 'unknown'))" 2>/dev/null || echo "unknown")
echo ""
echo "=== Done. Deleted $DELETED documents from $ENV ==="
