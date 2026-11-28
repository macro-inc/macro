# infra/stacks/monitoring/monitors/rum.ts
{ ... }:
{
  source = "monitors/rum.ts";
  interval = "1m";
  monitors = [
    {
      monitor = "web-app-source-errors-prod";
      datadogId = 1189349;
      route = "page";
      name = "[PROD] Web-App Source Error";
      status = "not-ported";
      reason = "It counts distinct RUM views with source errors against all views, and nothing in Grafana records browser views: the web app's telemetry has no RUM equivalent there. Datadog has no data for it either (the monitor shows No Data).";
    }
  ];
}
