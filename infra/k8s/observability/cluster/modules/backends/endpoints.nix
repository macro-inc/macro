# How the rest of the cluster reaches Loki, Tempo and Mimir: plain data, so
# Grafana's query gateway, Alloy ingest and the node Alloy import it instead of
# spelling addresses out (`import ./backends/endpoints.nix`).
#
# None of the backends takes a tenant header: Loki runs with auth off (tenant
# `fake`), Tempo and Mimir without multitenancy.
#
# A pod in `observability` gets through the backends' NetworkPolicies by
# carrying one of `clientLabels`; the node Alloy (namespace `alloy`) is let in
# by namespace.
let
  namespace = "observability";
  host = service: "${service}.${namespace}.svc.cluster.local";
  loki = "http://${host "loki"}:3100";
  mimir = "http://${host "mimir"}:8080";
in
{
  inherit namespace;

  loki = {
    # Loki's push API (JSON or protobuf), as the host's /loki/api/v1/push.
    push = "${loki}/loki/api/v1/push";
    # OTLP/HTTP logs; an otlphttp exporter appends /v1/logs.
    otlp = "${loki}/otlp";
    # Query base: the Loki API is under it at /loki/api/v1/..., as Grafana's
    # Loki datasource expects. Same paths as the host's 127.0.0.1:3100.
    query = loki;
  };

  tempo = {
    # OTLP gRPC (host:port, plaintext), as the host's 127.0.0.1:4317.
    otlpGrpc = "${host "tempo-distributor"}:4317";
    # OTLP/HTTP; an otlphttp exporter appends /v1/traces.
    otlpHttp = "http://${host "tempo-distributor"}:4318";
    # Query base: /api/search, /api/traces/<id>, /api/v2/..., /api/metrics/...
    # Same paths as the host's 127.0.0.1:3200.
    query = "http://${host "tempo-query-frontend"}:3200";
  };

  mimir = {
    # Prometheus remote write. The host's Prometheus took it at /api/v1/write.
    push = "${mimir}/api/v1/push";
    # OTLP/HTTP metrics; an otlphttp exporter appends /v1/metrics.
    otlp = "${mimir}/otlp";
    # Query base: the Prometheus API is under it at /api/v1/..., as Grafana's
    # Prometheus datasource expects. The host's 127.0.0.1:9090 had no prefix.
    query = "${mimir}/prometheus";
  };

  clientLabels = {
    # Alloy ingest: the push and OTLP endpoints above.
    write."observability.macro.com/telemetry-write" = "true";
    # The query gateway: the query bases above.
    read."observability.macro.com/telemetry-read" = "true";
  };
}
