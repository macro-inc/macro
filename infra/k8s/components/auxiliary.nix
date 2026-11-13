{
  pkgs,
  lib,
  platformLib,
  platformPkgs,
  instance,
  frontend,
  ...
}:
let
  inherit (platformLib) image;
  sh = script: [
    "/bin/sh"
    "-ec"
    script
  ];
  caddyfile = pkgs.writeText "Caddyfile" ''
    {
      auto_https disable_redirects
      admin off
    }
    :8443 {
      tls /tls/tls.crt /tls/tls.key
      ${lib.optionalString instance.telemetry ''
        handle /traces* {
          reverse_proxy otel-collector:3000
        }
      ''}
      @preflight method OPTIONS
      handle @preflight {
        header Access-Control-Allow-Origin "{http.request.header.Origin}"
        header Access-Control-Allow-Credentials true
        header Access-Control-Allow-Methods "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS"
        header Access-Control-Allow-Headers "{http.request.header.Access-Control-Request-Headers}"
        respond 204
      }
      ${lib.concatMapStringsSep "\n"
        (route: ''
          @${route.path} path /${route.path} /${route.path}/*
          handle @${route.path} {
            uri strip_prefix /${route.path}
            reverse_proxy ${route.service}:${toString (route.port or 8080)}
          }
        '')
        [
          {
            path = "auth";
            service = "authentication-service";
          }
          {
            path = "connection-gateway";
            service = "connection-gateway";
          }
          {
            path = "contacts";
            service = "contacts-service";
          }
          {
            path = "dss";
            service = "document-storage-service";
          }
          {
            path = "email";
            service = "email-service";
          }
          {
            path = "calendar";
            service = "calendar-service";
          }
          {
            path = "notification";
            service = "notification-service";
          }
          {
            path = "unfurl";
            service = "unfurl-service";
          }
          {
            path = "image-proxy";
            service = "image-proxy-service";
          }
          {
            path = "agent-harness";
            service = "agent-harness-service";
          }
          {
            path = "websocket";
            service = "websocket-service";
            port = 6969;
          }
          {
            path = "lexical";
            service = "lexical-service";
            port = 8096;
          }
          {
            path = "ai-editing";
            service = "ai-editing-worker";
            port = 8933;
          }
          {
            path = "local-storage";
            service = "localstack";
            port = 4566;
          }
        ]
      }
      @agent path /mcp /mcp/* /cognition /cognition/* /scheduled-action /scheduled-action/* /preview /preview/*
      handle @agent {
        reverse_proxy agent-harness-service:8080
      }
      @sync path /sync /sync/*
      handle @sync {
        uri strip_prefix /sync
        reverse_proxy sync-service:8787 {
          header_up Origin http://localhost:3000
        }
      }
      handle /i/* {
        reverse_proxy analytics-proxy:8098 {
          header_up CF-Connecting-IP {http.request.remote.host}
        }
      }
      handle /mailpit/* {
        reverse_proxy mailpit:8025
      }
      redir /mailpit /mailpit/ 308
      handle_path /static-file/* {
        route {
          @service path /api/* /internal/*
          reverse_proxy @service static-file-service:8080
          rewrite * /static-file-storage{uri}
          reverse_proxy localstack:4566
        }
      }
      redir / "/app/?{query}" 302
      redir /app /app/ 308
      handle_path /app/* {
        root * ${frontend}
        try_files {path} /index.html
        file_server
      }
    }
  '';
  worker = name: port: script: {
    image = image {
      inherit name;
      contents = [
        pkgs.wrangler
        pkgs.bun
        pkgs.nodejs
      ];
      env = {
        HOME = "/tmp";
        WRANGLER_SEND_METRICS = "false";
        CI = "true";
      };
      entrypoint = sh ''
        rm -rf /tmp/source
        mkdir -p /tmp/source/services
        ln -s ${platformPkgs.workspace}/node_modules /tmp/source/node_modules
        ln -s ${platformPkgs.workspace}/packages /tmp/source/packages
        cp ${platformPkgs.workspace}/package.json /tmp/source/
        cp -r ${platformPkgs.workspace}/services/${name} /tmp/source/services/${name}
        chmod -R u+w /tmp/source/services/${name}
        cd /tmp/source/services/${name}
        ln -s /state .wrangler
        ${script}
      '';
    };
    sharedEnv = true;
    ports = [ port ];
    volumes.state = "/state";
    claims.state = "${name}-wrangler";
    readiness.tcp = port;
  };
  cdnConfig = pkgs.writeText "nginx.conf" ''
    pid /tmp/nginx.pid;
    error_log stderr warn;
    events { worker_connections 1024; }
    http {
      access_log off;
      client_body_temp_path /tmp/body;
      proxy_temp_path /tmp/proxy;
      ${builtins.replaceStrings [ "static_file_service" ] [ "static-file-service" ] (
        builtins.readFile ../../../infra/local/nginx/static-file-cdn.conf
      )}
    }
  '';
  sshConfig = pkgs.writeText "sshd_config" ''
    Port 22
    HostKey /tmp/ssh_host_ed25519_key
    PermitRootLogin no
    PasswordAuthentication no
    KbdInteractiveAuthentication no
    PubkeyAuthentication yes
    StrictModes no
    AuthorizedKeysFile /keys/%u
    AllowTcpForwarding remote
    GatewayPorts clientspecified
    PidFile /tmp/sshd.pid
    UsePAM no
  '';
  sshAccounts = pkgs.runCommand "sdk-webhook-account" { } ''
    mkdir -p $out/etc
    printf '%s\n' 'root:x:0:0::/root:/bin/sh' 'app:x:1000:1000::/tmp:/bin/sh' 'nobody:x:65534:65534::/nonexistent:/bin/sh' 'sdk-webhook:x:1000:1000::/tmp:/bin/sh' 'sshd:x:1002:1002::/var/empty:/bin/false' > $out/etc/passwd
    echo 'sdk-webhook::1::::::' > $out/etc/shadow
  '';
in
{
  proxy = {
    image = image {
      name = "frontend";
      contents = [ pkgs.caddy ];
      entrypoint = [
        "caddy"
        "run"
        "--adapter"
        "caddyfile"
        "--config"
        (toString caddyfile)
      ];
      env = {
        XDG_DATA_HOME = "/tmp";
        XDG_CONFIG_HOME = "/tmp";
      };
    };
    ports = [ 8443 ];
    files.tls = {
      secret = "macro-tls";
      mountPath = "/tls";
    };
    readiness.tcp = 8443;
  };
  lexical-service = {
    image = image {
      name = "lexical";
      contents = [ pkgs.bun ];
      entrypoint = [
        "bun"
        "${platformPkgs.lexical}/server.js"
      ];
    };
    sharedEnv = true;
    env = {
      PORT = "8096";
      INTERNAL_AUTH_KEY.secret = "INTERNAL_API_SECRET_KEY";
      SYNC_SERVICE_AUTH_KEY.secret = "INTERNAL_API_SECRET_KEY";
      SYNC_SERVICE_URL = "http://sync-service:8787";
    };
    ports = [ 8096 ];
    readiness.http = "/health";
  };
  websocket-service = {
    image = image {
      name = "websocket";
      contents = [ pkgs.bun ];
      entrypoint = [
        "bun"
        "${platformPkgs.websocket}/server.js"
      ];
    };
    ports = [ 6969 ];
    readiness.tcp = 6969;
  };
  analytics-proxy = worker "analytics-proxy" 8098 ''
    exec wrangler dev --local --env local --ip 0.0.0.0 --port 8098 --var OTLP_TRACES_INTAKE_URL:${
      if instance.telemetry then "http://otel-collector:4318" else "http://127.0.0.1:4318"
    } --var OTLP_LOGS_INTAKE_URL:${
      if instance.telemetry then "http://otel-collector:4318" else "http://127.0.0.1:4318"
    }
  '';
  ai-editing-worker = worker "ai-editing-worker" 8933 ''
    bun scripts/generate-sandbox.ts
    printf 'OPENAI_API_KEY=%s\nANTHROPIC_API_KEY=%s\nCEREBRAS_API_KEY=%s\n' "$OPENAI_API_KEY" "$ANTHROPIC_API_KEY" "$CEREBRAS_API_KEY" > .dev.vars
    printf 'OTEL_EXPORTER_OTLP_ENDPOINT=%s\n' '${
      if instance.telemetry then "http://otel-collector:4318/v1/traces" else ""
    }' >> .dev.vars
    exec wrangler dev --local --env local --ip 0.0.0.0 --port 8933 --var SYNC_WS_BASE:ws://sync-service:8787
  '';
  sync-service = {
    image = image {
      name = "sync-service";
      contents = [
        pkgs.wrangler
        pkgs.nodejs
      ];
      env = {
        HOME = "/tmp";
        WRANGLER_SEND_METRICS = "false";
        CI = "true";
      };
      entrypoint = sh ''
        rm -rf /tmp/sync
        cp -r ${platformPkgs.sync} /tmp/sync
        chmod -R u+w /tmp/sync
        cd /tmp/sync
        mkdir .wrangler
        ln -s /state .wrangler/state
        printf 'LOCAL_API_KEY=%s\nDOCUMENT_PERMISSIONS_SECRET=%s\nSPS_API_SECRET_KEY=%s\nDSS_INTERNAL_AUTH_KEY=%s\nLEXICAL_SERVICE_AUTH_KEY=%s\n' "$INTERNAL_API_SECRET_KEY" "$DOCUMENT_PERMISSION_JWT" "$INTERNAL_API_SECRET_KEY" "$DOCUMENT_STORAGE_SERVICE_AUTH_KEY" "$INTERNAL_API_SECRET_KEY" > .dev.vars
        printf 'OTEL_EXPORTER_OTLP_ENDPOINT=%s\n' '${
          if instance.telemetry then "http://otel-collector:4318" else ""
        }' >> .dev.vars
        wrangler d1 migrations apply USER_PEER_MAPPING --local --config wrangler.toml
        exec wrangler dev --local --ip 0.0.0.0 --port 8787 --config wrangler.toml
      '';
    };
    sharedEnv = true;
    ports = [ 8787 ];
    volumes.state = "/state";
    claims.state = "sync-state";
    readiness.http = "/health";
  };
  sdk-webhook-relay = {
    image = image {
      name = "sdk-webhook-relay";
      contents = [ pkgs.openssh ];
      extraRoot = [ sshAccounts ];
      entrypoint = sh ''
        if [ ! -f /tmp/ssh_host_ed25519_key ]; then
          ssh-keygen -q -t ed25519 -N "" -f /tmp/ssh_host_ed25519_key
        fi
        mkdir -p /run/sshd /var/empty
        exec ${pkgs.openssh}/bin/sshd -D -e -f ${sshConfig}
      '';
    };
    ports = [ 22 ];
    files.keys = {
      secret = "sdk-webhook-keys";
      mountPath = "/keys";
    };
    readiness.tcp = 22;
  };
  static-file-cdn = {
    image = image {
      name = "static-file-cdn";
      contents = [ pkgs.nginx ];
      entrypoint = [
        "nginx"
        "-e"
        "stderr"
        "-c"
        (toString cdnConfig)
        "-g"
        "daemon off;"
      ];
    };
    ports = [ 80 ];
    readiness.tcp = 80;
  };
}
