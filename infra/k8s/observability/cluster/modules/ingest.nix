# Alloy ingest: the OTLP receiver behind the edge. It runs the host's own
# infra/stacks/observability/nixos/ingest.alloy with the cluster's addresses
# swapped in: it checks the bearer token (the secret's `otlp_token`), then
# sends logs to Loki, traces to the sampler (./sampler) and metrics to Mimir.
# Two replicas in different zones; the edge reaches them through their Service.
#
# The cluster adds CloudWatch Logs from Amazon Data Firehose on port 4319
# (./ingest-firehose.alloy), which join the OTLP logs at the memory limiter.
#
# It also forwards the spans and log records that metrics are derived from to the
# `derived-metrics` application (`macro.derivedMetrics.ingestTap`).
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
    # The sampler's headless Service.
    {
      from = ''hostname = "127.0.0.1"'';
      to = ''hostname = "alloy-sampler.${namespace}.svc.cluster.local"'';
    }
    {
      from = ''"http://127.0.0.1:9090/api/v1/write"'';
      to = ''"${endpoints.mimir.push}"'';
    }
    # The cluster's own: room for the copy of a log batch the derived-metrics tap
    # makes, so a burst that fit before it still fits.
    {
      from = ''limit = "768MiB"'';
      to = ''limit = "1536MiB"'';
    }
    # The cluster's own: every span and log record also goes to the
    # derived-metrics tap.
    {
      from = "logs = [otelcol.exporter.otlphttp.loki.input]";
      to = "logs = [otelcol.exporter.otlphttp.loki.input, otelcol.processor.filter.derived.input]";
    }
    {
      from = "traces = [otelcol.exporter.loadbalancing.sampler.input]";
      to = "traces = [otelcol.exporter.loadbalancing.sampler.input, otelcol.processor.filter.derived.input]";
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
    result + "\n" + firehoseConfig + "\n" + config.macro.derivedMetrics.ingestTap;
  firehosePort = config.macro.ingest.firehosePort;
  firehoseConfig = builtins.replaceStrings [ "@FIREHOSE_PORT@" ] [ (toString firehosePort) ] (
    builtins.readFile ./ingest-firehose.alloy
  );
in
{
  options.macro.ingest.firehosePort = lib.mkOption {
    type = lib.types.port;
    readOnly = true;
    default = 4319;
    description = "Alloy ingest's port for Amazon Data Firehose deliveries; the edge's /awsfirehose/api/v1/push proxies to it.";
  };

  config.applications.alloy-ingest = {
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
            {
              name = "firehose";
              port = firehosePort;
              targetPort = firehosePort;
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
          # 1 GiB above the memory limiter's limit.
          resources = {
            requests = {
              cpu = "100m";
              memory = "512Mi";
            };
            limits.memory = "2560Mi";
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
          ports = workload.tcpPorts [
            4318
            firehosePort
          ];
        }
        workload.scrapedByNodeAlloy
      ];
      # Loki OTLP, Mimir remote write, the sampler's OTLP gRPC.
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
