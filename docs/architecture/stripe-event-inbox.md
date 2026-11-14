# Stripe event inbox

How Macro receives and applies Stripe billing events. Code:
`crates/stripe_inbox` (inbox, translator, worker, audit) and
`services/authentication_service` (webhook, consumers).

## Flow

```
Stripe ──POST /webhooks/user/stripe──► verify signature
                                        INSERT stripe_events ON CONFLICT DO NOTHING
                                        project subscription/customer snapshot (if newer)
                                        mark each consumer's cursor due, NOTIFY stripe_inbox
                                        200
                    │
                    ▼  every replica: LISTEN stripe_inbox, poll every 5 s
   lease due (consumer, customer) cursors   FOR UPDATE SKIP LOCKED, 60 s lease
   load the customer's next events          ORDER BY created_at, id
   translate to typed facts                 one translator, every API version
   apply through the consumer               advance the cursor after success
```

The webhook calls no Stripe API and does no domain work. Each consumer keeps
its own cursor per Stripe customer, so one failing domain never holds back
another, and one customer's failure never holds back another customer.

## Consumers

| Consumer | Events | What it does |
| --- | --- | --- |
| `personal_plan` | subscription, invoice | roles and tier, `has_trialed`, billing period and usage policy, AI plan change, cancels a newer duplicate subscription |
| `team_subscription` | subscription, invoice | subscription id, restore or revoke members, `paying`, period and usage policy |
| `ai_credits` | invoice without subscription, checkout | overage and reload invoice outcomes, credit purchases |
| `computers` | subscription | `ComputerBillingObserver::subscription_observed` with the snapshot's time |
| `analytics` | subscription | GA, Meta and PostHog purchase and cancel conversions |
| `gtm` | subscription | marks a GTM invite link converted |

Decisions are pure functions (`authentication_service`
`src/domain/stripe_consumers.rs`); `src/outbound/stripe_consumers.rs` carries
them out. Every consumer is idempotent and advances its cursor after the
apply succeeds; none commits the cursor inside a domain transaction. Stripe
writes carry `Idempotency-Key = <consumer>:<event_id>:<action>`.

## Ordering and idempotency

- Ordering key: the Stripe customer, or the object id of an event naming
  none (credit checkouts). Within a key, events apply by `(created, id)`.
- Stripe does not deliver in order. An event created before what a cursor
  already applied moves that cursor back to just before it, so it and every
  later event apply again in order. A worker holding the lease cannot
  advance past the rewind; it releases and the cursor runs again. An event
  created more than 30 days ago (the payload retention, for example a
  dashboard resend of an old event) is stored for dedupe but never rewinds a
  cursor.
- One apply is cut off after 40 s (a retry), well inside the 60 s lease that
  every applied event extends, so no two replicas apply one cursor at once.
- `stripe_events.id` dedupes redeliveries.
- `invoice.paid` and `invoice.payment_succeeded` are one fact: a paid
  outcome already seen for the invoice skips the next, and a
  `payment_failed` after it.
- `computers` acts on the newest snapshot only and skips one a newer
  received event supersedes. The others apply every snapshot in order, since
  they react to the change itself (an upgrade, a first activation, a
  conversion while live).
- A paid invoice of a subscription that already ended grants nothing back.
  A team bound to another subscription ignores the old one's lapse.
- `stripe_objects` holds the newest snapshot of each subscription and
  customer. An invoice reads its subscription from there, and a personal plan
  decision reads all of the customer's subscriptions; the inbox reads Stripe
  only to fill a snapshot it never held, to list a customer's subscriptions
  once, to page items past ten (for every consumer that reads periods,
  value or computers), or to find the email of a customer no
  account names.

## Identity

A customer maps to an account by `User.stripeCustomerId`. Only a customer no
account names is read from Stripe once (then held) and matched by email.
Team events use the subscription's `team_id` and `owner_id` metadata. Spans
carry customer, subscription, team and event ids, never emails.

## Failure handling

- `Retry` (a dependency failed): backoff from 5 s, doubling to 1 h with
  jitter; after 84 attempts (267 915 s, 74.4 h, before jitter: past Stripe's
  three days of redelivery) the cursor is dead. Its next event re-arms it,
  from the event it is stuck on.
- `Reject` (never going to work: a grant on a price that is neither sold nor
  legacy, an unsupported API version, a bad id, a customer that belongs to
  no account): dead at once, until replayed.
- Seat prices: the sold Premium and Max prices, plus
  `LEGACY_PREMIUM_PRICE_IDS` (`crates/teams` `domain/model.rs`), historical
  prices that keep Premium entitlements, as the old webhook's fallback gave
  them. A grant on an unknown price dead-letters. Revokes (cancel, past due,
  unpaid, paused, failed payment) never fail: they remove the subscriber role
  and the subscription's own tier role, Premium for an unknown price (as
  before), so a team seat's tier role survives a personal revoke. The
  analytics consumer skips an unknown price.
- A subscription event of a deleted team is ignored with a warning.
- A payload cleared by retention is skipped; the cursor moves past it.
- A dead cursor stops that consumer for that customer and logs
  `stripe inbox cursor dead-lettered`, which pages; every 15 minutes each
  replica logs `stripe inbox dead cursors` while any is dead, so the page
  holds until it is replayed. Replay one with
  `POST /internal/stripe_inbox/replay`
  (`{"consumer", "orderingKey", "skipDeadEvent"}`; 409 while a worker holds
  the cursor's lease), or many with `POST /internal/stripe_inbox/replay_dead`
  (`{"consumer"?, "skipDeadEvent", "limit"?}`). Deploy, rollback and resend
  steps: [runbook](../runbooks/stripe-event-inbox.md).
- An event applied more than five minutes after it arrived logs
  `stripe inbox backlog`.

## Audit

Once a day one replica (row lease in `stripe_audit_run`), paced at 5 req/s:

- lists the last 26 hours of Stripe events and records each one of a type a
  consumer applies that was never received (`missing_event`);
- records event types received that no consumer applies;
- lists every subscription and records snapshot drift (status, item prices
  and quantities) and domain disagreement: a team's subscription id and
  `paying`, and a live personal subscriber without the subscriber role
  (a subscription whose customer's last invoice payment failed counts as not
  paying); a subscription whose Macro side could not be read is recorded as
  `unchecked`;
- clears payloads after 30 days and deletes events after 90.

Findings go to `stripe_audit_mismatch` and the `stripe audit mismatch` log.
The audit never changes anything.

## API versions

Webhook payloads arrive in the endpoint's version (`2019-12-03` on dev,
`2025-09-30.clover` on prod); API reads use `async-stripe`'s pinned
`2023-10-16`. The translator reads all of them into the same facts (the
period lives on the subscription in older versions and on each item in
newer ones). A webhook payload in any other version dead-letters; adding one
needs fixtures and tests (`crates/stripe_inbox/fixtures`).

## Known limits

- Two events of one object in the same second order by event id, not by
  Stripe's order.
- A failed payment revokes at once, as before, even while Stripe retries;
  following the subscription status instead is a separate product change.
- No other service hears about billing changes yet; a Kafka publisher of
  Macro's own billing decisions is planned for when one needs them.
