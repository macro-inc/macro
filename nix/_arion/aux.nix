{ lib }:
let
  inherit (lib) envFile paths;
in
{
  static_file_cdn = lib.pulled "nginx:alpine" {
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

  websocket_service = lib.dockerfile {
    dockerfile = paths.dockerfiles.websocket;
    service = {
      ports = [ "6969:6969" ];
      networks = {
        services = {
          aliases = [ "websocket-service" ];
        };
      };
    };
  };

  sync_service = lib.dockerfile {
    dockerfile = paths.dockerfiles.sync;
    service = {
      env_file = [ envFile ];
      ports = [ "8787:8787" ];
      volumes = [ "${paths.syncSrc}:/app/src" ];
      environment = {
        OTEL_EXPORTER_OTLP_ENDPOINT = "http://otel-collector:4318";
      };
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
  };

  ai_editing_worker = lib.dockerfile {
    dockerfile = paths.dockerfiles.aiEditing;
    service = {
      env_file = [ envFile ];
      ports = [ "8933:8933" ];
      volumes = [ "${paths.context}:/app" ];
      depends_on = [ "sync_service" ];
      networks = {
        services = {
          aliases = [ "ai-editing-worker" ];
        };
      };
    };
  };

  analytics_proxy = lib.dockerfile {
    dockerfile = paths.dockerfiles.analytics;
    service = {
      env_file = [ envFile ];
      ports = [ "8098:8098" ];
      volumes = [ "${paths.context}:/app" ];
      networks = {
        services = {
          aliases = [ "analytics-proxy" ];
        };
      };
    };
  };

  lexical_service = lib.dockerfile {
    dockerfile = paths.dockerfiles.lexical;
    args = {
      GITHUB_PACKAGES_TOKEN = "\${GITHUB_PACKAGES_TOKEN}";
    };
    service = {
      env_file = [ envFile ];
      ports = [ "8096:8096" ];
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
  };
}
