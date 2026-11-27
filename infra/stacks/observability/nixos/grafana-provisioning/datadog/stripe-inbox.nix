# infra/stacks/monitoring/monitors/stripe-inbox.ts
{ q, ... }:
let
  # Datadog's `"<phrase>"` terms as one case-insensitive regex of whole words.
  lines =
    {
      phrases,
      errorsOnly,
      range,
    }:
    q.loki ''sum by (consumer) (count_over_time({service_name="authentication-service", deployment_environment="prod"} |~ "(?i)\\b(${builtins.concatStringsSep "|" phrases})\\b"${
      if errorsOnly then ''| detected_level="error"'' else ""
    } [${range}]))'';
  translation = "Datadog's log query in Loki, per `consumer`. Validated on dev's logs, where the same query finds `personal_plan` dead cursors and `computers` backlog lines. Prod logs reach Loki when authentication-service's prod sending is turned on; until then this rule has no data.";
in
{
  source = "monitors/stripe-inbox.ts";
  interval = "1m";
  monitors = [
    {
      monitor = "stripe-inbox-dead-letter-prod";
      datadogId = null;
      route = "page";
      name = "[PROD] Stripe inbox: {{consumer.name}} dead-lettered an event";
      environment = "prod";
      service = "authentication-service";
      inputs = [
        {
          id = "lines";
          query = lines {
            phrases = [
              "stripe inbox cursor dead-lettered"
              "stripe inbox dead cursors"
            ];
            errorsOnly = true;
            range = "30m";
          };
        }
      ];
      window = 1800;
      comparator = ">";
      critical = 0;
      inherit translation;
    }
    {
      monitor = "stripe-inbox-backlog-prod";
      datadogId = null;
      route = "page";
      name = "[PROD] Stripe inbox: {{consumer.name}} is applying events late";
      environment = "prod";
      service = "authentication-service";
      inputs = [
        {
          id = "lines";
          query = lines {
            phrases = [ "stripe inbox backlog" ];
            errorsOnly = false;
            range = "15m";
          };
        }
      ];
      window = 900;
      comparator = ">";
      critical = 5;
      inherit translation;
    }
  ];
}
