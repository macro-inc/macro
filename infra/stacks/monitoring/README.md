# monitoring

Datadog monitors and synthetic tests as code.

35 resources here (34 monitors and one synthetic test) already exist in
Datadog. This stack **adopts** them — it does not recreate them. `import.json`
lists every one by id. Everything else is declared here first and is created
on deploy: the prod threshold and anomaly monitors (`monitors/macrodb.ts`,
`redis.ts`, `queues.ts`, `regressions.ts`) and their dashboards, the rollout monitors, the GoAlert webhooks and health check, and one log-based metric.

## Routing

Every monitor and synthetic test notifies through `notify.ts`, and nowhere
else:

- **All of them** post to the Macro Alerts channel (`@webhook-macro-alert-hook`,
  a webhook integration configured in the Datadog UI).
- **Paging monitors** also open a GoAlert alert on `{{#is_alert}}` and close it
  on `{{#is_recovery}}` (`@webhook-goalert`, `@webhook-goalert-close`, declared
  in `goalert.ts`). GoAlert runs on the observability host
  (`infra/stacks/observability`) and phones the on-call engineer. Warnings never
  page.
- **Every monitor renotifies hourly** (`RENOTIFY_MINUTES`) while it stays in
  warning or alert.
- `routing.test.ts` fails if any monitor mentions another handle or an email
  address, or lacks the renotify interval.

The GoAlert health check (`goalert-health`) notifies the channel only: when the
pager is down, a page through it would never arrive.

Paging monitors: the app-down synthetic, ALB non-200 responses and low healthy
hosts, Lambda error count, web-app source errors, macro-cache memory, RDS high
CPU, RDS storage, RDS proxy connections, the three SES reputation monitors, the
GraphQL soup DSS 5xx and DB connections monitors, and macrodb blocked
connections. `error-logs-overall` notifies without paging because it crosses
its thresholds many times a day.

## Prod threshold monitors

`monitors/macrodb.ts`, `redis.ts`, `queues.ts` and `regressions.ts` declare
the prod threshold, forecast and anomaly monitors with `prodMonitor()`. The ones
on CloudWatch metrics have hand-written copies in Grafana
(`infra/stacks/observability/nixos/prod-alerts.nix`), and Grafana pages on-call for
the critical ones through GoAlert. Their Datadog copies only notify, so one
incident pages once. Keep thresholds and windows in sync by hand. The error-logs
anomaly monitor reads `macro.logs.errors`, a log-based metric declared in
`regressions.ts`, because log monitors have no anomaly function.

Each of those files also declares a dashboard (MacroDB, Redis, Queue and
Regression alerts) with one graph per monitor, titled like the monitor, its
critical and warning thresholds drawn as markers; anomaly graphs show the band
instead. Every prod monitor's message links to its dashboard. Change a query or
threshold in the graph too; `routing.test.ts` checks that each monitor has a
graph with matching markers.

## Read this before deploying

**Set the GoAlert integration key and deploy GoAlert first.** The webhooks
need the key, and paging monitors reference them:

```bash
pulumi config set --secret goalertIntegrationKey '<Generic API key of the Datadog service in GoAlert>'
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
  `renotifyInterval` only** — the routing move. The two AI-editing monitors,
  already deployed from this stack, update the same way.
- **73 resources to create**: 64 monitors (25 prod threshold and anomaly, 19 GraphQL soup, 9
  notification retention, 10 WhatsApp session, 1 native call push), 2 webhooks,
  1 log-based metric, the GoAlert synthetic test, the four prod alert
  dashboards, and the notification retention dashboard.
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
otherwise the missing-telemetry alerts intentionally fire. This monitoring stack
still requires a separate, explicitly approved manual deployment. Adopted
monitors may change only in `message` and `renotifyInterval` (see the gate above).

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
