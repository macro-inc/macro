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
      url = "http://127.0.0.1:8081/prometheus";
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
      url = "http://127.0.0.1:8081/loki";
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
      url = "http://127.0.0.1:8081/tempo";
      editable = false;
      jsonData = {
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
