# Tempo: the tempo-distributed chart on the classic ingester write path
# (Tempo 2.x, no Kafka). Three ingesters, one per zone, every span on all
# three (replication 3, quorum 2), each with its WAL on a gp3 volume; blocks
# in S3. Two of each stateless part, so a rollout or a lost node keeps
# ingest and queries up; one compactor, which only works in the background.
#
# The compactor and queriers hold whole traces, so a few large ones set their
# memory: at 1Gi both ran out on dev traffic alone, and at 2.5Gi the
# compactor still ran out within seconds of starting to compact, so blocks
# piled up unmerged and past retention. The compactor also merges fewer traces
# per output block than Tempo's default. It runs on the m7g.xlarge nodes'
# headroom; a second compactor would double its reservation.
#
# The compactor waits a minute for its ring and then reads the whole
# blocklist before /ready answers, which outlasted the chart's liveness
# probe (60s delay, three misses), so its probe waits longer.
#
# The metrics generator only keeps recent blocks for TraceQL metrics: span
# metrics and service graphs come from the sampler (../sampler), before it
# drops anything. Retention and processors are the host's (lib.nix `host`).
{
  charts,
  config,
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

  # The Go runtime collects harder as it nears this, before the kernel kills
  # the container at `limit`.
  goMemLimit = limit: [
    {
      name = "GOMEMLIMIT";
      value = "${toString (limit * 85 / 100)}MiB";
    }
  ];

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
          grpc = {
            enabled = true;
            # The default is 4 MiB, which a batch of 1024 spans can exceed.
            receiverConfig.max_recv_msg_size_mib = 16;
          };
          http.enabled = true;
        };

        tempo = {
          # Every part but the distributor reads or writes the bucket.
          podLabels = shared.awsApis;
          podSecurityContext = shared.podSecurityContext 1000;
          securityContext = shared.containerSecurityContext;
          structuredConfig = {
            # The chart's 4 MiB is less than a distributor may take in (below);
            # it forwards what it took in to each ingester in one message.
            server = {
              grpc_server_max_recv_msg_size = 16777216;
              grpc_server_max_send_msg_size = 16777216;
            };
            inherit (host.tempo) query_frontend;
            ingester.max_block_duration = host.tempo.ingester.max_block_duration;
            compactor.compaction = {
              inherit (host.tempo.compactor.compaction) block_retention;
              # Tempo's default is 6M.
              max_compaction_objects = 1000000;
            };
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
          extraEnv = goMemLimit 4096;
          resources = resources "2Gi" "4Gi";
        };
        distributor = stateless "distributor" 2 "128Mi" "512Mi";
        # Each search job can read a block's largest traces, so a querier runs
        # few at once (the chart's 20 ran out of memory on one wide search).
        querier = stateless "querier" 2 "1Gi" "3Gi" // {
          config.max_concurrent_queries = 5;
          extraEnv = goMemLimit 3072;
        };
        queryFrontend = stateless "query-frontend" 2 "128Mi" "512Mi";
        compactor = stateless "compactor" 1 "4Gi" "6Gi" // {
          livenessProbe = {
            httpGet = {
              path = "/ready";
              port = "http-metrics";
            };
            initialDelaySeconds = 180;
            timeoutSeconds = 5;
          };
        };

        metricsGenerator = stateless "metrics-generator" 2 "256Mi" "2Gi" // {
          enabled = true;
          extraEnv = goMemLimit 2048;
          kind = "StatefulSet";
          persistence = volume;
          config = {
            inherit (host.tempo.metrics_generator) metrics_ingestion_time_range_slack processor;
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
