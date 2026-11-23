# Loki, Tempo and Mimir, each its own application in `observability`.
# endpoints.nix says how other apps reach them; lib.nix holds what they share.
#
# This module also points the node Alloy (platform/alloy-node.nix) at them:
# node, kubelet and cAdvisor metrics to Mimir, pod logs to Loki, and the
# backends' own /metrics to Mimir, as the host's Prometheus scraped Loki,
# Tempo and itself.
{ lib, ... }:
let
  shared = import ./lib.nix;
  inherit (shared) endpoints;
in
{
  imports = [
    ./loki.nix
    ./tempo.nix
    ./mimir.nix
  ];

  # Where Loki and Tempo keep their data: the cluster's own buckets until the
  # switch, then the host's, which hold its history (README "The switch").
  # Mimir keeps its own bucket for good.
  options.macro.backends.buckets =
    lib.mapAttrs
      (
        name: default:
        lib.mkOption {
          type = lib.types.str;
          inherit default;
          description = "S3 bucket of ${name}: the AWS layer's `buckets.${name}` output, or from the switch its `host_buckets`.";
        }
      )
      {
        inherit (shared.buckets) loki tempo;
      };

  config.macro.alloyNode = {
    metricsForwardTo = [ "prometheus.remote_write.mimir.receiver" ];
    logsForwardTo = [ "loki.write.loki.receiver" ];
    extraConfig = ''
      prometheus.remote_write "mimir" {
        endpoint {
          url = "${endpoints.mimir.push}"
        }
      }

      loki.write "loki" {
        endpoint {
          url = "${endpoints.loki.push}"
        }
      }

      // The backends' own metrics, from their pods on this node.
      discovery.kubernetes "backends" {
        role = "pod"

        namespaces {
          names = ["${endpoints.namespace}"]
        }

        selectors {
          role  = "pod"
          field = "spec.nodeName=" + sys.env("K8S_NODE_NAME")
        }
      }

      discovery.relabel "backends" {
        targets = discovery.kubernetes.backends.targets

        rule {
          source_labels = ["__meta_kubernetes_pod_label_app_kubernetes_io_name"]
          regex         = "loki|tempo|mimir"
          action        = "keep"
        }

        rule {
          source_labels = ["__meta_kubernetes_pod_container_port_name"]
          regex         = "http-metrics"
          action        = "keep"
        }

        rule {
          source_labels = ["__meta_kubernetes_pod_label_app_kubernetes_io_name"]
          target_label  = "job"
          replacement   = "observability/$1"
        }

        rule {
          source_labels = ["__meta_kubernetes_pod_label_app_kubernetes_io_component"]
          target_label  = "component"
        }

        rule {
          source_labels = ["__meta_kubernetes_pod_name"]
          target_label  = "pod"
        }

        rule {
          source_labels = ["__meta_kubernetes_pod_node_name"]
          target_label  = "node"
        }
      }

      // The host's Prometheus scraped every 30s.
      prometheus.scrape "backends" {
        targets         = discovery.relabel.backends.output
        job_name        = "observability"
        scrape_interval = "30s"
        forward_to      = [prometheus.remote_write.mimir.receiver]
      }
    '';
    egress = [
      {
        to = [
          {
            namespaceSelector.matchLabels."kubernetes.io/metadata.name" = endpoints.namespace;
            podSelector.matchExpressions = [
              {
                key = "app.kubernetes.io/name";
                operator = "In";
                values = [
                  "loki"
                  "tempo"
                  "mimir"
                ];
              }
            ];
          }
        ];
        ports = shared.tcp [
          3100
          3200
          8080
        ];
      }
    ];
  };
}
