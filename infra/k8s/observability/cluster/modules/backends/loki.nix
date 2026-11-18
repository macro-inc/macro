# Loki: the official chart in single-binary (monolithic) mode, three replicas,
# one per zone, every stream written to all three (replication 3, quorum 2).
# Chunks and the index live in S3; each pod keeps its WAL on a gp3 volume, so a
# restart replays what it hadn't flushed. Retention, limits, pattern ingestion
# and level detection are the host's (lib.nix `host`).
{
  charts,
  config,
  lib,
  ...
}:
let
  shared = import ./lib.nix;
  inherit (shared) host;
  bucket = config.macro.backends.buckets.loki;

  selector = {
    "app.kubernetes.io/name" = "loki";
    "app.kubernetes.io/instance" = "loki";
  };
in
{
  applications.loki = {
    inherit (shared) namespace;

    helm.releases.loki = {
      chart = charts.grafana-community.loki;
      values = {
        deploymentMode = "Monolithic";

        loki = {
          auth_enabled = false;
          commonConfig.replication_factor = 3;
          schemaConfig = host.loki.schema_config;
          storage = {
            type = "s3";
            bucketNames = {
              chunks = bucket;
              ruler = bucket;
              admin = bucket;
            };
            s3.region = config.macro.cluster.region;
          };
          inherit (host.loki) pattern_ingester querier;
          limits_config = host.loki.limits_config // {
            # The chart sets 15m; the host runs with Loki's 1h. With the
            # host's parallelism of 4, 15m splits make long queries slower.
            split_queries_by_interval = null;
          };
          # The host's, without its directory: the chart puts everything under
          # /var/loki, the volume.
          compactor = removeAttrs host.loki.compactor [ "working_directory" ];
          analytics = host.loki.analytics;
        };

        singleBinary = {
          replicas = 3;
          podLabels = shared.awsApis;
          persistence = {
            size = "10Gi";
            storageClass = "gp3";
          };
          podDisruptionBudget.maxUnavailable = 1;
          topologySpreadConstraints = shared.zoneSpread (
            selector // { "app.kubernetes.io/component" = "single-binary"; }
          );
          resources = {
            requests = {
              cpu = "100m";
              memory = "1Gi";
            };
            limits.memory = "2Gi";
          };
          # The chart publishes starting and stopping pods by default, which
          # would send pushes and queries to a replica replaying its WAL or
          # already shut down. Memberlist has its own Service.
          service.publishNotReadyAddresses = false;
          # Nothing in the single binary talks to the Kubernetes API.
          automountServiceAccountToken = false;
        };
        serviceAccount.automountServiceAccountToken = false;

        # Only the single binary: no simple-scalable targets, no nginx gateway
        # (Grafana's query gateway and Alloy ingest are their own apps), no
        # memcached (the host runs none), no canary, test pod or rules sidecar.
        read.replicas = 0;
        write.replicas = 0;
        backend.replicas = 0;
        gateway.enabled = false;
        chunksCache.enabled = false;
        resultsCache.enabled = false;
        lokiCanary.enabled = false;
        test.enabled = false;
        sidecar.rules.enabled = false;
        memcached.enabled = false;
        # A Role, empty without the rules sidecar, instead of a ClusterRole.
        rbac.namespaced = true;
      };
    };

    resources.networkPolicies.loki.spec = shared.policy {
      inherit selector;
      ingress = [
        {
          from = [
            shared.writers
            shared.readers
            shared.nodeAlloy
          ];
          ports = shared.tcp [ 3100 ];
        }
      ];
    };
  };
}
