{ lib }:
let
  inherit (lib) envFile paths;
in
{
  static_file_cdn = lib.nixImage lib.images.nginx {
    ports = [ "8100:80" ];
    volumes = [
      "${paths.staticFileCdnConf}:/etc/nginx/conf.d/default.conf:ro"
    ];
    depends_on = [ "static_file_service" ];
    networks = {
      databases = { };
      services = {
        aliases = [ "static-file-cdn" ];
      };
    };
  };

  websocket_service = lib.nixImage { ref = lib.nodeBunImage; } {
    working_dir = "/app/services/websocket-service";
    volumes = [ "${paths.context}:/app" ];
    command = [
      "bun"
      "run"
      "start"
    ];
    ports = [ "6969:6969" ];
    networks = {
      services = {
        aliases = [ "websocket-service" ];
      };
    };
  };

  sync_service = lib.nixImage { ref = lib.nodeBunImage; } {
    working_dir = "/app/services/sync-service";
    env_file = [ envFile ];
    ports = [ "8787:8787" ];
    volumes = [ "${paths.syncSrc}:/app/services/sync-service" ];
    environment = {
      OTEL_EXPORTER_OTLP_ENDPOINT = "http://otel-collector:4318";
    };
    command = [
      "sh"
      "-c"
      ''
        printf "LOCAL_API_KEY=%s\nDOCUMENT_PERMISSIONS_SECRET=%s\nSPS_API_SECRET_KEY=%s\nDSS_INTERNAL_AUTH_KEY=%s\n" \
          "$INTERNAL_API_SECRET_KEY" "$DOCUMENT_PERMISSIONS_SECRET" "$INTERNAL_API_SECRET_KEY" "$DSS_INTERNAL_AUTH_KEY" \
          > .dev.vars
        CI=true npx wrangler d1 migrations apply USER_PEER_MAPPING --local --config wrangler.docker.toml
        exec npx wrangler dev --local --ip 0.0.0.0 --port 8787 --config wrangler.docker.toml
      ''
    ];
    networks = {
      services = {
        aliases = [ "sync-service" ];
      };
      databases = { };
    };
    healthcheck = {
      test = [
        "CMD"
        "node"
        "-e"
        "fetch('http://localhost:8787/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
      ];
      interval = "30s";
      timeout = "10s";
      retries = 3;
      start_period = "60s";
    };
  };

  ai_editing_worker = lib.nixImage { ref = lib.nodeBunImage; } {
    working_dir = "/app/services/ai-editing-worker";
    env_file = [ envFile ];
    ports = [ "8933:8933" ];
    volumes = [ "${paths.context}:/app" ];
    depends_on = [ "sync_service" ];
    command = [
      "sh"
      "-c"
      ''
        bun scripts/generate-sandbox.ts && \
        printf "OPENAI_API_KEY=%s\nANTHROPIC_API_KEY=%s\nCEREBRAS_API_KEY=%s\n" \
          "$OPENAI_API_KEY" "$ANTHROPIC_API_KEY" "$CEREBRAS_API_KEY" \
          > .dev.vars && \
        npx wrangler dev --env local --ip 0.0.0.0 --var SYNC_WS_BASE:ws://sync-service:8787
      ''
    ];
    networks = {
      services = {
        aliases = [ "ai-editing-worker" ];
      };
    };
  };

  analytics_proxy = lib.nixImage { ref = lib.nodeBunImage; } {
    working_dir = "/app/services/analytics-proxy";
    env_file = [ envFile ];
    ports = [ "8098:8098" ];
    volumes = [ "${paths.context}:/app" ];
    command = [
      "sh"
      "-c"
      ''
        npx wrangler dev \
          --env local \
          --ip 0.0.0.0 \
          --port 8098 \
          --var OTLP_TRACES_INTAKE_URL:http://otel-collector:4318 \
          --var OTLP_LOGS_INTAKE_URL:http://otel-collector:4318
      ''
    ];
    networks = {
      services = {
        aliases = [ "analytics-proxy" ];
      };
    };
  };

  lexical_service = lib.nixImage { ref = lib.nodeBunImage; } {
    working_dir = "/app/services/lexical-service";
    env_file = [ envFile ];
    ports = [ "8096:8096" ];
    volumes = [ "${paths.context}:/app" ];
    depends_on = [ "sync_service" ];
    command = [
      "sh"
      "-c"
      "bun build src/server.ts --target=bun --external loro-crdt --outfile=/app/server.bundle.js && exec bun /app/server.bundle.js"
    ];
    environment = {
      PORT = "8096";
      SYNC_SERVICE_URL = "http://sync-service:8787";
    };
    networks = {
      services = {
        aliases = [ "lexical-service" ];
      };
    };
    healthcheck = {
      test = [
        "CMD"
        "bun"
        "-e"
        "fetch('http://localhost:8096/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
      ];
      interval = "30s";
      timeout = "10s";
      retries = 3;
      start_period = "10s";
    };
  };
}
