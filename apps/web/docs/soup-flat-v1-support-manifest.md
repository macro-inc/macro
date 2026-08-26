# `soup-flat-v1` baseline and `soup-flat-v2` support manifest

Status: v1 baseline retained for compatibility history; bounded v2 Documents expansion implemented and rollout-gated.

## Canonical boundary

The index receives the `filters` object from the same generated
`GraphqlSoupInput.initial` value sent to `Query.soup`. Names below are GraphQL
`Type.field` names. REST tokens such as `df`, `pid`, and `ca` are not index
inputs.

Profile: `soup-flat-v1`

Supported request options:

- `SoupInitialInput.sortMethod`: `CREATED_AT`, `UPDATED_AT`;
- `SoupInitialInput.sortDirection`: `ASC`, `DESC` (omission means `DESC`);
- initial requests only, with a bounded limit and no cursor;
- expanded Soup items (the first consumer materializes generated expanded
  fragments).

Supported partition literals:

- `GraphqlDocumentLiteral.id`
- `GraphqlDocumentLiteral.fileType`
- `GraphqlDocumentLiteral.projectId`
- `GraphqlDocumentLiteral.owner`
- `GraphqlDocumentLiteral.createdAt`
- `GraphqlDocumentLiteral.updatedAt`
- `GraphqlProjectLiteral.projectId`
- `GraphqlProjectLiteral.projectIdSelf`
- `GraphqlProjectLiteral.owner`
- `GraphqlProjectLiteral.createdAt`
- `GraphqlProjectLiteral.updatedAt`
- `GraphqlChatLiteral.chatId`
- `GraphqlChatLiteral.projectId`
- `GraphqlChatLiteral.owner`
- `GraphqlChatLiteral.createdAt`
- `GraphqlChatLiteral.updatedAt`

Every reachable literal may be combined with GraphQL expression fields `and`,
`or`, and `not`. No unsupported reachable leaf is ignored.

## Active profile: `soup-flat-v2`

V2 retains every v1 option and literal above. It additionally supports:

- `GraphqlDocumentLiteral.subType` for canonical `TASK`, `SNIPPET`, and `SKILL`;
- `GraphqlDocumentLiteral.isEmailAttachment` for both `true` and `false`.

A complete v2 Document has exactly one explicit attachment Boolean. Missing is
not false. A null subtype has no subtype posting; a supported non-null subtype
has exactly one canonical posting. These facts arrive only through a bounded
server-minted `GraphqlSoupEntity.cacheProjection` capsule bound to the
surrounding normalized key and partition. The browser accepts only wire version
1 carrying profile `soup-flat-v2`.

V2 remains initial-page-only and supports `CREATED_AT`/`UPDATED_AT` in both
directions. Every unsupported sibling under direct, `and`, `or`, or `not`
causes whole-request network fallback. V2 does not broaden the cached corpus or
provide authorization evidence.

Canonical `Soup`, `SoupBackfill`, and `SoupUpdates` operations select and ingest
the capsule atomically. Backfill rejects a page before storage when a supported
entity's selected capsule is absent, null, malformed, mismatched, or uses an
unsupported profile, so its checkpoint cannot pass an approximate page. A
new client receiving an old-server unknown-field validation error retries the
network request without `cacheProjection` and disables v2 local evaluation for
the session. Compatibility epoch 2 clears stale persisted v1 authority.

Optimistic Document, Project, and Chat payloads are projected as durable ordered
replacement, direct-field patch, or deletion overlays. Missing optimistic
`updatedAt` values use the queue enqueue time provisionally and are replaced by
the authoritative timestamp on settlement. Query-relevant uncertainty, more
than 128 distinct optimistically touched records, or a required overfetch above
the 500-record query bound causes exact network fallback.

## Conservative unsupported-partition exclusion

The frontend's `defineQueryFilters` mechanically excludes unreferenced entity
partitions with the nil UUID
`00000000-0000-0000-0000-000000000000`. The profile recognizes only these
direct positive leaves as impossible persisted IDs:

- `GraphqlCalendarEventLiteral.id`
- `GraphqlEmailLiteral.threadId`
- `GraphqlChannelLiteral.channelId`
- `GraphqlChannelThreadLiteral.threadId`
- `GraphqlCallLiteral.callId`
- `GraphqlCrmCompanyLiteral.id`
- `GraphqlForeignEntityLiteral.id`

A positive nil leaf proves its partition empty. An `and` containing a proven
empty branch is empty. `or`, `not`, a missing tree, a non-nil value, or another
literal does not prove exclusion. Omitted reminder filters retain Soup's
server-defined default of excluding reminders; any present reminder filter is
unsupported. An absent `propertiesFilter` is unrestricted; a present one is
unsupported.

## Representative generated requests

The audit generated `GraphqlSoupInput` values through the production
`compileToAst` -> `makeGraphqlSoupInput` path, rather than hand-writing REST AST
shapes.

Eligible examples observed in view presets:

- Agents: owned, running, shared, and automations. These use supported Chat
  direct fields and nil-exclude all unsupported partitions.
- Folders: owned and all. These use supported Project direct fields and
  nil-exclude all unsupported partitions.
- Documents: folders. This preset proves the Document partition empty and uses
  supported Project fields.

Common fallback causes observed:

- Inbox: notification, importance, email, channel, channel-thread, and foreign
  entity literals.
- Mail: the Email partition.
- Documents and Tasks: subtype, importance, notification, attachment, and
  property literals.
- Channels, Calls, Companies, and Reminders: deferred partitions.
- Search/all: several deferred partitions and document subtype predicates.
- Agents/skills: currently cannot be translated to GraphQL because the
  frontend mapper does not support the `SKILL` document subtype.

With the original feature-flag defaults, an admin context, and `UPDATED_AT`
sort, 7 of 36 checked-in view-tab preset shapes (19.4%) satisfy v1. V2 makes
all four active Documents tabs eligible when no unrelated user filter is
present, raising that same single-context static baseline to 11 of 36 (30.6%).

The expanded audit also captures snippets both enabled and disabled: all eight
Documents variants (Owned, Shared, Attachments, All × snippets on/off) compile
for `CREATED_AT` and `UPDATED_AT`, ascending and descending. Thus 32/32 checked
Documents request/sort combinations are statically eligible in v2, versus 0/32
in v1. These are shape measurements, not production traffic, local scope
completeness, or hit-rate data.
Runtime instrumentation must measure the actual eligible and complete hit
rates before expansion.

Direct call sites outside presets are mixed: contact/company email requests,
recent-channel requests, and channel attachment requests generally fall back;
dynamic List exact-ID queries can be eligible only when they select Documents,
Projects, and/or Chats and conservatively exclude every deferred partition.

## Product decision and success gate

A predicate index is justified for the first experiment because filters are
user-composed and persisted, while the normalized entities are independently
backfilled. A query-result cache would accelerate only an identical prior
request and would not answer a newly composed supported filter over those
records.

Do not expand beyond `soup-flat-v2` unless production measurements show all of:

- at least 15% of initial flat GraphQL Soup requests are statically eligible;
- at least 60% of eligible requests have a complete local scope;
- warm OPFS local-page latency is at most 25 ms at p95 and 50 ms at p99;
- the local placeholder is observable and is replaced by authoritative network
  data without ordering or membership divergence.

If the first two thresholds are not met, remove or pause the predicate-index
experiment and evaluate canonical query-result reuse instead of broadening the
semantic profile.

Rollout observations and alert formulas are fixed in
`apps/web/ops/soup-flat-v2-rollout-dashboard.json`. They include capsule
requested/present/null/absent and semantic outcomes by operation, bytes/facts,
decode and server compilation latency, storage failures, local filter fallback
reasons, authority source, and stale-fallback resumption. They expressly forbid
record IDs, user IDs, raw capsules, and fact values.
