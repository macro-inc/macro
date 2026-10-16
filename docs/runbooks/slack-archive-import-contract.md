# Slack archive import contract (v1)

This is repository interface documentation, not an execution plan. The Rust
source of truth is `crates/slack_integration/src/domain/{models,ports}.rs`.
The browser, administrator API, PostgreSQL repository and independent worker share
these contracts. Persisted selection, not browser state or queue input, owns job scope.

## Boundaries and authorization

- `ImportService` is the administrator-facing interface. Every operation takes
  `EntityAccessReceipt<AdminTeamRole>`; derive team and actor from it. Request
  JSON contains no team or requester override. Creation requires a real human
  user, not a team-bot identity. Feature disablement rejects new creation/uploads
  but leaves existing receipts readable and cancellable.
- `ImportWorker` is a separate set of queue/maintenance use cases. Queue identity
  is never authorization. Revalidate the persisted requesting admin before each
  start/reclaim. Check target type, team, access and import provenance separately.
- Policy and authorization orchestration live in domain services. Inbound
  handlers forward receipts/commands; outbound adapters implement narrow ports.
  Domain code contains no AWS, SQLx, HTTP framework or environment types.
- A job belonging to another team is indistinguishable from a missing job.
  An inaccessible reused target is skipped, with `target_unavailable` and no
  target ID. Never add the importing admin to a DM to bypass access checks.
- Ports use `rootcause::Report<ImportError>` internally to retain diagnostic
  causes. Only the closed `ImportError`/`ImportWarning` codes cross the public
  boundary. Never serialize raw provider errors, keys, tokens, emails or content.

Default features expose models only. `ports` adds capability interfaces;
`inbound`, `outbound`, `postgres`, `s3`, `sqs`, and `worker` enable their respective
integration dependencies. Versions of every
third-party dependency are inherited from the root workspace; none require a
new third-party version or library. Both packages participate in Hakari and test
environment setup. The default model dependency graph still includes the shared
native `workspace-hack`, as in `reminders`.

## Identities and encoding

JSON struct fields use camelCase. Enum tags/status values use snake_case.
Commands reject unknown fields where defined, rather than silently accepting
keys/team overrides. Transport adapters must also enforce bounded body sizes;
Serde parsing by itself does not enforce collection or string quotas.

- `JobId`, `TeamId`, `CreateToken`, `WorkerId`, `LeaseToken` are distinct non-nil,
  non-max UUID types. Generate new persisted IDs as UUIDv7 in application code.
  A lease token is internal, fresh for every claim, and never in progress/queues.
- `ConversationId` accepts uppercase alphanumeric Slack IDs beginning C/G/D;
  `SlackUserId` accepts U/W (including `USLACKBOT`); `SourceId` accepts T workspace
  identities. IDs are 2–64 ASCII bytes. An enterprise E ID alone is insufficient
  to establish a single workspace. If workspace identity cannot be established,
  require unknown-source confirmation.
- A `KeySegment` is one nonempty segment, at most 255 UTF-8 bytes, not `.` or
  `..`, with no slash, backslash, percent escape or control character. It permits
  source folder spaces/Unicode, but is not an authorization proof. `ObjectKey`
  validates a sequence of safe segments, at most 1024 bytes; canonical key layout
  is additionally enforced by the storage adapter.
- `SlackTimestamp` is an exact nonnegative Unix microsecond value. Parse decimal
  **strings**, never floats. Accept 1–6 fractional digits, normalize to exactly
  six, reject higher precision rather than rounding. Bound seconds to
  `253402300799` (year 9999). Integer Slack metadata creation seconds are converted
  to this representation with zero microseconds by the parser.
- `Sha256Digest` is exactly 64 lowercase hexadecimal characters. It hashes the
  actual uploaded UTF-8 bytes, not an ETag or an object metadata field.

## Source binding and creation

V1 supports one Slack workspace per Macro team. Source binding is durable and
shared with onboarding. Known mismatches fail with `source_mismatch`. A missing
workspace identity requires the explicit `confirmed_unknown` variant on every
such create, including when prior unscoped onboarding mappings exist. Omission
is not confirmation. Promoting a confirmed-unknown binding to a known identity
must preserve the existing source namespace; never silently replace a known
binding. Multi-workspace imports require a later scoped-ledger migration.

`POST /slack/imports` accepts `CreateImport` (team supplied by the authenticated
team context, not this body):

```json
{
  "idempotencyToken": "019a0000-0000-7000-8000-000000000001",
  "source": { "kind": "known", "sourceId": "T012ABC" },
  "includeMessageHistory": true,
  "conversations": [{
    "slackChannelId": "C012ABC",
    "kind": "public_channel",
    "name": "general",
    "folder": "general",
    "memberIds": ["U012ABC", "U045DEF"],
    "creatorId": "U012ABC",
    "createdAt": "1700000000.000000",
    "archived": false,
    "messageCount": null
  }]
}
```

`source: {"kind":"confirmed_unknown"}` is the affirmative unknown-source option.
Creation persists **all** selected metadata, not just counts. Conversations must
be unique, nonempty and within the selection limit; folder resolution must be
unambiguous. Complete source member lists are required even when history is off.
Unknown advisory counts are null, not zero. Missing creator/time are explicit
nulls. Missing creation time is resolved once from earliest source message when
available, otherwise the persisted job creation time; record the corresponding
warning. Never change a reused target's creation time.

The client generates and retains the create token with its frozen in-memory
confirmation snapshot before sending.
Uniqueness is `(team, requesting human admin, token)`. An identical semantic
payload returns the original job, even after it settles. A different payload
with the same scoped token conflicts; it never replaces the original selection.
The repository canonicalizes conversation/member ordering (including duplicate
members) for semantic comparison; clients retry the exact snapshot rather than
rebuilding it from mutable UI state. A lost response is retried with the same token,
not a second create. The browser snapshot is not persisted across a page reload;
job history can recover existing server jobs but cannot resume local uploads.

### Popup confirmation and immutable scope

Choosing a ZIP discovers metadata locally before any create, grant or upload.
The existing dialog then presents grouped searchable checkboxes keyed by Slack ID,
including the ID beside duplicate names, archived state and available advisory
counts. Keyboard focus moves from the disabled file input to the filter. Bulk
selection/clearing applies only to visible supported rows; filtering and hiding
archived rows preserve hidden selections. Unsupported DMs are unavailable choices,
not skipped selected work.

**Import selected channels (N)** requires a nonempty selection and explicit source
confirmation; history defaults on. This action freezes full selected metadata and
options in `CreateImport.conversations`, allocates one token, and disables further
review edits. Repeated clicks cannot create another request. Preparation, bounded
parts and seals use only that snapshot, while shared users metadata remains required.
Close/Escape or cancel before confirmation disposes scratch state without server
writes. Closing after confirmation retains the active session while Settings stays
mounted. Changing selection requires choosing an archive and confirming a new token.

Only persisted conversation rows authorize registration, completion/sealing and
worker claims. Unselected IDs have no manifest, outbox event or imported messages;
links to them never reserve targets or implicitly import them (see reference policy).
Shape-only imports retain the same selected rows with zero-part seals plus users.

## Registration and immutable uploads

Operations under `/slack/imports/{jobId}`:

| Operation | Domain input | Result |
| --- | --- | --- |
| `POST uploads` | `RegisterUploads` | array of `UploadGrant` |
| `POST uploads/complete` | `CompleteUploads` | `ImportProgress` |
| `POST finalize` | path `JobCommand`, no body fields | `ImportProgress` |
| `POST cancel` | path `JobCommand`, no body fields | `ImportProgress` |
| `GET` | path `JobCommand` | `ImportProgress` |

`GET /slack/imports` accepts an optional exclusive `before` job-ID cursor and
returns `ImportPage`: up to 50 newest receipts, `nextCursor`, effective `limits`
and `sourceBinding` (`unbound`, `confirmed_unknown`, or `known` with `sourceId`).
Create returns the same `ImportProgress` shape as lifecycle/detail operations.

Register at most 50 descriptors per call, with no duplicate upload identities:

```json
{
  "descriptors": [{
    "upload": {"kind":"users"},
    "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "byteLength": 123,
    "recordCount": null
  }, {
    "upload": {"kind":"conversation_part","slackChannelId":"C012ABC","partIndex":0},
    "sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "byteLength": 456,
    "recordCount": 2
  }]
}
```

The hashes above are illustrative. There is exactly one normalized users JSON
payload per job, accepting source data from `users.json` and `org_users.json`.
Its recordCount is null. Message parts contain one normalized JSON object per
line, UTF-8 with LF terminators, counted including the trailing LF. They have
positive byte/record counts. Empty history uses **no parts**, not a zero-byte
part. Browser/parser normalization owns the Slack record/user schemas; it strips
attachment payloads and sorts/deduplicates by exact source timestamp before
staging. Registering never uploads ZIPs to the backend.

The repository allocates keys and persists immutable descriptors before signing:

```text
slack-import/{team}/{job}/users.json
slack-import/{team}/{job}/{slackChannelId}/{partIndex}.ndjson
```

Canonical UUID strings and canonical decimal indices are server generated.
Neither requests nor queue bodies contain object keys. Every subsequent key
lookup must go through the job-owned manifest; prefix matching is insufficient.
Exact registration retries may renew grants while registration is open,
including for already sealed descriptors. Descriptor changes always conflict;
new indices conflict once that conversation is sealed. Job-wide aggregate byte
accounting includes users and every unique descriptor, not duplicate retries.
History-off jobs reject all conversation-part descriptors.

Each `UploadGrant` contains `descriptor`, `url`, `requiredHeaders`, `expiresAt`.
The storage adapter signs the exact checksum, length, derived content type and
`If-None-Match: *` create-only condition. Content types are `application/json`
(users) and `application/x-ndjson` (parts). The required-header map includes
`Content-Type`, `x-amz-checksum-sha256` (base64 encoding of the digest bytes), and
`If-None-Match`. Browser code sets the returned allowed headers; it does not set
forbidden `Content-Length`, which follows from the exact Blob length. Provider
adapter additions to the signed header map must be honored. Never log grants.
URLs are requested immediately before PUT. A retry returning 412 means verify
that existing object via completion, **not** obtain overwrite permission.

Completion reads actual object checksum and length with storage checksum
retrieval enabled. ETag and user-controlled object metadata are not evidence.
Persist the verified version or entity-tag identity; worker reads pin that version
or issue a conditional read against the verified ETag, then independently
revalidate the streamed SHA-256 digest/length. An ETag is a read validator, never
a substitute for SHA-256. `VerifiedUpload` cannot represent an unpinned read.
Objects may never be overwritten, including after verification. IAM permission
for S3 HeadObject is `s3:GetObject`, not a fictitious `s3:HeadObject` action.

## Completion and seals

```json
{
  "uploads": [{"kind":"conversation_part","slackChannelId":"C012ABC","partIndex":0}],
  "seal": {
    "slackChannelId": "C012ABC",
    "partCount": 1,
    "manifestSha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
  }
}
```

`uploads` identifies at most 50 previously registered objects to verify. The
optional seal covers the **entire** registered descriptor set for its selected
conversation, not just the objects in this call. An empty uploads list permits
a seal-only call. Null/absent seal verifies early parts without declaring the
conversation ready. Identical verification/seal retries are idempotent; changed
seals or descriptor sets conflict. Reject gaps, duplicates, extra parts and
foreign-conversation descriptors. Once sealed, the expected set is immutable.

### Canonical manifest digest

Sort the conversation descriptors by ascending part index. For each, concatenate
this ASCII line (decimal integers without leading zeros, lowercase hex digest):

```text
{partIndex}:{sha256}:{byteLength}:{recordCount}\n
```

Here `\n` denotes one LF byte. Hash the concatenated bytes using SHA-256.
Do not hash JSON, registration order, object keys, URLs, or the users descriptor.
Indices must equal `0..partCount`. Conversation identity is checked separately
against the selected conversation. `ConversationSeal::from_descriptors` is the
reference algorithm and test vector source for browser implementations.

For **zero parts**, partCount is 0 and manifestSha256 is the empty byte hash:

```text
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

A missing seal is not equivalent to a sealed empty set. Shape-only imports and
actually empty history both seal zero parts. Both still need verified users for
membership/author resolution. Readiness requires all three: verified users,
valid immutable seal, and every required verified part. Users may be completed
last, making multiple conversations ready in one transaction.

## Lifecycle, recovery and progress

Readiness and a unique `(job, conversation, event generation)` outbox event commit
in one transaction. API completion/finalization never directly sends SQS. A
maintenance publisher sends pending events then marks that generation published;
a crash between those actions duplicates delivery but cannot lose work.

`ImportEvent` contains exactly `jobId`, `slackChannelId`, `generation`. Unknown
fields are rejected. No team, keys, users, lease tokens or authorization claims
are trusted from a delivery. Reload full persisted state before execution.

Conversation states:

- `awaiting_uploads` → `queued` only after readiness; → `skipped` at finalize or
  cancellation if never ready.
- `queued` → `importing` under an atomic claim; → `skipped` on cancellation.
- `importing` → `completed`, `failed` or `skipped` under the matching fence.
  Expired leases can be reclaimed unless cancellation has stopped work.
- Terminal conversations cannot be resurrected by completion/finalization or old
  queue deliveries. Search state is tracked independently.

Persist lease owner/token, monotonically increasing execution generation,
expiry, heartbeat time, attempts, part/record checkpoint and committed counters.
Execution generation is distinct from outbox publication generation. Every batch
and final transition verifies the lease inside the transaction using database
time. Heartbeat the database and extend SQS visibility every 60 seconds, on a
loop independent of slow object/database processing. Losing either fencing
ownership or reliable delivery coverage stops writes. A stale worker cannot
commit. `ClaimOutcome`/`WorkerOutcome` distinguish an active duplicate from
settled/obsolete work: **do not acknowledge** a duplicate of an active lease.

Finalization is idempotent, closes registration, skips never-ready conversations
and leaves queued/importing conversations alone. It does not manufacture seals
or publish to SQS. Exact completion retries may observe already applied state
after closure; no new verification/seal mutation can revive skipped work.

Cancellation closes registration and atomically stops future claims/publication,
skips unclaimed work, and enters `cancelling`. Running fenced workers may finish.
If a running worker dies after cancellation, settle its expired lease without
restarting; retain committed history and schedule its indexing. `cancelled` is
terminal only when active leases, committed reference intents and required search
publication settle. Cancellation is **not rollback**.
Finalize, cancel and completion share one job lock/CAS. A publication already in
flight can still arrive; claim rejects it. Repeated cancel/finalize of a terminal
job returns its existing receipt, not a new lifecycle.

Job states are `uploading` while registration remains open, then `processing`
while queued/importing work, body reconciliation or required search publication
remains. Once registration is closed and all work is settled: `completed` if no failures (including deliberate skips),
`completed_with_errors` if failures coexist with completed conversations, or
`failed` if failures exist without a completed conversation. Cancellation takes
precedence while settling and becomes `cancelled`. Failed/cancelled imports may
still have committed messages; counters must reflect them honestly.

Maintenance also reconciles abandoned upload jobs, expired leases, stale search
receipts and identifiable DLQ deliveries in bounded pages. Acknowledge exhausted
work only after persisting failure and recomputing the job. A stale dead-letter
generation must not fail newer work or a current active lease.

`ImportProgress` exposes job ID/status/revision, creation/update/registration
closure times, users verification, limits, immutable `source` confirmation and
`includeMessageHistory`, and bounded per-selected-conversation progress.
Conversation progress includes persisted source ID, `name`, `kind`, `archived`,
target ID or null, seal
partCount (null = not sealed), verified parts, committed counters, sanitized
error/warnings and search state. No internal keys, grants, leases or raw errors.
Counters are cumulative committed `processed`, `imported`, `duplicates`, `skipped`
and `reactions`; processed equals imported + duplicates + skipped, not reactions.
Replays/checkpoint retries cannot inflate them. Selected failures/skips remain in
receipts; unselected channels are never counted as skipped. Names/kinds come from
persisted source metadata, not inaccessible Macro targets or locally retained ZIPs.
Polling, reconnect and job history render this same immutable server snapshot.
The administrator service independently gates target disclosure through a read-only
port using the **viewing** admin, not the original requester or import-write provenance.
IDs are conservatively returned only for current active participants (even for
team-visible channels), never for skipped work. Checks are deduplicated in batches
of 500; a disclosure failure hides target IDs without failing an already committed
mutation or hiding source receipts. No access grants or membership changes occur.

`slack_import_updated` notifications carry only team/job/revision/status hints to
the requesting administrator's gateway entity after access revalidation. Other
admins poll. Notification failure never fails committed work. Websocket messages
invalidate cached receipts; polling is authoritative. Terminal UI observation
refreshes channel lists once; inaccessible target links are never rendered.

## Historical persistence, ledger and search

`ImportLedger` reserves a stable candidate UUIDv7 for `(team, Slack, foreign ID)`
**before** channel creation; both onboarding and archive paths use it. Idempotent
explicit-ID creation plus ledger completion recovers crashes between stages.
Reservation states are pending/ready/conflict; ambiguous legacy mappings fail
closed. Preserve the first mapping. Private/DM provenance is import-owned and
must not leak through team-wide onboarding mapping lists.

| Slack kind | Macro target |
| --- | --- |
| Public channel | Team, explicit members, `auto_join_team=false`; never Public |
| Private channel | Private, `team_id=NULL`, provenance in reservation |
| Two-person DM | Exactly two distinct mapped email identities; otherwise skip |
| Group DM | Private, source-member display-name-based name |

New non-DM channels include the requesting owner. Reused targets preserve names,
creation time, settings, participant roles and joined/left times; silent inserts
must not demote owners or reactivate leavers. DM lookup/create shares an atomic
pair-locked primitive with live creation and requires exact cardinality. Reject
cross-team Team targets, incompatible types, and private/DM targets without
requester access or valid same-team import provenance. Reused non-DM private
targets additionally need participant-management authority before adding members.

Map ordinary authors/members using lowercase **raw email** to `macro|email`,
without account/roster lookup or alias canonicalization. No-email/unknown/bot
authors use `MACRO_SYSTEM_BOT_ID` plus Slack-name `imported_author`. No-email DM
participants cause a skip; the admin is never injected as a third participant.

`HistoricalSink::commit` is a worker composition-root coordinator invoking
transaction-aware helpers exposed by each owning crate. In **one transaction**,
fence the lease and persist messages, reactions, mentions, source mappings,
checkpoint/counters and a dirty-search marker. A failure anywhere rolls back all
of them. No SQL transaction type crosses a domain port; adapters never import
another domain's outbound adapter. `(team, Slack conversation, exact timestamp)`
is the long-lived first-commit-wins dedupe key. It is not global across teams,
and reimports do not overwrite live edits, delete history or reattribute authors.

Keep original timestamps, exact `thread_ts` parent identity and import metadata.
Roots precede replies; resolve parents from durable mappings plus the bounded
current batch. Preserve `orphaned_thread_ts` when missing/skipped, without a later
repair promise. Convert reactions, dedupe mapped reactors, and use source message
time when reaction time is absent. Ignore files/attachments and skip empty
converted messages. No live-message notifications, activity rows, Kafka, bots,
contacts, sharing changes or realtime sends. The colleague join email is the one
deliberate exception. Historical activity timestamps use
`GREATEST` so newer live activity never regresses.

`SearchBackfillClient` submits only affected channel IDs (empty scope means no
channels). A 202-style receipt is `submitted`, **not** indexed. Persist/poll the
receipt and distinguish `not_needed`, `pending`, `submitted`, `completed`,
`failed`. Dirty generation fencing prevents an older receipt clearing newer
writes. Retry search independently, including committed history from failed or
cancelled imports. Conversation completion means durable historical persistence
and recoverable search work, not synchronous indexing. Imported author display
names require an explicit searchable text mapping; the sender keyword alone is
not sufficient. Existing search authorization still applies.

Staging may expire after 14 days. Job/staging cleanup must not delete user-visible
history, long-lived dedupe mappings, canonical reservations or source bindings.
Team/channel deletion semantics belong to owning schema migrations.

## Colleague join email

`SLACK_IMPORT_JOIN_EMAIL_ENABLED` gates this email and defaults to off. When it
is on, the worker sends the email after a conversation binds. That send runs on
every bind, including a retry of the same attempt and a later re-import. Public
channels, private channels, DMs, and group DMs all participate.

A member is eligible only when all four of these conditions hold.

- The team has `auto_join_domain` set.
- The member's email domain equals the team's `auto_join_domain`.
- The member is not a `team_user`.
- The member has no pending `team_invite`.

`team_joined_macro_email` records one row per team and email. The worker sends
the email at most once for that pair, including across channels and later
imports. If the enqueue fails, the worker removes the row so a later import can
try again. x is the importing admin. The email shows x's Slack display name when
the export has one, and x's email otherwise.

The worker logs a send failure and continues. The failure does not change the
import result, and it does not retry the import.

## Native links and deferred source references

The pure `slack::mrkdwn::MrkdwnConverter` retains its existing `message`/`convert`
interfaces. The additive `convert_with_references(source, italic)` returns
`ConvertedText`: an initially safe `body`, explicit `user_mentions` (occurrences
actively emitted outside code), and typed `ReferenceIntent` occurrences. It accepts
at most 1 MiB source text, 1 MiB cumulative generated token/fallback bytes,
256 references, and 256 emitted user mentions per body. Metadata expansion and
occurrence budgets are checked as tokens are emitted; excess is an explicit
`LimitExceeded`, not silent truncation. `italic` is used for
Slack `me_message`. The importer uses `message_with_references` and carries this
evidence to its atomic historical sink.

Native representations match Lexical `INTERNAL_TRANSFORMERS`:

```text
<m-link>{"url":"https://example.com","text":"Example","title":""}</m-link>
<m-user-mention>{"userId":"macro|a@example.com","email":"a@example.com"}</m-user-mention>
<m-document-mention>{"documentId":"<channel UUID>","blockName":"channel","documentName":"general","blockParams":{},"collapsed":false}</m-document-mention>
<m-document-mention>{"documentId":"<channel UUID>","blockName":"channel","documentName":"general","blockParams":{"channel_message_id":"<message UUID>","channel_thread_id":"<persisted root UUID>"},"collapsed":false}</m-document-mention>
```

`channel_thread_id` is optional; `channel_message_id` is the canonical message UUID,
never a Slack timestamp. `documentId` is always the channel UUID. There is no
`m-channel-mention`. The renderer may show the accessible entity name, not the
original arbitrary link label. Shared typed serializers live in `mention_utils`;
the existing markdown-document serializer's API and behavior remain unchanged.
New native serialization JSON-escapes literal `<`/`>` delimiters, restoring labels
exactly on JSON decoding (including quotes, backslashes, newlines and Unicode).
This prevents closing/nested tag injection without HTML-encoding decoded labels.
URL scheme policy (HTTP/HTTPS/mailto only) is validated separately from URL syntax
using the URL parser; malformed authorities/ports and literal controls, whitespace,
backslashes or tag delimiters are rejected. Original accepted URLs are retained,
not rewritten to a hardcoded Macro origin.

Safe Slack labeled/unlabeled angle links and protocol-prefixed bare HTTP(S)/mailto
URLs outside code become `m-link`. Unlabeled mailto displays its address. Bare URL
boundaries follow the frontend's protocol-mode autolink convention: terminal
punctuation and unmatched closing parentheses are outside the URL; balanced path
parentheses remain inside. Host-only/fuzzy links are not guessed. Entities decode
once. Formatting is applied around generated nodes, never recursively through
serialized JSON. Source-supplied Macro tags are escaped display text; recognized
inline/fenced code remains literal. Never feed the entire output to the XML-only
Rust parser to extract mention rows: it is not code-aware. Use `user_mentions`.
Channel/group broadcasts and subteams are always inert text.

Reference evidence and fallback policy:

- Channel tokens carry a validated exact Slack channel ID. Fallback is the escaped
  original `#label`, archive-provided channel name, or original Slack ID; no Macro
  metadata is added to a fallback.
- Supported permalinks are HTTPS `<workspace>.slack.com/archives/<C/G/D ID>/p<seconds><six microseconds>`
  root links and reply links with optional `thread_ts=<seconds>.<six microseconds>`
  and matching `cid`. Message identity always comes from the path, not `thread_ts`.
  Credentials, non-default ports, fragments, extra path segments, duplicate/unknown
  query keys, malformed IDs/timestamps and other Slack URL forms stay external links.
- A parsed hostname is only source evidence to check, **not proof** of the bound
  workspace. Resolution requires team + bound source + exact channel/message
  identity and independently established matching source/domain evidence. Unknown
  source confirmation supplies no domain evidence. Do not infer associations,
  fetch URLs, call Slack, reserve IDs, create channels, or invent message mappings.
- `ResolvedTarget` distinguishes authorized canonical channels from messages and
  carries UUIDs (plus an optional persisted root). The resolver must require
  requester **read** access, separate from import-write provenance. Prior same-source
  imports may resolve even if not selected. Per-viewer runtime access checks remain.
- Missing, unauthorized, skipped, deleted, incompatible or source-mismatched targets
  retain their original safe fallback: external `m-link` for a permalink, source-only
  display text for a channel. A message can never downgrade to a channel mention.

### Read-only resolver boundary

`references::resolve::resolve_batch` returns typed `Resolved`, `Pending`, or
`Fallback` outcomes, in record/occurrence order. Pending/fallback contain no target
IDs or labels. It deduplicates exact source identities within a batch, caps each
record at 256 reference occurrences, caps records and serialized template bytes at
the configured database ceilings (never above 500/4 MiB), and chunks lookup calls
at that same record ceiling. No per-token queries or archive-wide reference map.

`ImportTargetReader` reads canonical reservations and unambiguous explicitly
team-scoped legacy mappings without reserving, locking, or deriving scope from a
user's current team. It validates binding, existence, type and team compatibility;
name-only legacy mappings are not evidence. Prior compatible imports and archived
source channels remain eligible. Pending reservations expose no candidate UUID.
`SourceMessageReader` reads exact integer-microsecond mappings; `HistoricalMessageReader`
checks live message/root state and actual channel/parent ownership. A persisted
orphan-imported reply links to its own root, not a guessed Slack parent.

The worker's `WorkerReferenceLookup::context` loads the requester and source from
the team-owned job. V1 has **no persisted domain-association evidence**, so its
`domains` is empty and all Slack permalinks remain external, even with a known T ID.
The domain resolver supports independently established exact workspace/hostname
pairs, but there is no public/archive input or implicit alias-binding flow for
those pairs. URL userinfo (including empty userinfo), contradictory `cid`, and a
`thread_ts` later than the path message are not accepted source references.

Disclosure requires current active participation for Private/DM, or current
membership in the owning team for Team channels. Import provenance and admin role
alone do not grant read access. Missing mappings in selected nonterminal work stay
pending; deleted/inconsistent mapped messages do not become speculative targets.
The sink persists user mention rows only from converter-emitted `user_mentions`,
never by parsing tags in the resulting body. Code-contained tags remain inert.

The resolver is a read-only capability for deferred reconciliation; persistence,
settlement-time retries, guarded body updates and search publication remain the
separate reconciliation boundary described below.

Each intent stores its exact fallback and UTF-8 byte range in the immutable initial
body. `ConvertedText::render` reconstructs by occurrence with typed targets; it
validates ordered, non-overlapping ranges/fallback equality and never searches or
regex-replaces serialized bodies. Duplicate, self, forward and cyclic occurrences
are independent of import order. Persist the template/intents atomically with the
imported body/mapping/checkpoint. Subsequent reconciliation must fence body updates
against live edits/deletion and atomically complete intents with search-dirty/outbox
work. Close unresolved intents to fallback when the job's opportunity ends, including
cancellation, without restarting imports or adding members/mention effects. This is
within-job reconciliation, not cross-job edit synchronization.

The sink records one job-owned `slack_import_message_reference` template per newly
won source mapping, plus `slack_import_job` and `body_version` in message import
metadata. Duplicate-import losers never write intents or replace the winning body.
No speculative UUID is rendered: all body references, including same-batch links,
wait until canonical arbitration and selected-conversation settlement.

Maintenance uses a transaction-held job row lock (`SKIP LOCKED`) as its fence,
not a reclaimed conversation lease. It processes at most 50 templates per tick,
one bounded template (at most 4 MiB) per transaction. A process crash rolls back
body, completion checkpoint and search writes together; a competing process cannot
patch the same job concurrently. No S3 object is needed to finish. The read-only
resolver rechecks source proof and current disclosure access immediately before a
message-owned compare-and-set. Body, owning job/version, unchanged timestamps,
absence of edits and deletion must still match. Live edits/deletions are skipped;
a successful patch changes only content, not author, timestamps, counters,
reactions, thread structure, membership or live-message effects.

Missing/pending targets at this final opportunity retain source-only fallbacks.
Unsupported template versions close without a rewrite. Expired/abandoned/failed
and cancelled partial imports follow the same rule after their conversations
settle, without reclaiming cancelled import work. Completion clears bulky template
data and retains a small checkpoint until job cleanup. Later exports or restored
access never reopen it. Job deletion cascades only into these temporary intents,
never into messages or long-lived dedupe mappings.

Changed bodies increment the conversation's durable search generation in the same
transaction. Scoped search publication waits for the job's pending templates to
close, then uses the existing receipt/retry path. Job completion waits for required
publication (not eventual OpenSearch refresh); terminal jobs never oscillate. These
are internal settlement rules, with no new public progress enum.

`tests/fixtures/native-message-links.json` in `slack_integration` is shared with
`packages/lexical-core/tests/slack-import-links.test.ts`. Rust checks converter/shared
serializer output with the real `mention_utils` parser; frontend tests import using
real `INTERNAL_TRANSFORMERS` and round-trip Lexical state, including hostile labels
and code. Ordinary mentions/mailto also round-trip native markdown. Lexical's own
markdown export normalizes URL parentheses and is not the import serializer.

## Bounds and browser obligations

`ImportLimits::default()` defines these initial configurable ceilings:

| Resource | Default |
| --- | --- |
| NDJSON part | 16 MiB and 20,000 records |
| NDJSON record, including LF | 1 MiB |
| Users/root metadata/individual day JSON | 32 MiB |
| Total selected temporary upload bytes | 2 GiB |
| ZIP entries | 100,000 |
| Selected conversations | 2,000 |
| Registration/completion call | 50 descriptors/identities |
| Historical database batch | 500 messages and 4 MiB |

Use byte limits as well as counts, including UTF-8 multibyte text. Reject explicit
limit violations; do not silently truncate imports. Server configuration must be
validated at startup. Route body/metadata text bounds complement these limits.

The browser shows the picker before uploads, scans the ZIP at most twice total
(first metadata/index, second all selected folders), and uses bounded IndexedDB
sorting/deduplication rather than retaining whole conversations. History-off
skips the history pass. Apply backpressure and clean scratch data on every exit.
The worker streams bytes and rechecks total bytes, line length, record count,
digest and monotonic timestamp ordering across part boundaries. No server ZIP
extraction, attachment downloads, multipart upload, live Slack bot/contact sync,
blocks converter, multi-workspace binding, rollback, SDK publishing or automatic
orphan repair is part of this contract.
