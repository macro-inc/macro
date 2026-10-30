# goalert-bot

## What it is

Observability: a Cloudflare Worker that turns GoAlert outgoing webhooks into
Macro Alerts channel posts, one thread per alert, through the Macro SDK.

## Start here

- `src/index.ts`: the webhook route and what each payload type does.
- `src/format.ts`: the compact post format, parsed from Datadog and Grafana details.
- `README.md`: payload → channel effect table, auth, setup.

## Scope

- Owns: formatting alerts, threading status changes, the KV map
  `alert:<AlertID>` → posted message.
- Not here: which alerts page → `infra/stacks/monitoring` (Datadog) and the
  observability stack's Grafana and GoAlert config.
- Called by: GoAlert webhook destinations only.

## Checks

- `bun test` (from this directory)
- `bunx tsc --noEmit --project tsconfig.json`

## Gotchas

- GoAlert abandons a webhook after ~3s and never retries: keep a request to one
  KV read, parallel channel calls, and one KV write. Don't add fetches.
- Import `@macro-inc/observability/worker` only from `src/worker.ts`: it loads
  `cloudflare:workers`, which Bun tests cannot resolve. Spans elsewhere use
  `Telemetry` from `@macro-inc/observability` (`src/traced.ts`).
- The bot is user-owned and acts as its owner (`ACTING_USER_ID`, a secret, never
  committed). Without `requestedAs` the SDK falls back to the channel webhook,
  which cannot thread, edit or react.
- The resolved edit drops the `here` mention; a bot edit carrying mentions can
  notify again.
- The SDK is imported by relative path from `packages/sdk/src`, like
  `anthropic-status-bot`; SDK changes reach this worker on the next deploy.

## Related

- Rules: `.agents/rules/observability.md` · Docs: `docs/guides/new-service.md`
