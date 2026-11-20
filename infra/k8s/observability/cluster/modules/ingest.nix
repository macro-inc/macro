# Alloy ingest: the OTLP receiver behind the edge. It runs the host's own
# infra/stacks/observability/nixos/ingest.alloy with the cluster's addresses
# swapped in: it checks the bearer token (the secret's `otlp_token`), then
# sends logs to Loki, traces to Tempo and metrics to Mimir. Two replicas in
# different zones; the edge reaches them through their Service.
{
  charts,
  config,
  lib,
  ...
}:
let
  cluster = config.macro.cluster;
  namespace = "observability";
  workload = import ./lib/workload.nix { inherit lib; };
  endpoints = import ./backends/endpoints.nix;
  name = "alloy-ingest";
  selector = {
    "app.kubernetes.io/name" = "alloy";
    "app.kubernetes.io/instance" = name;
  };
  credentials = "/etc/alloy/credentials";

  # The host's addresses, each of which must be present, and the cluster's.
  replacements = [
    # Behind the edge instead of the host's nginx.
    {
      from = ''endpoint = "127.0.0.1:4318"'';
      to = ''endpoint = "0.0.0.0:4318"'';
    }
    {
      from = ''"http://127.0.0.1:3100/otlp"'';
      to = ''"${endpoints.loki.otlp}"'';
    }
    {
      from = ''endpoint = "127.0.0.1:4317"'';
      to = ''endpoint = "${endpoints.tempo.otlpGrpc}"'';
    }
    {
      from = ''"http://127.0.0.1:9090/api/v1/write"'';
      to = ''"${endpoints.mimir.push}"'';
    }
  ];
  hostConfig = builtins.readFile ../../../../stacks/observability/nixos/ingest.alloy;
  ingestConfig =
    let
      froms = map (r: r.from) replacements;
      missing = lib.filter (from: !lib.hasInfix from hostConfig) froms;
      result = builtins.replaceStrings froms (map (r: r.to) replacements) hostConfig;
    in
    assert lib.assertMsg (
      missing == [ ]
    ) "ingest.alloy no longer contains ${lib.concatStringsSep ", " missing}; update modules/ingest.nix";
    assert lib.assertMsg (
      !lib.hasInfix "127.0.0.1" result
    ) "ingest.alloy has a loopback address modules/ingest.nix doesn't replace";
    result;
in
{
  applications.alloy-ingest = {
    inherit namespace;

    helm.releases.${name} = {
      chart = charts.grafana.alloy;
      values = {
        crds.create = false;
        # The image starts as root; 473 is its `alloy` user.
        global.podSecurityContext = workload.podSecurity 473;
        # It reads nothing from the Kubernetes API.
        rbac.create = false;
        serviceAccount.automountServiceAccountToken = false;

        controller = {
          type = "deployment";
          replicas = 2;
          updateStrategy = workload.surgeOne;
          topologySpreadConstraints = workload.spread selector;
          podDisruptionBudget = {
            enabled = true;
            maxUnavailable = 1;
          };
          podLabels = endpoints.clientLabels.write;
          terminationGracePeriodSeconds = 60;
          volumes.extra = [
            {
              name = "credentials";
              secret.secretName = name;
            }
            {
              name = "data";
              emptyDir = { };
            }
          ];
        };

        alloy = {
          configMap.content = ingestConfig;
          storagePath = "/var/lib/alloy";
          enableReporting = false;
          # ingest.alloy reads the token from $CREDENTIALS_DIRECTORY/otlp_token,
          # as under systemd on the host.
          extraEnv = [
            {
              name = "CREDENTIALS_DIRECTORY";
              value = credentials;
            }
          ];
          extraPorts = [
            {
              name = "otlp-http";
              port = 4318;
              targetPort = 4318;
              protocol = "TCP";
            }
          ];
          mounts.extra = [
            {
              name = "credentials";
              mountPath = credentials;
              readOnly = true;
            }
            {
              name = "data";
              mountPath = "/var/lib/alloy";
            }
          ];
          securityContext = workload.containerSecurity;
          # Stay in the Service while kube-proxy everywhere drops this pod;
          # then Alloy flushes its queues on SIGTERM.
          lifecycle.preStop.sleep.seconds = 10;
          # The host's MemoryMax; ingest.alloy's memory limiter starts
          # refusing data at 768 MiB.
          resources = {
            requests = {
              cpu = "100m";
              memory = "512Mi";
            };
            limits.memory = "1536Mi";
          };
        };

        configReloader.securityContext = workload.containerSecurity;
      };
    };

    yamls = [
      (workload.externalSecret cluster {
        inherit name;
        properties = [ "otlp_token" ];
      })
    ];

    resources.networkPolicies.${name}.spec = {
      podSelector.matchLabels = selector;
      policyTypes = [
        "Ingress"
        "Egress"
      ];
      ingress = [
        {
          from = [ (workload.pods { "app.kubernetes.io/name" = "edge"; }) ];
          ports = workload.tcpPorts [ 4318 ];
        }
      ];
      # Loki OTLP, Mimir remote write, Tempo OTLP gRPC.
      egress = [
        {
          to = [ workload.anyPod ];
          ports = workload.tcpPorts [
            3100
            8080
            4317
          ];
        }
      ];
    };
  };
}
