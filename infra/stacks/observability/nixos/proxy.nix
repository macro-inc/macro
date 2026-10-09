{ ... }:
let
  deny = {
    extraConfig = "return 404;";
  };
  websocketHeaders = ''
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
  '';
  queryLocation = backend: methods: {
    proxyPass = "http://${backend}";
    extraConfig = ''
      limit_except ${methods} { deny all; }
      rewrite ^/[^/]+(/.*)$ $1 break;
    '';
  };
in
{
  services.nginx = {
    enable = true;
    # Hostnames arrive through validated EC2 metadata. The native unit runs
    # nginx -t after bootstrap has written this runtime include.
    validateConfigFile = false;
    clientMaxBodySize = "8m";
    commonHttpConfig = ''
      include /opt/observability/hosts.conf;
      log_format safe '$remote_addr $host $request_method $uri $status';
      access_log syslog:server=unix:/dev/log,facility=local7,tag=nginx_access,severity=info safe;
      limit_req_zone $server_name zone=ingest:1m rate=100r/s;
      map $http_upgrade $connection_upgrade { default upgrade; ''' close; }
    '';
    virtualHosts.public = {
      listen = [
        {
          addr = "0.0.0.0";
          port = 8080;
        }
      ];
      default = true;
      serverName = "_";
      extraConfig = "add_header Strict-Transport-Security 'max-age=31536000' always;";
      locations = {
        "= /healthz" = {
          proxyPass = "http://127.0.0.1:3000/api/health";
          extraConfig = "access_log off; proxy_set_header Host $grafana_host;";
        };
        "/" = {
          proxyPass = "http://127.0.0.1:3000";
          extraConfig = ''
            if ($observability_host != grafana) { return 404; }
            proxy_set_header Host $host;
            proxy_set_header X-Forwarded-Proto https;
            proxy_set_header X-Forwarded-For $remote_addr;
            ${websocketHeaders}
          '';
        };
        "~ ^/v1/(traces|logs|metrics)$" = {
          proxyPass = "http://127.0.0.1:4318";
          extraConfig = ''
            if ($observability_host != otlp) { return 404; }
            limit_except POST { deny all; }
            limit_req zone=ingest burst=200 nodelay;
            limit_req_status 429;
            proxy_read_timeout 30s;
          '';
        };
      };
    };
    # Grafana Viewers can choose arbitrary datasource proxy paths. Allow query
    # endpoints only, including protection against maintenance APIs using GET.
    virtualHosts.queries = {
      listen = [
        {
          addr = "127.0.0.1";
          port = 8081;
        }
      ];
      serverName = "_";
      locations = {
        "~ ^/prometheus/api/v1/(query|query_range|query_exemplars|series|labels|label/[^/]+/values)$" =
          queryLocation "127.0.0.1:9090" "GET POST";
        "~ ^/prometheus/api/v1/(metadata|status/buildinfo|status/config|rules|alerts|targets|targets/metadata)$" =
          queryLocation "127.0.0.1:9090" "GET";
        "~ ^/loki/loki/api/v1/(query|query_range)$" = queryLocation "127.0.0.1:3100" "GET POST";
        "~ ^/loki/loki/api/v1/(labels|label/[^/]+/values|series|index/stats|index/volume|index/volume_range|patterns|tail|status/buildinfo|format_query|detected_fields|detected_labels|detected_field/[^/]+/values)$" =
          let
            location = queryLocation "127.0.0.1:3100" "GET";
          in
          location // { extraConfig = location.extraConfig + websocketHeaders; };
        "~ ^/tempo/api/(echo|search|search/tags|search/tag/[^/]+/values|traces/[a-fA-F0-9]+|v2/traces/[a-fA-F0-9]+|v2/search/tags|v2/search/tag/[^/]+/values|metrics/query|metrics/query_range|status/buildinfo)$" =
          queryLocation "127.0.0.1:3200" "GET";
        "/" = deny;
      };
    };
  };
  systemd.services.nginx.serviceConfig.MemoryMax = "256M";
}
