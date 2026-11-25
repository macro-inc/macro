# MAPPING.md: each Datadog metric and what replaces it, from the definitions.
{ lib }:
let
  spans = import ./spans.nix { inherit lib; };
  logs = import ./logs.nix { inherit lib; };
  code = text: "`${text}`";
  labels =
    m:
    lib.concatStringsSep ", " (
      lib.mapAttrsToList (
        tag: label: if tag == label then code label else "${code tag} → ${code label}"
      ) m.labels
    );
  table = metrics: ''
    | Datadog | Mimir | Kind | Unit | Labels |
    | --- | --- | --- | --- | --- |
    ${lib.concatMapStringsSep "\n" row metrics}
  '';
  row =
    m:
    "| ${code m.name} | ${code m.metric} | ${m.kind} | ${
      if m.value != "duration" then
        ""
      else if lib.hasPrefix "ml_obs." m.name then
        "seconds"
      else
        "seconds, not nanoseconds"
    } | ${labels m} |";
in
''
  # Derived metrics: Datadog to Mimir

  Generated from `modules/derived-metrics/*.nix` by `nix run .#render`; edit those.
  To use the mapping from Nix, import `spans.nix` and `logs.nix`: each entry of
  their `metrics` has the Datadog `name`, the Mimir `metric`, its `kind` and
  `labels` (Datadog tag to Mimir label).

  Rules:

  - Dots become underscores, in metric names and in tags. `env` is
    `deployment_environment`; tag values are unchanged (Datadog lowercases them,
    Mimir doesn't). A span or record without the tag has no such label (Datadog:
    `N/A`).
  - Durations (`@duration`) are in seconds and end in `_seconds`; a Datadog
    threshold on one is in nanoseconds (`ml_obs.*`: seconds). Fields that were already in milliseconds
    or bytes stay so.
  - ${
    lib.concatMapStringsSep ", " code spans.openTags
  } is a plain name or `other`: some agent harnesses put a whole
    command in it. Datadog keeps that; here `other` is every call whose tool
    name is missing or not plain (ingest removes the ones that aren't).
  - `job="derived-metrics"` and `instance` (which of the two replicas counted) are
    on every series: always aggregate them away.

  ## Translating a query

  A series holds one sample per 30 s in which something happened: what happened
  in those 30 s (OpenTelemetry delta temporality). Windows are summed with
  `sum_over_time`. `rate` and `increase` expect counters and give wrong numbers.

  | Datadog | PromQL |
  | --- | --- |
  | `sum:COUNT{env:prod} by {tool}.as_count()` over 1h | `sum by (tool) (sum_over_time(COUNT{deployment_environment="prod"}[1h]))` |
  | `count:DIST{...}` over 1h | `histogram_count(sum(sum_over_time(DIST{...}[1h])))` |
  | `sum:DIST{...}` over 1h | `histogram_sum(sum(sum_over_time(DIST{...}[1h])))` |
  | `avg:DIST{...}` over 1h | `histogram_avg(sum(sum_over_time(DIST{...}[1h])))` |
  | `p95:DIST{...} by {model}` over 1h | `histogram_quantile(0.95, sum by (model) (sum_over_time(DIST{...}[1h])))` |
  | `max:DIST{...}`, `min:DIST{...}` | `histogram_quantile(1, ...)`, `histogram_quantile(0, ...)` |

  Distributions are native histograms: no `_bucket`, `_sum` or `_count` series.
  Counts, sums and averages are exact; quantiles, minimum and maximum are within a
  bucket (a few percent, up to 20 % where one series mixes values a hundred
  thousand apart; Datadog's sketches are within 1 %).
  Nothing happening means no sample: an ungrouped query that has to give zero needs
  `or vector(0)`; a grouped one has no series for a group where nothing happened.

  Metrics of production services need those services to send to Grafana: until one
  does, its metrics have no `deployment_environment="prod"`.

  ## From spans

  - `ml_obs.*` are Datadog's LLM Observability metrics for model calls (its
    `span_kind:llm`), by any service; its `ml_app` is `service`. Agents, tools and
    workflows are the `macro.agent.*` metrics. The model is the one that answered,
    or else the one asked for. AI editing marks each of its steps as a model call,
    so those last until the step's tools are done and have no model.
  - For `ml_obs.span.llm.total.cost` (in nanodollars, estimated from spans) there is
    `macro.ai.usage.cost_usd`: in dollars, of the usage the services price and log.
  - `macro.genai.chat.time_to_first_chunk_ms` isn't in Datadog.

  ${table spans.metrics}
  ## From logs

  Computed from the log records ingest receives, before Loki.

  - Datadog's `status` is the record's `level` field by its first letters, or else
    its OpenTelemetry severity; `status:error` is neither critical nor fatal. A
    phrase in a definition matches anywhere in the message, in any case, as
    whole words.
  - `service` is the OpenTelemetry service name, without the environment Datadog
    has in some (`email-service-pubsub-workers-prod`).
  - `macro.logs.errors` counts prod only in Datadog and has no `env` there; here it
    counts every environment, by `deployment_environment`: a ported monitor needs
    `deployment_environment="prod"`.
  - `TimeToFirstToken` and `TimeToSendRequest` read the log field `metric`.
    Datadog's, made in its UI, read `event`, which nothing sets any more, so they
    are empty there.

  ${table logs.metrics}''
