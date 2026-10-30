# whatsapp_session_service

## What it is

WhatsApp linked devices: runs one whatsmeow client per linked personal
WhatsApp account, on whichever replica holds the account's Postgres advisory
lock. It pairs devices (QR codes into `whatsapp_pairing`), keeps group rosters
current, ingests the traffic of added chats (`external_chat`) through `whatsapp_linked`'s
`SessionService`, and dispatches the sends DSS records. No HTTP API besides
`GET /health`; DSS talks to it only through rows and `NOTIFY`.

## How it works

- `src/replica.rs`: `replica::start(ReplicaDeps, shutdown)` composes one
  replica; `main.rs` and end-to-end tests both use it (tests inject the fake
  server's dialer, `test_signal()`, a fake KMS and short `Timings`).
- `domain/supervisor.rs`: which accounts this replica runs. Takes free accounts
  (`pg_try_advisory_lock(hashtextextended('whatsapp-account:' || id, 0))`) on rescan and
  on `NOTIFY`, up to `MAX_ACCOUNTS` (500, `main.rs`); on SIGTERM releases them
  in batches of `DRAIN_BATCH` (20) (finish sends, disconnect,
  unlock, `NOTIFY whatsapp_account_released`), all within 100 s.
- `domain/account.rs`: one account. `begin_lease` bumps `lease_epoch`; every
  domain and store write is fenced by it, and `Fenced` stops the account.
  Pairing an account that is not connected deletes the stored device first
  (`PgWhatsAppStore::reset_device`, without unwrapping its key; fresh keys).
  A device that can never be read again (KMS refused its data key, or it
  doesn't decrypt: `SessionError::DeviceUnreadable`) is replaced once when
  pairing, and without a pairing marks a connected account `logged_out`, so
  the web asks its owner to reconnect. A KMS outage (`KmsUnavailable`) wipes
  nothing: the account exits `Failed` and the next rescan retries.
  `whatsapp_account_changed` to `disconnected` logs the device out at
  WhatsApp (the remote unlink DSS's disconnect promises).
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
  pairing_requested, send_requested, roster_requested, lookup_requested,
  account_changed}`.
  Payloads are `external_chat::signals::Signal` JSON; each
  one's `traceparent` parents a `whatsapp.signal.receive` span that travels
  with the signal (`ports::Traced`): the supervisor's work and the runner's
  `whatsapp.account.signal` span run inside it, and a runner started by it
  links its `whatsapp.account.connect` span to it. By hand,
  send JSON: `SELECT pg_notify('whatsapp_pairing_requested',
  '{"id":"<pairing id>"}')`.
- Group rosters: the whole list is read on connect, on resync, and on
  `whatsapp_roster_requested` (pages opening; at most once per
  `groups_refresh_interval`, 30 s, per account). Live `JoinedGroup` /
  `GroupInfo` events update that one group (`update_group`), reading its
  metadata when the event lacks it; a not-in-group answer is `group_left`.
  No periodic refresh. The domain signals `external_chat_changed` only when a roster
  write changed something.
- `outbound/whatsapp.rs` (+ `events.rs`): `whatsapp_store_pg` device store,
  whatsmeow `Client` (`whatsmeow_signal::libsignal()`), event mapping. Group
  and direct-chat events become inbound events (`events::chat_of`: a direct
  chat by phone number, its LID alongside); the gate drops chats the account
  has not adopted, matching a direct chat by either address. Before storing,
  `events::complete_addresses` fills the other half of a sender's and a
  direct chat's phone-number/LID pair from the account's LID store (pairing,
  group participant lists, message addressing); `from_me` carries WhatsApp's
  own-message flag. If the LID store can't be read, the event is left
  unacknowledged (WhatsApp redelivers it) rather than gated without its
  other address. History requests name a direct chat by LID
  (`events::phone_chat`), as phones key it. Adopted groups stay cached until `whatsapp_account_changed`;
  a miss always waits for a load that started after the event arrived
  (single-flight), so an adoption that committed just before is seen. Media locators (direct path, media key, hashes) are sealed with
  `PgWhatsAppStore::seal("media-locator", …)` before they leave the process.
- Message types (`events.rs` + `events/rich.rs`): text, media (with declared
  size/length; stickers, GIFs and PTT voice notes marked), quotes on any
  content part, mentions, forwarding, polls, locations, contact cards (vCard
  name and numbers), events; pins and call logs become system lines, as do
  live group notifications (`map_event` returns the roster refresh plus one
  system line per change), group icon changes and history stub messages.
  Poll votes are decrypted in `Forwarder::poll_vote` with the poll's stored
  message secret (undecryptable ones are acked and dropped). View-once media
  (unwrapped by the port, or flagged on the media) is imported like any media
  and marked `view_once`.
- Chat list and history: `outbound/whatsapp.rs` `Forwarder` turns history
  sync bundles, live messages (any chat) and contact/archive/pin events into
  `ChatUpdate`s (`events.rs`: `history_chats`, `message_chat`,
  `chat_setting`; direct chats by phone number) that the runner stores with
  `update_chats`. The device store's saved contacts (`events::contact_chats`:
  address-book names only, not people merely seen in groups) are listed on
  `Connected` and every `AppStateSyncComplete`, and a `Contact` event lists
  its contact, so the owner can start a chat with them.
- Phone-number lookups (`domain/account/lookups.rs`): on
  `whatsapp_lookup_requested`, on connect and on every tick, the runner
  answers pending lookups with one `IsOnWhatsApp` usync each
  (`WhatsAppSession::look_up`; whatsmeow stores the number's LID pairing, so a
  later message by LID lands in the same chat) and records the answer
  (`events::lookup_answer` names it like any chat). Only explicit owner
  lookups, rate-limited in DSS: WhatsApp bans bulk usync. On-demand history answers are parsed with
  `Client::parse_web_message`, ingested as history events through the inbound
  gate, then reported as a `HistoryPage`. The runner's `backfill` asks the
  phone for pages of added groups (`request_history`, plus `request_message`
  for an anchor that predates adoption), marks a group with no anchor
  `waiting_for_message` (an `update_chats` that gives it one returns true and
  the runner imports at once), marks unanswered requests
  `waiting_for_phone` after `backfill_timeout` and retries after
  `backfill_retry` or on reconnect.
- QR pairing: whatsmeow rotates codes (60 s, then 20 s each) and then
  times out; that timeout ends the pairing as `expired`
  (`SessionEvent::PairExpired`), not `failed`, so the web starts a new one.
- Passkey pairing: `PairPasskeyRequest` → `PairingUpdate::Passkey { challenge }`;
  on `whatsapp_pairing_requested`, and on every tick in case the notify was
  missed, the runner takes the owner's assertion (`take_passkey_response`)
  and forwards it; a confirmation that needs the
  handoff shows its code as the pairing's `pair_code`, then confirms.

## Config (Doppler `whatsapp-session-service`, `dev` and `prd`)

- `DATABASE_URL` (`${global_databases.<config>.DATABASE_URL}`), the only
  key. The pool and the dedicated advisory-lock connection both open from it,
  so it must be the RDS **instance** endpoint (`macro-db-<stack>`), never
  `macrodb-proxy-<stack>`: RDS Proxy multiplexes and reaps idle connections,
  which drops advisory locks and `LISTEN`. Never open a transaction on the
  lock connection: MacroDB kills sessions idle in transaction after 5 minutes.
- KMS key: `SessionKmsKey` (`src/config.rs`) picks
  `alias/whatsapp-session-service-<environment>` from `ENVIRONMENT`
  (GenerateDataKey + Decrypt); `xtask_local` creates the `-local` alias in
  LocalStack.
- Tests only, process env: `OVERRIDE_WHATSAPP_WEBSOCKET_URL` (fake server)
  and `OVERRIDE_WHATSAPP_MEDIA_HOST` (`scheme://host[:port]` of its media
  host).

## Telemetry

Spans: `whatsapp.account.{lease,release,rescan,connect}`,
`whatsapp.inbound.ingest`, `whatsapp.media.import`, `whatsapp.send.dispatch`
(parented on the trace of the request that recorded the send),
`whatsapp.groups.{refresh,event}`, `whatsapp.contacts.sync`, `whatsapp.lookup`
(outcome `found`/`not_on_whatsapp`/`failed`), `whatsapp.signal.receive`,
`whatsapp.account.signal`, `whatsapp.drain`,
`whatsapp.history.{sync,page}`, `whatsapp.backfill.request`
(`whatsapp.inbound.ingest` records the message `kind`; `whatsapp.history.page`
counts what a page stored, could not parse and skipped, by stub type). Log events read by `infra/stacks/monitoring/monitors/
whatsapp-session.ts` (`telemetry_event` = `whatsapp_session_health`,
`whatsapp_session_reconnect`, `whatsapp_send_outcome`,
`whatsapp_session_drain`): keep their field names. Opaque ids only; never
JIDs, phone numbers, QR codes or message text.

## Runbook

- **Stop all WhatsApp traffic**: scale the ECS service to 0 tasks. Accounts
  stay `connected` and are picked up again when it scales back; sends recorded
  meanwhile expire unsent after ten minutes. A deploy restores the task
  count in `infra/stacks/whatsapp-session-service/service.ts` (2 in prod, 1 in
  dev). The web flag
  `enable-whatsapp-linked` only hides the UI; the API keeps answering.
- **Stuck lease** (an account no replica runs, `accounts_unowned` > 0): find
  the holder with `SELECT pid FROM pg_locks WHERE locktype = 'advisory' AND
  objsubid = 1 AND ((classid::bigint << 32) | objid::bigint) =
  hashtextextended('whatsapp-account:<id>', 0)`; if its replica is gone,
  `pg_terminate_backend(pid)` frees it and the next rescan (30 s) takes it.
- **All accounts offline**: check the lock URL points at the instance endpoint,
  replicas are not crash-looping on a lost lock connection, and capacity
  (`accounts_running` vs `MAX_ACCOUNTS` × replicas).
- **KMS failure**: an outage (throttled, unreachable) makes accounts exit
  `Failed` at open (`whatsapp.account.connect` outcome `failed`); nothing is
  lost and the next rescan retries. A refusal (key deleted or disabled, no
  permission, a LocalStack that lost its key) is outcome
  `device_unreadable`: connected accounts become `logged_out` and must pair
  again, which replaces the device. Check the task role can use the key
  alias and the key is enabled before people re-pair.
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
  `group_not_adopted`, `invalid_event`, `undecryptable_poll_vote`). Once stored, the domain may still
  drop an event as not observed (consent boundary).
- whatsmeow's media, send and history futures are large: the adapter and the
  runner box them, or nesting them overflows a 2 MiB stack in debug builds
  (the local stack runs debug binaries).
- Every send sets `no_disconnect_retry`: a send cut off by a disconnect is
  recorded `unknown` instead of being resent after reconnect.
- whatsmeow emits a sender key distribution as its own message event with
  the content's id; `events.rs` drops it, or it would claim the id.
- Builds from the shared `docker/Dockerfile`; there is no per-service one.

## Related

- `crates/whatsapp_linked/AGENTS.md`, `crates/whatsapp_store_pg/AGENTS.md`,
  `crates/whatsmeow/AGENTS.md`, `infra/stacks/whatsapp-session-service/`
