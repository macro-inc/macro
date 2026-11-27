set -euo pipefail

url="${SEARCH_OPENSEARCH_URL:?}"
# Each probe is bounded, so a node that accepts the connection but never answers
# still reaches the log below within about four minutes.
for _ in $(seq 1 120); do
  curl --fail --silent --max-time 1 --output /dev/null "$url" && break
  sleep 1
done
curl --fail --silent --show-error --max-time 5 --output /dev/null "$url" \
  || { docker logs --tail 50 search-opensearch; exit 1; }

# The indices and aliases search reads, from the same script the local stack
# and the deployed domain are set up with. The cluster has no security
# plugin, so the credentials only have to be present.
cd infra/stacks/opensearch/helpers
bun install --frozen-lockfile
ENVIRONMENT=local DRY_RUN=false OPENSEARCH_URL="$url" \
  OPENSEARCH_USERNAME=admin OPENSEARCH_PASSWORD=admin \
  bun run scripts/create_indices.ts
