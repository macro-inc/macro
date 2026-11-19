## Why

Routines can start on a schedule or on Macro and GitHub events, but not from another system. A webhook trigger gives a routine a URL; a POST to it starts a run with the body as data. The URL is a way into Macro from the open internet that runs code and AI with its owner's access, so the design treats the secret, the sender and the body as hostile.

## How it works

```
sender ──POST /scheduled-action/hooks/{hook}/{secret}──┐  (or /hooks/{hook} + Authorization: Bearer {secret})
                                                       ▼
webhook_router ─ rate limit (address, hook; Redis, fails closed)
               ─ body ≤ 64 KiB, UTF-8
               ─ admit: lock routine, then webhook row; constant-time hash check
                 └ unknown / wrong / rotated / removed / deleted → the same 404
               ─ queue an event run (≤ 20 pending, Idempotency-Key for 24 h)
                                                       ▼
event-run worker ─ claim: recheck the delivery's hook is still current (FOR SHARE)
                 ─ run as the owner: code reads trigger.item.webhook.json,
                   agents see the body as untrusted text
```

A routine has at most one URL: a public hook id plus a 256-bit secret, of which only the SHA-256 is stored. Only the routine's owner, in their own session, can read, make, replace or delete it. Refused alike: API tokens and bots, agents' code, routine runs, and any credential signed for an agent or a routine's run (`routine_id`), whatever its origin. The secret is shown once, in the response that made it.

## What

- `scheduled_action_webhook` table (one URL per routine, hashed secret) and a concurrent partial index for idempotency keys on `scheduled_action_event_run`.
- `crates/scheduled_action`: webhook domain and store (`pg_webhook_store`), management routes (make/replace, read without secret, delete; `Cache-Control: no-store` on the mint answer), delivery routes in path and bearer forms, the `webhook` event filter, and delivery through the existing event-run queue. Saving a routine without the filter, rotating, or deleting it revokes the URL; queued deliveries made with an old URL never start (claim-time check).
- Responses: 202 with the run id, 200 with no run when the filter doesn't match, 404 for every refused credential, 409 paused routine, 413 too large, 400 not UTF-8 or bad Idempotency-Key, 429 rate limited, 503 when Redis is unavailable.
- `agent_harness_service` serves the routes and builds URLs on the public gateway origin (`ApiGatewayUrl` + `/scheduled-action`), the same as before in dev and prod. Locally, a minted URL is reachable only when the stack runs without AI computers (`--no-computers`); with them, the stack sets the gateway origin to an in-network host. Request spans record route templates, never paths; a test checks the secret appears in no log line or span.
- `agent_correlation`: minting and delivering count as sends, so a run that sends nothing can't start runs this way.
- Web (`features/routines`, behind `enable-routine-webhooks`): a **Webhooks** group in the trigger menu, a URL panel with a JSON `curl` example and the bearer form, JSON body filters, and the saved trigger reopens its panel, where its URL is made once the routine is saved with it. The secret is kept only while its panel is open and never in the query cache.
- SDK and code-mode docs describe `trigger.item.webhook`; the agent guide walks through the flow. Customer docs wait for release.
- `docs/agent-guide/ai-chat.md` no longer names a `POST /search/names` endpoint, which doesn't exist; it now names document storage's internal search routes.

## Database review

| Statement | Fired by | Rows touched | Index or lock | Checked |
| --- | --- | --- | --- | --- |
| `CREATE TABLE scheduled_action_webhook` (FK to `scheduled_action`) | migration | new, empty | brief ShareRowExclusiveLock on `scheduled_action` under `lock_timeout` 5s | applied locally |
| `CREATE INDEX CONCURRENTLY ... webhook_key_idx` (partial) | migration, `-- no-transaction` | rows with an idempotency key: none before deploy | ShareUpdateExclusiveLock only; INVALID-index recovery in the file | reasoned |
| admit (`FOR UPDATE OF a, w`) + `last_used_at` update | each delivery | 1 routine + 1 webhook row | PK / `hook_id` UNIQUE; routine then webhook | reasoned, lock order reviewed |
| mint/replace upsert, remove `DELETE` | owner actions | 1 row | PK on `action_id`; replace locks the routine first | reasoned |
| idempotency lookup | deliveries with a key | ≤ 1 row per routine/key in 24 h | `webhook_key_idx` (action_id, key, admitted_at) | reasoned |
| claim's `SELECT 1 ... FOR SHARE` on `scheduled_action_webhook` | each webhook claim | ≤ 1 row | PK; taken after the routine's `FOR UPDATE`, same order as every writer; `remove` waits on it | reasoned, lock order reviewed |
| `pending_runs` | event-run worker | unchanged from `main` | | |

The `last_used_at` update leaves a dead tuple per delivery on a busy hook; the rate limit (30/min per hook) bounds it.

## Follow-ups

- The bearer form keeps the secret out of the request path; which forms to offer at release is a separate decision.
- No backend switch beyond the web flag; limits are constants.
- Finished event-run rows (with the body) stay until the routine is deleted.
- `RoutineEvent` has no fallback for an event name an older self-hosted daemon doesn't know (as with `github` on main); a webhook run reaching such a daemon fails to decode its context.

Reviewed took 7 rounds with gpt-6.1-sol. Verdict: approved; one finding is left to the follow-ups above.




