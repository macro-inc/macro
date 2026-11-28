# infra/stacks/monitoring/monitors/ai-providers.ts
{ q, ... }:
{
  source = "monitors/ai-providers.ts";
  interval = "1m";
  monitors = [
    {
      monitor = "ai-provider-account-unavailable";
      datadogId = null;
      route = "page";
      name = "[PROD] AI provider account suspended or out of credit";
      environment = "prod";
      service = "agent-harness-service";
      inputs = [
        {
          id = "unavailable";
          # A derived metric: delta samples, so `sum_over_time`.
          query = q.prometheus ''sum by (provider, reason) (sum_over_time(macro_ai_provider_account_unavailable{deployment_environment="prod"}[5m]))'';
        }
      ];
      window = 300;
      comparator = ">=";
      critical = 1;
      translation = "The derived metric `macro_ai_provider_account_unavailable`, computed from the same log lines. On dev's it finds fireworks `suspended` (29 in a five-minute window this week). Prod logs reach it when agent-harness-service's prod sending is turned on.";
    }
  ];
}
