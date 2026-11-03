# Every workload in a Macro instance. Names and ports match the hosts the
# code-defined environment (xtask_local's local_env.rs) already uses, so the
# services need no per-platform configuration.
{
  pkgs,
  lib,
  platformLib,
  platformPkgs,
  macro,
}:
let
  inherit (platformLib) image;
  sh = script: [
    "/bin/sh"
    "-c"
    script
  ];

  # Fixed local credentials every AWS-API backend accepts (see
  # macro_aws_config::LOCAL_ACCESS_KEY_ID). ExtendDB requires AWS-shaped keys.
  awsKey = "LOCALMACROSTACKKEY01";
  awsSecret = "localmacrostacksecretlocalmacrostacksec1";

  postgres = pkgs.postgresql_18.withPackages (p: [ p.pgvector ]);

  postgresWorkload =
    {
      user,
      password,
      maxConnections ? 500,
    }:
    {
      image = image {
        name = "postgres";
        contents = [ postgres ];
        entrypoint = sh ''
          set -e
          export PGDATA=/var/lib/postgresql/data/pgdata
          if [ ! -s "$PGDATA/PG_VERSION" ]; then
            echo '${password}' > /tmp/pw
            initdb -D "$PGDATA" -U '${user}' --pwfile=/tmp/pw --auth=scram-sha-256
            echo "host all all 0.0.0.0/0 scram-sha-256" >> "$PGDATA/pg_hba.conf"
          fi
          exec postgres -D "$PGDATA" -c listen_addresses='*' \
            -c max_connections=${toString maxConnections} \
            -c shared_preload_libraries=pg_stat_statements \
            -c unix_socket_directories=/tmp
        '';
      };
      user = 1000;
      ports = [ 5432 ];
      volumes.data = "/var/lib/postgresql/data";
      readiness.exec = [
        "pg_isready"
        "-h"
        "127.0.0.1"
        "-U"
        user
      ];
      infra = true;
    };

  opensearchHome = pkgs.runCommand "opensearch-with-icu" { nativeBuildInputs = [ pkgs.unzip ]; } ''
    cp -r ${pkgs.opensearch} $out
    chmod -R u+w $out
    mkdir -p $out/plugins/analysis-icu
    unzip -q ${
      pkgs.fetchurl {
        url = "https://artifacts.opensearch.org/releases/plugins/analysis-icu/${pkgs.opensearch.version}/analysis-icu-${pkgs.opensearch.version}.zip";
        hash = "sha256-ZUCg1WsXWcCJ4CRkhFZkeuigLRAcSC9w7Qul88mXMO4=";
      }
    } -d $out/plugins/analysis-icu
  '';

  # Routes each AWS API request to its backend by the service the SDK named:
  # X-Amz-Target for the JSON protocols, the SigV4 credential scope otherwise
  # (header or presigned query). The Host header is preserved because it is
  # part of the signature the backend verifies.
  awsGatewayConf = pkgs.writeText "aws-gateway.conf" ''
    daemon off;
    worker_processes 2;
    error_log stderr warn;
    pid /tmp/nginx.pid;
    events { worker_connections 1024; }
    http {
      access_log off;
      client_body_temp_path /tmp/body;
      proxy_temp_path /tmp/proxy;
      client_max_body_size 0;
      proxy_request_buffering off;
      proxy_buffering off;
      map "$http_x_amz_target|$http_authorization|$arg_x_amz_credential" $aws_backend {
        ~^AmazonSQS              elasticmq;
        ~^DynamoDB_              extenddb;
        ~^TrentService           kms;
        ~/sqs/aws4_request       elasticmq;
        ~/dynamodb/aws4_request  extenddb;
        ~/kms/aws4_request       kms;
        default                  s3;
      }
      upstream s3 { server rustfs:9000; }
      upstream elasticmq { server elasticmq:9324; }
      upstream extenddb { server extenddb:18443; }
      upstream kms { server kms:8080; }
      server {
        listen 4566;
        location = /_localstack/health { return 200 '{"services":{}}'; }
        location / {
          proxy_set_header Host $http_host;
          proxy_http_version 1.1;
          proxy_ssl_verify off;
          set $scheme_up http;
          if ($aws_backend = extenddb) { set $scheme_up https; }
          proxy_pass $scheme_up://$aws_backend;
        }
      }
    }
  '';

  rustService =
    {
      bin,
      env ? { },
      ports ? [ 8080 ],
      aliases ? [ ],
      health ? "/health",
      terminationGracePeriod ? 30,
    }:
    {
      image = image {
        name = bin;
        contents = [ macro.binaries.${bin} ];
        entrypoint = [ "/bin/${bin}" ];
      };
      sharedEnv = true;
      env = {
        PORT = "8080";
      } // env;
      inherit ports aliases terminationGracePeriod;
    }
    // lib.optionalAttrs (health != null && ports != [ ]) {
      readiness = {
        http = health;
        port = 8080;
        period = 10;
      };
    };

  inNetwork = {
    gateway = "http://connection-gateway:8080";
    lexical = "http://lexical-service:8096";
    sync = "http://sync-service:8787";
  };
in
{
  # ── Data plane ────────────────────────────────────────────────────────
  postgres = postgresWorkload {
    user = "user";
    password = "password";
  };

  # FusionAuth's own database (`jdbc:postgresql://db:5432/fusionauth`).
  db = postgresWorkload {
    user = "postgres";
    password = "postgres";
    maxConnections = 100;
  };

  redis = {
    image = image {
      name = "valkey";
      contents = [ pkgs.valkey ];
      entrypoint = [
        "valkey-server"
        "--bind"
        "0.0.0.0"
        "--protected-mode"
        "no"
        "--dir"
        "/data"
        "--appendonly"
        "yes"
      ];
    };
    user = 1000;
    ports = [ 6379 ];
    volumes.data = "/data";
    readiness.tcp = 6379;
    infra = true;
  };

  kafka = {
    image = image {
      name = "kafka";
      contents = [ pkgs.apacheKafka ];
      entrypoint = sh ''
        set -e
        cat > /tmp/server.properties <<EOF
        process.roles=broker,controller
        node.id=1
        controller.quorum.voters=1@kafka:29093
        listeners=PLAINTEXT://:29092,CONTROLLER://:29093,HOST://:9092
        advertised.listeners=PLAINTEXT://kafka:29092,HOST://localhost:${toString macro.kafkaHostPort}
        listener.security.protocol.map=PLAINTEXT:PLAINTEXT,CONTROLLER:PLAINTEXT,HOST:PLAINTEXT
        inter.broker.listener.name=PLAINTEXT
        controller.listener.names=CONTROLLER
        log.dirs=/var/lib/kafka/data
        offsets.topic.replication.factor=1
        transaction.state.log.replication.factor=1
        transaction.state.log.min.isr=1
        share.coordinator.state.topic.replication.factor=1
        share.coordinator.state.topic.min.isr=1
        auto.create.topics.enable=true
        EOF
        kafka-storage.sh format --ignore-formatted -t TWFjcm9Mb2NhbEthZmthMQ -c /tmp/server.properties
        exec kafka-server-start.sh /tmp/server.properties
      '';
      env.KAFKA_HEAP_OPTS = "-Xms256m -Xmx768m";
    };
    user = 1000;
    ports = [
      9092
      29092
      29093
    ];
    volumes.data = "/var/lib/kafka/data";
    readiness.tcp = 29092;
    infra = true;
  };

  search = {
    image = image {
      name = "opensearch";
      contents = [ pkgs.jdk21_headless ];
      entrypoint = sh ''
        set -e
        mkdir -p /tmp/os/config
        cp -r ${opensearchHome}/config/. /tmp/os/config/
        chmod -R u+w /tmp/os/config
        cat > /tmp/os/config/opensearch.yml <<EOF
        cluster.name: search
        node.name: search
        discovery.type: single-node
        network.host: 0.0.0.0
        path.data: /usr/share/opensearch/data
        path.logs: /tmp/os/logs
        plugins.security.disabled: true
        EOF
        export OPENSEARCH_PATH_CONF=/tmp/os/config OPENSEARCH_JAVA_OPTS="-Xms512m -Xmx512m"
        exec ${opensearchHome}/bin/opensearch
      '';
    };
    user = 1000;
    ports = [ 9200 ];
    volumes.data = "/usr/share/opensearch/data";
    readiness.http = "/";
    infra = true;
  };

  rustfs = {
    image = image {
      name = "rustfs";
      contents = [ platformPkgs.rustfs ];
      entrypoint = [
        "rustfs"
        "/data"
      ];
      env = {
        RUSTFS_ADDRESS = ":9000";
        RUSTFS_ACCESS_KEY = awsKey;
        RUSTFS_SECRET_KEY = awsSecret;
        RUSTFS_CONSOLE_ENABLE = "false";
      };
    };
    user = 1000;
    ports = [ 9000 ];
    volumes.data = "/data";
    readiness.tcp = 9000;
    infra = true;
  };

  elasticmq = {
    image = image {
      name = "elasticmq";
      contents = [ pkgs.elasticmq-server-bin ];
      entrypoint = sh ''
        cat > /tmp/elasticmq.conf <<EOF
        include classpath("application.conf")
        node-address { protocol = http, host = localstack, port = 4566, context-path = "" }
        rest-sqs { enabled = true, bind-port = 9324, bind-hostname = "0.0.0.0" }
        messages-storage { enabled = true, uri = "jdbc:h2:/data/elasticmq" }
        queues-storage { enabled = true, path = "/data/queues.conf" }
        EOF
        exec elasticmq-server -Dconfig.file=/tmp/elasticmq.conf
      '';
    };
    user = 1000;
    ports = [ 9324 ];
    volumes.data = "/data";
    readiness.tcp = 9324;
    infra = true;
  };

  extenddb = {
    image = image {
      name = "extenddb";
      contents = [ platformPkgs.extenddb ];
      env.HOME = "/var/lib/extenddb";
      entrypoint = sh ''
        set -e
        cd /var/lib/extenddb
        if [ ! -f extenddb.toml ]; then
          extenddb init --pg-host postgres --pg-port 5432 --pg-user user \
            --extenddb-user extenddb --bind-addr 0.0.0.0 --tls-san extenddb \
            --config extenddb.toml > init.log 2>&1 || { cat init.log; exit 1; }
          grep -oE 'Password: [A-Za-z0-9]+' init.log | head -1 | cut -d' ' -f2 > admin-password
        fi
        extenddb serve --config extenddb.toml --foreground &
        until extenddb healthcheck --config extenddb.toml >/dev/null 2>&1; do sleep 1; done
        if [ ! -f provisioned ]; then
          export EXTENDDB_PASSWORD="$(cat admin-password)"
          M="extenddb manage --config extenddb.toml --user admin"
          $M create-account --account-id 000000000000 --account-name local
          $M create-user --account-id 000000000000 --user-name services
          $M import-access-key --yes --account-id 000000000000 --user-name services \
            --access-key-id ${awsKey} --secret-access-key ${awsSecret}
          $M put-user-policy --account-id 000000000000 --user-name services --policy-name all \
            --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":"dynamodb:*","Resource":"*"}]}'
          touch provisioned
        fi
        wait
      '';
    };
    env = {
      EXTENDDB_PG_PASSWORD = "password";
      EXTENDDB_APP_PASSWORD = "extenddb";
    };
    user = 1000;
    ports = [ 18443 ];
    volumes.state = "/var/lib/extenddb";
    readiness.tcp = 18443;
    infra = true;
  };

  kms = {
    image = image {
      name = "local-kms";
      contents = [ platformPkgs.local-kms ];
      entrypoint = [ "local-kms" ];
      env = {
        PORT = "8080";
        KMS_ACCOUNT_ID = "000000000000";
        KMS_REGION = "us-east-1";
        KMS_DATA_PATH = "/data";
      };
    };
    user = 1000;
    ports = [ 8080 ];
    volumes.data = "/data";
    readiness.tcp = 8080;
    infra = true;
  };

  aws-gateway = {
    image = image {
      name = "aws-gateway";
      contents = [ pkgs.nginx ];
      entrypoint = [
        "nginx"
        "-c"
        "${awsGatewayConf}"
      ];
    };
    user = 1000;
    ports = [ 4566 ];
    # The code-defined environment names LocalStack's host.
    aliases = [ "localstack" ];
    readiness.http = "/_localstack/health";
    infra = true;
  };

  mailpit = {
    image = image {
      name = "mailpit";
      contents = [ pkgs.mailpit ];
      entrypoint = [ "mailpit" ];
      env = {
        MP_SMTP_AUTH_ACCEPT_ANY = "1";
        MP_SMTP_AUTH_ALLOW_INSECURE = "1";
        MP_WEBROOT = "/mailpit";
        MP_DATABASE = "/data/mailpit.db";
      };
    };
    user = 1000;
    ports = [
      1025
      8025
    ];
    volumes.data = "/data";
    readiness.tcp = 8025;
    infra = true;
  };

  fusionauth = {
    image = image {
      name = "fusionauth";
      contents = [ platformPkgs.fusionauth ];
      entrypoint = sh ''
        set -e
        src=${platformPkgs.fusionauth}/share/fusionauth
        mkdir -p /tmp/fusionauth
        for entry in "$src"/*; do ln -sfn "$entry" /tmp/fusionauth/; done
        rm -f /tmp/fusionauth/config /tmp/fusionauth/logs
        mkdir -p /tmp/fusionauth/logs
        ln -sfn /var/lib/fusionauth/config /tmp/fusionauth/config
        mkdir -p /var/lib/fusionauth/config
        exec /tmp/fusionauth/fusionauth-app/bin/start.sh
      '';
    };
    user = 1000;
    env = {
      DATABASE_URL = "jdbc:postgresql://db:5432/fusionauth";
      DATABASE_ROOT_USERNAME = "postgres";
      DATABASE_ROOT_PASSWORD = "postgres";
      DATABASE_USERNAME = "fusionauth";
      DATABASE_PASSWORD = "fusionauth";
      FUSIONAUTH_APP_KICKSTART_FILE = "/kickstart/kickstart.json";
      FUSIONAUTH_APP_MEMORY = "512M";
      FUSIONAUTH_APP_RUNTIME_MODE = "development";
      FUSIONAUTH_APP_URL = "http://fusionauth:9011";
      FUSIONAUTH_APP_SILENT_MODE = "true";
      SEARCH_TYPE = "database";
    };
    ports = [ 9011 ];
    volumes.config = "/var/lib/fusionauth/config";
    files.kickstart = {
      secret = "fusionauth-kickstart";
      mountPath = "/kickstart";
    };
    readiness.http = "/api/status";
    infra = true;
  };

  # ── Macro services ────────────────────────────────────────────────────
  authentication-service = rustService { bin = "authentication_service"; };
  connection-gateway = rustService { bin = "connection_gateway_service"; };
  contacts-service = rustService { bin = "contacts_service"; };
  document-storage-service = rustService {
    bin = "document_storage_service";
    env = {
      OVERRIDE_SYNC_SERVICE_URL = inNetwork.sync;
      OVERRIDE_LEXICAL_SERVICE_URL = inNetwork.lexical;
    };
  };
  document-upload-finalizer = rustService {
    bin = "document_upload_finalizer_local_worker";
    ports = [ ];
    env.DOCUMENT_UPLOAD_FINALIZER_QUEUE_URL = "http://localstack:4566/000000000000/document-upload-finalizer-queue";
  };
  email-service = rustService { bin = "email_service"; };
  email-pubsub-workers = rustService {
    bin = "pubsub_workers";
    ports = [ ];
  };
  calendar-service = rustService { bin = "calendar_service"; };
  notification-service = rustService {
    bin = "notification_service";
    env = {
      LAST_ONLINE_REDIS_URI = "redis://redis:6379";
      OVERRIDE_CONNECTION_GATEWAY_URL = inNetwork.gateway;
    };
  };
  search-processing-service = rustService {
    bin = "search_processing_service";
    env.OVERRIDE_LEXICAL_SERVICE_URL = inNetwork.lexical;
  };
  agent-harness-service = rustService {
    bin = "agent_harness_service";
    ports = [
      8080
      8102
      8111
      2222
    ];
    env = {
      OVERRIDE_CONNECTION_GATEWAY_URL = inNetwork.gateway;
      OVERRIDE_LEXICAL_SERVICE_URL = inNetwork.lexical;
      OVERRIDE_SYNC_SERVICE_URL = inNetwork.sync;
    };
  };
  whatsapp-session-service = rustService {
    bin = "whatsapp_session_service";
    ports = [ 8080 ];
    terminationGracePeriod = 120;
  };
  static-file-service = rustService {
    bin = "static_file_service";
    health = "/api/health";
  };
  unfurl-service = rustService { bin = "unfurl_service"; };
  image-proxy-service = rustService { bin = "image_proxy_service"; };

  # ── Edge: the instance's single origin (routes, CORS, static frontend) ──
  edge = {
    image = image {
      name = "edge";
      contents = [ pkgs.caddy ];
      entrypoint = [
        "caddy"
        "run"
        "--adapter"
        "caddyfile"
        "--config"
        "${macro.caddyfile}"
      ];
      env = {
        XDG_DATA_HOME = "/tmp";
        XDG_CONFIG_HOME = "/tmp";
        MACRO_FRONTEND = "${macro.frontend}";
      };
    };
    user = 1000;
    ports = [ 8080 ];
    readiness.tcp = 8080;
  };
}
