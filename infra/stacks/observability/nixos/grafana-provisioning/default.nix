# Everything Grafana provisions, as plain data: datasources, dashboards, alert
# rules, contact points and the notification policy. The observability
# cluster's Grafana (`infra/k8s/observability/cluster`) imports it; the NixOS
# host no longer runs Grafana, and its image does not read this directory.
#
# What depends on where Grafana runs is a parameter:
# - `goalertUrl`: GoAlert's base URL, without a trailing slash.
# - `datasourceUrls`: the `prometheus`, `loki` and `tempo` query endpoints.
#
# Grafana itself must also have, wherever it runs:
# - `GRAFANA_ALERT_TOPIC_ARN`, `GOALERT_GRAFANA_KEY` and
#   `GOALERT_GRAFANA_NOTIFY_KEY` in its environment; the contact points expand
#   them;
# - AWS credentials from the default chain that can read CloudWatch in
#   us-east-1 and publish to that SNS topic in us-east-2.
{
  lib,
  goalertUrl,
  datasourceUrls,
}:
let
  dashboard = file: import file { inherit lib; };
  dev = dashboard ./dashboards.nix;
  provider = name: files: {
    inherit name files;
    folder = "Macro";
  };
in
{
  datasources = import ./datasources.nix { urls = datasourceUrls; };

  # Grafana `alerting` provisioning documents: `contactPoints`, `policies`, `rules`.
  alerting = import ./alerting.nix { inherit lib goalertUrl; };

  # One dashboard provider each, in the order the host has always listed them
  # (its system's store path depends on it). `files` is a list of
  # { name = "<file>.json"; dashboard = <dashboard JSON>; }.
  dashboards = [
    (provider "macro-email-focus" [
      {
        name = "email-focus-rollout.json";
        dashboard = dashboard ./email-focus-dashboard.nix;
      }
    ])
    (provider "macro-prod-alerts" [
      {
        name = "prod-alerts.json";
        dashboard = dashboard ./prod-alerts-dashboard.nix;
      }
    ])
    (provider "macro-postgres-queries" [
      {
        name = "postgres-queries.json";
        dashboard = dashboard ./database-queries-dashboard.nix;
      }
    ])
    (provider "macro-postgres" [
      {
        name = "postgres.json";
        dashboard = dashboard ./database-dashboard.nix;
      }
    ])
    (provider "macro-computers-fleet" [
      {
        name = "computers-fleet.json";
        dashboard = dashboard ./computers-dashboard.nix;
      }
    ])
    (provider "macro-run-local" [
      {
        name = "run-local.json";
        dashboard = dashboard ./local-dashboard.nix;
      }
    ])
    (provider "macro-ci" [
      {
        name = "ci.json";
        dashboard = dashboard ./ci-dashboard.nix;
      }
    ])
    (provider "macro" [
      {
        name = "dev.json";
        dashboard = dev.dev;
      }
      {
        name = "database.json";
        dashboard = dev.database;
      }
    ])
  ];
}
