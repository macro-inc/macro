set -euo pipefail
token=$(aws secretsmanager get-secret-value --region us-east-1 \
  --secret-id observability/dev-ingest --query SecretString --output text)
if [[ ${#token} -lt 32 || "$token" == *[[:space:]]* ]]; then
  echo 'Invalid ingestion credential' >&2
  exit 1
fi
echo "::add-mask::$token"
headers=$(printf '%s' "$token" | python3 -c 'import sys, urllib.parse; print("Authorization=Bearer%20" + urllib.parse.quote(sys.stdin.read(), safe=""))')
echo "::add-mask::$headers"
printf 'headers=%s\n' "$headers" >> "$GITHUB_OUTPUT"
