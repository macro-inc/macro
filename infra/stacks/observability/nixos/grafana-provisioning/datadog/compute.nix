# infra/stacks/monitoring/monitors/compute.ts
{ q, ... }:
{
  source = "monitors/compute.ts";
  interval = "1m";
  monitors = [
    {
      monitor = "lambda-error-count";
      datadogId = 1065393;
      route = "page";
      name = "[PROD] Lambda Increased Error Count";
      environment = "prod";
      service = "lambda";
      inputs = [
        {
          id = "errors";
          reducer = "sum";
          query = q.cloudwatch {
            namespace = "AWS/Lambda";
            metricName = "Errors";
            # Datadog's `(level:prod OR environment:prod) AND NOT
            # functionname:ws-api-gateway-authorizer-lambda-prod`: the
            # functions it evaluated when this was written. CloudWatch has no
            # tags to select by.
            dimensions.FunctionName = [
              "call_recording_preview_handler-prod"
              "dataloss_prevention_handler-prod"
              "document-text-extractor-prod"
              "document-upload-finalizer-lambda-prod"
              "docx-unzip-lambda-prod"
              "docx-upload-job-table-cleanup-lambda-prod"
              "email_refresh_handler-prod"
              "email_scheduled_handler-prod"
              "job-submission-handler-lambda-prod"
              "job-to-dpr-table-cleanup-lambda-prod"
              "job-update-handler-lambda-prod"
              "notification_retention_handler-prod"
              "pdf-preprocess-lambda-prod"
              "search_upload_handler-prod"
              "sha-cleanup-trigger-prod"
              "static-file-service-image-optimizer-prod"
              "ws-connection-init-handler-lambda-prod"
              "ws-ping-response-handler-prod"
            ];
            statistic = "Sum";
          };
        }
      ];
      # `.as_rate()` over Datadog's one-minute points: the hour's errors / 60
      # (Datadog's 59.72 was 3583 errors).
      value = "$errors / 60";
      window = 3600;
      delay = 900;
      comparator = ">";
      critical = 500;
      warning = 100;
      translation = "Errors per function over the hour, divided by 60 as Datadog's `.as_rate()` of a `sum(last_1h)` comes out. The functions are Datadog's tag selection when this was written: a new prod function needs adding here.";
      comparison = "Replay, 2026-11-13 05:00 to 11-28 00:00 UTC: job-update-handler-lambda-prod warned 41 times in both, each episode overlapping one in the other and every Grafana episode starting and ending within a minute of Datadog's; the other 17 functions fired in neither, and neither went critical. Same state in 99.6% of minutes. Live, 2026-11-27 23:43 to 11-28 00:48 UTC: neither fired.";
    }
  ];
}
