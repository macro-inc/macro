# Error and latency regression alerts

Runbook for the per-service anomaly monitors in
[`monitors/regressions.ts`](../../infra/stacks/monitoring/monitors/regressions.ts). Each compares a
service's errors or latency with its own usual band for that time of day, so it
fires on a change, not on a fixed count.

## Errors

A service's HTTP server errors, failed internal or consumer spans, or error
logs are above their usual band.

- Find what changed. Compare the start of the rise with the service's deploys
  (ECS service events, the web app's release) and with flag changes.
- Group the errors by `resource_name` (APM) or by message pattern (Logs →
  Patterns) for the alert window. A new error appearing from zero is usually
  the regression; a familiar one growing usually follows load or a dependency.
- Check Error Tracking for issues first seen in the window.
- Levers: roll back the deploy or turn off the flag; if a dependency is
  failing, follow that dependency's runbook.

## Latency

A service's p95 HTTP latency is above its usual band.

- In APM, sort the service's resources by p95 change to find the slow
  endpoint, then open a slow trace and see which span holds the time.
- Database time points at the [MacroDB runbook](macrodb.md); time waiting for a
  pool connection points at pool exhaustion in that service.
- Levers: roll back the deploy that introduced the slow path; reduce load from
  the caller driving it.
