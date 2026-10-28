FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
	&& rm -rf /var/lib/apt/lists/*
RUN npm install -g bun

# Wrangler includes platform-specific workerd/esbuild binaries. Install the
# proxy's locked dependencies outside /app so the repository bind mount cannot
# replace them with the host platform's node_modules at runtime.
COPY services/analytics-proxy/package.json services/analytics-proxy/bun.lock /opt/analytics-proxy/
RUN cd /opt/analytics-proxy && bun install --frozen-lockfile
ENV PATH="/opt/analytics-proxy/node_modules/.bin:${PATH}"

ENV SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt

WORKDIR /app/services/analytics-proxy
EXPOSE 8098

# The repo is bind-mounted at /app (see docker-compose.yml), while Wrangler and
# its native dependencies stay under /opt. Forward OTLP (both signals) to the
# local collector (--var overrides the wrangler.jsonc host defaults); no
# DD_API_KEY locally, so the worker skips key injection.
CMD ["sh", "-c", "\
  wrangler dev \
    --env local \
    --ip 0.0.0.0 \
    --port 8098 \
    --var OTLP_TRACES_INTAKE_URL:http://otel-collector:4318 \
    --var OTLP_LOGS_INTAKE_URL:http://otel-collector:4318\
"]
