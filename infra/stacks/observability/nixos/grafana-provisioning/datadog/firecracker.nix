# infra/stacks/monitoring/monitors/firecracker.ts
#
# The Firecracker host agent's own metrics (`firecracker_host.*`) go only to
# the host's Datadog agent today, and none of these monitors is deployed to
# Datadog. The agent's two are not ported: the cluster has no series for them
# and no labels to write the rules against until the host sends them. The
# memory one reads agent-harness-service's gauges.
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
      status = "not-ported";
      reason = "Reads the host agent's `firecracker_host.golden.builds` counter, which reaches only the host's Datadog agent. OTLP sent to the cluster's ingest would keep `host.name` and `deployment.environment` on `target_info`, not on the series, so the labels a rule needs depend on how the host sends them (its Alloy's `host` and `deployment_environment` external labels, as for the fleet dashboard, would do). Port it with that change.";
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
          query = q.prometheus ''avg_over_time((max by (host) (computer_host_memory_used_ratio{deployment_environment="prod"}) / min by (host) (computer_host_memory_high_watermark_ratio{deployment_environment="prod"}))[5m:1m])'';
        }
      ];
      window = 300;
      comparator = ">";
      critical = 1;
      translation = "Used over high-watermark memory per host, averaged over 5 minutes at one-minute steps, from the gauges agent-harness-service reports per host (`host` is the gauges' own attribute; in Mimir from local stacks). On ECS the telemetry sidecar sets `deployment.environment` on every datapoint (`infra/packages/resources/src/resources/ecs-telemetry.alloy`), so the series carry `deployment_environment` as dev's do today. No data until agent-harness-service's prod sending is turned on.";
    })
    (monitor {
      monitor = "firecracker-host-unhealthy";
      name = "[PROD] Firecracker host agent unhealthy";
      status = "not-ported";
      reason = "Reads the host agent's `firecracker_host.ready` gauge, which reaches only the host's Datadog agent; as for the golden secret refusals, port it once the host sends its metrics to the cluster with per-host labels. Datadog's query is the per-host minimum's maximum over 2 minutes, below 1, with a 5-minute no-data alert per host.";
    })
  ];
}
