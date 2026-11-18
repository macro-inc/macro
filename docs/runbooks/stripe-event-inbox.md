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

## Rollout window

Deploy at low traffic. During the ECS rolling deploy, old tasks still take
some webhooks and apply them synchronously with the old handler: those
events bypass the inbox and are never stored. Once every task runs the new
version (the deploy job finished and ECS shows one task definition):

1. List the events Stripe delivered during the rollout window, by created
   time (Unix seconds, from just before `deploy-services` started to when it
   finished):

   ```sh
   stripe get /v1/events -d "created[gte]=<unix start>" -d "created[lte]=<unix end>" -d limit=100
   # next page: add -d starting_after=<last evt_id of the previous page> while has_more is true
   ```

2. Resend each one to the production endpoint, from the dashboard
   (Developers → Events → the event → Resend) or the CLI:

   ```sh
   stripe events resend <evt_id> --webhook-endpoint <we_id>
   ```

   Against production, add `--live` (or `--api-key` with a live restricted
   key) to both commands. Events the new version already stored dedupe on
   their id. The rest apply
   in created order, rewinding a cursor where needed (consumers are
   idempotent).

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
   `stripe get /v1/events -d "created[gte]=<unix start>" -d "created[lte]=<unix end>" -d limit=100`
   (page with `-d starting_after=<evt_id>`), as in the rollout window above. The next daily audit also records them as
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

## Unknown price on a grant

A personal subscription granting access on a price that is neither a sold
seat price nor in `LEGACY_PREMIUM_PRICE_IDS` dead-letters by design: Macro
does not guess a tier. Revokes on such a price still apply (they remove
Premium). The `personal_plan` dead-letter monitor pages on-call. Recover:

1. Add the price id to `LEGACY_PREMIUM_PRICE_IDS` in
   `crates/teams/src/domain/model.rs` (when it should keep Premium; another
   tier is a code change to `SeatPrices`).
2. Ship it through the normal full deploy (`deploy_all_services.yml`).
3. Once it is live, replay the dead `personal_plan` cursors, retrying each
   dead event (do not skip it):

   ```sh
   curl -sS -X POST "https://gateway.macro.com/auth/internal/stripe_inbox/replay_dead" \
     -H "x-internal-auth-key: $INTERNAL_API_KEY" \
     -H "content-type: application/json" \
     -d '{"consumer": "personal_plan", "skipDeadEvent": false, "limit": 100}'
   # {"rearmed": 3}; repeat until it answers {"rearmed": 0}
   ```

   `INTERNAL_API_KEY` is the value of that key in the authentication-service
   Doppler config of the environment; the base URL is `AuthServiceUrl`
   (`crates/macro_service_urls`), `https://dev-gateway.macro.com/auth` on dev.
4. Check the dead count is gone: the `stripe inbox dead cursors` log stops
   and the monitor recovers within 30 minutes.

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
