{
  pkgs,
  lib,
  platformLib,
  platformPkgs,
  instance,
  ...
}:
let
  inherit (platformLib) image;
  sh = text: [
    "/bin/sh"
    "-ec"
    text
  ];
  opensearchHome = pkgs.runCommand "opensearch-with-icu" {
    nativeBuildInputs = [ pkgs.unzip ];
    disallowedReferences = [ pkgs.opensearch ];
  } ''
    cp -r ${pkgs.opensearch} $out
    chmod -R u+w $out
    # Local mappings require ICU; omit unrelated bundled ML/SQL plugins.
    rm -rf $out/plugins
    # The original wrappers retain the full plugin distribution. Run the
    # relocated launchers directly and keep their helper paths in this home.
    for program in opensearch opensearch-plugin; do
      rm "$out/bin/$program"
      mv "$out/bin/.$program-wrapped" "$out/bin/$program"
    done
    for program in "$out"/bin/*; do
      if grep -Iq . "$program"; then
        substituteInPlace "$program" --replace-quiet '${pkgs.opensearch}' "$out"
      fi
    done
    mkdir -p $out/plugins/analysis-icu
    unzip -q ${
      pkgs.fetchurl {
        url = "https://artifacts.opensearch.org/releases/plugins/analysis-icu/${pkgs.opensearch.version}/analysis-icu-${pkgs.opensearch.version}.zip";
        hash = "sha256-ZUCg1WsXWcCJ4CRkhFZkeuigLRAcSC9w7Qul88mXMO4=";
      }
    } -d $out/plugins/analysis-icu
  '';

  postgresWorkload =
    {
      name,
      user,
      passwordKey,
      claim,
      main ? false,
    }:
    let
      postgres = if main then platformPkgs.postgres else pkgs.postgresql_16;
      data = if main then "/var/lib/postgresql/18/docker" else "/var/lib/postgresql/pgdata";
      permissions = platformPkgs.utilityImages.volume-permissions;
    in
    {
      image = image {
        inherit name;
        contents = [ postgres ];
        env.LOCALE_ARCHIVE = "${pkgs.glibcLocales}/lib/locale/locale-archive";
        entrypoint = sh ''
          export PGDATA=${data}
          create_database=false
          if [ ! -s "$PGDATA/PG_VERSION" ]; then
            ${
              if main && instance.seeded then
                ''
                  cp -r ${platformPkgs.postgresSeed}/. "$PGDATA/"
                  chmod -R u+w "$PGDATA"
                ''
              else
                ''
                  printf '%s' "$POSTGRES_PASSWORD" > /tmp/password
                  ${postgres}/bin/initdb -D "$PGDATA" -U ${user} --pwfile=/tmp/password --auth-local=trust --auth-host=scram-sha-256 --encoding=UTF8 --locale=en_US.UTF-8
                  rm /tmp/password
                  create_database=${if main then "true" else "false"}
                ''
            }
          fi
          printf 'local all all trust\nhost all all 0.0.0.0/0 scram-sha-256\n' > "$PGDATA/pg_hba.conf"
          chmod 700 "$PGDATA"
          # A Nix libc upgrade can change locale ordering on a persisted volume.
          # Repair affected indexes before this pod accepts network connections.
          ${postgres}/bin/pg_ctl -D "$PGDATA" -o "-c listen_addresses= -k /tmp" -w start >/dev/null
          export PGHOST=/tmp PGUSER=${user}
          ${postgres}/bin/psql -d postgres -v ON_ERROR_STOP=1 -v runtime_password="$POSTGRES_PASSWORD" <<'SQL'
          ALTER ROLE "${user}" PASSWORD :'runtime_password';
          SQL
          if $create_database; then
            ${postgres}/bin/createdb macrodb
          fi
          ${postgres}/bin/psql -d postgres -Atc "SELECT datname FROM pg_database WHERE datallowconn AND datcollversion IS NOT NULL AND pg_database_collation_actual_version(oid) IS NOT NULL AND datcollversion <> pg_database_collation_actual_version(oid)" |
          while IFS= read -r database; do
            ${postgres}/bin/psql --dbname="$database" -v ON_ERROR_STOP=1 -v target="$database" <<'SQL'
          REINDEX DATABASE :"target";
          ALTER DATABASE :"target" REFRESH COLLATION VERSION;
          SQL
          done
          # template0 is pristine, disallows connections and has no user indexes.
          ${postgres}/bin/psql -d postgres -Atc "SELECT format('ALTER DATABASE %I REFRESH COLLATION VERSION;', datname) FROM pg_database WHERE datname = 'template0' AND datcollversion IS NOT NULL AND pg_database_collation_actual_version(oid) IS NOT NULL AND datcollversion <> pg_database_collation_actual_version(oid)" |
            ${postgres}/bin/psql -d postgres -v ON_ERROR_STOP=1
          ${postgres}/bin/pg_ctl -D "$PGDATA" -m fast -w stop >/dev/null
          exec ${postgres}/bin/postgres -D "$PGDATA" -c listen_addresses='*' -c max_connections=500 -c shared_preload_libraries=pg_stat_statements -c unix_socket_directories=/tmp
        '';
      };
      user = 1000;
      env.POSTGRES_PASSWORD.secret = passwordKey;
      terminationGracePeriod = 30;
      lifecycle.preStop.exec.command = [
        "${postgres}/bin/pg_ctl"
        "-D"
        data
        "-m"
        "fast"
        "-w"
        "stop"
      ];
      volumes.data = "/var/lib/postgresql";
      claims.data = claim;
      initContainers.permissions = {
        image = permissions.ref;
        command = sh "mkdir -p ${data}; chown -R 1000:1000 /var/lib/postgresql";
        securityContext = {
          runAsUser = 0;
          runAsGroup = 0;
        };
        volumeMounts = [
          {
            name = "vol-data";
            mountPath = "/var/lib/postgresql";
          }
        ];
      };
      ports = [ 5432 ];
      readiness.exec = [
        "${postgres}/bin/pg_isready"
        "-h"
        "127.0.0.1"
        "-d"
        "postgres"
        "-U"
        user
      ];
      infra = true;
    };
in
{
  postgres = postgresWorkload {
    name = "postgres";
    user = "user";
    passwordKey = "KUBE_POSTGRES_PASSWORD";
    claim = "db";
    main = true;
  };
  db = postgresWorkload {
    name = "fusionauth-postgres";
    user = "postgres";
    passwordKey = "PLATFORM_FUSIONAUTH_DB_ROOT_PASSWORD";
    claim = "db-data";
  };
  redis = {
    image = platformPkgs.upstreamImage "redis" instance.registry;
    ports = [
      6379
      8001
    ];
    volumes.data = "/data";
    claims.data = "cache";
    readiness.tcp = 6379;
    infra = true;
  };
  localstack = {
    image = platformPkgs.localstackImage instance.registry;
    sharedEnv = true;
    env = {
      SERVICES = "s3,sqs,dynamodb,kms,sns,ses";
      EAGER_SERVICE_LOADING = "1";
      LOCALSTACK_HOST = "localstack:4566";
    };
    ports = [ 4566 ];
    readiness.exec = [
      "/bin/sh"
      "-ec"
      ''
        status=$(curl -fsS localhost:4566/_localstack/init/ready)
        printf '%s' "$status" | grep -q '"completed": true'
        printf '%s' "$status" | grep -q '"state": "SUCCESSFUL"'
      ''
    ];
    infra = true;
  };
  kafka = {
    image = platformPkgs.upstreamImage "kafka" instance.registry;
    env = {
      KAFKA_NODE_ID = "1";
      KAFKA_PROCESS_ROLES = "broker,controller";
      KAFKA_CONTROLLER_QUORUM_VOTERS = "1@kafka:29093";
      KAFKA_LISTENERS = "PLAINTEXT://:29092,CONTROLLER://:29093";
      KAFKA_ADVERTISED_LISTENERS = "PLAINTEXT://kafka:29092";
      KAFKA_LISTENER_SECURITY_PROTOCOL_MAP = "CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT";
      KAFKA_INTER_BROKER_LISTENER_NAME = "PLAINTEXT";
      KAFKA_CONTROLLER_LISTENER_NAMES = "CONTROLLER";
      KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR = "1";
      KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR = "1";
      KAFKA_TRANSACTION_STATE_LOG_MIN_ISR = "1";
      KAFKA_LOG_DIRS = "/var/lib/kafka/data";
      KAFKA_HEAP_OPTS = "-Xms256m -Xmx512m";
      CLUSTER_ID = "TWFjcm9Mb2NhbEthZmthMQ";
    };
    ports = [
      29092
      29093
    ];
    publishNotReady = true;
    volumes.data = "/var/lib/kafka/data";
    claims.data = "kafka-data";
    initContainers.permissions = {
      image = platformPkgs.utilityImages.volume-permissions.ref;
      command = sh "chown -R 1000:1000 /var/lib/kafka/data";
      securityContext = {
        runAsUser = 0;
        runAsGroup = 0;
      };
      volumeMounts = [
        {
          name = "vol-data";
          mountPath = "/var/lib/kafka/data";
        }
      ];
    };
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
        # The launcher runs from the read-only home; keep JVM output in /tmp.
        sed -i -e 's|logs/gc.log|/tmp/os/logs/gc.log|' -e 's|HeapDumpPath=data|HeapDumpPath=/tmp|' \
          -e 's|ErrorFile=logs/|ErrorFile=/tmp/os/logs/|' /tmp/os/config/jvm.options
        cat > /tmp/os/config/opensearch.yml <<EOF
        cluster.name: search
        node.name: search
        discovery.type: single-node
        network.host: 0.0.0.0
        path.data: /usr/share/opensearch/data
        path.logs: /tmp/os/logs
        EOF
        export OPENSEARCH_HOME=${opensearchHome} OPENSEARCH_PATH_CONF=/tmp/os/config OPENSEARCH_JAVA_OPTS="-Xms512m -Xmx512m -XX:ActiveProcessorCount=2"
        # jvm.options logs GC to a path relative to the working directory.
        mkdir -p /tmp/os/logs && cd /tmp/os
        exec ${opensearchHome}/bin/opensearch
      '';
    };
    user = 1000;
    ports = [ 9200 ];
    claims.data = "opensearch-data";
    volumes.data = "/usr/share/opensearch/data";
    readiness.http = "/";
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
      contents = [
        platformPkgs.fusionauth
        pkgs.curl
      ];
      entrypoint = sh ''
        set -e
        # Silent configuration runs once at boot and does not retry a refused
        # connection (compose ordered this with depends_on: healthy).
        until nc -z -w 1 db 5432; do sleep 1; done
        src=${platformPkgs.fusionauth}/share/fusionauth
        # /tmp survives container restarts within a pod; start clean.
        rm -rf /tmp/fusionauth && mkdir -p /tmp/fusionauth/logs
        for entry in "$src"/*; do
          case "$(basename "$entry")" in config|logs) ;; *) ln -s "$entry" /tmp/fusionauth/ ;; esac
        done
        # Config lives on the volume, seeded from the package default once.
        mkdir -p /var/lib/fusionauth/config
        if [ -f /var/lib/fusionauth/config/fusionauth.properties ]; then
          # Preserve the database identity in an existing private config.
          unset DATABASE_PASSWORD
        else
          cp "$src/config/fusionauth.properties" /var/lib/fusionauth/config/
        fi
        chmod u+w /var/lib/fusionauth/config/fusionauth.properties
        ln -s /var/lib/fusionauth/config /tmp/fusionauth/config
        # start.sh downloads a JDK unless one sits at java/current.
        mkdir -p /tmp/fusionauth/java/jdk-21.0.4+7
        ln -s ${platformPkgs.fusionauthJdk} /tmp/fusionauth/java/current
        export FUSIONAUTH_BASE=/tmp/fusionauth
        exec ${platformPkgs.fusionauth}/bin/fusionauth
      '';
    };
    initContainers.permissions = {
      image = platformPkgs.utilityImages.volume-permissions.ref;
      command = sh "chown -R 1000:1000 /var/lib/fusionauth/config";
      securityContext = {
        runAsUser = 0;
        runAsGroup = 0;
      };
      volumeMounts = [
        {
          name = "vol-config";
          mountPath = "/var/lib/fusionauth/config";
        }
      ];
    };
    user = 1000;
    env = {
      DATABASE_URL = "jdbc:postgresql://db:5432/fusionauth";
      DATABASE_ROOT_USERNAME = "postgres";
      DATABASE_ROOT_PASSWORD.secret = "PLATFORM_FUSIONAUTH_DB_ROOT_PASSWORD";
      DATABASE_USERNAME = "fusionauth";
      DATABASE_PASSWORD.secret = "PLATFORM_FUSIONAUTH_DB_PASSWORD";
      FUSIONAUTH_APP_KICKSTART_FILE = "/kickstart/kickstart.json";
      FUSIONAUTH_APP_MEMORY = "512M";
      FUSIONAUTH_APP_RUNTIME_MODE = "development";
      FUSIONAUTH_APP_URL = "http://fusionauth:9011";
      FUSIONAUTH_APP_SILENT_MODE = "true";
      SEARCH_TYPE = "database";
    };
    ports = [ 9011 ];
    claims.config = "fusionauth-config";
    volumes.config = "/var/lib/fusionauth/config";
    files.kickstart = {
      secret = "fusionauth-kickstart";
      mountPath = "/kickstart";
    };
    sharedEnv = true;
    readiness.exec = [
      "/bin/sh"
      "-ec"
      ''
        [ "$(curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: $FUSIONAUTH_API_KEY" "http://127.0.0.1:9011/api/application/$FUSIONAUTH_CLIENT_ID")" = 200 ]
      ''
    ];
    infra = true;
  };
}
