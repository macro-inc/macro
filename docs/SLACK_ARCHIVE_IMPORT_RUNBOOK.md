# Slack archive import: rollout and recovery

This is an operator checklist, **not production rollout approval**. Use synthetic
archives and isolated local resources for verification. Do not deploy, import
customer archives, reset databases, purge queues, or delete staging/history to
troubleshoot without separate approval.

See [the contract](SLACK_ARCHIVE_IMPORT_CONTRACT.md),
[local setup](RUNNING_LOCALLY.md), [database workflows](DATABASE_DEVELOPMENT.md),
and [the Settings interaction guide](AGENT_GUIDE/surfaces.md#slack-archive-import).

## Deployment order and configuration

1. Apply additive migrations, including source bindings, canonical target
   reservations, manifests/outbox/leases, and deferred message references.
   Do not remove older schema or mappings when rolling services back.
2. Deploy `archive`-aware ledger readers and canonical-reservation **onboarding**
   writers before archive admission. Both paths must reserve the same target;
   updating only the archive worker leaves a duplicate-channel race.
3. Add the `imported_author` OpenSearch mapping **before writers/backfills**.
   The channel index uses `dynamic: false`; `_source` alone is not searchable.
   Inspect the intended endpoint/alias first. From
   `infra/stacks/opensearch/helpers`, run
   `DRY_RUN=true bun scripts/add_imported_author.ts`. With separate deployment
   approval, `DRY_RUN=false` applies it; `INDEX` optionally selects a physical
   index. This adds a `content_text` text field copied into `content`; it does not
   recreate an index or swap aliases. Backfill affected channels afterward.
4. Provision `slack-import-queue`/DLQ, the independent Fargate worker, staging
   lifecycle/CORS and scoped IAM. The main queue's redrive count is 5; configured
   queue visibility is 900 seconds, while the consumer requests 180 seconds and
   extends visibility every 60 seconds. Do not derive lease health from the queue
   default. ECS gives 120 seconds to stop; the driver drains for up to 110 seconds.
5. Register/verify the exact Doppler names below in the intended environment.
   Keep DSS and worker admission disabled while deploying search and HTTP changes.
6. Complete the release gates below against the local stack, then an explicitly
   approved controlled dev team. Enable backend/worker admission before the
   frontend flag. The current backend flag is service-wide, not a team allowlist:
   restrict access operationally or use an isolated environment for the canary.

| Setting | Owner / requirement |
| --- | --- |
| `SLACK_IMPORT_ENABLED` | DSS admits creates/registration/completion; worker admits new claims/publication. Default false. Set in both configurations deliberately. |
| `SLACK_IMPORT_CONCURRENCY` | Worker, default 1; only 1 or 2 accepted. Start at 1. |
| `DATABASE_URL` | Worker MacroDB; role needs the owning-domain historical transaction tables. |
| `INTERNAL_API_KEY` | Worker and search processing must agree; never log or include it in tickets. |
| `UPLOAD_STAGING_BUCKET` | DSS/worker same bucket. Worker infrastructure supplies this value. |
| `OVERRIDE_SLACK_IMPORT_QUEUE`, `OVERRIDE_SLACK_IMPORT_DLQ` | Typed queue names/URLs; worker infrastructure supplies them. Resolve both at startup. |
| `OVERRIDE_SEARCH_PROCESSING_SERVICE_URL` | Worker internal scoped-backfill endpoint; supplied by infrastructure. |
| `enable-slack-archive-import` | Frontend feature flag. Local override: `VITE_ENABLE_SLACK_ARCHIVE_IMPORT=true`. It grants no server authority. |

The worker stack uses Doppler project `slack-import-worker` and selects
`DATABASE_URL`, `INTERNAL_API_KEY`, `SLACK_IMPORT_ENABLED`, and
`SLACK_IMPORT_CONCURRENCY` from its synchronized secret. Verify registration and
restart tasks when changing values. `APP_SECRETS_JSON` can override ordinary
configuration: do not introduce contradictory values there. No secrets or Doppler
changes are supplied by this runbook. Worker provisioning is separately gated by
Pulumi's `deploy_slack_import_worker` (default `false`); enable it only after the
dedicated secret exists, following the [worker rollout guide](../infra/stacks/cloud-storage-service/SLACK_IMPORT_ROLLOUT.md).
Keep that deployment gate enabled once provisioned; use `SLACK_IMPORT_ENABLED`
to pause intake without deleting the worker.

DSS may PutObject/GetObject only under `slack-import/*`. HeadObject uses
**GetObject**, not an invented `s3:HeadObject` permission. The worker needs
GetObject there, SendMessage on main, and GetQueueUrl/ReceiveMessage/DeleteMessage/
ChangeMessageVisibility on main and DLQ. Check pinned version reads if enabling
bucket versioning; version-specific permissions must be reviewed separately.

Test CORS from the real web and Tauri origins. PUT must preserve signed
`content-type`, `x-amz-checksum-sha256`, `if-none-match: *`, and exact byte length.
Browser code does not set the forbidden Content-Length header itself. A 412 means
verify the existing object through completion, **never remove the condition and
retry an overwrite**. Do not treat ETag as a SHA-256 checksum.

## Source and data semantics

- V1 binds one Slack workspace to one Macro team. Known mismatches fail; unknown
  exports need explicit admin confirmation. Never clear a binding to bypass a
  mismatch. Existing onboarding mappings belong to that binding.
- Unknown-source confirmation is **not** Slack domain evidence. Unproven Slack
  permalinks remain external links. There is no domain-association UI in v1.
- Selection is the immutable create request's full `conversations` set. Names
  are not identities. Same-token retries must preserve metadata/options; widening
  selection needs another explicit confirmation and token. Linked unselected
  conversations are never automatically imported.
- Public Slack channels become **Team**, with `auto_join_team=false` and explicit
  source members. Private/group DMs become Private. A DM has exactly two distinct
  mapped email identities; no importing-admin third member. Unauthorized reused
  private/DM targets are skipped without exposing their IDs.
- Emails are lowercased as exported, without roster/alias matching. Unknown users
  use the system bot with an imported Slack author label. There is no contact
  synchronization. Files, attachments and attachment-only messages are ignored.
- Source timestamp identity wins on first commit within the bound team. Repeat
  and overlapping/date-split exports dedupe; they do not synchronize later edits
  or deletes or repair earlier orphan threads. Existing names, roles, leavers,
  creation times and newer live activity must survive imports.
- Historical writes must not generate live notifications, bot invocations,
  contact invitations or per-message activity/realtime fan-out.

## Monitor before enabling admission

The current worker emits structured `operation`, `outcome`, and sanitized `code`
logs. Operation names include `receive`, `delivery`, `delete`, `outbox`, `reconcile`,
`search`, `malformed`, and `shutdown`. These are logs, **not a claim that custom
metrics or every alarm below already exist**. Provision dashboards/alarms and
validate routing before rollout. Avoid source text, emails, object keys, signed
URLs and receipt handles as labels or log fields.

| Signal | Initial operational action |
| --- | --- |
| Main queue age/depth/in-flight count | Warn on rising age for 15 minutes while enabled; compare throughput and worker health before scaling. |
| DLQ visible messages or `malformed` events | Alert on any; reconcile identity-bearing failures before acknowledging. |
| ECS restart/OOM/failed deployment, CPU/RSS | Alert; keep concurrency bounded and inspect batch/record limits. |
| Expired `importing` leases | Warn when still expired after two maintenance cycles; sustained expiry over 5 minutes warrants investigation. |
| Oldest due unpublished import outbox row | Warn beyond 5 minutes while enabled; publication can safely repeat. |
| Pending reference count/age after conversations settle | Warn beyond 5 minutes; do not force job completion to clear it. |
| Dirty/submitted/failed search generations and receipt age | Warn on no progress for 15 minutes; distinguish publication from indexing/refresh lag. |
| Conversation imported/duplicate/skipped/failed totals | Track reason codes and changes from canary expectations, not just a green job count. |
| Staging deadline / abandoned upload count | Inspect jobs approaching expiry; request a new confirmed import if bytes are gone. |

A successful job requires reference reconciliation and required search
**publication**, not merely a 202 acceptance receipt. OpenSearch consumption and
refresh are eventually consistent and need a separate authorized search probe.
Use an imported author name absent from message text; verify the matching message
is found by a participant and not by a no-access viewer.

## Stale-job inspection (read-only)

Start with the admin receipt/detail API or Settings job history; polling remains
available if websocket invalidation is missed. For an authorized operator, bind
`job_id` in psql to the particular job UUID and inspect without archive content:

```sql
BEGIN READ ONLY;
SELECT id, team_id, status, revision, include_message_history,
       created_at, updated_at, registration_closed_at, cancel_requested_at,
       staging_expires_at
FROM slack_import_job WHERE id = :'job_id'::uuid;

SELECT slack_channel_id, status, part_count, processed, imported, duplicates,
       skipped, reactions, checkpoint_part, checkpoint_record, attempts,
       lease_generation, heartbeat_at, lease_expires_at,
       search_state, search_dirty_generation, search_submitted_generation,
       search_updated_at, last_error
FROM slack_import_conversation WHERE job_id = :'job_id'::uuid;

SELECT slack_channel_id, part_index, byte_length, verified_at
FROM slack_import_upload WHERE job_id = :'job_id'::uuid;

SELECT kind, generation, available_at, published_at
FROM slack_import_outbox WHERE job_id = :'job_id'::uuid;

SELECT count(*) AS pending_references
FROM slack_import_message_reference
WHERE job_id = :'job_id'::uuid AND completed_at IS NULL;
COMMIT;
```

Compare users verification, contiguous part descriptors and the seal; completing
one part is not readiness. A zero-part seal still needs verified users. Check
current requester admin status, target authorization, S3 identity availability,
queue delivery, and search receipt separately. Do not manually change fences,
checkpoints, generations, source bindings or statuses. Stale owners must remain
unable to commit. Keep any investigation limited to the authorized team.

## Recovery, cancellation and DLQ precautions

1. Disable **DSS admission** first to stop new uploads if there is a safety issue;
   preserve progress/finalize/cancel access. Hiding the frontend alone is not a
   server-side stop. Disable worker new work too if processing is unsafe.
2. Leave recovery available: a disabled worker still reconciles leases,
   cancellation, references/search and DLQ messages. Do not scale every worker
   to zero and expect this maintenance to happen. Already running work may finish.
3. Fix the cause before replay: check current authorization, source binding,
   verified bytes, staging deadline, lease generation and whether the event is
   already obsolete/terminal. An old DLQ event must not fail a newer active lease.
4. Let the DLQ consumer persist terminal failure before deleting its delivery.
   Malformed envelopes have no trustworthy job identity: retain sanitized failure
   evidence, not a guessed job/key from the raw body.
5. Do not bulk-redrive or fabricate generations. Terminal failure is not reopened
   by replaying an old SQS message. A new explicitly confirmed same-source job may
   safely dedupe committed history; inaccessible/expired inputs need correction
   first. There is no operator "force resume" endpoint.
6. For a lost publication acknowledgement, let the outbox resend. Duplicate
   delivery is expected. Do not remove message mappings, reactions or reservations
   to make a replay appear new.

Cancellation is **not rollback**. It closes registration, prevents future claims
and skips unclaimed work. `cancelling` waits for active leases and retained-history
reference/search work. A cancelled worker that dies is settled after lease expiry
without restarting that conversation. Committed messages remain, are indexed,
and counters remain visible. Finalize skips never-ready conversations but must
not discard queued/importing work. Finalize/cancel/complete share the job lock;
no request may resurrect terminal results.

Staging bytes under `slack-import/` expire after **14 days**. This is not deletion
of imported channels, messages, idempotency maps, source bindings or reservations.
Lifecycle expiry is asynchronous, not an upload-resume promise. The worker stops
starting/recovering imports within one day of the persisted staging deadline, so
operators must not promise all 14 days for processing. SQL receipts and
manifests have a separate retention/cleanup policy; never cascade from staging
cleanup into user-visible history. Reloading Settings recovers receipts, not a
lost browser ZIP or unfinished local upload session.

## Verification harnesses

Run from the workspace root with a local PostgreSQL role capable of creating
isolated SQLx test databases. Confirm DATABASE_URL is local before proceeding.
Do not set SQLX_OFFLINE for tests. Nix is the documented toolchain; an approved
native toolchain works too.

```sh
export DATABASE_URL="$(just --evaluate DATABASE_URL)"
env -u SQLX_OFFLINE cargo test -p slack_import_worker --test archive_import -- --ignored --nocapture
```

Preload `localstack/localstack:4`. The ignored harness refuses to pull an image,
starts its own container on an ephemeral loopback port, uses dummy credentials,
and removes only that container on normal exit or panic unwind (a killed test
process may need operator cleanup of its own container). SQLx creates a separate migrated test
DB. It uses real conditional PUTs, storage verification, service completion/seal,
PostgreSQL writes, SQS and the production queue driver. It tests shape→history→
repeat ID stability, selection tampering, foreign-team lookup, duplicate
publication, canonical channel references/threads, unproven-domain fallback,
the search-completion barrier, actual SQS receive exhaustion/redrive, and durable
DLQ settlement with worker admission disabled. The redrive scenario uses fresh
queues so abandoned HTTP long polls from the prior driver cannot reserve its
messages; its test-only redrive count is 2 rather than production's 5. Its notifier/disclosure and search receipt gate
are test doubles. Three additional tests launch the actual `slack_import_worker`
binary and kill it after lease acquisition, committed history, and SQS publication
before outbox acknowledgement. Test-only PostgreSQL triggers/advisory locks make
those boundaries deterministic; no production fault switches are added. Restart
assertions check canonical UUID survival, exactly-once counts and the search
completion barrier. They advance only isolated test lease/outbox deadlines and
replay the original envelopes rather than waiting the full visibility timeout.
This is real process-death coverage, but search publication still uses a controlled
receipt gate, **not OpenSearch**. HTTP auth, navigation and AWS CORS require the
separate live probes below.

For a **new disposable** browser instance, use the local launcher and seed an admin
team against that named instance. For an existing instance, follow
[non-destructive recovery](RUNNING_LOCALLY.md#recover-an-existing-instance-without-resetting-data)
instead: neither `run_local` nor `stack up` is a data-preserving restart. Enable
DSS/worker admission and the frontend override, and use the local E2E backend
origin/JWT setup without invoking a stack-resetting harness. No-Doppler default
Macro API signing keys are placeholders: supply a local-only generated RSA key
pair to the services and token generator, or use local FusionAuth login. Never use
hosted credentials. Warm the browser WASM builds before Playwright's 60-second
server-start deadline, and do not run Docker teardown tests concurrently with
Chromium (network-interface changes can abort module requests). The checked-in Playwright testDir is
`tests/e2e`, not `tests`:

```sh
# From apps/web, with LOCAL_E2E_BASE_URL, LOCAL_E2E_BACKEND_ORIGIN and
# LOCAL_JWT for the isolated stack (never a hosted account):
SLACK_IMPORT_LIVE_E2E=true bun run local:e2e tests/e2e/slack-import.spec.ts
```

Without `SLACK_IMPORT_LIVE_E2E=true`, only the existing deterministic picker
fixture runs; the live HTTP tests are skipped. Do not report those skips as a
backend pass. Live tests cover cancel-before-confirmation, lazy worker creation,
duplicate display names and hidden selections, actual create/PUT/registration,
persisted/reloaded options, and open-job unselected registration/seal rejection.
They leave synthetic imported history and cancel their extra tamper job; they do
not reset the database. The worker unit suites cover bounded slices, exactly one
discovery/history phase, backpressure, part limits and quota cleanup. Bounded
buffer assertions are not a measured browser/native peak-memory certification.

## Required browser/backend release gates

Tauri is **not** a gate for T27 browser/backend verification. Native WebView,
platform-specific worker behavior and native-origin CORS remain separate follow-up
coverage below; browser passes must never be presented as native passes.

- [ ] Standard, corporate and Enterprise exports; shape-only; repeat/date-split;
  onboarding-before/after archive; raw email attribution, unknown/bot authors,
  threads/reactions, new-user membership; no live effects.
- [ ] Actual Lexical rendering, hover and click: external/mailto, mapped channels,
  canonical root/reply UUID targets, forward/self/cyclic links with reversed queue
  order and prior same-source imports. Inspect destination IDs, not text snapshots.
- [ ] Private/no-access viewers, unproven/mismatched domains, missing/skipped/deleted
  targets, closing-tag injection and literal inline/fenced examples retain safe
  fallbacks and create no unintended mention rows.
- [ ] Reconciliation failure/rollback/retry, cancellation, edits/deletion before
  patch and overlapping-job ID races; body patch/search dirty work atomic;
  successful completion waits for reconciliation and search publication.
- [x] Kill the actual worker process after lease acquisition, batch commit and
  queue send-before-ack. Restart from durable state; assert counts and UUIDs.
  Exhaust real SQS receives into DLQ and verify terminal reconciliation.
  Verified by the four opt-in `archive_import` tests on 2026-10-01, with local
  PostgreSQL/LocalStack and native Cargo; search is a receipt-gate double.
- [ ] Concurrent imports of the same channel/DM; unauthorized reused DM;
  foreign-team jobs/keys; immutable PUT; finalize/cancel races.
- [ ] Large synthetic ZIP on desktop: two passes, bounded parts and measured
  memory, low disk quota failure/cleanup, no eager worker construction,
  signed-header/CORS behavior. Unit buffer bounds are not a peak-RSS measurement.
- [ ] Real Settings subset test with live backend, polling/reconnect/reload;
  selected failures remain visible and unselected IDs produce no work.
- [ ] Real authorized author-only search and denied-viewer search after publication
  and index refresh; reindex after reconciled body changes.
- [ ] Package tests: `slack_integration --all-features`, `slack_import_worker`,
  `messages`, `channels`, `import`, `document_storage_service` (each via cargo test).
- [ ] `just check full`, `just rust-check`, `cargo run -p xtask -- deps --check`,
  web `bun run gen-api cloud-storage --check`, SDK `just coverage && just check`.
- [ ] Confirm deployed IAM/CORS/lifecycle, Doppler values, alarms and additive
  mapping. Obtain explicit approval before any production or customer-data run.

### Separate native/platform follow-ups

- [ ] Repeat selection/upload/navigation in the native WebView, including lazy
  worker startup, quota behavior and signed PUT headers/CORS from native origins.
- [ ] Verify Linux GTK/WebKit through `apps/web/tests/native/README.md` using the
  installed native toolchain when available. Nix is not required on the approved
  Fedora verification host.
- [ ] Verify iOS/WKWebView and other supported platforms on their actual runtimes.
  Chromium desktop results do not establish any of these passes.

Rollback admission, not data: disable new imports, retain queues/outbox/mappings
and imported history, and continue safe reconciliation. Never use a destructive
reset as a recovery procedure.
