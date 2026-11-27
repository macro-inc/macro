# infra/stacks/monitoring/monitors/firecracker.ts
#
# The Firecracker host agent's own metrics (`firecracker_host.*`) go only to
# the host's Datadog agent today; Grafana has none yet. These rules read them
# by the names the cluster's OTLP translation gives (`.` → `_`, counters
# `_total`, unit-1 gauges `_ratio`), labelled `host_name` for Datadog's
# `host`, so they work once the host sends OTLP to the cluster.
{ q, ... }:
let
  monitor =
    attrs:
    {
      datadogId = null;
      route = "page";
      environment = "prod";
      service = "firecracker-host";
    }
    // attrs;
in
{
  source = "monitors/firecracker.ts";
  interval = "1m";
  monitors = [
    (monitor {
      monitor = "firecracker-golden-secret-refused";
      name = "[PROD] Firecracker golden secret scan refused";
      inputs = [
        {
          id = "refused";
          query = q.prometheus ''sum by (host_name) (increase(firecracker_host_golden_builds_total{deployment_environment="prod", outcome="secret_refused"}[10m]))'';
        }
      ];
      window = 600;
      comparator = ">=";
      critical = 1;
      translation = "The golden build counter's increase over 10 minutes. `increase` misses a host's very first refusal (the counter appears at 1), which Datadog's `default_zero` counts. No data until the host sends its metrics to the cluster.";
    })
    (monitor {
      monitor = "firecracker-host-memory";
      name = "[PROD] Firecracker host memory above high watermark";
      # agent-harness-service reports these per host (hosted_runtimes), not
      # the host agent: Mimir has them from local stacks.
      service = "agent-harness-service";
      inputs = [
        {
          id = "pressure";
          query = q.prometheus ''max by (host) (avg_over_time(computer_host_memory_used_ratio{deployment_environment="prod"}[5m])) / min by (host) (avg_over_time(computer_host_memory_high_watermark_ratio{deployment_environment="prod"}[5m]))'';
        }
      ];
      window = 300;
      comparator = ">";
      critical = 1;
      translation = "Used over high-watermark memory per host, from the gauges agent-harness-service reports (seen in Mimir from local stacks, labelled `host`). Datadog averages the ratio over 5 minutes; this divides the 5-minute averages. No data until agent-harness-service's prod sending is turned on.";
    })
    (monitor {
      monitor = "firecracker-host-unhealthy";
      name = "[PROD] Firecracker host agent unhealthy";
      inputs = [
        {
          id = "ready";
          # A host seen in the last hour that has sent nothing for 5 minutes
          # counts as 0, as Datadog's no-data alert for that host.
          query = q.prometheus ''min by (host_name) (min_over_time(firecracker_host_ready_ratio{deployment_environment="prod"}[2m])) or (0 * (max by (host_name) (max_over_time(firecracker_host_ready_ratio{deployment_environment="prod"}[1h])) unless max by (host_name) (max_over_time(firecracker_host_ready_ratio{deployment_environment="prod"}[5m]))))'';
        }
      ];
      window = 3600;
      comparator = "<";
      critical = 1;
      translation = "The readiness gauge's minimum over 2 minutes per host. Datadog's no-data alert (5 minutes) becomes 0 for a host seen in the last hour that stopped sending; a host gone for over an hour, or every host at once before any arrive, is no data, which is OK here. No data until the host sends its metrics to the cluster.";
    })
  ];
}
