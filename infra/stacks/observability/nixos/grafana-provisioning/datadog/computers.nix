# infra/stacks/monitoring/monitors/computers.ts
{ q, ... }:
let
  # Datadog's `service:<service> status:error "<phrase>" env:prod`, counted per
  # `@<by>` over `range`: Loki's `detected_level` is Datadog's status (the
  # record's level), and a phrase matches the message, in any case, as whole
  # words.
  errors =
    service: phrase: by: range:
    q.loki ''sum by (${by}) (count_over_time({service_name="${service}", deployment_environment="prod"} |~ "(?i)\\b${phrase}\\b" | detected_level="error" [${range}]))'';
  translation = "Datadog's log query in Loki. Prod logs reach Loki as each service's prod sending is turned on; until then this rule has no data.";
  computer = monitor: datadogName: service: phrase: range: window: {
    inherit
      monitor
      service
      window
      translation
      ;
    datadogId = null;
    route = "page";
    name = datadogName;
    environment = "prod";
    inputs = [
      {
        id = "lines";
        query = errors service phrase "computer_id" range;
      }
    ];
    comparator = ">";
    critical = 0;
  };
in
{
  source = "monitors/computers.ts";
  interval = "1m";
  monitors = [
    (computer "computer-billing-removal-abandoned-prod"
      "[PROD] Computers: billing item removal abandoned for {{computer_id.name}}"
      "authentication-service"
      "computer billing item removal abandoned"
      "1h"
      3600
    )
    (computer "computer-purchase-refund-abandoned-prod"
      "[PROD] Computers: purchase refund abandoned for {{computer_id.name}}"
      "authentication-service"
      "computer purchase refund abandoned"
      "1h"
      3600
    )
    (computer "computer-purchase-refund-unmatched-prod"
      "[PROD] Computers: no purchase found to refund for {{computer_id.name}}"
      "authentication-service"
      "computer purchase refund found no paid purchase"
      "1h"
      3600
    )
    (computer "computer-needs-operator-prod" "[PROD] Computers: {{computer_id.name}} needs an operator"
      "agent-harness-service"
      "computer needs an operator"
      "15m"
      900
    )
  ];
}
