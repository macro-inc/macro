{
  config,
  lib,
  pkgs,
  ...
}:
let
  backends = import ./backend-config.nix;
  grafanaProvisioning = import ./grafana-provisioning {
    inherit lib;
    # Loopback, so paging does not depend on the ALB.
    goalertUrl = "http://127.0.0.1:3030";
    # The query-only gateway in proxy.nix.
    datasourceUrls = {
      prometheus = "http://127.0.0.1:8081/prometheus";
      loki = "http://127.0.0.1:8081/loki";
      tempo = "http://127.0.0.1:8081/tempo";
    };
  };
  # The store names these folders have always had; renaming one changes the
  # host's system, and a deploy would replace the host for nothing.
  dashboardFolderNames = {
    macro = "macro-grafana-dashboards";
    macro-ci = "macro-ci-dashboard";
    macro-run-local = "macro-run-local-dashboard";
    macro-postgres = "macro-postgres-dashboard";
    macro-postgres-queries = "macro-postgres-queries-dashboard";
    macro-prod-alerts = "macro-prod-alerts-dashboard";
    macro-email-focus = "macro-email-focus-dashboard";
  };
  dashboardProvider =
    {
      name,
      folder,
      files,
    }:
    {
      inherit name folder;
      orgId = 1;
      type = "file";
      disableDeletion = true;
      allowUiUpdates = false;
      options.path = pkgs.linkFarm dashboardFolderNames.${name} (
        map (file: {
          inherit (file) name;
          path = pkgs.writeText file.name (builtins.toJSON file.dashboard);
        }) files
      );
    };
  credential = name: "${name}:/run/macro-observability/${name}";
  needsSecrets = {
    requires = [ "observability-secrets.service" ];
    after = [ "observability-secrets.service" ];
    partOf = [ "observability-secrets.service" ];
  };
in
{
  imports = [ ./goalert.nix ];
  services.grafana = {
    enable = true;
    declarativePlugins = with pkgs.grafanaPlugins; [
      grafana-lokiexplore-app
      grafana-metricsdrilldown-app
      grafana-exploretraces-app
    ];
    dataDir = "/srv/observability/grafana";
    settings = import ./grafana.nix;
    provision = {
      enable = true;
      datasources.settings = grafanaProvisioning.datasources;
      dashboards.settings.providers = map dashboardProvider grafanaProvisioning.dashboards;
      alerting = with grafanaProvisioning.alerting; {
        contactPoints.settings = contactPoints;
        policies.settings = policies;
        rules.settings = rules;
      };
    };
  };
  services.loki = {
    enable = true;
    dataDir = "/srv/observability/loki";
    configuration = backends.loki;
    extraFlags = [ "-config.expand-env=true" ];
  };
  services.tempo = {
    enable = true;
    settings = backends.tempo;
    extraFlags = [ "-config.expand-env=true" ];
  };
  services.prometheus = {
    enable = true;
    listenAddress = "127.0.0.1";
    retentionTime = "30d";
    globalConfig = backends.prometheus.global;
    scrapeConfigs = backends.prometheus.scrape_configs;
    extraFlags = [
      "--storage.tsdb.retention.size=100GB"
      "--web.enable-remote-write-receiver"
      "--enable-feature=exemplar-storage"
    ];
  };
  systemd.services = {
    nginx = needsSecrets // {
      serviceConfig.LoadCredential = [ (credential "metrics.htpasswd") ];
    };
    grafana = needsSecrets // {
      serviceConfig = {
        EnvironmentFile = [
          "/opt/observability/runtime.env"
          # Interpolated into the GoAlert contact points by alerting provisioning.
          "/run/macro-observability/grafana-goalert.env"
        ];
        LoadCredential = map credential [
          "google_client_id"
          "google_client_secret"
          "grafana_secret_key"
        ];
        ReadWritePaths = [ config.services.grafana.dataDir ];
        MemoryMax = "1G";
      };
    };
    loki.serviceConfig = {
      EnvironmentFile = "/opt/observability/runtime.env";
      ReadWritePaths = [ config.services.loki.dataDir ];
      MemoryMax = "4G";
    };
    tempo.serviceConfig = {
      EnvironmentFile = "/opt/observability/runtime.env";
      DynamicUser = lib.mkForce false;
      User = "tempo";
      Group = "tempo";
      WorkingDirectory = lib.mkForce "/srv/observability/tempo";
      StateDirectory = lib.mkForce "";
      ReadWritePaths = [ "/srv/observability/tempo" ];
      MemoryMax = "3G";
    };
    prometheus.serviceConfig = {
      # The upstream module manages /var/lib/prometheus2; keep its whole state
      # directory on retained storage without overriding its generated command.
      BindPaths = [ "/srv/observability/prometheus:/var/lib/${config.services.prometheus.stateDir}" ];
      MemoryMax = "3G";
    };
    alloy-ingest = needsSecrets // {
      description = "Unprivileged OTLP ingress";
      wantedBy = [ "multi-user.target" ];
      serviceConfig = {
        User = "alloy-ingest";
        Group = "alloy-ingest";
        LoadCredential = [ (credential "otlp_token") ];
        ExecStart = "${lib.getExe pkgs.grafana-alloy} run ${pkgs.writeText "ingest.alloy" (builtins.readFile ./ingest.alloy)} --storage.path=/srv/observability/alloy-ingest --server.http.listen-addr=127.0.0.1:12345 --disable-reporting";
        ReadWritePaths = [ "/srv/observability/alloy-ingest" ];
        MemoryMax = "1536M";
        CapabilityBoundingSet = [ "" ];
        PrivateDevices = true;
      };
    };
  };
}
