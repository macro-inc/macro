# GoAlert on-call paging, its Postgres, and the Macro Alerts relay.
#
# Everything here runs in Ohio and talks only to loopback, so paging keeps
# working while production or its database is down. Pages reach the Macro
# Alerts channel through the relay; phone paging (Twilio) is not set up yet.
{
  config,
  lib,
  pkgs,
  ...
}:
let
  goalert = pkgs.callPackage ./goalert/package.nix { };
  credential = name: "${name}:/run/macro-observability/${name}";
  needsSecrets = {
    requires = [ "observability-secrets.service" ];
    after = [ "observability-secrets.service" ];
    partOf = [ "observability-secrets.service" ];
  };
  relayUrl = "http://127.0.0.1:8090/goalert";
  # GoAlert's config.Config, applied with `goalert set-config` before every
  # start. `@name@` strings are replaced with the credential of that name.
  goalertConfig = {
    General.ApplicationName = "Macro On-Call";
    # Google login, with Grafana's OAuth client. GoAlert cannot restrict OIDC
    # logins to a domain; the client's Internal audience keeps them to Workspace
    # accounts. Basic auth stays on for the break-glass `admin` login, created
    # by apply-config.py from goalert_admin_password.
    Auth.DisableBasic = false;
    OIDC = {
      Enable = true;
      NewUsers = true;
      OverrideName = "Google";
      IssuerURL = "https://accounts.google.com";
      ClientID = "@google_client_id@";
      ClientSecret = "@google_client_secret@";
      Scopes = "openid profile email";
    };
    Webhook = {
      Enable = true;
      AllowedURLs = [ relayUrl ];
    };
    Maintenance = {
      AlertCleanupDays = 180;
      AlertAutoCloseDays = 0;
    };
  };
  dbUrl = "postgres://goalert@/goalert?host=/run/postgresql&sslmode=disable";
  goalertEnvironment = {
    GOALERT_DB_URL = dbUrl;
    GOALERT_LISTEN = "127.0.0.1:3030";
    GOMEMLIMIT = "600MiB";
  };
  # The encryption key only ever lives in this process's environment.
  start = pkgs.writeShellScript "goalert-start" ''
    GOALERT_DATA_ENCRYPTION_KEY="$(< "$CREDENTIALS_DIRECTORY/goalert_encryption_key")"
    export GOALERT_DATA_ENCRYPTION_KEY
    exec ${lib.getExe goalert}
  '';
  backup = pkgs.writeShellScript "goalert-backup" ''
    set -euo pipefail
    # Dump to a file first, so a failed dump never replaces a good backup.
    dump="$(mktemp)"
    ${config.services.postgresql.package}/bin/pg_dump --format=custom --file="$dump" goalert
    # One object per weekday keeps a rolling week without a lifecycle rule on
    # a bucket whose retention Loki owns.
    ${lib.getExe pkgs.awscli2} s3 cp --only-show-errors "$dump" \
      "s3://$LOGS_BUCKET/goalert/goalert-$(date +%a).dump"
  '';
in
{
  services.postgresql = {
    enable = true;
    package = pkgs.postgresql_17;
    dataDir = "/srv/observability/postgres";
    enableTCPIP = false;
    settings.listen_addresses = lib.mkForce "";
    ensureDatabases = [ "goalert" ];
    ensureUsers = [
      {
        name = "goalert";
        ensureDBOwnership = true;
      }
    ];
  };

  systemd.services = {
    postgresql = {
      serviceConfig.MemoryMax = "512M";
      # Like the other services, retry forever instead of the module's limit.
      unitConfig.StartLimitIntervalSec = lib.mkForce 0;
    };

    goalert = needsSecrets // {
      description = "GoAlert on-call paging";
      wantedBy = [ "multi-user.target" ];
      requires = needsSecrets.requires ++ [ "postgresql.target" ];
      after = needsSecrets.after ++ [ "postgresql.target" ];
      environment = goalertEnvironment;
      serviceConfig = {
        User = "goalert";
        Group = "goalert";
        EnvironmentFile = "/opt/observability/runtime.env";
        LoadCredential = map credential [
          "goalert_encryption_key"
          "goalert_admin_password"
          "google_client_id"
          "google_client_secret"
        ];
        ExecStartPre = [
          "${pkgs.python3}/bin/python3 ${./goalert/apply-config.py} ${lib.getExe goalert} ${pkgs.writeText "goalert-config.json" (builtins.toJSON goalertConfig)} ${config.services.postgresql.package}/bin/psql ${./goalert/workspace-admins.sql}"
        ];
        ExecStart = start;
        MemoryMax = "768M";
        CapabilityBoundingSet = [ "" ];
        PrivateDevices = true;
      };
    };

    macro-alerts-relay = needsSecrets // {
      description = "Forward GoAlert notifications to Macro Alerts";
      wantedBy = [ "multi-user.target" ];
      serviceConfig = {
        DynamicUser = true;
        LoadCredential = map credential [
          "macro_alerts_webhook_url"
          "macro_alerts_bot_token"
        ];
        ExecStart = "${pkgs.python3}/bin/python3 ${./goalert/macro-alerts-relay.py}";
        MemoryMax = "128M";
        CapabilityBoundingSet = [ "" ];
        PrivateDevices = true;
      };
    };

    goalert-backup = {
      description = "Dump the GoAlert database to S3";
      requires = [ "postgresql.target" ];
      after = [ "postgresql.target" ];
      serviceConfig = {
        Type = "oneshot";
        User = "goalert";
        Group = "goalert";
        EnvironmentFile = "/opt/observability/runtime.env";
        ExecStart = backup;
        PrivateTmp = true;
        ProtectSystem = "strict";
        ProtectHome = true;
        NoNewPrivileges = true;
        # The AWS CLI writes its cache under HOME.
        Environment = "HOME=/tmp";
      };
    };
  };

  systemd.timers.goalert-backup = {
    wantedBy = [ "timers.target" ];
    timerConfig = {
      OnCalendar = "*-*-* 05:00:00";
      Persistent = true;
    };
  };
}
