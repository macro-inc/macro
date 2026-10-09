let
  common = {
    # systemd owns boot/daemon recovery and fetches secrets before startup.
    restart = "on-failure";
    stop_grace_period = "60s";
    read_only = true;
    cap_drop = [
      "ALL"
    ];
    security_opt = [
      "no-new-privileges:true"
    ];
    tmpfs = [
      "/tmp:rw,noexec,nosuid,size=128m"
    ];
    logging = {
      driver = "local";
      options = {
        max-size = "10m";
        max-file = "3";
      };
    };
  };
in
{
  name = "macro-observability";
  services = {
    grafana = common // {
      image = "grafana/grafana:13.2.3@sha256:b28bae15e219c998fb0e0424ed724930cc61b1f61fb404d47c862f9a23f9e572";
      user = "472:472";
      group_add = [
        "10001"
      ];
      mem_limit = "1g";
      environment = {
        GRAFANA_HOST = "@@GRAFANA_HOST@@";
        GRAFANA_ROOT_URL = "https://@@GRAFANA_HOST@@/";
        GRAFANA_ROLE_EXPRESSION = "@@ROLE_EXPRESSION@@";
      };
      volumes = [
        "./grafana.ini:/etc/grafana/grafana.ini:ro"
        "./datasources.yaml:/etc/grafana/provisioning/datasources/main.yaml:ro"
        "/srv/observability/grafana:/var/lib/grafana"
        "/run/macro-observability/google_client_id:/run/secrets/google_client_id:ro"
        "/run/macro-observability/google_client_secret:/run/secrets/google_client_secret:ro"
        "/run/macro-observability/grafana_secret_key:/run/secrets/grafana_secret_key:ro"
      ];
    };
    loki = common // {
      image = "grafana/loki:3.7.8@sha256:1107dd5274e0ada47e42472b7a7e71f3b2a2fe878878108f3e2f9e51528f0193";
      user = "10001:10001";
      mem_limit = "4g";
      ports = [ "127.0.0.1:3100:3100" ];
      command = [
        "-config.file=/etc/loki/config.yaml"
      ];
      volumes = [
        "./loki.yaml:/etc/loki/config.yaml:ro"
        "/srv/observability/loki:/var/lib/loki"
      ];
    };
    # The maintained 2.x line supports a single process without Kafka.
    tempo = common // {
      image = "grafana/tempo:2.10.8@sha256:f0561deb1c68ec44d6e6e7e4487f30106c4e5e768642077695b37958b105812a";
      user = "10001:10001";
      mem_limit = "3g";
      command = [
        "-config.file=/etc/tempo/config.yaml"
      ];
      volumes = [
        "./tempo.yaml:/etc/tempo/config.yaml:ro"
        "/srv/observability/tempo:/var/lib/tempo"
      ];
    };
    prometheus = common // {
      ports = [ "127.0.0.1:9090:9090" ];
      image = "prom/prometheus:v3.15.0@sha256:efd719c99d83b060d9daefdcf00360461adf279f45ef5391f8d111892118753e";
      user = "65534:65534";
      mem_limit = "3g";
      command = [
        "--config.file=/etc/prometheus/prometheus.yaml"
        "--storage.tsdb.path=/prometheus"
        "--storage.tsdb.retention.time=30d"
        "--storage.tsdb.retention.size=100GB"
        "--web.enable-remote-write-receiver"
      ];
      volumes = [
        "./prometheus.yaml:/etc/prometheus/prometheus.yaml:ro"
        "/srv/observability/prometheus:/prometheus"
      ];
    };
    alloy = common // {
      image = "grafana/alloy:v1.20.1@sha256:2aa2099af76c0098d4af7a4d6e48f86cb66dc1a000222ad927a1c67c6542d13f";
      user = "10001:10001";
      mem_limit = "1536m";
      command = [
        "run"
        "--storage.path=/var/lib/alloy"
        "--server.http.listen-addr=0.0.0.0:12345"
        "/etc/alloy/config.alloy"
      ];
      volumes = [
        "./config.alloy:/etc/alloy/config.alloy:ro"
        "/srv/observability/alloy:/var/lib/alloy"
        "/run/macro-observability/otlp_token:/run/secrets/otlp_token:ro"
      ];
    };
    proxy = common // {
      image = "nginx:1.30.5-alpine@sha256:0985e772fb9f729e6fa0980da05fca5d9c468e870eed43071545afa9d2e27d94";
      user = "101:101";
      mem_limit = "256m";
      entrypoint = [
        "nginx"
        "-g"
        "daemon off;"
      ];
      ports = [
        "8080:8080"
      ];
      volumes = [
        "./nginx.conf:/etc/nginx/nginx.conf:ro"
      ];
    };
  };
}
