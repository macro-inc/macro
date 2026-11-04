# goalert-bot

Posts GoAlert alerts to the Macro Alerts channel, one thread per alert.

GoAlert is the paging hub: Grafana and Datadog alert GoAlert, whose escalation
policies send outgoing webhooks for each alert and status change. This worker
receives them and posts through the [Macro SDK](../../../packages/sdk), so it
can thread, mention, edit and react, which the channel bot webhook cannot.

## How it works

```
GoAlert webhook ──POST──> /goalert/{WEBHOOK_SECRET}
                              │ parse (Alert | AlertStatus | bundles | …)
                              │ KV ALERT_MESSAGES: alert:<AlertID> → message
                              ▼
         @macro-inc/sdk → channel.send / message.reply / react / edit
         headers: x-macro-bot-token: BOT_TOKEN, x-macro-bot-scope: user,
                  x-macro-bot-for-macro-user-id: ACTING_USER_ID
```

| GoAlert payload | Channel effect |
| --- | --- |
| `Alert` (new) | Compact top-level post; pages end the headline with a `here` mention. Stored in KV for 30 days. |
| `Alert` (already posted) | GoAlert re-escalated an open page: thread reply `⏰ Still open` (with `here` for pages). |
| `AlertStatus` acknowledged | Thread reply `👀 Acknowledged by …`, 👀 reaction on the post. |
| `AlertStatus` closed | Thread reply `✅ Closed by …`, ✅ reaction, and the post's headline is prefixed `✅ Resolved ·` (the `here` mention is dropped so the edit notifies nobody). |
| `AlertStatus` other (escalated, …) | Thread reply with the log entry. |
| `AlertStatus` for an alert never posted | One-line top-level post. |
| `AlertBundle` / `AlertStatusBundle` | One top-level line with the count and a link. |
| `ScheduleOnCallUsers`, `Test`, `Verification` | One top-level notice. |

A new alert post:

```
🚨 **PAGE** · **<title> — <scope>** @here
🔴 critical: 2631 (threshold 1800)
<one-sentence description, AWS hostnames shortened>
[Acknowledge](…) · [Graph](…) · [Runbook](…)
```

The `Notify` GoAlert service posts `🔔` instead of `🚨 **PAGE**` and mentions
nobody. State, description and links are parsed from Datadog monitor messages
(`alertMessage()` in `infra/stacks/monitoring/notify.ts`) and Grafana's details
table.

Notes on the GoAlert side:

- GoAlert **cannot set headers**, so the URL carries the shared secret,
  compared in constant time.
- GoAlert **abandons a webhook after about three seconds** and does not retry.
  A request does one KV read, its channel calls in parallel, and at most one
  KV write. A failed channel call returns `502` so it shows in GoAlert's logs.
- Unrecognized payloads are acknowledged (`200 {ok, ignored: true}`).

## Auth

The bot is **user-owned and acts as its owner** (`requestedAs(ACTING_USER_ID)`,
user scope). The server lets a user-owned bot act only as its owner. Messages
show the bot as sender, triggered by the owner, and the bot's channel access
follows the owner's: the owner must be able to post in `CHANNEL_ID`. Moving to a
team-owned bot means dropping `ACTING_USER_ID` and `requestedAs` in
`src/channel.ts` and using the default team scope.

## Tracing

`src/worker.ts` wraps the worker in otel-cf-workers' `instrument()` through
`@macro-inc/observability/worker`, configured like `services/ai-editing-worker`:
spans go to `OTEL_EXPORTER_OTLP_ENDPOINT` (the prod OTLP proxy), with
`DD_API_KEY` as `dd-api-key` when set. Each webhook is one
`goalert_bot.webhook` span with `goalert.payload_type`, `goalert.alert_id`,
`goalert.service_name` and `goalert.outcome`; children
`goalert_bot.kv.get`/`kv.put` (`goalert.found` on reads) and
`goalert_bot.channel.post`/`reply`/`react`/`edit` (`goalert.message_id`).
Message bodies are never recorded. Search by `@goalert.alert_id`.

## Setup

Deployed as a single prod Cloudflare Worker (`goalert-bot`, no dev
environment):

```bash
wrangler kv namespace create ALERT_MESSAGES     # put the id in wrangler.jsonc
printf '%s' '<token>' | wrangler secret put BOT_TOKEN
printf '%s' '<owner user id>' | wrangler secret put ACTING_USER_ID
printf '%s' '<secret>' | wrangler secret put WEBHOOK_SECRET
printf '%s' '<key>' | wrangler secret put DD_API_KEY   # optional, see Tracing
bun run deploy                                  # wrangler deploy
```

Then point a GoAlert webhook destination (escalation policy step or service
notification) at
`https://goalert-bot.macroverse.workers.dev/goalert/<WEBHOOK_SECRET>`.

## Environment variables

| Variable         | Required | Default | Description                                               |
| ---------------- | -------- | ------- | --------------------------------------------------------- |
| `BOT_TOKEN`      | yes      |         | Bot API key (`mbot_...`, sent as `x-macro-bot-token`)      |
| `CHANNEL_ID`     | yes      |         | Channel UUID to post to (Macro Alerts)                    |
| `ACTING_USER_ID` | yes      |         | Secret: the bot owner's user id (`macro\|<email>`)         |
| `WEBHOOK_SECRET` | yes      |         | Secret path segment for the webhook URL                   |
| `ALERT_MESSAGES` | worker   |         | KV namespace binding: `alert:<AlertID>` → posted message  |
| `ENVIRONMENT`    | no       | `local` | `deployment.environment` on exported spans                |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | no |    | OTLP/HTTP traces endpoint; unset disables export          |
| `DD_API_KEY`     | no       |         | Secret: Datadog key sent with trace exports               |
| `MACRO_ENV`      | no       | `prod`  | SDK environment (`prod`/`dev`/`local`), local server only |
| `PORT`           | no       | `8089`  | Listen port (local Bun server only)                       |

## Development

```bash
just dev    # bun run --watch src/server.ts (in-memory alert store)
just test   # bun test
just check  # tsc --noEmit
```

Formatter tests use real Datadog and Grafana alert details.
