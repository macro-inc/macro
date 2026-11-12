# monitoring

Datadog monitors and synthetic tests as code.

35 resources here (34 monitors and one synthetic test) already exist in
Datadog. This stack **adopts** them — it does not recreate them. `import.json`
lists every one by id. Everything else is declared here first and is created
on deploy: the prod threshold and anomaly monitors (`monitors/macrodb.ts`,
`redis.ts`, `queues.ts`, `regressions.ts`, `outlook-sync.ts`,
`routine-suggestions.ts`, `harness-runtimes.ts`, `computer-capacity.ts`) and their dashboards, the rollout monitors, the GoAlert webhooks and health check, the Outlook sync, routine suggestions and agent runtime metrics, the Outlook retention filter, one other log-based metric, and one downtime.

## Routing

Every monitor and synthetic test notifies GoAlert through `notify.ts`, and
nothing else. GoAlert runs on the observability host (`infra/stacks/observability`)
and has two services, each with its pair of webhooks declared in `goalert.ts`:

- **Notify** (`@webhook-goalert-notify`, `@webhook-goalert-notify-close`):
  posts the alert to the Macro Alerts channel. Every warning, alert and no-data
  notification opens or updates an alert here, except a paging monitor's
  critical alert.
- **Paging** (`@webhook-goalert`, `@webhook-goalert-close`): also phones the
  on-call engineer. Only a paging monitor's `{{#is_alert}}` opens one; its
  warnings and no-data go to Notify.
- **Every recovery** closes on each service the monitor could have opened.
  Closing an alert GoAlert does not have open does nothing.
- **Re-posts come from GoAlert**: a page posts to the channel again every hour
  until someone acknowledges it; a Notify alert posts once. Monitors still renotify
  hourly (`RENOTIFY_MINUTES`); the repeat dedups into the open GoAlert alert
  (`$ALERT_CYCLE_KEY`) and reopens it if someone closed it while the monitor
  still fires.
- **Dev and staging monitors notify no one** (`notify({ pages, environment })`).
  They stay visible in Datadog; on-call is for prod.
- **Datadog never posts to the channel itself**, so each alert appears once.
  The only exception is the GoAlert health check (`goalert-health`), which
  posts straight to `@webhook-macro-alert-hook` (a webhook integration
  configured in the Datadog UI): when GoAlert is down, nothing routed through
  it arrives.
- `routing.test.ts` fails if any monitor mentions another handle or an email
  address, if anything but the health check mentions the channel webhook, or if
  a monitor lacks the renotify interval.

Paging monitors: the app-down synthetic, ALB non-200 responses and low healthy
hosts, Lambda error count, web-app source errors, macro-cache memory, RDS high
CPU, RDS storage, RDS proxy connections, the three SES reputation monitors, the
GraphQL soup DSS 5xx and DB connections monitors, and macrodb blocked
connections. `error-logs-overall` notifies without paging because it crosses
its thresholds many times a day.

## Prod threshold monitors

`monitors/macrodb.ts`, `redis.ts`, `queues.ts`, `regressions.ts`,
`outlook-sync.ts`, `routine-suggestions.ts`, `harness-runtimes.ts` and `computer-capacity.ts` declare the prod threshold, forecast and anomaly monitors with `prodMonitor()`. The ones
on CloudWatch metrics have hand-written copies in Grafana
(`infra/stacks/observability/nixos/prod-alerts.nix`), and Grafana pages on-call for
the critical ones through GoAlert. Their Datadog copies only notify (GoAlert's
Notify service), so one incident pages once. Keep thresholds and windows in sync by hand. The error-logs
anomaly monitor reads `macro.logs.errors`, a log-based metric declared in
`regressions.ts`, because log monitors have no anomaly function.

Each of those files also declares a dashboard (MacroDB, Redis, Queue,
Regression alerts, Outlook sync, Routine suggestions and Computer capacity) with one graph per monitor, titled like the monitor, its
critical and warning thresholds drawn as markers; anomaly graphs show the band
instead. Every prod monitor's message links to its dashboard. Change a query or
threshold in the graph too; `routing.test.ts` checks that each monitor has a
graph with matching markers.

## Read this before deploying

**Set the GoAlert integration keys and deploy GoAlert first.** The webhooks
need the keys, and every monitor references them:

```bash
pulumi config set --secret goalertIntegrationKey '<Generic API key of the paging service in GoAlert>'
pulumi config set --secret goalertNotifyIntegrationKey '<Generic API key of the Notify service in GoAlert>'
```

**Run the import before the first `pulumi up`.** The program declares 34
monitors that already exist in Datadog. Until `pulumi import` has told Pulumi
they exist, a deploy would create 34 duplicates — duplicate pages
included.

Adoption is a one-time local run. `pulumi import` reads Datadog and writes
Pulumi state — it does not create, modify, or pause anything in Datadog. The
Datadog keys are needed by `preview` as well: the provider validates every
monitor against `/api/v1/monitor/validate` while diffing.

```bash
cd infra/stacks/monitoring
export DD_API_KEY=... DD_APP_KEY=... DD_HOST=https://api.us5.datadoghq.com/
pulumi stack select macro-inc/prod --create
pulumi import --file import.json --out imported.generated.ts --protect --yes
pulumi refresh --yes
pulumi preview --diff
```

`--protect` matches the `adopted()` helper so state and code agree.
`imported.generated.ts` is Pulumi's own rendering of the live monitors — the
ground truth to reconcile against if the preview shows drift. Delete it after;
it must not be committed (index.ts does not import it, and a second copy of
every monitor would double-declare them).

The refresh reads the live resources back into state without changing Datadog
and records options omitted during import.

The gate is that preview:

- **34 monitors + 1 synthetic test updated, in `message` and
  `renotifyInterval` only** — the routing move to GoAlert. The two AI-editing
  monitors, already deployed from this stack, update their `message` the same
  way. `dss-errors-prod` also changes its query and critical threshold
  (150 → 800), and `rds-low-freeable-memory` its query and thresholds
  (critical 2 GB → 250 MB, warning 3 GB → 500 MB) so 2 GiB instances stop
  alerting at their normal level.
- **Already-deployed monitors update their `message`** (GoAlert handles instead
  of the channel), and the GraphQL soup volume, websocket upgrade, gateway
  connections and task count monitors their `query` and thresholds (volume
  and websocket upgrades also gain recovery thresholds).
- **119 resources to create**: 81 monitors (37 prod threshold and anomaly, 19 GraphQL soup, 9
  notification retention, 10 WhatsApp session, 1 native call push, 2 harness
  presence, 3 OAuth), 2 webhooks,
  16 log-based metrics, 9 span-based metrics and 1 APM retention filter (6, 3
  and 1 of them for Outlook sync, 8 log-based metrics for routine
  suggestions, 1 log-based and 6 span-based metrics for agent runtimes), the
  GoAlert synthetic test, the eight prod alert dashboards, and the notification retention dashboard. If the paging
  webhooks and GoAlert synthetic are already deployed, expect only the 2
  Notify webhooks among the webhooks.
- **1 downtime to create**, muting `[PROD] Notification consumer: no
  telemetry`, which fires by design until the DSS consumer health
  instrumentation ships. Delete it then.
- **Any other update, a replace, or a delete** — the hand-written code in
  `monitors/*.ts` drifted from the live monitor. Reconcile against
  `imported.generated.ts` before deploying.

Only then deploy: `pulumi up` locally, or **Actions → "deploy pulumi service"**
with `pulumi-service-name: monitoring`, `environment: prod` (that action already
exports the DD keys from repo secrets).

## Why nothing here deploys by accident

`.github/services-config.json` is the allowlist that drives `deploy_on_push.yml`
and `pulumi_preview_pr.yml`. This stack is deliberately absent from it, so no
push and no PR ever deploys it. It moves only by manual dispatch.

Monitors are org-global rather than per-environment — a single monitor covers
both the `-dev` and `-prod` services it queries. So there is one stack, `prod`,
and no `dev` counterpart. (`deploy-pulumi-stack.yml` names the stack
`macro-inc/<environment>`, hence `prod`.)

## Credentials

None to add. `deploy-cloud-storage-pulumi` already exports `DD_API_KEY`,
`DD_APP_KEY`, and `DD_HOST=https://api.us5.datadoghq.com/`, which is all the
Datadog provider reads. Do not set `datadog:validate: "false"` here — a missing
key should fail the deploy rather than silently no-op.

## Where transcription is most likely to be wrong

The code was written from the Datadog API's own JSON, and `tsc` validates every
field against the provider schema, so field *shapes* are right. Values that the
provider models differently from the API are the risk, and these are the spots:

- `monitors/logs.ts` `error-logs-overall` and `monitors/rum.ts`
  `web-app-source-errors-prod` use `formula()` queries with `variables`. The API
  returns one `compute` object per variable; the provider takes a `computes`
  list. The API also carries `additionalProperties.storage: "hot"` on each
  variable, which provider 4.68 cannot express at all.
- `monitors/rds.ts` `rds-connection-anomaly` is an anomaly monitor, so its
  `monitorThresholdWindows` are required rather than optional.
- `synthetics.ts` reproduces Datadog's default notification template verbatim,
  with backticks escaped for the template literal. Drift there changes alert
  *text*, not alert behavior.
- `onMissingData` values are the API's snake_case (`show_no_data`). Pulumi's
  generated docs camelCase them; the provider forwards the string as-is.
- All adopted monitors have `requireFullWindow: false`; `adopted()` preserves
  that setting instead of the provider's default of `true`.
- Datadog omits `newHostDelay` on monitors using `newGroupDelay`, but provider
  4.68 defaults it to 300. Imported nulls can cause perpetual updates. After
  backing up state and verifying that each affected monitor is not grouped by
  `host`, normalize only its input/output `newHostDelay` to 300 in Pulumi state.
  The helper declares that same default. Host delay is ignored for these
  monitors; group delay stays unchanged. Verify again with `preview --refresh`
  and compare the live Datadog definitions before deploying.
- The existing APM latency monitor is a draft. Keep its `draftStatus` explicit
  so adoption does not publish it. RUM monitors omit the log-only
  `enableLogsSample` and `groupbySimpleMonitor` options.

## Drift

A code-managed monitor edited in the UI is reverted on the next deploy of this
stack. Since that deploy is manual, drift shows up in `pulumi preview` before it
is applied. Reach for `restrictedRoles` if convention stops being enough.

## Adding a monitor

Add a prod threshold or anomaly monitor with `prodMonitor()` in the matching
`monitors/*.ts`, a `thresholdGraph()` for it on that file's dashboard, and its Grafana copy in `prod-alerts.nix` when the metric is in
CloudWatch. Declare anything else with `new datadog.Monitor(...)`, ending its
message with `notify({ pages })` and setting `renotifyInterval: RENOTIFY_MINUTES`. Use the `adopted()` helper only
for monitors that already exist in Datadog — it sets `protect`, which is there
to stop a program that no longer declares a pre-existing monitor from deleting
it, and the hourly renotify default.

The MemoryDB (`cloud-storage-cache-*`) and burst-balance monitors report no
data; retire them in a separate commit that drops `protect` first.

## AI-editing coverage

The caller-side log alert matches `editing worker returned` for non-2xx HTTP
responses and `editing worker request failed` for transport failures. The latter
requires the updated `ReqwestEditingWorkerClient` to be deployed in the caller
services; creating the monitor alone does not add that telemetry.

Neither new alert detects successful responses that apply no edits, or failures
during periods without editing requests. The end-to-end canary remains a
follow-up.

## Native call push coverage

`monitors/calls.ts` adds one log monitor that alerts on any rejected iOS or
Android call push, excluding stale device registrations.

It sees only publishes SNS rejects. A push that SNS accepts and the device then
drops leaves no backend trace.

## OAuth connection coverage

`monitors/oauth.ts` adds three production log monitors through GoAlert's
Notify service. They post to the alerts channel without phoning on-call,
renotify hourly, and recover when their rolling count falls below the threshold:

| Signal | Threshold | First check |
| --- | --- | --- |
| Linked GitHub token lookup errors | 3 in 15 minutes | Internal auth response and the caller's resolved authentication-service key; user OAuth can succeed while this lookup fails. |
| Native MCP token exchange/provider rejection or Pipedream connection failure | 3 in 1 hour | Provider error, redirect URL, scopes, app configuration and organization permissions. Explicit `access_denied`, `user_cancelled` and `user_canceled` codes are excluded. |
| OAuth client rejection codes in `error` or `reason` | 1 in 15 minutes | Client ID/secret, app status and allowed grant types for `invalid_client`, `unauthorized_client` or `incorrect_client_credentials`. |

The first two read existing logs from `mcp_client` and `pipedream_mcp`;
the third is provider-independent. Log samples are not included in notifications;
follow the filtered log links for investigation. The linked-token log was
verified in production during the internal-key failure. Ordinary unlinked or
expired GitHub grants return no token rather than emitting that failure log.

These are failure signals, not synthetic sign-in tests. They cannot detect an
unused provider breaking, a browser-only failure, or an error that is not
logged in one of these forms. Repeated failures from one user's permissions
can trigger the flow monitor and need triage. Generic HTTP 401s, `invalid_grant`,
and routine expired grants do not by themselves trigger the client-rejection
monitor. Recovery means the error count fell below threshold, not that a sign-in succeeded.

After deploying a credential fix, verify the internal token lookup succeeds
and a read-only MCP tool call works with the linked account. This stack needs
its own explicitly approved manual deployment; merging the service fix does
not activate these alerts.

## GraphQL soup rollout coverage

`monitors/graphql-soup.ts` declares 19 new monitors for the `enable-graphql-soup`
rollout: GraphQL latency, errors and volume, per-operation errors and latency,
unauthenticated mutations, websocket upgrades, cloud-storage-service capacity
and 5xx, macro-db-prod connections and CPU, the gateway ALB, and web-app cache
logs.

Resolver errors still return HTTP 200, so the endpoint error monitors are
proxies; the per-operation monitors read the `graphql.execute` span instead.

## Notification retention coverage

`monitors/notification-retention.ts` adds **nine monitors and one dashboard**:
per-environment consumer backlog, unhealthy telemetry, missing telemetry, and
failed delete publication, plus a cross-environment retention trace-flush alarm.
The dashboard URL is exported as `notificationRetentionDashboardUrl`.

Deploy the notification consumer instrumentation in DSS before these monitors;
otherwise the missing-telemetry alerts intentionally fire. Until it ships, a
downtime in `notification-retention.ts` mutes the prod one; delete the downtime
once the instrumentation is deployed. This monitoring stack
still requires a separate, explicitly approved manual deployment. Adopted
monitors may change only as the gate above lists.

Consumers are intentionally ungrouped and do not commit offsets, so native MSK
consumer-group lag is not meaningful. The new logs expose broker high watermark
minus application position, not committed position. Unknown/stale measurements
are omitted rather than graphed as zero. Alerts are per consumer instance so one
healthy process cannot mask a lagging one; retired-instance alerts resolve on
missing data, while a separate monitor catches loss of all telemetry in an env.
The initial backlog thresholds (warning 100, critical 1000 averaged over five
minutes) need review against live baselines before production cleanup.

These signals do not acknowledge delivery through PostgreSQL NOTIFY or WebSockets.
See [the rollout runbook](../../../docs/runbooks/notification-retention.md) for
limitations and the post-deploy verification gates.

## Outlook sync coverage

`monitors/outlook-sync.ts` adds **six monitors, one dashboard, six log-based
metrics, three span-based metrics and one APM retention filter** for Outlook
mailbox sync in the email-service pubsub workers. Its header lists every field
it reads; [the runbook](../../../docs/runbooks/outlook-sync.md) covers each
alert.

Deploy the email-service release that emits the `outlook mailbox health` log,
the `outlook.sync.*` spans and the Graph and token span fields before these.
Until then every Outlook metric is empty and the monitors have no data; they
do not alert. Span-based metrics count spans from deploy onward, not before.

The mailbox metrics are tagged by `link_id`, so each Outlook mailbox adds about
30 custom metrics (six distributions of five aggregations each). Revisit the
per-mailbox tags before Outlook leaves its rollout flag.

Thresholds come from the first production import (2026-11-03, two mailboxes,
about 2,100 messages in 15 minutes); retune them against a few weeks of data.
The reauthorization thresholds have no baseline yet.

## Routine suggestions coverage

`monitors/routine-suggestions.ts` adds **one monitor, one dashboard and eight
log-based metrics** for routine suggestions in agent-harness-service. Its
header lists every log field it reads;
[the runbook](../../../docs/runbooks/routine-suggestions.md) covers the alert
and where each generation's trace is.

The dashboard shows generations by outcome, the fallback rate (generations
that left Macro's templates only), time to first suggestion, per-surface fill,
rejected suggestions, and saves and dismissals by surface, origin and kind.
The monitor notifies when more than 10% of an hour's finished generations,
plus two, fail; it does not page while suggestions are behind
`enable-routine-suggestions`.

Deploy the agent-harness-service release that emits the
`routine_suggestions.*` logs before these. Log-based metrics count from deploy
onward. There is no baseline yet; the 10% threshold is a starting point.

## Agent runtime coverage

`monitors/harness-runtimes.ts` adds **three monitors, one dashboard, six
span-based metrics and one log-based metric** for agent-harness-service
runtimes. Its header lists every field it reads;
[the runbook](../../../docs/runbooks/agent-harness-runtimes.md) covers each
alert. None of them page.

Per runtime, the monitors notify when one dials more than 15 times in
15 minutes or lists more than 500 sessions to reattach; across the service,
when it logs more than 1,000 tokio runtime starvation warnings in 15 minutes.
Over the seven days to 2026-11-10 quiet 15 minutes stayed at or under 12
dials, 263 sessions and 451 warnings. Every reattach storm crossed the
sessions or dials threshold and the starvation one; the storm at 17:15Z on
2026-11-10 was one runtime listing about 1,450 sessions in three dials.

The eager, lazy and skipped metrics stay empty until the agent-harness-service
release that records those span fields; the dials, sessions and starvation
metrics read fields prod emits today. Span-based metrics count from deploy
onward.
