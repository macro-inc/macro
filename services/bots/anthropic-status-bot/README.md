# anthropic-status-bot

Posts Anthropic status page updates to a Macro channel.

[status.claude.com](https://status.claude.com) (formerly status.anthropic.com)
is powered by Atlassian Statuspage. This service receives Statuspage webhook
notifications, formats them, and forwards them to a channel via the channel
bot webhook (`crates/bots`), the same mechanism the old SNS deployment-failure
lambda used.

## How it works

```
Statuspage webhook ──POST──> /webhook/{WEBHOOK_SECRET}
                                 │ parse + format (incident | component)
                                 ▼
              @macro/sdk → POST /channels/{CHANNEL_ID}/webhook
              headers: x-macro-bot-token: BOT_TOKEN, x-macro-bot-scope: user
              body: {"content": "🟡 [Anthropic Status] ..."}
```

Channel delivery uses the [Macro SDK](../../../packages/sdk)
(`Macro._client.storage.postChannelBotWebhook`) with bot auth
(`x-macro-bot-token`, user scope) — the endpoint's preferred auth. The bot
must be a participant of `CHANNEL_ID`.

Statuspage webhooks carry one of two payload shapes (verified against the
[official docs](https://support.atlassian.com/statuspage/docs/enable-webhook-notifications/)):

- **Incident update** — `incident` object with `name`, `status`, `impact`,
  `shortlink`, and `incident_updates[]` (the newest update is posted).
- **Component update** — `component_update` (`old_status` → `new_status`)
  plus the affected `component` (e.g. `Claude API (api.anthropic.com)`).

Notes on the Statuspage side:

- Webhooks are HTTP POSTs and expect a **2xx response within 30s**.
- There is **no request signing**, and Statuspage source IPs change, so the
  webhook URL itself carries the shared secret: `POST /webhook/{WEBHOOK_SECRET}`.
- Unrecognized payloads are acknowledged (`200 {ok, ignored: true}`) so the
  subscription is never disabled by retries.
- A failed channel post returns `502` so Statuspage retries the delivery.

## Setup

Deployed as a single prod Cloudflare Worker (`anthropic-status-bot`, no dev
environment):

```bash
bun run deploy                                  # wrangler deploy
printf '%s' '<token>' | wrangler secret put BOT_TOKEN
printf '%s' '<secret>' | wrangler secret put WEBHOOK_SECRET
```

The bot must be a participant of `CHANNEL_ID` or the channel webhook returns
401. Local dev: copy `.env.example` to `.env` and `just dev`.

Subscribe on status.claude.com with webhook URL:
`https://anthropic-status-bot.macroverse.workers.dev/webhook/<WEBHOOK_SECRET>`

## Environment variables

| Variable         | Required | Default                            | Description                                  |
| ---------------- | -------- | ---------------------------------- | -------------------------------------------- |
| Variable         | Required | Default | Description                              |
| ---------------- | -------- | ------- | ---------------------------------------- |
| `BOT_TOKEN`      | yes      |         | Bot API key (`mbot_...`, sent as `x-macro-bot-token`) |
| `CHANNEL_ID`     | yes      |         | Channel UUID to post to                  |
| `WEBHOOK_SECRET` | yes      |         | Secret path segment for the webhook URL  |
| `MACRO_ENV`      | no       | `prod`  | SDK environment (`prod`/`dev`/`local`)   |
| `PORT`           | no       | `8088`  | Listen port (local Bun server only)      |

## Development

```bash
just dev    # bun run --watch src/server.ts
just test   # bun test
just check  # tsc --noEmit
```

Tests replay the exact example payloads from the Atlassian docs.
