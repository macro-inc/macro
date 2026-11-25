# The sampler: Alloy replicas that each see whole traces (Alloy ingest routes
# by trace id), count span metrics and service graphs from every span, and
# send Tempo the traces ./policies.nix keeps. A StatefulSet, so a replica
# keeps its name, and so its series, across restarts. The headless Service is
# how ingest finds the replicas.
#
# When a replica starts or stops, about a third of trace ids move to another
# one. Ingest learns from DNS (cached up to 35s), so preStop keeps a stopping
# replica receiving meanwhile, and it decides what it holds before it exits. A
# trace in flight then is in two parts, each decided on its own.
{
  charts,
  lib,
  ...
}:
let
  namespace = "observability";
  workload = import ../lib/workload.nix { inherit lib; };
  endpoints = import ../backends/endpoints.nix;
  name = "alloy-sampler";
  selector = {
    "app.kubernetes.io/name" = "alloy";
    "app.kubernetes.io/instance" = name;
  };
  replicas = 3;

  sampling = import ./policies.nix { inherit lib; } { inherit replicas; };

  # Spans wait this long for the rest of their trace. Sized with the load
  # test in the README: at 38k spans/s over three replicas each held about
  # 80k traces and 1.5 GiB.
  values = {
    DECISION_WAIT = "30s";
    NUM_TRACES = "150000";
    SAMPLED_CACHE = "500000";
    MEMORY_LIMIT = "3GiB";
    MEMORY_SPIKE = "512MiB";
    MIMIR_PUSH = endpoints.mimir.push;
    TEMPO = endpoints.tempo.otlpGrpc;
    POLICIES = sampling.policies;
    ROOT_STATEMENTS = sampling.rootStatements;
  };
  configText =
    let
      result = builtins.replaceStrings (map (k: "@${k}@") (
        lib.attrNames values
      )) (lib.attrValues values) (builtins.readFile ./sampler.alloy);
    in
    assert lib.assertMsg (
      !lib.hasInfix "@" result
    ) "sampler.alloy has a placeholder modules/sampler/default.nix doesn't fill";
    result;
in
{
  applications.alloy-sampler = {
    inherit namespace;

    helm.releases.${name} = {
      chart = charts.grafana.alloy;
      values = {
        crds.create = false;
        global.podSecurityContext = workload.podSecurity 473;
        rbac.create = false;
        serviceAccount.automountServiceAccountToken = false;
        service.clusterIP = "None";

        controller = {
          type = "statefulset";
          inherit replicas;
          # All three at once on a first start; updates still go one by one.
          parallelRollout = true;
          # Soft, unlike the backends' zones: a drained node's zone stays empty
          # until it returns, and a replica that can't be placed would hold up
          # the next drain.
          topologySpreadConstraints = map (c: c // { whenUnsatisfiable = "ScheduleAnyway"; }) (
            workload.spread selector
          );
          podDisruptionBudget = {
            enabled = true;
            maxUnavailable = 1;
          };
          podLabels = endpoints.clientLabels.write;
          terminationGracePeriodSeconds = 120;
          volumes.extra = [
            {
              name = "data";
              emptyDir = { };
            }
          ];
        };

        alloy = {
          configMap.content = configText;
          storagePath = "/var/lib/alloy";
          enableReporting = false;
          extraPorts = [
            {
              name = "otlp-grpc";
              port = 4317;
              targetPort = 4317;
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
          lifecycle.preStop.sleep.seconds = 45;
          resources = {
            requests = {
              cpu = "200m";
              memory = "2Gi";
            };
            limits.memory = "4Gi";
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
          ports = workload.tcpPorts [ 4317 ];
        }
        workload.scrapedByNodeAlloy
      ];
      # Mimir remote write, Tempo OTLP gRPC.
      egress = [
        {
          to = [ workload.anyPod ];
          ports = workload.tcpPorts [
            8080
            4317
          ];
        }
      ];
    };
  };
}
