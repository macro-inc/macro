# `soup-flat-v1` support manifest and request-shape audit

Status: baseline audit for the incremental exact entity-filter cache index.

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

With current feature-flag defaults, an admin context, and `UPDATED_AT` sort,
7 of 36 checked-in view-tab preset shapes (19.4%) satisfy the static profile.
This is a shape baseline, not production traffic or cache-completeness data.
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

Do not expand `soup-flat-v1` unless production measurements show all of:

- at least 15% of initial flat GraphQL Soup requests are statically eligible;
- at least 60% of eligible requests have a complete local scope;
- warm OPFS local-page latency is at most 25 ms at p95 and 50 ms at p99;
- the local placeholder is observable and is replaced by authoritative network
  data without ordering or membership divergence.

If the first two thresholds are not met, remove or pause the predicate-index
experiment and evaluate canonical query-result reuse instead of broadening the
semantic profile.
