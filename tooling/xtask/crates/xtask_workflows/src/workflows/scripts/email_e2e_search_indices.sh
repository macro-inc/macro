set -euo pipefail

for _ in $(seq 1 120); do
  curl --fail --silent --output /dev/null "$EMAIL_E2E_OPENSEARCH_URL" && break
  sleep 1
done
curl --fail --silent --show-error --output /dev/null "$EMAIL_E2E_OPENSEARCH_URL" \
  || { docker logs --tail 50 email-e2e-opensearch; exit 1; }

# The indices and aliases search reads, from the same script the local stack
# and the deployed domain are set up with. The cluster has no security
# plugin, so the credentials only have to be present.
cd infra/stacks/opensearch/helpers
bun install --frozen-lockfile
ENVIRONMENT=local DRY_RUN=false OPENSEARCH_URL="$EMAIL_E2E_OPENSEARCH_URL" \
  OPENSEARCH_USERNAME=admin OPENSEARCH_PASSWORD=admin \
  bun run scripts/create_indices.ts
