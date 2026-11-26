# One Alloy per node for the cluster's own node, kubelet, cAdvisor and pod-log
# telemetry (alloy-node.alloy). It runs in its own `alloy` namespace because it
# mounts host paths, which the `observability` namespace's Pod Security level
# forbids.
#
# Destinations come from `macro.alloyNode`, which ../backends/default.nix sets:
# the Mimir and Loki writers, their forward_to receivers, and the egress rule
# that reaches the backends' pods. Their own ingress policies let the `alloy`
# namespace in.
{
  charts,
  config,
  lib,
  ...
}:
let
  cfg = config.macro.alloyNode;
  namespace = "alloy";
  apiServerAndKubelet = {
    # The API server (EKS endpoints on 443; 6443 on kind) and kubelets
    # (10250) have no addresses a policy can name in advance.
    ports =
      map
        (port: {
          protocol = "TCP";
          inherit port;
        })
        [
          443
          6443
          10250
        ];
  };

  alloyConfig =
    builtins.replaceStrings
      [ "@METRICS@" "@LOGS@" ]
      [
        (lib.concatStringsSep ", " cfg.metricsForwardTo)
        (lib.concatStringsSep ", " cfg.logsForwardTo)
      ]
      (builtins.readFile ./alloy-node.alloy)
    + lib.optionalString (cfg.extraConfig != "") "\n${cfg.extraConfig}";

  hostMount = name: path: {
    volume = {
      inherit name;
      hostPath.path = path;
    };
    mount = {
      inherit name;
      mountPath = "/host${path}";
      readOnly = true;
    };
  };
  hostMounts = [
    (hostMount "proc" "/proc")
    (hostMount "sys" "/sys")
  ];
in
{
  options.macro.alloyNode = with lib; {
    metricsForwardTo = mkOption {
      type = types.listOf types.str;
      default = [ ];
      description = "Alloy receivers the node, kubelet and cAdvisor metrics go to.";
    };
    logsForwardTo = mkOption {
      type = types.listOf types.str;
      default = [ ];
      description = "Alloy receivers the pod logs go to.";
    };
    extraConfig = mkOption {
      type = types.lines;
      default = "";
      description = "Alloy components appended to the config: the writers the receivers above belong to.";
    };
    egress = mkOption {
      type = types.listOf types.attrs;
      default = [ ];
      description = "NetworkPolicy egress rules to the destinations.";
    };
  };

  config.applications.alloy-node = {
    inherit namespace;
    createNamespace = true;

    helm.releases.alloy-node = {
      chart = charts.grafana.alloy;
      values = {
        crds.create = false;

        controller = {
          type = "daemonset";
          # Every node, whatever its taints.
          tolerations = [ { operator = "Exists"; } ];
          volumes.extra = map (m: m.volume) hostMounts ++ [
            # Log read positions and the remote-write WAL outlive the pod, so a
            # restart or rollout neither re-ships logs nor drops samples.
            {
              name = "data";
              hostPath = {
                path = "/var/lib/alloy-node";
                type = "DirectoryOrCreate";
              };
            }
          ];
        };

        alloy = {
          configMap.content = alloyConfig;
          storagePath = "/var/lib/alloy";
          mounts = {
            varlog = true;
            extra = map (m: m.mount) hostMounts ++ [
              {
                name = "data";
                mountPath = "/var/lib/alloy";
              }
            ];
          };
          # Pod log files belong to root (no capabilities needed to read them as
          # their owner); the data directory is written as root too.
          securityContext = {
            runAsUser = 0;
            allowPrivilegeEscalation = false;
            capabilities.drop = [ "ALL" ];
          };
          resources = {
            requests = {
              cpu = "50m";
              memory = "128Mi";
            };
            limits.memory = "512Mi";
          };
          enableReporting = false;
        };

        # Only what the config uses; the chart's default also reads every
        # Secret and ConfigMap in the cluster.
        rbac.rules = [
          {
            apiGroups = [ "" ];
            resources = [
              "pods"
              "namespaces"
            ];
            verbs = [
              "get"
              "list"
              "watch"
            ];
          }
        ];
        rbac.clusterRules = [
          {
            apiGroups = [ "" ];
            resources = [
              "nodes"
              "nodes/metrics"
            ];
            verbs = [
              "get"
              "list"
              "watch"
            ];
          }
        ];
      };
    };

    resources = {
      # Host paths need the privileged Pod Security level.
      namespaces.${namespace}.metadata.labels = {
        "pod-security.kubernetes.io/enforce" = "privileged";
      };

      networkPolicies = {
        default-deny.spec = {
          podSelector = { };
          policyTypes = [
            "Ingress"
            "Egress"
          ];
        };
        alloy-node-egress.spec = {
          podSelector = { };
          policyTypes = [ "Egress" ];
          egress = [
            config.macro.networkPolicy.allowDns
            apiServerAndKubelet
          ]
          ++ cfg.egress;
        };
      };
    };
  };
}
