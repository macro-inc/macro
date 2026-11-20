# Mimir in monolithic mode (`-target=all`), three replicas, one per zone, in
# place of the host's Prometheus. Every series is written to all three
# ingesters (replication 3, quorum 2), so a rollout or a lost node keeps
# writes and queries up, which a single Prometheus can't. Blocks go to S3
# after two hours; each pod keeps its TSDB head, WAL and the store gateway's
# and compactor's working files on a gp3 volume.
#
# Hand-written: the mimir-distributed chart has no monolithic mode.
#
# Same endpoints as Prometheus had, at Mimir's paths (endpoints.nix):
# remote write at /api/v1/push, OTLP at /otlp/v1/metrics, the query API under
# /prometheus. Same 30 days, exemplars on.
{ config, lib, ... }:
let
  shared = import ./lib.nix;
  inherit (shared) namespace;
  inherit (config.macro.cluster) region;

  name = "mimir";
  image = "docker.io/grafana/mimir:3.2.5";
  selector = {
    "app.kubernetes.io/name" = name;
    "app.kubernetes.io/instance" = name;
  };
  ports = {
    http = 8080;
    grpc = 9095;
    gossip = 7946;
  };
  data = "/data";

  mimirConfig = shared.toYAML {
    multitenancy_enabled = false;
    usage_stats.enabled = false;

    server = {
      http_listen_port = ports.http;
      grpc_listen_port = ports.grpc;
      log_level = "info";
    };

    memberlist = {
      join_members = [ "dns+${name}-headless.${namespace}.svc.cluster.local:${toString ports.gossip}" ];
      bind_port = ports.gossip;
      # Loki and Tempo gossip on the same port; never merge rings with them.
      cluster_label = "${name}.${namespace}";
    };

    # One bucket, a prefix per component.
    common.storage = {
      backend = "s3";
      s3 = {
        endpoint = "s3.${region}.amazonaws.com";
        inherit region;
        bucket_name = shared.buckets.mimir;
      };
    };
    blocks_storage = {
      storage_prefix = "blocks";
      tsdb.dir = "${data}/tsdb";
      bucket_store.sync_dir = "${data}/tsdb-sync";
    };
    # The ruler is part of `all`. Grafana evaluates the alert rules, so it has
    # none, but it still needs somewhere to look.
    ruler_storage.storage_prefix = "ruler";
    ruler.rule_path = "${data}/ruler";
    compactor.data_dir = "${data}/compactor";
    activity_tracker.filepath = "${data}/metrics-activity.log";

    ingester.ring = {
      replication_factor = 3;
      tokens_file_path = "${data}/ingester-tokens";
    };
    store_gateway.sharding_ring = {
      replication_factor = 3;
      tokens_file_path = "${data}/store-gateway-tokens";
    };

    limits = {
      # Prometheus' --storage.tsdb.retention.time on the host.
      compactor_blocks_retention_period = "30d";
      # Prometheus' --enable-feature=exemplar-storage, at its default size.
      # Tempo's span metrics carry trace IDs as exemplars.
      max_global_exemplars_per_user = 100000;
      # Prometheus has no series limit; Mimir defaults to 150k. The host holds
      # about 53k; each of the two metrics generators may add up to 50k (its
      # own cap), and the node Alloy adds the cluster's own node, kubelet and
      # cAdvisor series.
      max_global_series_per_user = 300000;
      # Mimir's 10k samples/s would cut off senders catching up after an
      # outage; the host takes about 900/s.
      ingestion_rate = 50000;
      ingestion_burst_size = 500000;
    };
  };

  memoryLimitMiB = 2048;
in
{
  applications.mimir = {
    inherit namespace;

    resources = {
      serviceAccounts.${name}.automountServiceAccountToken = false;

      configMaps.${name}.data."mimir.yaml" = mimirConfig;

      statefulSets.${name}.spec = {
        replicas = 3;
        serviceName = "${name}-headless";
        # All three start together: no ingester is ready before it has
        # joined a ring that can take writes at replication 3.
        podManagementPolicy = "Parallel";
        selector.matchLabels = selector;
        template = {
          metadata = {
            labels = selector // shared.awsApis;
            annotations."checksum/config" = builtins.hashString "sha256" mimirConfig;
          };
          spec = {
            serviceAccountName = name;
            securityContext = shared.podSecurityContext 10001;
            topologySpreadConstraints = shared.zoneSpread selector;
            affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution = [
              {
                labelSelector.matchLabels = selector;
                topologyKey = "kubernetes.io/hostname";
              }
            ];
            # An ingester leaving the ring hands nothing over (the other two
            # hold its series), but give the TSDB head time to close cleanly.
            terminationGracePeriodSeconds = 300;
            containers = [
              {
                inherit name image;
                args = [
                  "-target=all"
                  "-config.file=/etc/mimir/mimir.yaml"
                ];
                env = [
                  {
                    name = "GOMEMLIMIT";
                    value = "${toString (memoryLimitMiB * 85 / 100)}MiB";
                  }
                ];
                ports = [
                  {
                    name = "http-metrics";
                    containerPort = ports.http;
                  }
                  {
                    name = "grpc";
                    containerPort = ports.grpc;
                  }
                  {
                    name = "memberlist";
                    containerPort = ports.gossip;
                  }
                ];
                # No liveness probe: restarting a slow ingester only makes it
                # replay its WAL again.
                readinessProbe = {
                  httpGet = {
                    path = "/ready";
                    port = "http-metrics";
                  };
                  initialDelaySeconds = 15;
                  periodSeconds = 10;
                };
                resources = {
                  requests = {
                    cpu = "100m";
                    memory = "1Gi";
                  };
                  limits.memory = "${toString memoryLimitMiB}Mi";
                };
                securityContext = shared.containerSecurityContext;
                volumeMounts = [
                  {
                    name = "config";
                    mountPath = "/etc/mimir";
                  }
                  {
                    name = "data";
                    mountPath = data;
                  }
                  {
                    name = "tmp";
                    mountPath = "/tmp";
                  }
                ];
              }
            ];
            volumes = [
              {
                name = "config";
                configMap.name = name;
              }
              {
                name = "tmp";
                emptyDir = { };
              }
            ];
          };
        };
        volumeClaimTemplates = [
          {
            metadata.name = "data";
            spec = {
              accessModes = [ "ReadWriteOnce" ];
              storageClassName = "gp3";
              resources.requests.storage = "20Gi";
            };
          }
        ];
      };

      services = {
        ${name}.spec = {
          inherit selector;
          ports = [
            {
              name = "http-metrics";
              port = ports.http;
              targetPort = "http-metrics";
            }
            {
              name = "grpc";
              port = ports.grpc;
              targetPort = "grpc";
            }
          ];
        };
        # Memberlist peers find each other through this, ready or not.
        "${name}-headless".spec = {
          inherit selector;
          clusterIP = "None";
          publishNotReadyAddresses = true;
          ports = [
            {
              name = "memberlist";
              port = ports.gossip;
              targetPort = "memberlist";
            }
            {
              name = "grpc";
              port = ports.grpc;
              targetPort = "grpc";
            }
          ];
        };
      };

      podDisruptionBudgets.${name}.spec = {
        maxUnavailable = 1;
        selector.matchLabels = selector;
      };

      networkPolicies.${name}.spec = shared.policy {
        inherit selector;
        ingress = [
          {
            from = [
              shared.writers
              shared.readers
              shared.nodeAlloy
              # Tempo's metrics generator: span metrics and service graphs.
              (shared.pods {
                "app.kubernetes.io/name" = "tempo";
                "app.kubernetes.io/component" = "metrics-generator";
              })
            ];
            ports = shared.tcp [ ports.http ];
          }
        ];
      };
    };
  };
}
