# Local Postgres images built from Nixpkgs postgresql + pgvector.
#
# `macro-local-postgres` is the app database (user/password, pgvector).
# `macro-local-fusionauth-db` is FusionAuth's companion Postgres 16.
{
  pkgs,
}:
let
  inherit (pkgs) lib;
  imageLib = pkgs.callPackage ./image-lib.nix { };

  mkPostgres =
    {
      name,
      postgresql,
    }:
    let
      entrypoint = pkgs.writeShellScriptBin "postgres-entrypoint" ''
        set -euo pipefail
        export LOCALE_ARCHIVE=${pkgs.glibcLocales}/lib/locale/locale-archive
        PGDATA="''${PGDATA:-/var/lib/postgresql/data}"
        USER_NAME="''${POSTGRES_USER:-postgres}"
        PASSWORD="''${POSTGRES_PASSWORD:-postgres}"
        DB_NAME="''${POSTGRES_DB:-}"
        mkdir -p "$PGDATA" /run/postgresql
        chown -R postgres:postgres "$(dirname "$PGDATA")" /run/postgresql || true
        chown -R postgres:postgres "$PGDATA" /run/postgresql
        chmod 700 "$PGDATA" || true
        if [ ! -s "$PGDATA/PG_VERSION" ]; then
          pwfile=$(mktemp)
          printf '%s\n' "$PASSWORD" > "$pwfile"
          chown postgres:postgres "$pwfile"
          ${pkgs.gosu}/bin/gosu postgres ${postgresql}/bin/initdb \
            --username="$USER_NAME" \
            --pwfile="$pwfile" \
            --auth-host=scram-sha-256 \
            --auth-local=trust \
            -D "$PGDATA"
          rm -f "$pwfile"
          {
            echo "listen_addresses = '*'"
            echo "max_connections = 500"
          } >> "$PGDATA/postgresql.conf"
          echo "host all all 0.0.0.0/0 scram-sha-256" >> "$PGDATA/pg_hba.conf"
          echo "host all all ::/0 scram-sha-256" >> "$PGDATA/pg_hba.conf"
          if [ "$USER_NAME" != "postgres" ]; then
            echo "CREATE DATABASE \"''${USER_NAME}\";" \
              | ${pkgs.gosu}/bin/gosu postgres ${postgresql}/bin/postgres --single -D "$PGDATA" postgres
          fi
          if [ -n "$DB_NAME" ] && [ "$DB_NAME" != "$USER_NAME" ]; then
            echo "CREATE DATABASE \"''${DB_NAME}\";" \
              | ${pkgs.gosu}/bin/gosu postgres ${postgresql}/bin/postgres --single -D "$PGDATA" postgres
          fi
        fi
        exec ${pkgs.gosu}/bin/gosu postgres ${postgresql}/bin/postgres -D "$PGDATA" "$@"
      '';
    in
    imageLib.mk {
      inherit name;
      extraContents = [
        postgresql
        pkgs.gosu
        pkgs.glibcLocales
        entrypoint
      ];
      extraPath = [
        postgresql
        pkgs.gosu
      ];
      extraEnv = [
        "LOCALE_ARCHIVE=${pkgs.glibcLocales}/lib/locale/locale-archive"
        "LANG=C.UTF-8"
      ];
      extraCommands = ''
        ${imageLib.writablePasswd}
        echo 'postgres:x:999:999:postgres:/var/lib/postgresql:/bin/sh' >> ./etc/passwd
        echo 'postgres:x:999:' >> ./etc/group
        mkdir -p ./var/lib/postgresql ./run/postgresql
        chown 999:999 ./var/lib/postgresql ./run/postgresql || true
      '';
      config = {
        Cmd = [ "${entrypoint}/bin/postgres-entrypoint" ];
        ExposedPorts = {
          "5432/tcp" = { };
        };
        Volumes = {
          "/var/lib/postgresql" = { };
        };
      };
    };

  pgvector = pkgs.postgresql_18.withPackages (ps: [ ps.pgvector ]);
in
{
  postgres = mkPostgres {
    name = "macro-local-postgres";
    postgresql = pgvector;
  };
  fusionauthDb = mkPostgres {
    name = "macro-local-fusionauth-db";
    postgresql = pkgs.postgresql_16;
  };
}
