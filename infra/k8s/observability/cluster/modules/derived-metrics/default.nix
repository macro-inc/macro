# The metrics Datadog computes from spans (spans.nix) and logs (logs.nix),
# computed here instead. alloy-ingest forwards what they read (the tap,
# alloy.nix), before any sampling; two Alloys turn that into delta samples and
# native histograms in Mimir. See README "Derived metrics".
#
# A StatefulSet, so a restarted replica writes to its own series again rather
# than starting new ones.
{
  charts,
  config,
  lib,
  ...
}:
let
  namespace = "observability";
  workload = import ../lib/workload.nix { inherit lib; };
  endpoints = import ../backends/endpoints.nix;
  alloy = import ./alloy.nix { inherit lib; };
  name = "derived-metrics";
  port = 4317;
  selector = {
    "app.kubernetes.io/name" = "alloy";
    "app.kubernetes.io/instance" = name;
  };
in
{
  options.macro.derivedMetrics.ingestTap = lib.mkOption {
    type = lib.types.lines;
    readOnly = true;
    default = alloy.tap "${name}.${namespace}.svc.cluster.local:${toString port}";
    description = "Alloy configuration alloy-ingest appends; it sends traces and logs to `otelcol.processor.filter.derived.input`.";
  };

  config.applications.${name} = {
    inherit namespace;

    helm.releases.${name} = {
      chart = charts.grafana.alloy;
      values = {
        fullnameOverride = name;
        crds.create = false;
        # The image starts as root; 473 is its `alloy` user.
        global.podSecurityContext = workload.podSecurity 473;
        # It reads nothing from the Kubernetes API.
        rbac.create = false;
        serviceAccount.automountServiceAccountToken = false;

        controller = {
          type = "statefulset";
          replicas = 2;
          parallelManagement = true;
          topologySpreadConstraints = workload.spread selector;
          podDisruptionBudget = {
            enabled = true;
            maxUnavailable = 1;
          };
          podLabels = endpoints.clientLabels.write;
          terminationGracePeriodSeconds = 60;
          volumes.extra = [
            {
              name = "data";
              emptyDir = { };
            }
          ];
        };

        alloy = {
          configMap.content = alloy.config {
            inherit port;
            mimirOtlp = endpoints.mimir.otlp;
            mimirPush = endpoints.mimir.push;
          };
          # otelcol.connector.signaltometrics.
          stabilityLevel = "experimental";
          storagePath = "/var/lib/alloy";
          enableReporting = false;
          extraEnv = [
            {
              name = "POD_NAME";
              valueFrom.fieldRef.fieldPath = "metadata.name";
            }
          ];
          extraPorts = [
            {
              name = "otlp-grpc";
              inherit port;
              targetPort = port;
              protocol = "TCP";
            }
          ];
          mounts.extra = [
            {
              name = "data";
              mountPath = "/var/lib/alloy";
            }
          ];
          securityContext = workload.containerSecurity;
          # Stay in the Service while kube-proxy everywhere drops this pod;
          # then Alloy flushes what it holds on SIGTERM.
          lifecycle.preStop.sleep.seconds = 10;
          # The memory limiter starts refusing data at 192 MiB.
          resources = {
            requests = {
              cpu = "50m";
              memory = "192Mi";
            };
            limits.memory = "512Mi";
          };
        };

        configReloader.securityContext = workload.containerSecurity;
      };
    };

    resources.networkPolicies.${name}.spec = {
      podSelector.matchLabels = selector;
      policyTypes = [
        "Ingress"
        "Egress"
      ];
      ingress = [
        {
          from = [
            (workload.pods {
              "app.kubernetes.io/name" = "alloy";
              "app.kubernetes.io/instance" = "alloy-ingest";
            })
          ];
          ports = workload.tcpPorts [ port ];
        }
      ];
      # Mimir: OTLP and remote write.
      egress = [
        {
          to = [ workload.anyPod ];
          ports = workload.tcpPorts [ 8080 ];
        }
      ];
    };
  };
}
