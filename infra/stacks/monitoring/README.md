# monitoring

Datadog monitors and synthetic tests as code.

37 resources here (36 monitors and one synthetic test) already exist in
Datadog. This stack **adopts** them — it does not recreate them. `import.json`
lists every one by id. The two AI-editing monitors in `monitors/ai-editing.ts`
are new and are meant to be created.

## Read this before deploying

**Run the import before the first `pulumi up`.** The program declares 36
monitors that already exist in Datadog. Until `pulumi import` has told Pulumi
they exist, a deploy would create 36 duplicates — duplicate pages to
`#holy-shit-alarms` included.

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

- **36 monitors + 1 synthetic test unchanged** — adoption is exact.
- **2 monitors to create** (`ai-editing-*`) — expected, that's the new alerting.
- **Any update, replace, or delete** — the hand-written code in `monitors/*.ts`
  drifted from the live monitor. Reconcile against `imported.generated.ts`
  before deploying. An `update` here silently changes who gets paged.

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

Declare it in the matching `monitors/*.ts` with `new datadog.Monitor(...)`. Use
the `adopted()` helper only for monitors that already exist in Datadog — it sets
`protect`, which is there to stop a program that no longer declares a
pre-existing monitor from deleting it.

The one-time import has already run against `prod`, so adopt a monitor created
in the UI since then on its own: add it to `import.json`, declare it with
`adopted()`, and before deploying run
`pulumi import datadog:index/monitor:Monitor <name> <id> --protect --out imported.generated.ts --yes`.
The preview must then show only the edits you meant to make to that monitor;
copy any other differing field from `imported.generated.ts`.

## AI-editing coverage

The caller-side log alert matches `editing worker returned` for non-2xx HTTP
responses and `editing worker request failed` for transport failures. The latter
requires the updated `ReqwestEditingWorkerClient` to be deployed in the caller
services; creating the monitor alone does not add that telemetry.

Neither new alert detects successful responses that apply no edits, or failures
during periods without editing requests. The end-to-end canary remains a
follow-up.

## GraphQL soup rollout coverage

`monitors/graphql-soup.ts` declares 15 new monitors for the `enable-graphql-soup`
rollout: GraphQL latency, errors and volume, websocket upgrades,
cloud-storage-service capacity and 5xx, macro-db-prod connections and CPU, the
gateway ALB, and web-app cache logs. A `pulumi preview` after they are added
should show exactly those 15 creates and nothing else.

Resolver errors still return HTTP 200, so the error monitors are proxies. Add
per-operation error and latency monitors once the server emits operation names
and error counts.

## Notification retention coverage

`monitors/notification-retention.ts` adds **nine monitors and one dashboard**:
per-environment consumer backlog, unhealthy telemetry, missing telemetry, and
failed delete publication, plus a cross-environment retention trace-flush alarm.
The dashboard URL is exported as `notificationRetentionDashboardUrl`.

Deploy the notification consumer instrumentation in DSS before these monitors;
otherwise the missing-telemetry alerts intentionally fire. This monitoring stack
still requires a separate, explicitly approved manual deployment. The preview
must not change adopted monitors.

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
