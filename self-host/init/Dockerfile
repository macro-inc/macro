# syntax=docker/dockerfile:1
#
# The provisioning image. Runs once per `macroctl up` and is idempotent:
# creates the database and applies migrations, provisions object storage,
# queues, tables and the KMS key, and creates the search indices.
#
# Build context is the repository root.
ARG MACRO_IMAGE_SERVICES=ghcr.io/macro-inc/macro-services
ARG MACRO_VERSION=latest

FROM ${MACRO_IMAGE_SERVICES}:${MACRO_VERSION} AS services
FROM oven/bun:1.2-slim AS bun

FROM debian:trixie-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl jq awscli postgresql-client \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Bun runs the canonical OpenSearch index bootstrap (TypeScript). Copying the
# binary avoids a second package manager in this image.
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun

# The migration runner: macro_db_migrator's CLI, which carries the migrations
# compiled in. No sqlx-cli, no migrations directory to keep in sync.
COPY --from=services /app/out/macro_db_migrate /usr/local/bin/macro_db_migrate

WORKDIR /app

# The canonical index mappings and their helper package.
COPY infra/stacks/opensearch/helpers /app/opensearch-helpers
RUN cd /app/opensearch-helpers && bun install --frozen-lockfile

COPY .github/kafka-cluster-topics.json /app/kafka-topics.json
COPY self-host/init/resources.json /app/resources.json
COPY self-host/init/provision.sh /app/provision.sh
COPY self-host/init/render-kickstart.sh /app/render-kickstart.sh
COPY self-host/kickstart /app/kickstart-templates
COPY infra/stacks/fusionauth-instance/templates/reconcile_secondary_idp_link.js /app/kickstart-templates/reconcile_secondary_idp_link.js

RUN chmod +x /app/provision.sh /app/render-kickstart.sh

ENTRYPOINT ["/app/provision.sh"]
