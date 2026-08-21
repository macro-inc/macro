{ lib }:
let
  inherit (lib) paths;
in
{
  db = lib.nixImage lib.images.fusionauth-db {
    environment = {
      PGDATA = "/var/lib/postgresql/data/pgdata";
      POSTGRES_USER = "postgres";
      POSTGRES_PASSWORD = "postgres";
    };
    volumes = [ "db_data:/var/lib/postgresql/data" ];
    networks = [ "auth-internal" ];
    healthcheck = {
      test = [
        "CMD-SHELL"
        "pg_isready -U postgres"
      ];
      interval = "5s";
      timeout = "5s";
      retries = 5;
    };
  };

  fusionauth = lib.nixImage lib.images.fusionauth {
    depends_on = {
      db.condition = "service_healthy";
    };
    environment = {
      DATABASE_URL = "jdbc:postgresql://db:5432/fusionauth";
      DATABASE_ROOT_USERNAME = "postgres";
      DATABASE_ROOT_PASSWORD = "postgres";
      DATABASE_USERNAME = "fusionauth";
      FUSIONAUTH_APP_KICKSTART_FILE = "/usr/local/fusionauth/kickstart/kickstart.json";
      FUSIONAUTH_APP_MEMORY = "512M";
      FUSIONAUTH_APP_RUNTIME_MODE = "development";
      FUSIONAUTH_APP_URL = "http://fusionauth:9011";
    };
    ports = [ "9011:9011" ];
    volumes = [
      "fusionauth_config:/usr/local/fusionauth/config"
      "${paths.fusionauthKickstart}:/usr/local/fusionauth/kickstart"
    ];
    networks = {
      auth-internal = { };
      auth = { };
    };
    healthcheck = {
      test = [
        "CMD-SHELL"
        "curl -s http://localhost:9011/api/status | grep -q '\"status\":\"Ok\"'"
      ];
      interval = "5s";
      timeout = "5s";
      retries = 5;
    };
  };
}
