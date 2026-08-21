#!/bin/bash
# Install analysis-icu on first boot of the stock OpenSearch image, then
# hand off to the upstream entrypoint. The plugin lives in the container
# filesystem, so a recreate repeats the install; the data volume is untouched.
set -euo pipefail
cd /usr/share/opensearch
if ! bin/opensearch-plugin list | grep -q analysis-icu; then
  bin/opensearch-plugin install --batch analysis-icu
fi
exec ./opensearch-docker-entrypoint.sh "$@"
