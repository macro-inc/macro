FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
	&& rm -rf /var/lib/apt/lists/*
RUN npm install -g bun

ENV SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt

WORKDIR /app/services/analytics-proxy
EXPOSE 8098

# The repo is bind-mounted at /app (see docker-compose.yml), so wrangler and
# node_modules come from the host install. Forward OTLP (both signals) to the
# local collector (--var overrides the wrangler.jsonc host defaults); no
# DD_API_KEY locally, so the worker skips key injection.
CMD ["sh", "-c", "\
  npx wrangler dev \
    --env local \
    --ip 0.0.0.0 \
    --port 8098 \
    --var OTLP_TRACES_INTAKE_URL:http://otel-collector:4318 \
    --var OTLP_LOGS_INTAKE_URL:http://otel-collector:4318\
"]
