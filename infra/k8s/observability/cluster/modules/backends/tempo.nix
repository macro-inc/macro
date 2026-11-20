# Tempo: the tempo-distributed chart on the classic ingester write path
# (Tempo 2.x, no Kafka). Three ingesters, one per zone, every span on all
# three (replication 3, quorum 2), each with its WAL on a gp3 volume; blocks
# in S3. Two of each stateless part, so a rollout or a lost node keeps
# ingest and queries up; one compactor, which only works in the background.
#
# The metrics generator turns spans into span metrics and service graphs
# and writes them to Mimir, and keeps recent blocks for TraceQL metrics.
# Retention, processors and their limits are the host's (lib.nix `host`).
{
  charts,
  config,
  lib,
  ...
}:
let
  shared = import ./lib.nix;
  inherit (shared) host;
  inherit (config.macro.cluster) region;

  selector = {
    "app.kubernetes.io/name" = "tempo";
    "app.kubernetes.io/instance" = "tempo";
  };
  component = name: selector // { "app.kubernetes.io/component" = name; };
  # The chart reads these through `tpl`, so it takes YAML text; JSON is YAML.
  spread = name: builtins.toJSON (shared.zoneSpread (component name));

  resources = request: limit: {
    requests = {
      cpu = "50m";
      memory = request;
    };
    limits.memory = limit;
  };

  stateless = name: replicas: request: limit: {
    inherit replicas;
    topologySpreadConstraints = spread name;
    resources = resources request limit;
  };

  volume = {
    enabled = true;
    size = "10Gi";
    storageClass = "gp3";
  };
in
{
  applications.tempo = {
    inherit (shared) namespace;

    helm.releases.tempo = {
      chart = charts.grafana-community.tempo-distributed;
      values = {
        reportingEnabled = false;
        traces.otlp = {
          grpc.enabled = true;
          http.enabled = true;
        };

        tempo = {
          # Every part but the distributor reads or writes the bucket.
          podLabels = shared.awsApis;
          podSecurityContext = shared.podSecurityContext 1000;
          securityContext = shared.containerSecurityContext;
          structuredConfig = {
            inherit (host.tempo) query_frontend;
            ingester.max_block_duration = host.tempo.ingester.max_block_duration;
            compactor.compaction.block_retention = host.tempo.compactor.compaction.block_retention;
          };
        };
        serviceAccount.automountServiceAccountToken = false;

        storage.trace = {
          backend = "s3";
          s3 = {
            bucket = config.macro.backends.buckets.tempo;
            inherit region;
            endpoint = "s3.${region}.amazonaws.com";
          };
        };
        overrides.defaults = host.tempo.overrides.defaults;

        # No memcached (the host runs none). With it off the chart copies
        # `cache` into the config as is, so empty it too.
        memcached.enabled = false;
        cache.caches = [ ];

        ingester = {
          replicas = 3;
          persistence = volume;
          topologySpreadConstraints = spread "ingester";
          # Never two on one node (the chart only prefers it): their volumes
          # would pin them together, and losing that node would lose quorum.
          affinity = builtins.toJSON {
            podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution = [
              {
                labelSelector.matchLabels = component "ingester";
                topologyKey = "kubernetes.io/hostname";
              }
            ];
          };
          resources = resources "1Gi" "2Gi";
        };
        distributor = stateless "distributor" 2 "128Mi" "512Mi";
        querier = stateless "querier" 2 "256Mi" "1Gi";
        queryFrontend = stateless "query-frontend" 2 "128Mi" "512Mi";
        compactor = stateless "compactor" 1 "256Mi" "1Gi";

        metricsGenerator = stateless "metrics-generator" 2 "256Mi" "1Gi" // {
          enabled = true;
          kind = "StatefulSet";
          persistence = volume;
          config = {
            # The host's processors with Tempo's default histogram buckets
            # (the chart sets its own, which changes the `le` labels).
            processor = lib.recursiveUpdate {
              service_graphs.histogram_buckets = null;
              span_metrics.histogram_buckets = null;
            } host.tempo.metrics_generator.processor;
            storage = {
              remote_write = [
                {
                  url = shared.endpoints.mimir.push;
                  send_exemplars = true;
                }
              ];
              # Mimir runs without tenants.
              remote_write_add_org_id_header = false;
            };
          };
        };
      };
    };

    resources.networkPolicies = {
      tempo.spec = shared.policy {
        inherit selector;
        # Every part's /metrics.
        ingress = [
          {
            from = [ shared.nodeAlloy ];
            ports = shared.tcp [ 3200 ];
          }
        ];
        # The metrics generator's remote write.
        egress = [
          {
            to = [ (shared.pods { "app.kubernetes.io/name" = "mimir"; }) ];
            ports = shared.tcp [ 8080 ];
          }
        ];
      };
      # OTLP in, only at the distributors.
      tempo-distributor.spec = {
        podSelector.matchLabels = component "distributor";
        policyTypes = [ "Ingress" ];
        ingress = [
          {
            from = [ shared.writers ];
            ports = shared.tcp [
              4317
              4318
            ];
          }
        ];
      };
      # Queries in, only at the query frontends.
      tempo-query-frontend.spec = {
        podSelector.matchLabels = component "query-frontend";
        policyTypes = [ "Ingress" ];
        ingress = [
          {
            from = [ shared.readers ];
            ports = shared.tcp [ 3200 ];
          }
        ];
      };
    };
  };
}
