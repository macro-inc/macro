set -euo pipefail
[[ $ENVIRONMENT == dev && $GITHUB_REF == refs/heads/main ]]
[[ $NIX_CACHE_URL =~ ^s3://([a-z0-9.-]+)\?(.*\&)?region=([a-z0-9-]+) ]]
bucket=${BASH_REMATCH[1]}
region=${BASH_REMATCH[3]}
secrets=$(mktemp -d "$RUNNER_TEMP/runtime-update.XXXXXX")
chmod 700 "$secrets"
trap 'rm -rf "$secrets"' EXIT

cargo build --release --locked -p hosted_runtimes --features runtime-update-cli --bin agent-runtime-update

manifest="$ARTIFACT_DIR/manifest.json"
digest=$(jq -er --arg version "$SOURCE_SHA" \
  'select(.version == $version) | .digest | select(test("^[a-f0-9]{64}$"))' "$manifest")
url=$(AWS_DEFAULT_REGION=$region aws s3 presign --expires-in 3600 \
  "s3://$bucket/agent-runtime-bundles/$SOURCE_SHA/runtime.tar.zst")
echo "::add-mask::$url"
jq -n --arg version "$SOURCE_SHA" --arg digest "$digest" --arg url "$url" \
  '{version:$version,digest:$digest,url:$url}' >"$secrets/request.json"

database_url=$(env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
  aws secretsmanager get-secret-value --secret-id macro-db-dev --query SecretString --output text)
if [[ $database_url != *sslmode=* ]]; then
  if [[ $database_url == *"?"* ]]; then database_url="$database_url&sslmode=require"; else database_url="$database_url?sslmode=require"; fi
fi
echo "::add-mask::$database_url"
printf '%s' "$database_url" >"$secrets/database.url"

target/release/agent-runtime-update --environment dev --database-url-file "$secrets/database.url" \
  --request "$secrets/request.json" --computer "$COMPUTER" | tee -a "$GITHUB_STEP_SUMMARY"
