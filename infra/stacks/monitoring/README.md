# monitoring

Datadog monitors and synthetic tests as code.

35 of the 36 resources here were created by hand in the Datadog UI between 2024
and 2026. This stack **adopts** them — it does not recreate them. `import.json`
lists every one by id. The two AI-editing monitors in `monitors/ai-editing.ts`
are new and are meant to be created.

## Read this before deploying

**Run the import before the first `pulumi up`.** The program declares 35
monitors that already exist in Datadog. Until `pulumi import` has told Pulumi
they exist, a deploy would create 35 duplicates — duplicate pages to
`#holy-shit-alarms` included.

Adoption is one manual workflow run: **Actions → "adopt datadog monitors" →
`mode: import`**. It runs `pulumi import` (reads Datadog, writes Pulumi state —
it does not create, modify, or pause anything in Datadog), prints the code it
generated from the live monitors, then prints a preview.

The gate is the preview at the end of that run:

- **35 monitors + 1 synthetic test unchanged** — adoption is exact.
- **2 monitors to create** (`ai-editing-*`) — expected, that's the new alerting.
- **Any update, replace, or delete** — the hand-written code in `monitors/*.ts`
  drifted from the live monitor. Reconcile against the generated
  `imported.generated.ts` from that same run before deploying. An `update` here
  silently changes who gets paged.

Only then: **Actions → "deploy pulumi service"** with
`pulumi-service-name: monitoring`, `environment: prod`.

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

## Drift

A code-managed monitor edited in the UI is reverted on the next deploy of this
stack. Since that deploy is manual, drift shows up in `pulumi preview` before it
is applied. Reach for `restrictedRoles` if convention stops being enough.

## Adding a monitor

Declare it in the matching `monitors/*.ts` with `new datadog.Monitor(...)`. Use
the `adopted()` helper only for monitors that already exist in Datadog — it sets
`protect`, which is there to stop a program that no longer declares a
pre-existing monitor from deleting it.
