{ pkgs, ... }:
let
  tempo = {
    type = "tempo";
    uid = "tempo";
  };
  selector = ''resource.service.name="github-actions" && resource.deployment.environment="ci"'';
  panel = id: title: description: filter: fields: {
    inherit id title description;
    type = "table";
    datasource = tempo;
    gridPos = {
      x = 0;
      y = (id - 1) * 10;
      w = 24;
      h = 10;
    };
    targets = [
      {
        refId = "A";
        queryType = "traceql";
        query = "{ ${selector} && ${filter} } | select(name, ${fields})";
        tableType = "spans";
        limit = 100;
        spss = 100;
      }
    ];
    transformations = [
      {
        id = "organize";
        options = {
          excludeByName = {
            "Trace Service" = true;
            "deployment.environment" = true;
            "service.name" = true;
            workflow_run_id = true;
            job_id = true;
            workflow_name = true;
            job_name = true;
            step_name = true;
          };
          indexByName = {
            "Name" = 0;
            conclusion = 1;
            "Duration" = 2;
            "Start time" = 3;
            "Span ID" = 4;
            "Trace Name" = 5;
          };
        };
      }
    ];
    options.showHeader = true;
  };
  dashboard = {
    uid = "macro-ci";
    title = "Macro CI";
    description = "GitHub Actions workflow, job and step traces exported after completion. Select a trace to open its execution waterfall. Tables are bounded search results, not complete counts or percentile summaries. Narrow the time range when there are many runs.";
    schemaVersion = 39;
    version = 2;
    editable = false;
    tags = [
      "macro"
      "ci"
    ];
    timezone = "browser";
    refresh = "1m";
    time = {
      from = "now-24h";
      to = "now";
    };
    panels = [
      (panel 1 "Workflow runs — open a trace for jobs and steps"
        "Workflow duration includes waiting; for reruns the upstream exporter starts the root span at the original run creation. Use job durations for execution timing. The url attribute links to GitHub."
        "span.workflow_run_id != nil"
        "span.workflow_name, span.conclusion, span.run_attempt, span.url"
      )
      (panel 2 "Failed, cancelled or timed-out jobs"
        "Cancellation is included; inspect the conclusion attribute to distinguish it from a failure."
        "span.job_id != nil && status = error"
        "span.workflow_name, span.job_name, span.conclusion, span.runner_name"
      )
      (panel 3 "Jobs taking more than five minutes"
        "Job span duration measures execution, excluding runner queue time."
        "span.job_id != nil && duration > 5m"
        "span.workflow_name, span.job_name, span.conclusion, span.runner_name"
      )
      (panel 4 "Failed, cancelled or timed-out steps"
        "Open the trace to see the step in its parent job and workflow. Raw build logs and individual test cases remain in GitHub."
        "span.step_name != nil && status = error"
        "span.step_name, span.conclusion"
      )
    ];
  };
in
{
  services.grafana.provision.dashboards.settings.providers = [
    {
      name = "macro-ci";
      orgId = 1;
      folder = "Macro";
      type = "file";
      disableDeletion = true;
      allowUiUpdates = false;
      options.path = pkgs.linkFarm "macro-ci-dashboard" [
        {
          name = "ci.json";
          path = pkgs.writeText "ci.json" (builtins.toJSON dashboard);
        }
      ];
    }
  ];
}
