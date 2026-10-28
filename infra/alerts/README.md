# Alert rule catalog

`rules.json` is the single list of prod threshold and anomaly rules. Datadog
monitors and the Grafana mirror are both generated from it, so a rule's
thresholds, window, severity and paging decision live in one place.

| Generator | Reads | Produces |
| --- | --- | --- |
| `infra/stacks/monitoring/monitors/catalog.ts` | `datadog` block | one Datadog monitor per rule, `catalog-<id>` |
| `infra/stacks/observability/nixos/alerting.nix` | `grafana.cloudwatch` block, via `builtins.fromJSON` | Grafana alert rules for the Ohio observability host |

`bun test alerts` (from `infra/`) validates the file: see `rules.test.ts`.

## Fields

| Field | Meaning |
| --- | --- |
| `id` | Stable kebab-case id; part of the Datadog resource name and the `catalog:` tag. Renaming it replaces the monitor. |
| `title` | Monitor name, prefixed `[PROD]` in Datadog. |
| `service` | Value of the `service:` tag. |
| `comparison` | `above` or `below` the thresholds. |
| `window` | Evaluation window (`10m`, `1h`, `4h`); for forecast rules, how far ahead to look (`1w`). |
| `thresholds` | `critical` (required) and `warning` (optional, before `critical` in the comparison's direction). |
| `pages` | `true`: a critical alert pages on-call through GoAlert. Warnings never page. |
| `pager` | `datadog` or `grafana`: which side pages while both evaluate the rule. The other only posts to the Macro Alerts channel, so one incident never pages twice. |
| `description` | What the alert means and where to look first; Datadog template variables such as `{{value}}` are allowed. |
| `runbook` | Repository path with a heading anchor, e.g. `docs/runbooks/macrodb.md#memory`. |
| `datadog.query` | The complete monitor query, threshold included. Its comparison, window and critical value must agree with the fields above. |
| `datadog.thresholdWindows` | Anomaly rules only: trigger window equal to the query's `alert_window`, and a recovery window. |
| `grafana.cloudwatch` | `namespace`, `metricName`, `dimensions` (dimension name to the list of values to alert on, one alert per value), `statistic` (`Average`, `Maximum`, `Minimum`, `Sum`) and `reducer` (`mean`, `max`, `min`, `sum`, how the window reduces to one value). Region is us-east-1. |
| `grafana.gap` | Instead of `cloudwatch`: why Grafana can't evaluate the rule (no prod logs or traces in Grafana, no anomaly or forecast functions, Database Monitoring metrics). |

## Adding a rule

1. Pick the metric and check two weeks of data, so `warning` sits above normal
   peaks and `critical` at a level that means real trouble.
2. Write the Datadog query and validate it (Datadog's monitor validate
   endpoint, or the monitor editor without saving).
3. Add the CloudWatch equivalent or a `gap`, and a runbook section.
4. Run `bun test --isolate alerts stacks/monitoring` from `infra/`.

Rules the catalog can't express (log monitors, formulas, synthetics) stay
hand-written in `infra/stacks/monitoring/monitors/*.ts`.
