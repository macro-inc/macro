# The two nginx front doors, ported from the full host's nginx
# (infra/stacks/observability/nixos/proxy.nix before it served only GoAlert):
#
# - `edge`: the only target of the existing ALB (TargetGroupBinding, IP
#   targets). Grafana and Argo CD by hostname, POST-only OTLP to Alloy ingest, and
#   basic-auth Prometheus remote write and Loki push, rate limited. The
#   ALB is enabled in only two zones and sends nothing to a target outside
#   them, so the edge runs only there.
# - `query-gateway`: Grafana's datasources go through it. Grafana users can
#   send arbitrary paths through a datasource proxy, so only the query
#   endpoints of Mimir, Loki and Tempo pass, and only with the methods
#   queries use; maintenance and write APIs answer 404 or 403.
#
# Rate limits are per replica: two edge replicas allow twice the host's
# 100 requests/s.
{
  config,
  lib,
  ...
}:
let
  cfg = config.macro.edge;
  cluster = config.macro.cluster;
  namespace = "observability";
  workload = import ./lib/workload.nix { inherit lib; };
  nginx = import ./lib/nginx.nix { inherit lib workload; };
  endpoints = import ./backends/endpoints.nix;
  svc = name: port: "http://${name}.${namespace}.svc.cluster.local:${toString port}";

  grafanaPods."app.kubernetes.io/name" = "grafana";
  ingestPods = {
    "app.kubernetes.io/name" = "alloy";
    "app.kubernetes.io/instance" = "alloy-ingest";
  };
  argocdServer = {
    namespaceSelector.matchLabels."kubernetes.io/metadata.name" = "argocd";
    podSelector.matchLabels = {
      "app.kubernetes.io/instance" = "argocd";
      "app.kubernetes.io/name" = "argocd-server";
    };
  };
  edgePods."app.kubernetes.io/name" = "edge";
  gatewayPods."app.kubernetes.io/name" = "query-gateway";

  hostMap = lib.concatStrings (
    map (host: "    ${host} grafana;\n") cfg.grafanaHosts
    ++ map (host: "    ${host} otlp;\n") cfg.otlpHosts
  );

  # Unauthenticated (bearer token checked by Alloy) or basic-auth ingest.
  ingest = upstream: auth: ''
    if ($observability_host != otlp) { return 404; }
    limit_except POST { deny all; }
    limit_req zone=ingest burst=200 nodelay;
    limit_req_status 429;
    proxy_read_timeout 30s;
    ${lib.optionalString auth ''
      auth_basic "metrics";
      auth_basic_user_file /etc/nginx/auth/metrics.htpasswd;
      proxy_set_header Authorization "";
    ''}
    set $upstream ${upstream};
    proxy_pass $upstream;
  '';

  websocketHeaders = ''
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
  '';

  edgeConfig = nginx.wrapConfig ''
    client_max_body_size 8m;
    map $host $observability_host {
      default denied;
    ${hostMap}  }
    limit_req_zone $server_name zone=ingest:1m rate=100r/s;
    map $http_upgrade $connection_upgrade {
      default upgrade;
      "" close;
    }
    server {
      listen ${toString cfg.port} default_server;
      server_name _;
      add_header Strict-Transport-Security "max-age=31536000" always;
      # The ALB health check: this pod is up. Grafana's own health is its
      # readiness probe; a Grafana outage shows as 5xx on the target group.
      ${nginx.healthz}
      location / {
        if ($observability_host != grafana) { return 404; }
        set $upstream ${svc "grafana" 80};
        proxy_pass $upstream;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-For $remote_addr;
        ${websocketHeaders}
      }
      location ~ ^/v1/(traces|logs|metrics)$ {
        ${ingest (svc "alloy-ingest" 4318) false}
      }
      location = /api/v1/write {
        ${ingest endpoints.mimir.push true}
      }
      location = /loki/api/v1/push {
        ${ingest endpoints.loki.push true}
      }
    }
    ${lib.optionalString (cfg.argocdHosts != [ ]) ''
      # Argo CD, which checks sign-in itself (Google through its Dex). Its UI
      # streams application changes, so responses aren't buffered.
      server {
        listen ${toString cfg.port};
        server_name ${lib.concatStringsSep " " cfg.argocdHosts};
        add_header Strict-Transport-Security "max-age=31536000" always;
        location / {
          set $upstream http://argocd-server.argocd.svc.cluster.local:80;
          proxy_pass $upstream;
          proxy_set_header Host $host;
          proxy_set_header X-Forwarded-Proto https;
          proxy_set_header X-Forwarded-For $remote_addr;
          proxy_buffering off;
          proxy_read_timeout 300s;
          ${websocketHeaders}
        }
      }
    ''}
  '';

  # Proxy to `base` with the first path segment (the datasource prefix)
  # replaced by base's own path. `set` before `rewrite ... break`, which ends
  # the rewrite phase.
  query =
    base: methods: extra:
    let
      url = workload.splitUrl base;
    in
    ''
      limit_except ${methods} { deny all; }
      set $backend ${url.origin};
      rewrite ^/[^/]+(/.*)$ ${url.path}$1 break;
      proxy_pass $backend;
      ${extra}
    '';

  gatewayConfig = nginx.wrapConfig ''
    map $http_upgrade $connection_upgrade {
      default upgrade;
      "" close;
    }
    server {
      listen ${toString cfg.gatewayPort} default_server;
      server_name _;
      ${nginx.healthz}
      location ~ ^/prometheus/api/v1/(query|query_range|query_exemplars|series|labels|label/[^/]+/values)$ {
        ${query endpoints.mimir.query "GET POST" ""}
      }
      location ~ ^/prometheus/api/v1/(metadata|status/buildinfo|status/config|rules|alerts|targets|targets/metadata)$ {
        ${query endpoints.mimir.query "GET" ""}
      }
      location ~ ^/loki/loki/api/v1/(query|query_range)$ {
        ${query endpoints.loki.query "GET POST" ""}
      }
      # Loki's limits handler requires the single-tenant ID even with auth off.
      location = /loki/loki/api/v1/drilldown-limits {
        ${query endpoints.loki.query "GET" "proxy_set_header X-Scope-OrgID fake;"}
      }
      location ~ ^/loki/loki/api/v1/(labels|label/[^/]+/values|series|index/stats|index/volume|index/volume_range|patterns|tail|status/buildinfo|format_query|detected_fields|detected_labels|detected_field/[^/]+/values)$ {
        ${query endpoints.loki.query "GET" websocketHeaders}
      }
      location ~ ^/tempo/api/(echo|search|search/tags|search/tag/[^/]+/values|traces/[a-fA-F0-9]+|v2/traces/[a-fA-F0-9]+|v2/search/tags|v2/search/tag/[^/]+/values|metrics/query|metrics/query_range|status/buildinfo)$ {
        ${query endpoints.tempo.query "GET" ""}
      }
      location / {
        return 404;
      }
    }
  '';

  backendPorts = ports: {
    to = [ workload.anyPod ];
    ports = workload.tcpPorts ports;
  };
in
{
  options.macro.edge = with lib; {
    grafanaHosts = mkOption {
      type = types.listOf types.str;
      description = "Hostnames the edge serves Grafana on; the ALB's listener rules send them to `targetGroups.grafana`.";
    };
    otlpHosts = mkOption {
      type = types.listOf types.str;
      description = "Hostnames the edge takes OTLP, remote write and Loki push on.";
    };
    argocdHosts = mkOption {
      type = types.listOf types.str;
      default = [ ];
      description = "Hostnames the edge serves Argo CD's UI and API on.";
    };
    targetGroups = mkOption {
      type = types.attrsOf types.str;
      description = "ALB target groups (by name) the edge pods register in, from `../aws/` settings `hosts.*.targetGroup`.";
    };
    zones = mkOption {
      type = types.listOf types.str;
      description = "Zones the ALB is enabled in (`../aws/` output `edge_zones`); the edge runs only there.";
    };
    albSourceCidrs = mkOption {
      type = types.listOf types.str;
      description = "Where ALB traffic and health checks come from (`../aws/` output `alb_source_cidrs`).";
    };
    albReadinessGate = mkOption {
      type = types.bool;
      default = true;
      description = ''
        Whether an edge pod is ready only once the ALB sees it healthy. The
        ALB health-checks a target group only while a listener rule uses it,
        and until then reports its targets `unused`, which never passes the
        gate: off until the switch.
      '';
    };
    port = mkOption {
      type = types.port;
      default = 8080;
      description = "The edge's port; the target groups forward and health-check here.";
    };
    gatewayPort = mkOption {
      type = types.port;
      readOnly = true;
      default = 8081;
      description = "The query gateway's port, as the host's.";
    };
    datasourceUrls = mkOption {
      type = types.attrsOf types.str;
      readOnly = true;
      default =
        let
          base = svc "query-gateway" config.macro.edge.gatewayPort;
        in
        {
          prometheus = "${base}/prometheus";
          loki = "${base}/loki";
          tempo = "${base}/tempo";
        };
      description = "Grafana datasource URLs through the query gateway.";
    };
  };

  config = {
    # With `albReadinessGate` the load balancer controller adds a readiness
    # gate to pods behind a TargetGroupBinding in this namespace: a new edge
    # pod counts as ready only once the ALB sees it healthy, so a rollout
    # never empties the target group.
    applications.observability-namespace.resources.namespaces.${namespace}.metadata.labels =
      lib.mkIf cfg.albReadinessGate
        {
          "elbv2.k8s.aws/pod-readiness-gate-inject" = "enabled";
        };

    applications.edge = {
      inherit namespace;

      resources = lib.mkMerge [
        (nginx.resources {
          name = "edge";
          config = edgeConfig;
          inherit (cfg) port zones;
          # Remote write and Loki push go straight to Mimir and Loki.
          podLabels = endpoints.clientLabels.write;
          # Longer than the controller takes to deregister the pod and the
          # ALB to stop sending it new requests.
          preStopSeconds = 25;
          terminationGracePeriodSeconds = 60;
          # Gates are added when a pod is created: turning them on or off
          # replaces the pods.
          podAnnotations."observability.macro.com/alb-readiness-gate" = lib.boolToString cfg.albReadinessGate;
          volumes = [
            {
              name = "auth";
              secret.secretName = "edge-basic-auth";
            }
          ];
          volumeMounts = [
            {
              name = "auth";
              mountPath = "/etc/nginx/auth";
              readOnly = true;
            }
          ];
        })
        {
          networkPolicies.edge.spec = {
            podSelector.matchLabels = edgePods;
            policyTypes = [
              "Ingress"
              "Egress"
            ];
            ingress = [
              {
                from = workload.cidrs cfg.albSourceCidrs;
                ports = workload.tcpPorts [ cfg.port ];
              }
            ];
            egress = [
              {
                to = [ (workload.pods grafanaPods) ];
                ports = workload.tcpPorts [ 3000 ];
              }
              {
                to = [ (workload.pods ingestPods) ];
                ports = workload.tcpPorts [ 4318 ];
              }
              {
                to = [ argocdServer ];
                ports = workload.tcpPorts [ 8080 ];
              }
              # Loki push, Mimir remote write.
              (backendPorts [
                3100
                8080
              ])
            ];
          };
        }
      ];

      yamls = [
        # Remote write and Loki push use HTTP basic auth, user `metrics`,
        # password the OTLP token, as on the host. `{PLAIN}`: the token is in
        # this namespace's Secrets anyway (Alloy ingest checks it), and a
        # crypt hash would make every render or refresh differ.
        (workload.externalSecret cluster {
          name = "edge-basic-auth";
          properties = [ "otlp_token" ];
          template."metrics.htpasswd" = "metrics:{PLAIN}{{ .otlp_token }}\n";
        })
      ]
      ++ lib.mapAttrsToList (
        name: targetGroupName:
        builtins.toJSON {
          apiVersion = "elbv2.k8s.aws/v1beta1";
          kind = "TargetGroupBinding";
          metadata = {
            name = "edge-${name}";
            annotations."argocd.argoproj.io/sync-options" = "SkipDryRunOnMissingResource=true";
          };
          spec = {
            inherit targetGroupName;
            targetType = "ip";
            serviceRef = {
              name = "edge";
              inherit (cfg) port;
            };
          };
        }
      ) cfg.targetGroups;
    };

    applications.query-gateway = {
      inherit namespace;

      resources = lib.mkMerge [
        (nginx.resources {
          name = "query-gateway";
          config = gatewayConfig;
          port = cfg.gatewayPort;
          podLabels = endpoints.clientLabels.read;
          preStopSeconds = 10;
        })
        {
          networkPolicies.query-gateway.spec = {
            podSelector.matchLabels = gatewayPods;
            policyTypes = [
              "Ingress"
              "Egress"
            ];
            ingress = [
              {
                from = [ (workload.pods grafanaPods) ];
                ports = workload.tcpPorts [ cfg.gatewayPort ];
              }
            ];
            # Loki, Mimir, Tempo's query frontend.
            egress = [
              (backendPorts [
                3100
                8080
                3200
              ])
            ];
          };
        }
      ];
    };
  };
}
