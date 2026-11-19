# Grafana's datasources provisioning document. The uids are what dashboards,
# rules and links name, so they stay fixed wherever Grafana runs.
#
# `urls` holds the query endpoints Grafana reaches: `prometheus`, `loki`, `tempo`.
{ urls }:
{
  apiVersion = 1;
  datasources = [
    {
      name = "CloudWatch";
      uid = "cloudwatch";
      type = "cloudwatch";
      access = "proxy";
      editable = false;
      jsonData = {
        authType = "default";
        defaultRegion = "us-east-1";
      };
    }
    {
      name = "Prometheus";
      uid = "prometheus";
      type = "prometheus";
      access = "proxy";
      url = urls.prometheus;
      editable = false;
      isDefault = true;
      jsonData = {
        timeInterval = "30s";
        exemplarTraceIdDestinations = [
          {
            name = "traceID";
            datasourceUid = "tempo";
          }
        ];
      };
    }
    {
      name = "Loki";
      uid = "loki";
      type = "loki";
      access = "proxy";
      url = urls.loki;
      editable = false;
      jsonData.derivedFields = [
        {
          name = "trace_id";
          matcherType = "label";
          matcherRegex = "trace_id";
          datasourceUid = "tempo";
          url = "$\${__value.raw}";
          urlDisplayLabel = "View trace";
        }
      ];
    }
    {
      name = "Tempo";
      uid = "tempo";
      type = "tempo";
      access = "proxy";
      url = urls.tempo;
      editable = false;
      jsonData = {
        # Variables and autocomplete read tag values from the stored blocks of the
        # last 7 days (the retention), not only the last half hour still in memory.
        timeRangeForTags = 604800;
        serviceMap.datasourceUid = "prometheus";
        nodeGraph.enabled = true;
        tracesToLogsV2 = {
          datasourceUid = "loki";
          spanStartTimeShift = "-1m";
          spanEndTimeShift = "1m";
          tags = [
            {
              key = "service.name";
              value = "service_name";
            }
            {
              key = "deployment.environment";
              value = "deployment_environment";
            }
          ];
          # FireLens logs do not always have a trace ID; show the service's logs in the span window.
          filterByTraceID = false;
          filterBySpanID = false;
        };
        tracesToMetrics = {
          datasourceUid = "prometheus";
          tags = [
            {
              key = "service.name";
              value = "service";
            }
          ];
          queries = [
            {
              name = "Recorded span rate";
              query = "sum(rate(traces_spanmetrics_calls_total{$\${__tags}}[5m]))";
            }
          ];
        };
      };
    }
  ];
}
