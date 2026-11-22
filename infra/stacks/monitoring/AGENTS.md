# monitoring

## What it is

Org-global Datadog monitors, synthetics, and rollout dashboards. This stack is
manual and has only a prod stack, even for monitors covering both environments.
Prod threshold and anomaly monitors are in `monitors/{macrodb,redis,queues,regressions,outlook-sync,routine-suggestions,harness-runtimes,computer-capacity,storage-pool,agent-sessions,search-freshness}.ts`
(`prodMonitor()` in `prod-monitor.ts`), each file with a dashboard graphing its
monitors that their messages link to; every monitor notifies through `notify.ts`.
`dashboards/web-performance.ts` holds the web app performance dashboard with the
APM retention filter and span-based metrics it reads; it has no monitors.

## Checks

From `infra/`:
- `bun run check` (tsc and the bun tests, including `bun test stacks/monitoring`;
  CI runs it on every `infra/**` change).
- Biome on changed files.
- An authenticated `pulumi preview` may change adopted monitors only in
  `message` and `renotifyInterval`, apart from the exceptions README.md lists
  with the expected counts.

## Gotchas

- The CloudWatch-based monitors in `macrodb.ts`, `redis.ts` and `queues.ts`,
  except those `queues.ts` marks Datadog only, have hand-written Grafana copies in
  `infra/stacks/observability/nixos/grafana-provisioning/prod-alerts.nix`. Change thresholds and windows
  in both. Grafana pages for those, so their Datadog copies use `pages: false`.
- Read `README.md` before deployment: imported resources must be adopted first
  to avoid duplicate alerts. Never deploy without explicit approval.
- Deploying needs the `goalertIntegrationKey` and `goalertNotifyIntegrationKey`
  secrets in stack config, and GoAlert (infra/stacks/observability) reachable
  at oncall.macro-internal.com.
- A prod monitor's graph on its file's dashboard repeats its metric and
  thresholds by hand; change both. `routing.test.ts` matches them by title
  and lists every prod monitor by name; add a new one there.
  The long-running transaction monitor takes the lowest
  `postgresql.activity.xact_start_age` over 5 minutes, and its graph plots the
  same `moving_rollup(..., 300, 'min')`. A single-sample spike from
  notification-service's `LISTEN` connection fires hourly otherwise
  (docs/runbooks/macrodb.md#locks).
- End every monitor message with `notify({ pages })`, which routes only to
  GoAlert, and pass `dependsOn: goalertWebhooks`. Never mention a channel
  webhook, Slack handle or email address: GoAlert posts to the channel. Only
  `goalert-health` posts to `@webhook-macro-alert-hook` directly.
  `routing.test.ts` enforces it.
- The Pulumi mock tests import modules that register resources once, and bun
  shares one module cache across test files. Call `evictStackModules()` before
  importing the stack in a new test file.
- Notification retention adds nine monitors, one dashboard and a downtime muting
  the prod missing-telemetry alarm; delete the downtime once DSS health
  instrumentation is deployed. Missing telemetry is deliberately an alert, not
  zero lag.
- Do not use native committed-offset lag for the independent notification
  consumers. Their per-instance log measurements preserve broadcast semantics.
- `notificationRetentionDashboardUrl` is a stack output, not an app route.
- `dashboards/web-performance.ts` reads span attributes set by
  `apps/web/src/observability` (the span model in
  `docs/agent-guide/observability.md`). Renaming one there silently empties
  its widgets. Span-based metric names and computes cannot be changed after
  creation; add a new metric instead.
- `monitors/whatsapp-session.ts` reads log events by `telemetry_event`; its
  header is the field contract with `services/whatsapp_session_service`.
  Renaming a field there silently turns its monitor into missing data.
- `monitors/computers.ts` reads the error logs `computer billing item removal
  abandoned` (authentication-service) and `computer needs an operator`
  (agent-harness-service) that `crates/hosted_runtimes` writes; its header is
  the message and field contract. Renaming either message silences its monitor.
- `monitors/stripe-inbox.ts` reads the logs `stripe inbox cursor
  dead-lettered`, `stripe inbox dead cursors`, `stripe inbox backlog` and
  `stripe audit mismatch` that
  `crates/stripe_inbox` writes from authentication-service; its header is the
  message and field contract.
- `monitors/harness-presence.ts` reads `harness_presence_disagreement` logged by
  `crates/harnesses/src/inbound/axum_router.rs`; its header is the field contract.
- `monitors/outlook-sync.ts` reads the health log, sync spans and Graph and
  token span fields email-service emits; its header is the field contract.
  It finds the Graph and token spans by `@outlook.throttle_origin` and
  `@outlook.token_cache`, not by name: Datadog renames an HTTP client span to
  `http.client.request` with its method as the resource.
- `monitors/email-provider-repair.ts` reads the domain's
  `email.reconciliation.provider_backfill` span and closed
  `backfill.outcome` for deferred attempts and hourly blocked-state heartbeats,
  plus verified stream mismatch classifications. All three signals have env-only
  dimensions, are non-paging and require a separately approved deployment.
- `monitors/ai-providers.ts` reads the `ai provider account unavailable` and
  `ai usage priced` logs (`crates/genai_telemetry/src/provider_account.rs`,
  `crates/ai_usage/src/domain/service.rs`) and the AI editing worker's
  `ai.provider_account_unavailable` span; its header is the field contract.
  `MONTHLY_CAPS` must match each provider's billing console.
- `monitors/routine-suggestions.ts` reads the `routine_suggestions.*` log
  events (`@event`) that `crates/scheduled_action` emits; its header is the
  field contract. Its failure monitor does not page while suggestions are
  behind their flag.
- `monitors/harness-runtimes.ts` reads the `agent.runtime.reattach` span fields
  in `crates/agent_harness/src/domain/service.rs` and matches the text of the
  `tokio runtime starvation detected` warning in `crates/macro_tower_layers`;
  its header is the field contract.
- `monitors/calls.ts` matches the text of the `voip push: SNS delivery failed`
  log in `crates/notification/src/domain/service/voip.rs` and the
  `PushEndpointUnavailable` message. Rewording either silently breaks it.
- Keep `monitors/oauth.ts` in sync with the linked-token, native MCP OAuth,
  and Pipedream failure logs it names; preserve channel-only routing and
  exclude normal authentication challenges and explicit consent cancellations.
- Agent session panels (`monitors/agent-sessions.ts`) read span-based metrics
  (`datadog.SpansMetric`): custom spans produce no trace metrics, and span
  queries see only indexed spans. A new span field charted there needs its own
  span-based metric, and only counts from the deploy that creates it. Its tool
  metrics count spans with `gen_ai.conversation.id`, one per session tool call;
  `execute_tool*` alone double-counts tools reached through MCP.
- `monitors/search-freshness.ts` reads the `search.index.*` metrics that
  `services/search_processing_service/src/inbound/kafka_consumer/metrics.rs`
  records, `kafka.consumer.offset_resets` from `crates/kafka_util` and
  `event_broker.publishes` from `crates/macro_event_broker`; its header is the
  name and tag contract. `search.index.oldest_pending_ms` is per task and
  partition: read it with `max`. Its retention monitors repeat each topic's
  retention from `infra/stacks/kafka-cluster/topics.ts`; change them together.
  Apply it only after the indexer that records these metrics is deployed:
  its no-readings monitor fires on missing data. It also reads the
  `search.freshness.probe_*` metrics of `services/search_freshness_probe`
  (`src/outbound/metrics.rs`); the probe's heartbeat is declared only once
  `PROBE_RUNS_IN_PROD` is true, for the same reason.
- `monitors/storage-pool.ts` reads the `db.client.connection.*` pool metrics
  cloud-storage-service records and the `perform_unified_search` span fields
  from `crates/search_service`; its header is the name and tag contract.
- The Kafka lag monitors in `monitors/queues.ts` read MSK's offset lag. Do not
  alert on `aws.kafka.estimated_max_time_lag` or
  `rolling_estimated_time_lag_max`: they divide lag by the current consumption
  rate, read years when a consumer slows, and are not event age.
- `monitors/computer-capacity.ts` reads the `computer.capacity.*` gauges that
  `crates/hosted_runtimes/src/domain/telemetry.rs` records; its header is the
  tag contract. Renaming a gauge, tag or `resource` value there silently turns
  its monitors into missing data.
- `monitors/firecracker.ts` reads `firecracker_host.*` from the host agent,
  `computer.host.memory.*` from fleet admission, and the `firecracker_host.launch`
  span's stable snake_case `source`. Its header and the Firecracker runbook are
  the contract; the local Datadog hostname must equal fleet `host`. Only the
  readiness gauge alerts on missing data; an idle host has no failure events.

`monitors/imap-credentials.ts` counts bounded `imap.credentials.classification` spans from imap-service. Preserve the unreadable-count and fleet-guard field contract; dimensions are env only, never mailbox/key/context. The new metrics and monitors are code-only until an approved deployment.

Follow the [validation cap and recovery contract](../../../docs/runbooks/email-provider-repair.md#validation-failures-and-the-constraint-cap).
