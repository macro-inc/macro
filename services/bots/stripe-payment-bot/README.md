# stripe-payment-bot

Posts to every Macro channel containing the bot when Stripe reports a new
payment or a subscription cancellation. It can be deployed from any Cloudflare
account; it has no dependency on a Macro-owned Worker or domain.

The bot handles paid Checkout sessions, delayed payment methods, the first
successful invoice after a free trial, `customer.subscription.deleted`, and
`customer.subscription.updated` when `cancel_at_period_end` flips from false to
true. Unpaid sessions and unrelated Stripe events are acknowledged and ignored.

## How it works

```text
Stripe webhook ──POST /webhook──> Cloudflare Worker
                                   │ Stripe SDK verifies the signature
                                   │ map the event to a payment or cancellation
                                   ▼
                  Macro SDK → list the bot's channel memberships
                            → POST each channel's bot webhook
```

The destinations do not come from the Stripe event or Worker configuration.
`MACRO_BOT_TOKEN` authenticates the SDK request, and every channel where that
bot is an active participant receives the notification. Adding or removing the
bot from a channel changes the destinations automatically.

## Configuration

All deployment-specific values are Worker bindings:

- `MACRO_BOT_TOKEN`: API key for a team-owned Macro bot.
- `MACRO_ENV`: `dev`, `prod`, or `local`.
- `MACRO_STORAGE_URL`: optional storage API base URL override for a custom
  Macro deployment.
- `STRIPE_API_KEY`: restricted or secret Stripe API key.
- `STRIPE_WEBHOOK_SECRET`: signing secret for this deployment's Stripe webhook
  destination.

## Deploy

From this directory:

```bash
printf '%s' 'mbot_...' | wrangler secret put MACRO_BOT_TOKEN
printf '%s' 'prod' | wrangler secret put MACRO_ENV
printf '%s' 'rk_live_...' | wrangler secret put STRIPE_API_KEY
printf '%s' 'whsec_...' | wrangler secret put STRIPE_WEBHOOK_SECRET
bun run deploy
```

For a nonstandard Macro storage endpoint, also set:

```bash
printf '%s' 'https://your-storage-api.example.com' | \
  wrangler secret put MACRO_STORAGE_URL
```

`STRIPE_API_KEY` can be a restricted key with read access to subscriptions and
customers. The Worker uses it to confirm that a paid invoice is the first one
after a trial, and to resolve customer name and email on cancellation events.

Wrangler prints the URL assigned to the Worker in the deploying Cloudflare
account. In Stripe Workbench, create a webhook destination pointing to:

```text
<your-worker-url>/webhook
```

Subscribe it to these events:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `invoice.paid`
- `customer.subscription.deleted`
- `customer.subscription.updated`

Copy that destination's signing secret (`whsec_...`) into the Worker secret
above. Test-mode and live-mode webhook destinations have different signing
secrets.

## Local development

Copy `dev.vars.example` to `.dev.vars`, fill in its values, then run:

```bash
just dev
```

Forward Stripe test events to the local server:

```bash
stripe listen \
  --events checkout.session.completed,checkout.session.async_payment_succeeded,invoice.paid,customer.subscription.deleted,customer.subscription.updated \
  --forward-to localhost:8787/webhook
```

Use the `whsec_...` printed by `stripe listen` as
`STRIPE_WEBHOOK_SECRET`.

Stripe can occasionally deliver the same event more than once. This bot
intentionally accepts the small risk of duplicate channel notifications rather
than adding a database solely for deduplication.

## Checks

```bash
just check
just test
```
