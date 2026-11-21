set -euo pipefail

# The local stack's OpenSearch image: the engine version of the deployed
# domain, with the analysis plugin the index mappings need. The build pulls
# the base image and downloads the plugin; one that times out is tried again.
for attempt in 1 2 3; do
  if docker build --quiet --tag search-opensearch infra/local/opensearch; then
    break
  fi
  if [ "$attempt" -eq 3 ]; then
    echo "the OpenSearch image did not build in 3 attempts" >&2
    exit 1
  fi
  echo "::warning::the OpenSearch image did not build (attempt $attempt); trying again"
  sleep $((attempt * 15))
done
docker run --detach --name search-opensearch --publish 127.0.0.1:9200:9200 \
  --env discovery.type=single-node \
  --env OPENSEARCH_JAVA_OPTS="-Xms1g -Xmx1g" \
  search-opensearch
