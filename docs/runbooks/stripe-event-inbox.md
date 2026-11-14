# Stripe event inbox: deploy, rollback and replay

How to ship, roll back and recover the Stripe event inbox
(`crates/stripe_inbox`, consumers in `services/authentication_service`). How
it works: [architecture](../architecture/stripe-event-inbox.md).

## Migrations run before the service rolls

- Dev (every push to `main`, `.github/workflows/deploy_on_push.yml:32`) and
  prod (`.github/workflows/release-production.yml:14`) both deploy through
  `.github/workflows/deploy_all_services.yml`.
- In it, `migrate-db` (`deploy_all_services.yml:309`, running
  `.github/actions/migrate-cloud-storage-db`, which is `cargo sqlx migrate run`
  at `action.yml:53-55`) must succeed before `deploy-services` starts
  (`deploy_all_services.yml:336-337`: `needs.migrate-db.result == 'success'`).
  Source: `tooling/xtask/crates/xtask_workflows/src/workflows/deploy_all_services.rs:299-342`.
- `authentication_service` never migrates at boot.
- **Never ship the inbox with the single-service deploy**
  (`deploy-service-generic.yml` → `reusable_deploy_service.yml`): it runs no
  migrations, so the new code would start without its tables.

The inbox migration only adds tables and types, so code from before the inbox
runs unchanged with it applied.

## Before a rollback: drain

Events stored but not yet applied when the old code takes over are applied by
the inbox only after a later roll forward, behind whatever the old webhook
applied meanwhile. Drain first:

```sql
-- Pending work per consumer; wait until dirty is 0.
SELECT consumer, state, count(*) FROM stripe_event_cursor
WHERE state <> 'idle' GROUP BY consumer, state;
```

- `dirty` drains within seconds unless a consumer is slow.
- `failing` cursors back off for up to three days; note their customers
  (`SELECT consumer, ordering_key, last_error FROM stripe_event_cursor WHERE
  state = 'failing'`) and check them after the roll forward.
- `dead` cursors stay dead across a rollback; replay them after rolling forward.

## Rolling back

- Revert the code, but **keep the migration file**
  (`crates/macro_db_client/migrations/*_stripe_event_inbox.sql`). Prod runs
  `cargo sqlx migrate run` without `--ignore-missing`, so a release missing an
  applied migration fails `migrate-db`, and that blocks every later deploy.
- While rolled back, the old webhook handler applies each event directly and
  writes nothing to the inbox tables. The inbox never sees those events.

## After rolling forward: resend what the inbox missed

1. List the events of the rollback window, from just before the rollback
   deployed to just after the roll forward:
   `stripe events list --created[gte]=<unix start> --created[lte]=<unix end> --limit 100`
   (page with `--starting-after`). The next daily audit also records them as
   `missing_event` (`stripe_audit_mismatch`), within its 26-hour lookback.
2. Resend each to the production endpoint: in the Stripe dashboard, open
   Developers → Events → the event, and choose Resend; or use
   `stripe events resend <evt_id> --webhook-endpoint <we_id>`.
   - The inbox stores each event and applies it in created order. An event
     older than what a cursor applied rewinds that cursor, so the events after
     it apply again (consumers are idempotent).
   - An event created more than 30 days ago (the payload retention) is stored
     for dedupe but never rewinds a cursor or applies. Stripe keeps events for
     30 days anyway.
3. Replay dead cursors once their cause is fixed (below).

## Replaying dead cursors

- A cursor whose retries ran out (84 attempts, about 74 hours) re-arms by
  itself on its customer's next event. A rejected one (for example, a grant on
  a price that is neither sold nor on `LEGACY_PREMIUM_PRICE_IDS`) stays dead
  until replayed.
- One cursor: `POST /internal/stripe_inbox/replay` with
  `{"consumer", "orderingKey", "skipDeadEvent"}`. It answers 409 while a
  worker holds the lease.
- In bulk: `POST /internal/stripe_inbox/replay_dead` with
  `{"consumer"?, "skipDeadEvent", "limit"?}` re-arms up to `limit` (default
  100, at most 1000) dead cursors, of one consumer or all, and answers
  `{"rearmed": n}`. Repeat until it answers 0.
- Both endpoints are on authentication-service and take the
  `x-internal-auth-key` header. Skip the dead event only when it must never
  apply.
