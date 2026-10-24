# whatsapp_session_service

## What it is

WhatsApp linked devices: runs one whatsmeow client per linked personal
WhatsApp account, on whichever replica holds the account's Postgres advisory
lock. It pairs devices (QR codes into `whatsapp_pairing`), keeps group rosters
current, ingests standalone `whatsapp_group` traffic through `whatsapp_linked`'s
`SessionService`, and dispatches the sends DSS records. No HTTP API besides
`GET /health`; DSS talks to it only through rows and `NOTIFY`.

## How it works

- `src/replica.rs`: `replica::start(ReplicaDeps, shutdown)` composes one
  replica; `main.rs` and end-to-end tests both use it (tests inject the fake
  server's dialer, `test_signal()`, a fake KMS and short `Timings`).
- `domain/supervisor.rs`: which accounts this replica runs. Takes free accounts
  (`pg_try_advisory_lock(hashtext('whatsapp-account:' || id))`) on rescan and
  on `NOTIFY`, up to `WHATSAPP_SESSION_MAX_ACCOUNTS`; on SIGTERM releases them
  in batches of `WHATSAPP_SESSION_DRAIN_BATCH` (finish sends, disconnect,
  unlock, `NOTIFY whatsapp_account_released`), all within 100 s.
- `domain/account.rs`: one account. `begin_lease` bumps `lease_epoch`; every
  domain and store write is fenced by it, and `Fenced` stops the account.
  Pairing an account that is not connected deletes the stored device first
  (fresh keys); `whatsapp_account_changed` to `disconnected` logs the device
  out at WhatsApp (the remote unlink DSS's disconnect promises).
- `domain/inbound.rs`: durable inbound. The client's event handler (with
  `synchronous_ack`) calls the `InboundGate`: drop unadopted groups, else
  `enqueue_inbound` (one fenced insert), and only then is the node acked;
  `replay_deferred` ingests the queue from the runner. The handler never
  waits on the runner or the socket.
- `domain/media.rs`: per-account import loop (`claim_media_imports` →
  download → `complete_media_import` / `fail_media_import`). Media sends
  upload before `begin_dispatch`. Two transfers per account, 32 MiB cap.
- `outbound/lease.rs`: the lock connection (one non-pooled `PgConnection`,
  pinged every 5 s; if it dies every account stops and the process exits
  non-zero so ECS replaces it), release announcements, and discovery through
  `SessionService` (`discoverable_accounts`, `fleet_health`).
- `outbound/signals.rs`: `LISTEN` for `whatsapp_{account_released,
  pairing_requested, send_requested, groups_requested, account_changed}`.
  Payloads are `whatsapp_linked::outbound::pg::signals::Signal` JSON; each
  one's `traceparent` parents a `whatsapp.signal.receive` span.
- Group rosters: the whole list is read on connect, on resync, and on
  `whatsapp_groups_requested` (pages opening; at most once per
  `groups_refresh_interval`, 30 s, per account). Live `JoinedGroup` /
  `GroupInfo` events update that one group (`update_group`), reading its
  metadata when the event lacks it; a not-in-group answer is `group_left`.
  No periodic refresh. The domain signals `whatsapp_changed` only when a roster
  write changed something.
- `outbound/whatsapp.rs` (+ `events.rs`): `whatsapp_store_pg` device store,
  whatsmeow `Client` (`whatsmeow_signal::libsignal()`), event mapping. Only
  group events become inbound events; the gate drops groups the account has
  not adopted. Adopted groups stay cached until `whatsapp_account_changed`;
  a miss always waits for a load that started after the event arrived
  (single-flight), so an adoption that committed just before is seen. Media locators (direct path, media key, hashes) are sealed with
  `PgWhatsAppStore::seal("media-locator", …)` before they leave the process.
- Passkey pairing: `PairPasskeyRequest` → `PairingUpdate::Passkey { challenge }`;
  on `whatsapp_pairing_requested`, and on every tick in case the notify was
  missed, the runner takes the owner's assertion (`take_passkey_response`)
  and forwards it; a confirmation that needs the
  handoff shows its code as the pairing's `pair_code`, then confirms.

## Config (Doppler `whatsapp-session-service`, `dev` and `prd`)

- `DATABASE_URL`: pooled MacroDB URL.
- `WHATSAPP_SESSION_LOCK_DATABASE_URL`: the RDS **instance** endpoint
  (`macro-db-<stack>`, the macrodb stack's `endpoint` output), never
  `macrodb-proxy-<stack>`: RDS Proxy multiplexes and reaps idle connections,
  which drops advisory locks and `LISTEN`. Never open a transaction on it:
  MacroDB kills sessions idle in transaction after 5 minutes.
- `WHATSAPP_SESSION_KMS_KEY_ID`: `alias/whatsapp-session-service-<stack>`
  (GenerateDataKey + Decrypt).
- `WHATSAPP_SESSION_MAX_ACCOUNTS` (local 500), `WHATSAPP_SESSION_DRAIN_BATCH`
  (local 20).
- Tests only, process env: `OVERRIDE_WHATSAPP_WEBSOCKET_URL` (fake server)
  and `OVERRIDE_WHATSAPP_MEDIA_HOST` (`scheme://host[:port]` of its media
  host).

## Telemetry

Spans: `whatsapp.account.{lease,release,rescan,connect}`,
`whatsapp.inbound.ingest`, `whatsapp.media.import`, `whatsapp.send.dispatch`
(parented on the trace of the request that recorded the send),
`whatsapp.groups.{refresh,event}`, `whatsapp.signal.receive`, `whatsapp.drain`. Log events read by `infra/stacks/monitoring/monitors/
whatsapp-session.ts` (`telemetry_event` = `whatsapp_session_health`,
`whatsapp_session_reconnect`, `whatsapp_send_outcome`,
`whatsapp_session_drain`): keep their field names. Opaque ids only; never
JIDs, phone numbers, QR codes or message text.

## Runbook

- **Stuck lease** (an account no replica runs, `accounts_unowned` > 0): find
  the holder with `SELECT pid FROM pg_locks WHERE locktype = 'advisory' AND
  objsubid = 1 AND ((classid::bigint << 32) | objid::bigint) =
  hashtext('whatsapp-account:<id>')`; if its replica is gone,
  `pg_terminate_backend(pid)` frees it and the next rescan (30 s) takes it.
- **All accounts offline**: check the lock URL points at the instance endpoint,
  replicas are not crash-looping on a lost lock connection, and capacity
  (`accounts_running` vs `WHATSAPP_SESSION_MAX_ACCOUNTS` × replicas).
- **KMS failure**: accounts exit `Failed` at open (`whatsapp.account.connect`
  outcome `failed`, error "KMS refused"); check the task role can use the key
  alias and the key is enabled. Nothing is lost; the next rescan retries.
- **Unknown sends**: never resent automatically; a later echo with the same
  message id settles them.

## Checks

- `cargo test -p whatsapp_session_service` (`SQLX_OFFLINE` unset; the lease
  tests need Postgres).

## Gotchas

- Release order matters: unlock before `NOTIFY`, or the next replica's
  `try_lock` loses the race.
- The event handler runs on whatsmeow's node-handler queue, not the socket
  reader, so a database insert there cannot block send acks; it must still
  never wait on the runner (session events go through an unbounded channel).
- Every path that acknowledges an event without storing it logs a debug
  event `whatsapp.inbound.skipped` with a `reason` (`not_group_content`,
  `group_not_adopted`, `invalid_event`). Once stored, the domain may still
  drop an event as not observed (consent boundary).
- whatsmeow's media futures are large: the adapter boxes them, or nesting
  them in the runner overflows a 2 MiB stack in debug builds.
- Every send sets `no_disconnect_retry`: a send cut off by a disconnect is
  recorded `unknown` instead of being resent after reconnect.
- whatsmeow emits a sender key distribution as its own message event with
  the content's id; `events.rs` drops it, or it would claim the id.
- Builds from the shared `docker/Dockerfile`; there is no per-service one.

## Related

- `crates/whatsapp_linked/AGENTS.md`, `crates/whatsapp_store_pg/AGENTS.md`,
  `crates/whatsmeow/AGENTS.md`, `infra/stacks/whatsapp-session-service/`
