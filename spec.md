# Fix Specification — PR #5490 `feat(email): hexify gmail client`

Source: multi-agent review of the PR at head `96866a335` (merge-base with main: `9362a31c5`).
All file:line references are pinned to that commit and will drift as fixes land.

Priorities:

- **P0 — required before merge.** Correctness regressions vs main, or incomplete new mechanisms with silent-mail-loss / quota-burn consequences. All were independently confirmed (multiple reviewers and/or adversarial verification against the code).
- **P1 — required follow-ups.** Smaller correctness, resilience, and observability fixes. Land in this PR if cheap, otherwise as an immediate follow-up PR.
- **P2 — hygiene.** Docs, tests, lint shields, style conventions.
- **Open questions** — behavior changes that look intentional but are not stated in the PR description; confirm and document, or revert.

Definition of done: every P0 item checked off with its listed tests added; `cargo test -p email_api_client -p gmail_client -p email_service` green; `cargo fmt` + `just clippy` clean. No SQL/schema changes are expected by this spec; if any fix adds a new sqlx query, run `nix develop --command just prepare_db` from the repo root.

---

## P0 — Required before merge

### P0.1 Classify Gmail 403 quota errors as `RateLimited`, not `Forbidden`

- [x] **Status** — done

**Problem.** `map_gmail_error` (`crates/email_api_client/src/outbound/gmail/mod.rs:79`) maps every 403 to `EmailApiError::Forbidden`. Gmail signals per-user quota exhaustion as **HTTP 403** with reasons `userRateLimitExceeded` / `rateLimitExceeded` / `dailyLimitExceeded` (429 is only one of its forms). `EmailApiError::is_transient()` excludes `Forbidden`, and all three worker policy modules treat it as non-retryable.

**Impact.** A quota burst that main retried now: drops inbox_sync operations (and because `gmail_message.rs` advances the stored cursor before children complete, the affected email **silently never syncs**); marks a user's entire backfill job failed and notifies the client; reverts the user's label change in gmail_ops.

**Fix.**
1. In `map_gmail_error`, for status 403, inspect the preserved response body (`GmailApiHttpError::Http { body, .. }` — the sanitizer keeps Gmail `reason` strings intact, verified) for `userRateLimitExceeded`, `rateLimitExceeded`, `dailyLimitExceeded`, `quotaExceeded` → return `EmailApiError::RateLimited { retry_after }`.
2. Plain 403 (no quota reason) stays `Forbidden`.

**Files.** `crates/email_api_client/src/outbound/gmail/mod.rs`.

**Tests.** Extend `crates/email_api_client/src/outbound/gmail/test/error.rs` (it currently pins 403 → `Forbidden` unconditionally): 403 + `userRateLimitExceeded` body → `RateLimited`; 403 + quota reason + `Retry-After` header → `retry_after` populated; plain 403 → `Forbidden`.

**Acceptance.** Worker policy modules (`inbox_sync|gmail_ops|backfill/email_api_error.rs`) treat quota-403s as retryable through `is_transient()` with no changes of their own.

---

### P0.2 Repair the sync cursor in the stale-cursor (`OutdatedCursor`) recovery path

- [x] **Status** — done

**Problem.** On `OutdatedCursor` from `list_changes`, `schedule_stale_cursor_backfill` (`services/email_service/src/pubsub/inbox_sync/operations/gmail_message.rs:81-84, 117-177`) schedules a recovery backfill and drops the notification — but **nothing writes a fresh history cursor**. Verified: the only writers of `email_gmail_histories` are link init (`api/email/init.rs:913`) and a successful `list_changes` (`gmail_message.rs:88`, unreachable once the cursor is expired). The notification's own `history_id` is read for a freshness check (`gmail_message.rs:56`) but never persisted; `handle_refresh` discards the fresh cursor `register_subscription` returns; `/resync` doesn't repair it either.

**Impact.** After each recovery backfill completes, the next notification finds no active job and creates **another full-mailbox backfill, indefinitely** (`get_active_backfill_job` filters `status IN ('Init','InProgress')`). Because `backfill_thread.rs:40-44` skips threads already in the DB without fetching messages, **new messages in existing threads never sync** until the user reconnects the inbox. (Main was also permanently stuck in this state — retry-to-DLQ — so this is an incomplete new recovery mechanism, not a regression; it must still be completed.)

**Fix.**
1. In the `OutdatedCursor` arm, after successfully scheduling (or reusing) the recovery backfill job, persist a fresh cursor via `upsert_gmail_history` using `payload.history_id` from the triggering notification (already in hand). Alternative: re-register the subscription and persist `ProviderSubscription.cursor` (the `init.rs:913` pattern).
2. **Scope the repair strictly to this arm.** Do not persist the watch cursor unconditionally in `handle_refresh` — that would skip unprocessed changes whenever the worker lags.
3. If the cursor write fails, log via `.inspect_err` and drop the notification as today — the next notification re-enters the arm (active job is reused) and retries the repair; this converges.

**Files.** `services/email_service/src/pubsub/inbox_sync/operations/gmail_message.rs`.

**Tests.** Operation-level test: `OutdatedCursor` → backfill job scheduled **and** `upsert_gmail_history` called with the notification's history id; second notification after repair goes through `list_changes` (no new job).

**Acceptance.** One expired cursor produces exactly one recovery backfill; subsequent notifications sync incrementally.

**Follow-up (see P1.9).** Recovery backfills should not skip existing threads, so the gap window's replies are actually recovered.

---

### P0.3 Restore warn-and-skip for undecodable MIME part bodies

- [x] **Status** — done

**Problem.** `crates/email_api_client/src/outbound/gmail/convert/payload.rs:105-110` returns `EmailApiError::Permanent` when any part's `body.data_base64` fails to decode — the decode runs for every data-carrying part, including parts whose bytes are then discarded. Both sync and backfill map `Permanent` to non-retryable, and `thread.rs:28` collects with `.collect::<Result<Vec<_>,_>>()?`, so one bad part permanently blocks the message **and its whole thread**. Main warned and continued (`git show 9362a31c5:services/email_service/src/convert/payload.rs`, lines 105-121). The strict `URL_SAFE` engine also rejects non-canonical/unpadded input that this PR's own calendar path tolerates (`outbound/gmail/messages.rs:50-53`).

**Fix.**
1. On decode failure: `tracing::warn!(message_id = %message_id, part_id = %part.part_id, mime = %part.mime_type, error = %e, "failed to decode base64 body data")` and **continue** (restore main semantics).
2. Use tolerant decoding: `URL_SAFE_NO_PAD.decode(..).or_else(|_| URL_SAFE.decode(..))`, matching `collect_calendar_parts`.
3. Optional: only attempt the decode when the bytes will be consumed (`text/plain` with `body_text` unset, or `text/html` with `body_html_sanitized` unset).

**Files.** `crates/email_api_client/src/outbound/gmail/convert/payload.rs`; update `payload/test.rs:42-46`, which currently pins the error behavior.

**Tests.** Message with one undecodable part still converts (body absent, other fields intact); unpadded-base64url body decodes; thread containing such a message converts.

---

### P0.4 Extract calendar parts from the already-fetched message (no second `messages.get`)

- [x] **Status** — done (get_message now returns `MessageWithCalendarParts`; `get_thread` untouched since ingest only needs the trigger message's parts)

**Problem.** `MailboxCalendarClient::get_calendar_parts` (`crates/email_api_client/src/domain/ports.rs:146`) takes only `(token, provider_message_id)`, so the Gmail adapter re-fetches the full message (`outbound/gmail/messages.rs:24`) and the domain service charges a second `GetMessage` (5 quota units, `domain/service/messages.rs:129-138`). Both ingest callers (`upsert_message.rs:305`, `backfill_message.rs:64-65`) invoke it unconditionally when `calendar_sync_enabled` — for a payload they fetched moments earlier. Main passed the payload in (`payload: &MessagePart`) at zero provider cost.

**Impact.** Per-message Gmail read quota and internal Redis budget roughly double (5 → 10 units on the common path); a 100k-message backfill issues ~100k extra `messages.get` calls. Inline `text/calendar` invites — previously free and infallible — can now be skipped when the budget refuses the second fetch (best-effort `.ok()` at `calendar_ingest.rs`).

**Fix.** Return calendar parts with the message fetch: have the adapter run `collect_calendar_parts` on the same wire resource inside `get_message`/`get_thread` and surface them alongside the normalized `Message` (new field or a `MessageWithCalendarParts` return). Callers pass the parts into `ingest_calendar_parts`. Keep the id-based `get_calendar_parts` port method only for the durable ICS re-extraction job, where a fresh fetch (and its quota charge) is correct.

**Files.** `crates/email_api_client/src/domain/ports.rs`, `domain/models/*`, `domain/service/messages.rs`, `outbound/gmail/messages.rs`; `services/email_service/src/calendar_ingest.rs`, `pubsub/inbox_sync/operations/upsert_message.rs`, `pubsub/backfill/backfill_message.rs`.

**Tests.** Service-level test asserting a single `GetMessage` charge for fetch+calendar; adapter test asserting parts extracted from one wire fetch; keep an id-based-path test for the re-extract flow.

**Acceptance.** Exactly one `messages.get` per ingested message with calendar sync enabled; inline invites extracted even when the rate budget would refuse a new provider call.

---

### P0.5 Restore case-insensitive blocked-sender filter matching

- [x] **Status** — done (also restores the "no block filter found" warn from P1.10)

**Problem.** `find_block_filter` (`crates/email_api_client/src/outbound/gmail/blocklist.rs:99-103`) compares `filter.criteria.from.as_deref() == Some(email_address)`. Main used `eq_ignore_ascii_case`. No call-site layer normalizes case (`api/email/contacts/block_sender.rs` passes the request value verbatim).

**Impact.** Unblocking `john@example.com` when the filter was stored as `John@Example.com` finds nothing and returns `Ok(())` (`blocklist.rs:46-48`) — the sender's mail keeps going to TRASH while the UI reports success. Blocking with different casing creates duplicate filters; `unblock_sender` deletes only the first match.

**Fix.** Compare with `eq_ignore_ascii_case`; on unblock, delete **all** matching filters (heals legacy duplicates). Optionally normalize the address when constructing the block filter.

**Files.** `crates/email_api_client/src/outbound/gmail/blocklist.rs`.

**Tests.** `outbound/gmail/test/blocklist.rs`: block dedupe with case-differing existing filter; unblock with case-differing filter; unblock deleting multiple matches.

---

### P0.6 Stop paying a link SELECT + new Redis connection + health UPDATE on every Gmail call

- [ ] **Status**

**Problem.** `EmailApiClientServiceImpl::prepare()` runs per operation, and `EmailServiceTokenSource::get_access_token` (`services/email_service/src/outbound/email_api/token_source.rs:57-63, 89-94, 122-129`) performs, per Gmail API call: a `fetch_link_by_id` Postgres SELECT (for a link every call site already holds), `get_multiplexed_async_connection()` — which **dials a new Redis TCP connection per call** (redis-rs is not a pool), a Redis GET, and a guarded-but-unconditional `clear_link_needs_reauth` UPDATE. Main amortized this once per SQS message / HTTP request. A 50-change history batch: 1 token dance → 50; a message with N attachments: 1 → N+2; backfills multiply by thousands, against DB pools sized 15/25, at peak load.

**Fix (required).**
1. Create one `MultiplexedConnection` in `EmailServiceTokenSource::new` and clone it per call — the in-repo precedent is `GmailTokenProviderImpl` in `main.rs:179-198` ("cheap to clone and designed to be shared").
2. Skip `clear_link_needs_reauth` when the freshly SELECTed row already has `needs_reauth = false`. Gate only on the row read in the id-based path — never on caller-supplied `Link` values (`attach_link_context` hardcodes `needs_reauth: false`).

**Fix (recommended, may ship as immediate follow-up).**
3. Eliminate the per-call SELECT on hot paths: thread `&Link` through the service entry points (the `get_access_token_for_link` override already skips the SELECT) or memoize link+token per operation batch.

**Files.** `services/email_service/src/outbound/email_api/token_source.rs`; for (3): `crates/email_api_client/src/domain/service/*`, worker call sites.

**Tests.** `token_source/test.rs`: conditional-clear behavior (healthy row → no UPDATE issued; `needs_reauth = true` row → cleared). Add the currently missing health-transition tests while in the module (see P1.11).

---

### P0.7 Make link teardown health-neutral again, with bounded retry

- [ ] **Status**

**Problem.** `handle_delete` → `ctx.email_api.stop_subscription(link.id)` (`services/email_service/src/pubsub/link_manager/process.rs:271-279`) routes token acquisition through `record_token_health`. Main's teardown deliberately used a side-effect-free token fetch (`fetch_teardown_token`) with a 3-attempt retry (200ms/400ms, no retry on `Forbidden`).

**Impact.** Deleting a link whose grant died since the last probe can set `needs_reauth` and fan out a `NotifyReauthRequired` ("reconnect your inbox") notification for an inbox being intentionally removed, racing the delete. A transient auth blip now abandons `stop_watch` on the first attempt, leaving the Gmail watch to linger until expiry.

**Fix.** Provide a health-neutral teardown path — e.g. `stop_subscription_for_link(&link)` mirroring `register_subscription_without_cache`'s structure, backed by a token acquisition that skips `record_token_health` (a `TokenHealth::Ignore` mode on the source, or a dedicated method). Restore the bounded retry (3 attempts, 200/400ms) for transient token failures, skipping retry on permanent errors.

**Files.** `services/email_service/src/pubsub/link_manager/process.rs`, `services/email_service/src/outbound/email_api/token_source.rs`, possibly `crates/email_api_client/src/domain/ports.rs` + `domain/service/subscription.rs`.

**Tests.** link_manager process test: teardown with a revoked grant does not set `needs_reauth` and enqueues no `NotifyReauthRequired`; transient failure retries then succeeds.

---

## P1 — Required follow-ups (this PR if cheap, else immediate next PR)

### Error policy

- [ ] **P1.1 Missing link → `Permanent`, not `Transient`.** `token_source.rs:63` maps a nonexistent link to `TokenError::Transient` → workers retry a deleted mailbox to the DLQ. Map the `None` case to `Permanent` (keep DB *query failures* `Transient`). Main mapped this non-retryable.
- [ ] **P1.2 Propagate routing out of `fetch_and_insert_thread`.** `upsert_message.rs:226-233, 569-580`: the `handle_operation_error` result (which enqueues to the retry queue and returns `NonRetryable`) is flattened to `anyhow` and blanket-rewrapped as `Retryable(DatabaseQueryFailed)` — a 429 on `get_thread` is double-processed (retry queue **and** primary redelivery), and `AuthRequired`/`Permanent` thread-fetch failures are mislabeled retryable. Return `Result<(), ProcessingError>` and propagate verbatim.
- [ ] **P1.3 Exhaustive matches in the three policy modules.** `inbox_sync/email_api_error.rs:78`, `gmail_ops/email_api_error.rs:27,87`, `backfill/email_api_error.rs:12` use `_ =>` catch-alls that would silently drop messages for any future `EmailApiError` variant (main's default posture was retry). Match all variants explicitly so new variants force a policy decision.
- [ ] **P1.4 Contacts sync must self-heal on expired sync tokens.** People API returns 400 `EXPIRED_SYNC_TOKEN` (~7-day expiry); today that maps to `Permanent` forever — contact sync for the link never recovers (pre-existing on main, but `OutdatedCursor` now exists for exactly this). Add a contacts-scoped mapping (400 + `EXPIRED_SYNC_TOKEN` → `OutdatedCursor`) and have `sync_contacts` retry once with `sync_token: None`.
- [ ] **P1.5 Decide the gmail_message 429-drop policy.** `inbox_sync/email_api_error.rs:53-59` drops the notification on a real provider 429 where main retried; the code comment calls it intentional ("a later notification covers the range") — but an idle mailbox stays unsynced until its next change. Either document the acceptance or restore retry for provider-origin 429s (distinguishable today via `retry_after.is_some()`; a dedicated flag would be cleaner).

### Rate limiting / Retry-After

- [ ] **P1.6 Check the rate limit before acquiring the token in `prepare()`.** `crates/email_api_client/src/domain/service/mod.rs:62-77` acquires the token (SELECT + Redis + possible auth-service refresh + health write) before `check_rate_limit`; main's gmail_ops did the cheap check first. Under throttling, every refused attempt pays the full token dance. Swap the order (the limiter doesn't consume provider quota on denial); update `service/test.rs:69-75`, which pins the current order, and `register_subscription_without_cache`.
- [ ] **P1.7 Plumb `Retry-After` end-to-end.** (a) `gmail_client/src/error.rs:88-93` parses only delta-seconds — also handle the HTTP-date form (`httpdate::parse_http_date`, clamp at zero). (b) `api/email/provider_error.rs` drops `RateLimited::retry_after` — return it and set a `Retry-After` header on 429 responses. (c) Worker policy modules ignore it — optionally use it for SQS visibility timeout on retryable rate limits.

### Sanitizer (security-adjacent)

- [ ] **P1.8 Consolidate the sanitizer and handle `<style>` content.** The 280-line allowlist now exists in two live copies (`crates/email_api_client/src/outbound/gmail/convert/sanitizer.rs` and `services/email_service/src/util/sanitizer.rs`, still used for signature `sanitize_html_fragment`; its `sanitize_email_html` is dead). Extract one shared implementation. Separately: `<style>` **element** content is emitted verbatim — ammonia's CSS filter applies only to `style` *attributes*, so the comment "ammonia has built-in css sanitization" is wrong for tags; CSS overlay phishing and `@import` exfil/tracking are possible (pre-existing on main). Either stop allowlisting `<style>` or sanitize its text (strip `@import`/`url()` + non-allowlisted properties). Fix the comment regardless. Add direct sanitizer tests (XSS vectors: svg/math/foreignObject, `javascript:`/`data:` URLs, event handlers, `<style>` payloads).

### Sync recovery completeness

- [ ] **P1.9 Recovery backfills should not skip existing threads.** `pubsub/backfill/backfill_thread.rs:40-44` returns early for known thread ids without fetching messages, so the stale-cursor gap window's replies in existing threads are never recovered (even after reconnect). Add a job flag (e.g. `refresh_existing: bool` on stale-cursor recovery jobs) that fetches message ids for existing threads and upserts missing ones. Depends on P0.2.

### Observability

- [ ] **P1.10 Restore lost signals; instrument the domain service.** Add `tracing` + `#[tracing::instrument(skip(...), err)]` (never `level = "info"`) to `EmailApiClientServiceImpl` public methods with `link_id` + operation kind in scope (sibling domain crates do this). Restore dropped warns: address-parse double-failure (`convert/message.rs:95-107` — From/To loss is now fully silent), watch-conflict recovery (`outbound/gmail/subscription.rs:16-29`), "no block filter found" on unblock. Render reqwest transport/decode errors with `.without_url()` in `GmailApiHttpError`'s `Display` (`gmail_client/src/error.rs:61-62`) — full URLs currently leak People-API `syncToken`s into `instrument(err)` logs. Cap error-body *reads* (not just retention) at a few KB in `unsuccessful_response` (`error.rs:95`).

### Tests

- [ ] **P1.11 Pin the load-bearing policy and health tables.** inbox_sync `email_api_error/test.rs` covers 2 paths; backfill pins all 8 variants — mirror that (`processing_error` outcome per `EmailApiError` variant, plus the retry-worker branch of `handle_operation_error`). Add token-health transition tests in `token_source/test.rs`: success clears a set flag; first reauth failure enqueues `NotifyReauthRequired` exactly once; repeat failure doesn't re-enqueue; transient error leaves health untouched.

### Port design papercuts

- [ ] **P1.12** Remove the default body of `ProviderTokenSource::get_access_token_for_link` (`ports.rs:250`) — it delegates to the id-based lookup, contradicting its documented "not yet persisted" purpose; a future implementor relying on the default breaks mailbox init silently. Make it required (or document the default's real behavior).
- [ ] **P1.13** Drop the unused `dep:async-trait` from the `ports` feature (`crates/email_api_client/Cargo.toml:9`) — all traits use native async fn.
- [ ] **P1.14** Thread conversion went parallel → sequential (`convert/thread.rs:24-29` vs main's spawn-per-message): serial ammonia sanitization of large threads on runtime worker threads. Restore concurrency (`spawn_blocking` batch is better than main's approach) **if profiling shows it matters**; otherwise record the accepted trade-off.
- [ ] **P1.15** `SendRequest::build_mime` (`domain/models/send.rs:46-53`) clones attachment bytes main moved — doubles peak memory for large-attachment sends. Take/move the buffers.

---

## P2 — Hygiene

- [ ] **P2.1** Remove stale lint shields: `#[allow(dead_code)]` on live items (`outbound/gmail/mod.rs:23,102,111`); module-wide `#![allow(dead_code)]` + `#[allow(unused_imports)]` in `convert/mod.rs` (then delete the genuinely dead `map_thread_resources_to_service`, `thread.rs:10-18`, and `ProviderSubscription::is_expired_at` if still uncalled).
- [ ] **P2.2** Update utoipa response docs for newly reachable statuses (429/403/404/409 on `get_attachment`, `init`, `create_label`, `list_blocked`), then regenerate the SDK/spec (`just coverage` / SDK codegen) — the OpenAPI spec currently under-documents error codes.
- [ ] **P2.3** Route `get_document_id`'s `UploadError` through `provider_error_status` — it special-cases only `RateLimited` → 429 while provider `AuthRequired`/`NotFound` collapse to 500 (sibling `attachments/get.rs` returns 401/404).
- [ ] **P2.4** Replace tautological tests: `gmail_client/src/error/test.rs:36-44,62-66` (variant matches itself); `rate_limiter/test.rs` mapping table restating the impl — add a fail-open test (Redis unreachable → allowed) instead.
- [ ] **P2.5** Test-file placement: move the `AccessToken`/`EmailApiError`/`SyncCursor`/`ProviderSubscription` tests out of `models/send/test.rs` into their own modules' `test.rs`. Replace the five hand-rolled busy-spin `block_on` helpers in domain tests with `#[tokio::test]`.
- [ ] **P2.6** Port the address-parser regression corpus (main had 7 cases: quoted display names with commas, truncation salvage, "(withheld recipients)", still-invalid-after-truncation, real-world truncated header; new file keeps 2).
- [ ] **P2.7** Docs: delete the leftover batch-API doc block above `get_message` (`gmail_client/src/lib.rs:229-231`); document that `RateBudget` live/backfill are **two thresholds over one shared Redis window** (`rate_limiter.rs:14-21`) so nobody "fixes" the key split later and resets deployed quota state; fix the `EmailApiClientRepository` doc claiming "eight capabilities" while excluding `MailboxCalendarClient`.
- [ ] **P2.8** Pre-existing, fix opportunistically: `GmailLabelColor` missing `#[serde(rename_all = "camelCase")]` (label colors always deserialize `None`); `WatchRequest.topic_name` serialized snake_case (works only via proto-JSON leniency); `level = "info"` on `upload_single_attachment`'s instrument (repo rule: never); `srcset` not scheme-filtered by ammonia; non-UTF-8 charsets mangled by `from_utf8_lossy`.
- [ ] **P2.9** New service modules use `anyhow` where CS-46 prefers `rootcause` (partially forced by `DetailedError.source: anyhow::Error`) — align where feasible or record the exception.

---

## Open questions — confirm intent, then document in the PR description (or revert)

1. **Permanent 4xx in gmail_ops/backfill now drop instead of retrying to the DLQ.** Main redelivered to `maxReceiveCount` → DLQ, leaving an inspection trail. E.g. a scope-missing 403 on `BlockSender` now deletes the op: DB says blocked, Gmail has no filter, nothing in the DLQ. If intended, consider revert-or-flag semantics for mutations (as `modify_message_labels` already reverts).
2. **Interactive API calls now consume the shared live Redis budget** and can 429 (main never throttled handler-path Gmail calls). Presumably the point of centralizing quota — confirm the interactive-vs-worker contention trade-off is accepted.
3. **link_manager Refresh: transient watch-renewal failure now fails the message** (SQS retry) and skips that pass's contacts sync; main logged and continued. The code comment says deliberate — confirm. Related nit: with a cached-but-revoked token, Refresh retry-loops until the token cache TTL expires (main logged and dropped).

---

## Regression-test checklist (net-new coverage this spec requires)

| Area | Test |
|---|---|
| Error classification | 403 + quota reason → `RateLimited`; plain 403 → `Forbidden`; Retry-After (seconds + HTTP-date) captured |
| Stale cursor | `OutdatedCursor` → one job + cursor repaired; post-repair notification syncs incrementally |
| MIME | undecodable part → message still converts; unpadded base64url accepted; bad part doesn't sink thread |
| Calendar | single `GetMessage` charge covers fetch + calendar parts |
| Blocklist | case-insensitive block dedupe + unblock; unblock deletes all matches |
| Token source | healthy row → no clear UPDATE; health transitions (clear/notify-once/transient-untouched) |
| Teardown | revoked grant → no `needs_reauth`, no notification; transient failure retried |
| Policy tables | inbox_sync: every `EmailApiError` variant → expected `ProcessingError` |
| Rate limiter | Redis unreachable → fail-open allowed |
