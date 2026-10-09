{
  config,
  lib,
  pkgs,
  ...
}:
let
  backends = import ./backend-config.nix;
  credential = name: "${name}:/run/macro-observability/${name}";
  needsSecrets = {
    requires = [ "observability-secrets.service" ];
    after = [ "observability-secrets.service" ];
    partOf = [ "observability-secrets.service" ];
  };
in
{
  services.grafana = {
    enable = true;
    dataDir = "/srv/observability/grafana";
    settings = import ./grafana.nix;
    provision = {
      enable = true;
      datasources.settings = import ./datasources.nix;
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
    ];
  };
  systemd.services = {
    grafana = needsSecrets // {
      serviceConfig = {
        EnvironmentFile = "/opt/observability/runtime.env";
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
        ExecStart = "${lib.getExe pkgs.grafana-alloy} run ${pkgs.writeText "ingest.alloy" (import ./ingest-alloy.nix)} --storage.path=/srv/observability/alloy-ingest --server.http.listen-addr=127.0.0.1:12345 --disable-reporting";
        ReadWritePaths = [ "/srv/observability/alloy-ingest" ];
        MemoryMax = "1536M";
        CapabilityBoundingSet = [ "" ];
        PrivateDevices = true;
      };
    };
  };
}
