set -euo pipefail

# The local stack's OpenSearch image: the engine version of the deployed
# domain, with the analysis plugin the index mappings need.
docker build --quiet --tag email-e2e-opensearch infra/local/opensearch
docker run --detach --name email-e2e-opensearch --publish 9200:9200 \
  --env discovery.type=single-node \
  --env OPENSEARCH_JAVA_OPTS="-Xms1g -Xmx1g" \
  email-e2e-opensearch
