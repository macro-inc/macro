# datadog-alerts-bot

Posts Datadog monitor alerts to a Macro channel.

Datadog's [webhook integration](https://docs.datadoghq.com/integrations/webhooks/)
POSTs a user-defined JSON payload whenever a monitor message mentions
`@webhook-<name>`. This service receives those payloads, formats them, and
forwards them to a channel via the channel bot webhook (`crates/bots`) — the
same mechanism as `anthropic-status-bot`.

First consumer: the `[PROD] AI Not Responding — AI stream error spike`
anomaly monitor (spikes in `document-cognition-service` AI stream errors),
but any monitor can notify the channel by mentioning the webhook.

## How it works

```
Datadog monitor ──@webhook-macro-ai-alert-bot──> POST /webhook/{WEBHOOK_SECRET}
                                 │ parse + format (transition → emoji)
                                 ▼
              @macro/sdk → POST /channels/{CHANNEL_ID}/webhook
              headers: x-macro-bot-token: BOT_TOKEN, x-macro-bot-scope: user
              body: {"content": "🚨 [Datadog] [Triggered] ..."}
```

The webhook integration in Datadog (Integrations → Webhooks, name
`macro-ai-alert-bot`) is configured with URL
`https://datadog-alerts-bot.macroverse.workers.dev/webhook/<WEBHOOK_SECRET>`
and this payload template:

```json
{
  "title": "$EVENT_TITLE",
  "body": "$EVENT_MSG",
  "transition": "$ALERT_TRANSITION",
  "link": "$LINK",
  "priority": "$PRIORITY",
  "tags": "$TAGS",
  "date": "$DATE"
}
```

Notes on the Datadog side:

- Webhooks carry **no request signing**, so the URL itself carries the shared
  secret: `POST /webhook/{WEBHOOK_SECRET}`.
- Datadog retries failed deliveries; a failed channel post returns `502` so
  the delivery is retried, while unrecognized payloads are acknowledged
  (`200 {ok, ignored: true}`).

## Setup

Deployed as a single prod Cloudflare Worker (`datadog-alerts-bot`, no dev
environment):

```bash
bun run deploy                                  # wrangler deploy
printf '%s' '<token>' | wrangler secret put BOT_TOKEN
printf '%s' '<channel-uuid>' | wrangler secret put CHANNEL_ID
printf '%s' '<secret>' | wrangler secret put WEBHOOK_SECRET
```

Nothing is hardcoded — all config comes from worker secrets (or a local
`.env` in development; copy `dev.vars.example`).

Create the bot in **Settings → Bots**, generate an `mbot_...` token, and add
the bot to the `CHANNEL_ID` channel — the channel webhook returns 401 if the
bot is not a participant.

## Environment variables

| Variable         | Required | Default | Description                                            |
| ---------------- | -------- | ------- | ------------------------------------------------------ |
| `BOT_TOKEN`      | yes      |         | Bot API key (`mbot_...`, sent as `x-macro-bot-token`)  |
| `CHANNEL_ID`     | yes      |         | Channel UUID to post to                                |
| `WEBHOOK_SECRET` | yes      |         | Secret path segment for the webhook URL                |
| `MACRO_ENV`      | no       | `prod`  | SDK environment (`prod`/`dev`/`local`)                 |
| `PORT`           | no       | `8089`  | Listen port (local Bun server only)                    |

## Development

```bash
cp dev.vars.example .env   # fill in real values (gitignored)
just dev    # bun run --watch src/server.ts
just test   # bun test
just check  # tsc --noEmit
```

Tests replay payloads as rendered by the webhook JSON template above.
