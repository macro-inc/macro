# Server-Minted Soup Cache Projection Plan

Status: **Phases 0-3 implemented; Phase 4 not started**

## Implementation status

- [x] Phase 0: fixtures and contract lock (including the document-email lifecycle audit below).
- [x] Phase 1: server-fact hydration. The flat expanded cursor, frecency fallback, and bounded by-ID paths now return authorized items plus optional document relation facts from one SQL result; the document relation probe uses `document_email_pkey`. Projects, chats, unsupported entities, and unenriched paths carry no supplement source.
- [x] Phase 2: `soup-flat-v2` profile validation and typed supplement wire. The complete profile retains v1 facts and adds subtype plus an explicit Boolean attachment posting, while capsule-v1 contains only the server-owned attachment Boolean and defensive target-profile/record-key/partition bindings. Native and WASM-reachable adapter golden fixtures pass.
- [x] Phase 3: emit supplements from `GraphqlSoupEntity`. The nullable argument-free opaque scalar is implemented by every concrete Soup entity, but only documents with authoritative relation hydration return a capsule. Projects, chats, unsupported variants, and unenriched constructors return `null`. `SoupItemFields` selects the scalar with `@cacheOnly`; the composed SDL, generated client document, shared-interface contract, flat-page emission, unsupported-variant, and realtime loader tests are updated.
- [ ] Phases 4-6: not started; outside the current implementation request.

## Objective

Allow authoritative Soup responses to carry a versioned, opaque **server-only fact supplement**. The capsule is not a complete predicate document: the browser derives direct facts (including document subtype) from the same GraphQL response, validates and merges the supplement, validates one complete `soup-flat-v2` document, and atomically stores that replacement alongside the normalized entity record.

The first release exists to make flat Documents/Files queries locally reevaluable after a `SoupUpdates` cache revision. In particular, it must support the production document predicates that currently force `soup-flat-v1` to return `Unsupported`:

- `GraphqlDocumentLiteral.subType`;
- `GraphqlDocumentLiteral.isEmailAttachment`.

`isEmailAttachment` is relation-backed (`EXISTS(document_email ...)`) and is intentionally not a GraphQL business field on `GraphqlSoupDocument`. The only entity-shape addition is a generic opaque `cacheProjection` field on the shared `GraphqlSoupEntity` interface; `SoupDocument` and UI entity models remain unchanged.

The design must make later server-derived exact facts straightforward to add without teaching `cache-core`, `cache-turso`, the worker protocol, or Soup UI components about each business field.

## Context and current failure

The current realtime flow is:

```text
Document event
  -> recipient-targeted Soup realtime patch
  -> GraphQL SoupUpdated.item hydration
  -> normalized-cache write
  -> cache revision advances
  -> flat Soup detects stale network authority
  -> browser entityFilter attempts exact local reevaluation
```

The subscription write successfully normalizes the new `GraphqlSoupDocument` and advances the cache revision. It does not splice the new entity into an existing `Query.user.soup.items` link list, so list membership must be recomputed through the local predicate index.

That recomputation fails for the normal Documents tabs:

- Owned and Shared use `isEmailAttachment: false` and subtype exclusions;
- Attachments uses `isEmailAttachment: true`;
- All uses subtype exclusions.

The local `soup-flat-v1` projection contains owner, project, file type, created time, and updated time, but not subtype or email-attachment membership. The compiler therefore returns `Unsupported`, and the frontend retains the stale network page.

The existing plans deliberately deferred relation-backed predicates. This plan is the first bounded expansion for the previously identified "simple relation-existence facts such as document email-attachment state" family. It deliberately revises the earlier client-only authoritative-projection decision because the client cannot derive this relation exactly from `GraphqlSoupDocument`.

## Scope

### In scope

1. A server-minted, versioned, opaque server-fact supplement for authoritative flat Soup hydration.
2. An entity-scoped `GraphqlSoupEntity.cacheProjection` field selected by:
   - `Query.user.soup` flat initial/continuation responses, including backfill hydration;
   - `Subscription.soupUpdates` through each `SoupUpdated.item`.
3. A new `soup-flat-v2` profile containing all existing v1 direct facts plus:
   - document subtype;
   - explicit email-attachment membership.
4. Local compilation of `GraphqlDocumentLiteral.subType` and `GraphqlDocumentLiteral.isEmailAttachment` against the new facts.
5. Atomic normalized-record and one browser-composed complete projection replacement in the browser cache.
6. Safe handling of missing, malformed, unsupported, or stale capsules through existing incomplete/network fallback behavior.
7. Tests using the real production Documents preset shapes, not only exact-id fixtures.
8. A bounded typed extension contract for adding future server-only facts without duplicating direct GraphQL fields in the capsule.

### Out of scope

- Adding `isEmailAttachment` to `GraphqlSoupDocument`, `SoupDocument`, REST Soup entities, or UI entity models.
- Local grouped-Soup reevaluation or grouped local pagination.
- Adding new entity partitions.
- Notification, properties, assignment, CRM, email, channel, reminder, or query-time predicates.
- `VIEWED_AT` or `VIEWED_UPDATED` local sorting.
- Treating cache facts as authorization evidence or sending them back as trusted mutation input.
- Guaranteeing local completeness for entities that have never been delivered to the identity-scoped cache.
- Retrofitting every GraphQL mutation response with a projection capsule in the first release.
- Transporting cache-turso physical row IDs, SQL table state, or SQL statements.

## Confirmed design decisions

1. **The server sends a typed server-only fact supplement, not physical rows and not a complete `IndexDocument`.** Capsule-v1 contains only the explicit email-attachment Boolean. It contains no subtype, id fact, owner, project, file type, created/updated membership facts, or sort facts.
2. **The capsule belongs to the normalized entity and the field has no arguments.** Add nullable `cacheProjection` to the shared `GraphqlSoupEntity` interface, which requires every concrete Soup entity type to implement it. The capsule declares its wire version, target profile, record key, and partition; unsupported bindings are rejected rather than negotiated through GraphQL. Do not put metadata on `SoupPage`/`SoupUpdated` wrappers. `isEmailAttachment` itself remains absent from `GraphqlSoupDocument`.
3. **The browser owns complete projection composition.** It derives all direct fields, including subtype from `GraphqlSoupDocument.subType.__typename`, from the same selected GraphQL object; validates and merges the server supplement; validates the complete `soup-flat-v2` document; then emits exactly one atomic `ProjectionMutation::Replace`. A decoded capsule cannot itself be submitted as a replacement because its API returns a dedicated supplement type, never `IndexDocument`.
4. **The browser remains responsible for query compilation and optimistic composition.** Server supplement data is authoritative fact input, not executable SQL, a server cursor, or a complete cache mutation.
5. **Support remains all-or-network per query.** No unsupported leaf is ignored and no absent required fact is interpreted approximately.
6. **A profile version change is mandatory.** Existing v1 projections marked complete cannot safely satisfy queries that depend on newly required facts.
7. **Authorization remains server-side.** Capsules accompany only items returned by the existing user-scoped Soup service. Local facts never broaden the cached corpus.
8. **Opaque does not mean secret.** A browser user can inspect the capsule. The goal is API/domain decoupling, not confidentiality.
9. **Projection generation and item hydration must use the same database result/snapshot.** Do not issue an independent per-item relation query from GraphQL resolvers.
10. **The generic cache layers remain business-agnostic.** Soup typenames, relation semantics, and profile-required-fact validation stay in Soup projection/compiler adapters.

## Target architecture

```text
Postgres Soup repository
  |  authorized item row + optional document server facts
  v
Soup domain service
  |  item remains public; relation facts are internal hydration output
  v
Soup projection adapter
  |  compiles a typed, bounded server-fact supplement
  v
GraphQL GraphqlSoupEntity.cacheProjection opaque capsule
  |
  v
normalized-cache exchange / WASM Soup adapter (next PR)
  |  derive direct GraphQL facts + decode/bind/merge supplement
  |  + validate one complete soup-flat-v2 IndexDocument
  v
cache-core atomic normalized write + one ProjectionMutation::Replace
  |
  v
cache-turso generic index_documents / exact_facts / integer_facts / sort_facts
```

### Hexagonal boundaries

- `soup` outbound PostgreSQL code owns `document_email` lookup and row mapping.
- The Soup domain/service boundary owns authorized hydration and returns the facts needed by its caller without exposing SQL.
- `soup-filter-projection` owns the typed mapping from Soup relation hydration to `SoupCacheProjectionSupplement`, its wire contract, and separate complete `soup-flat-v2` validation. It does not compile direct GraphQL fields into the opaque scalar.
- `graphql_soup` only serializes the adapter-produced opaque entity-scoped supplement through the shared `GraphqlSoupEntity` contract; it does not query PostgreSQL or reconstruct facts.
- `cache-wasm` is the future composition edge that derives direct selected fields, decodes and binds the Soup supplement, merges both sources, validates a complete document, and only then passes one generic replacement inward.
- `cache-core` owns atomic projection lifecycle and revision changes without Soup knowledge.
- `cache-turso` owns generic persistence and predicate SQL without GraphQL field or entity semantics.

## Authoritative server-fact source

### Repository data

Extend the document detail row used by flat expanded Soup hydration with an explicit relation fact derived in the existing query:

```sql
EXISTS (
  SELECT 1
  FROM document_email de
  WHERE de.document_id = d.id
) AS is_email_attachment
```

The existing `document_email` primary key begins with `document_id`, so this should use an indexed existence lookup. Confirm with `EXPLAIN` for normal pages and the realtime loader's bounded ID batches.

All union-compatible non-document detail branches must provide the correctly typed neutral column. The value must be read from the same query that returns the document fields; GraphQL must not perform N+1 relation lookups.

Subtype already comes from `document_sub_type` in the same detail row and is exposed as `GraphqlSoupDocument.subType`; it remains a direct GraphQL-derived client fact and is not copied into the capsule.

### Domain-facing shape

Do not add relation state to `SoupDocument`. Introduce a dedicated internal hydration wrapper for optional server facts, conceptually:

```rust
pub struct SoupDocumentServerFacts {
    pub is_email_attachment: bool,
}

pub struct SoupProjectionHydration {
    pub item: SoupItem<()>,
    pub document_server_facts: Option<SoupDocumentServerFacts>,
}
```

The exact type must avoid serializing through existing REST models. The optional facts are present only for documents whose authoritative relation state was loaded. Projects and chats have no server-only facts, while unsupported entities and unenriched paths also carry `None`; no enum variants pretend that direct-only entities require capsules. A dedicated Soup service/repository method preserves the same authorization, filtering, ordering, and cursor behavior as canonical Soup.

The service method is a domain capability; GraphQL remains a thin caller and must not reach into `document_email` or a concrete repository.

### Realtime consistency

The document creation repository inserts `document_email` in the same transaction as the document and commits before the document-created event is published. `SoupUpdated` already hydrates current user-scoped state after receiving the event. Therefore the update capsule can observe the committed relation without changing the Kafka Soup patch schema.

If a future operation can add or remove `document_email` after document creation, that operation must publish a document Soup update. Adding a server fact requires auditing every mutation of its source relation and documenting the invalidation event.

## Projection profile: `soup-flat-v2`

### Complete client document facts retained

For Documents, Projects, and Chats, a complete browser-composed v2 document retains the v1 facts:

- record identity;
- owner;
- project/parent identity;
- document file type;
- created timestamp;
- updated timestamp;
- created sort fact;
- updated sort fact.

### New document facts and ownership

Add stable vocabulary tokens owned by `item-filter-index`, conceptually:

```text
document-sub-type
email-attachment
```

Canonical values:

- subtype: stable canonical values for `task`, `snippet`, and `skill`; an ordinary document has no subtype posting;
- email attachment: an explicit canonical Boolean value for both `true` and `false`.

The email-attachment fact must be explicit in every complete v2 document projection. Missing is not equivalent to false. It is the only current server-owned fact and comes from the decoded supplement.

The subtype fact is client-owned direct response data: `GraphqlTaskSubType`, `GraphqlSnippetSubType`, and `GraphqlSkillSubType` map to stable `task`, `snippet`, and `skill` postings; GraphQL `null` maps to no subtype posting. The complete-profile validator must ensure the composed result has at most one canonical subtype. The supplement never contains subtype.

### Compiler expansion

Extend complete-profile eligibility and compilation so:

- `DocumentLiteral::SubType(value)` compiles to an exact subtype posting;
- `DocumentLiteral::IsEmailAttachment(value)` compiles to an exact Boolean posting.

`And`, `Or`, and `Not` continue to use the generic predicate IR. Existing unsupported literals remain unsupported.

The production Documents presets should become statically eligible when using `CREATED_AT` or `UPDATED_AT` sort and when no unrelated unsupported user filter is active.

### Profile validation

Validation has two distinct boundaries:

1. Supplement decode validates the bounded base64/postcard frame, wire version, target profile, record key, document partition, and typed Boolean. The browser additionally matches record key and partition to the surrounding selected entity.
2. After deriving direct GraphQL facts and merging the supplement, `IndexDocument::validate` plus `validate_soup_flat_v2` validate required identity/direct/membership/sort facts, canonical subtype values, exactly one explicit attachment Boolean, allowed attributes, uniqueness, and generic bounds.

The decoder returns `SoupCacheProjectionSupplement`, not `IndexDocument`. A malformed supplement or composed profile document becomes `ProjectionIncompleteKind::IncompatibleVersion` or `Missing`; it never becomes a partial complete replacement.

## Wire protocol

### GraphQL shape

Add the opaque scalar to the normalized Soup entity interface, not to an embedded page/update wrapper or a new per-item wrapper:

```graphql
scalar SoupCacheProjection

interface GraphqlSoupEntity {
  id: ID!
  cacheProjection: SoupCacheProjection
}

type SoupPage {
  items: [GraphqlSoupEntity!]!
  nextCursor: String
}

type SoupUpdated {
  item: GraphqlSoupEntity
}
```

`cacheProjection` is part of the shared interface contract, so every concrete Soup entity object implements the nullable field. Only Documents with authoritative relation hydration return the active supplement capsule. Projects and Chats return `null` because all their profile facts are direct fields; unsupported variants and unenriched Documents also return `null`.

The field intentionally has no arguments. The capsule's framing `wire_version` and embedded `target_profile` identify its encoding and merge target. The client validates both before composition; an unknown value marks the projection incompatible and invokes network fallback. This avoids requiring the server to retain and negotiate every historical compiler through the GraphQL schema. The capsule is generic cache-control metadata: it does not add `isEmailAttachment` or any other projected business fact to `GraphqlSoupDocument`.

This placement follows the normalized-cache schema convention that entity facts belong on the entity carrying the stable `__typename:id`. Do not create a no-ID `SoupItem` wrapper containing an entity plus projection; such a wrapper would be an embedded value carrying facts about another entity and would make key correlation indirect.

Select the field with `@cacheOnly`. The current cache may persist that opaque scalar on the normalized entity while also decoding it into the predicate index, but `@cacheOnly` prevents it from entering the operation result consumed by Soup UI mappers. The predicate index, not the raw scalar, remains the filtering authority. If duplicated payload storage becomes material, add a generic consume-only metadata mechanism later; do not add a Soup-specific storage exception to `cache-core`.

Adding the interface field changes the composed SDL, but additive SDL changes do **not** automatically rotate the persisted normalized-cache namespace: compatibility is controlled separately by `CACHE_SCHEMA_COMPATIBILITY_EPOCH`. Regenerate the SDL and client/cache metadata normally, and make the v2 cutover explicit through a compatibility-epoch bump or a targeted projection reset. Do not assume the schema hash removes v1 projections.

### Entity server-fact supplement capsule

Define a dedicated, bounded single-entity wire type rather than serializing cache-turso rows, generic fact vectors, or the incidental Rust layout of `IndexDocument`:

```rust
struct SoupCacheProjectionCapsuleV1 {
    target_profile: String,
    record_key: String,
    partition: String,
    is_email_attachment: bool,
}

struct SoupCacheProjectionSupplement { /* validated private fields */ }
```

`decode_cache_projection_supplement` returns the typed `SoupCacheProjectionSupplement`. There is deliberately no decode API returning `IndexDocument` and no conversion that could be passed directly to `ProjectionMutation::Replace`.

The scalar uses RFC 4648 standard unpadded base64 over one framing byte followed by a postcard payload:

```text
base64_no_pad([wire-version byte] + postcard(SoupCacheProjectionCapsuleV1))
```

The wire-version byte is outside the postcard value so the decoder can dispatch without first assuming a payload layout. Version 1 is byte `0x01`. Never serialize `IndexDocument` directly; `SoupCacheProjectionCapsuleV1` is a dedicated immutable wire struct whose field order and postcard representation are locked by native/WASM golden fixtures. Capsule-v1 is capped at 1 KiB decoded and has:

- an explicit framing version independent of the embedded target-profile version;
- deterministic/canonical postcard encoding and RFC 4648 standard base64 without padding;
- strict decoded-size, token-size, and record-key bounds;
- no physical database IDs;
- no executable query or SQL fragments;
- stable cross-version fixtures decoded by both native Rust and WASM.

Although the field is structurally colocated with the entity, retain `record_key` and `partition` in the capsule as defensive binding. The client must verify that they match the surrounding entity's `__typename:id`; it must never infer identity from list position.

Each Document returned by canonical Soup hydration with authoritative `document_email` state carries one capsule. Projects, Chats, unsupported entities, and unenriched Documents return `null`; emitting an empty capsule for direct-only entities would add no authority. Per-entity encoding keeps identity association explicit. The browser will compose every present entity in one GraphQL emission and batch the resulting complete replacements into a single atomic write.

### Entity hydration

Canonical Soup hydration constructs each `GraphqlSoupEntity` from an item plus optional `SoupDocumentServerFacts`. Add an internal constructor or wrapper such as `GraphqlSoupEntity::new_with_projection`; do not add relation state to public `SoupDocument` models.

The flat `SoupPage` path attaches the optional facts before GraphQL object construction. The `SoupUpdated.item` loader returns the same item-plus-facts hydration value so direct fields and supplement cannot observe different hydration operations or trigger a second relation query. Cache/coalesce that loader value for one patch resolution only; repeated websocket updates must still reload current state.

Other GraphQL paths may construct a `GraphqlSoupEntity` without server facts during the first release. If they select `cacheProjection`, the resolver returns `null`. Future mutation or grouped-Soup paths can opt into authoritative supplements through the same domain capability; they must not independently reconstruct relation facts in GraphQL.

## Browser ingestion

### Operation documents

Add the interface field to the shared `SoupItemFields` fragment:

```graphql
fragment SoupItemFields on GraphqlSoupEntity {
  __typename
  id
  cacheProjection @cacheOnly
  # existing shared and concrete fields
}
```

Because the flat `Soup`, `SoupBackfill`, and `SoupUpdates` documents already reuse `SoupItemFields`, initial pages, backfill pages, and `SoupUpdated.item` all receive the same entity-scoped metadata without adding fields to `SoupPage` or `SoupUpdated`.

Do not expose the value from `mapGraphqlSoupPage`, `mapGraphqlSoupItem`, or Soup UI types. It is consumed exclusively by the normalized-cache composition boundary. Other operations can opt in later by selecting the same interface field.

### Atomic write

For each authoritative operation result in the next PR:

1. find every selected `GraphqlSoupEntity`, its direct selected fields, and its colocated `cacheProjection` scalar;
2. derive the surrounding normalized `__typename:id` key;
3. derive direct facts from the same object, including subtype from `subType.__typename`;
4. decode the scalar to `SoupCacheProjectionSupplement` and verify wire version, target profile, record key, and partition against the surrounding entity;
5. merge the typed email-attachment fact into those direct facts and validate one complete `soup-flat-v2` `IndexDocument`;
6. derive normalized record updates from the GraphQL response;
7. submit all record updates and the composed `ProjectionMutation::Replace` values in one cache-core command/storage transaction;
8. advance one logical cache revision only after both records and facts commit, then fan out notifications.

A supplement is never submitted directly as a replacement. A Soup projection must never be persisted before or after its normalized record in a separate best-effort write. Multiple entity supplements in one page are decoded and composed independently but committed together.

Explicit `GraphqlCacheDeletion` effects continue to delete both the normalized entity and projection state atomically through the existing deletion path.

### Missing capsules and other writes

For a recognized v2-supported entity arriving through a canonical Soup query/update that selected the interface field:

- valid document supplement bound to the surrounding entity plus complete direct selected fields: compose, validate, and replace the complete v2 projection;
- null/absent capsule for an authoritative Document response: mark attachment-dependent v2 composition missing; null is expected for direct-only Projects and Chats;
- malformed capsule or mismatched bound identity/partition: mark it incompatible and report telemetry;
- unsupported entity variant: do not fabricate projection state.

Other mutation/query responses may still contain partial `GraphqlSoupDocument` objects without a selected or populated capsule. The first release must preserve safety:

- they must not fabricate a complete v2 projection;
- deterministic optimistic direct-field patches may preserve an existing server-owned email-attachment fact;
- if the client cannot prove a complete effective projection, mark only the relevant projection incomplete and wait for canonical Soup hydration;
- a later complete direct response plus valid document supplement from `SoupUpdates` or a Soup page restores completeness.

Before implementation, add an ordering test where a mutation response and its `SoupUpdated` emission arrive in either order. A partial response must not permanently downgrade or erase a valid server-owned fact. If the existing authoritative projection API cannot express a safe direct-field patch over a complete server projection, add a bounded generic authoritative patch mutation or route the partial write to explicit rehydration. Do not solve the race by treating a missing relation fact as false.

## Optimistic behavior

Server-minted capsules apply only to authoritative responses. Offline/local optimistic writes still need deterministic projection behavior:

- a patch to owner, project, file type, subtype, created time, or updated time updates those attributes while preserving known server-owned facts from the base projection;
- deletion produces the existing tombstone behavior;
- an optimistic create may be complete only if all required v2 facts, including email-attachment state, are known from mutation input/semantics;
- otherwise it carries query-relevant uncertainty or an incomplete projection until authoritative hydration;
- settlement composes the authoritative direct response with its server supplement and replaces provisional facts atomically;
- commit/rollback continues to advance cache revision and trigger reevaluation.

Do not default every optimistic document create to `isEmailAttachment: false` unless the specific mutation contract proves it cannot create an email attachment. Encode such proof in the Soup projection adapter for that mutation shape, not in generic cache code.

## Versioning and rollout

### Profile cutover

Introduce `soup-flat-v2`; do not reinterpret existing v1 complete rows. The additive GraphQL SDL change does not itself clear persisted cache data. Choose and test one explicit cutover mechanism before rollout:

- bump `CACHE_SCHEMA_COMPATIBILITY_EPOCH`, rebuilding the complete normalized and predicate cache; or
- add a targeted projection-profile reset that removes v1 index state and marks v2 incomplete until canonical Soup hydration/backfill repopulates it.

The epoch bump is simpler and safer for the first release; a targeted reset is justified only if preserving normalized records materially reduces rollout cost. Retain explicit profile checks under either mechanism.

The server emits supplements targeting one active projection profile in `cacheProjection`, and the client validates the embedded target profile before merging. There is no GraphQL profile negotiation and the server is not required to retain historical profile compilers solely for stale clients. During the initial mixed deployment:

- old clients do not select the interface field and continue using v1 behavior against a new server;
- new clients select the field and accept only embedded profiles they understand;
- a new client talking to a server whose schema predates the interface field receives a GraphQL unknown-field validation error, not a null capsule.

Deploy the additive server schema before shipping a client document that selects the field. If deployment ordering cannot guarantee this, the client needs a tested legacy-document retry/fallback rather than treating an operation validation error as a cache miss. Guard v2 local evaluation behind the existing cache rollout control until server support is established.

For a future profile upgrade, ship client decode/validation/compiler support before changing the server's active emitted profile when uninterrupted local evaluation is desired. A stale client that receives an unknown embedded profile rejects it, marks the projection incompatible, and safely uses network authority until it reloads/upgrades. If uninterrupted multi-version local evaluation later becomes a product requirement, add bounded profile negotiation as a separate design rather than preemptively encoding it in this field.

### Backfill

The existing GraphQL Soup backfill must request and ingest capsules. Completion/checkpoint behavior must not advance past a page whose normalized records committed but whose required v2 projections failed. On capsule validation/storage failure, retry or leave the scope incomplete; do not checkpoint an approximate index.

### Telemetry

Track at least:

- entity capsule requested/present/null/missing by operation (`Soup`, `SoupBackfill`, `SoupUpdates`);
- supplement bytes and server-fact count per capsule, plus capsules per operation emission;
- decode and semantic-validation latency;
- complete, missing, incompatible, mismatched-key, unsupported-profile, and storage-error outcomes;
- server supplement compilation latency;
- attachment fact true/false counts as coarse diagnostics only if privacy review permits;
- local filter outcomes by unsupported reason, proving Documents presets move from unsupported to complete/incomplete;
- stale-fallback duration and whether network or local authority resumed it.

Do not log fact values, record IDs, user IDs, or raw capsules.

## Implementation phases

### Phase 0: Fixtures and contract lock

Before changing production behavior:

1. Capture the exact generated GraphQL inputs for Documents Owned, Shared, Attachments, and All with snippets both enabled and disabled.
2. Add a failing compiler/WASM fixture showing that a realtime ordinary document cannot currently satisfy these requests.
3. Record authoritative PostgreSQL membership for regular documents, email-attachment documents, tasks, snippets, and null subtype documents.
4. Define the single-entity typed supplement capsule and separate complete `soup-flat-v2` canonical fact encodings in tests.
5. Audit the current document-email lifecycle for relation mutation paths lacking a document Soup update.

#### Phase 0 lifecycle audit result

The audit found an invalidation gap; the stronger confirmation is **not** currently true:

- `documents::PgDocumentRepo::create_document` inserts `document_email` in the document transaction, commits, and only then publishes `DocumentMacroEvent::Created`. This path is correctly ordered for realtime hydration.
- `macro_db_client::document::v2::create` can also insert the relation. Its only non-test caller currently creates the instructions document with `email_attachment_id: None`, but this public legacy path is not intrinsically coupled to document event publication and must not gain a `Some` caller unnoticed.
- `document_email.email_attachment_id` has `ON DELETE CASCADE`. Email attachment reconciliation deletes orphaned `email_attachments`; message deletion cascades attachments; link deletion cascades messages and attachments. Those paths can remove `document_email` while leaving the Document row.
- No corresponding `DocumentMacroEvent` publication exists in `email_db_client`, `email_service`, or the email domain after those attachment/link deletions. A previously cached Document projection can therefore retain `isEmailAttachment: true` after the authoritative relation becomes false.
- Cascading relation removal caused by deleting the Document itself is not a separate projection-update problem because the document deletion path emits/removes the entity.

Before enabling v2 attachment facts, centralize or wrap relation-removing email operations so they collect affected document IDs and publish recipient-targeted document Soup updates after commit, or prevent deletion of an attachment while its derived Document remains. Add provider-reconciliation, message-deletion, and link-deletion tests. This is a rollout blocker discovered by Phase 0, not work to hide in the GraphQL adapter.

Likely files:

- `apps/web/src/features/next-soup/sidebar/soup-filter-presets.test.ts`;
- `apps/web/src/lib/queries/soup/graphql/ast.test.ts`;
- `crates/item_filter_index/src/test.rs`;
- `crates/soup_filter_cache_adapter/src/test.rs`;
- `crates/client/cache-wasm/src/shell/test.rs`;
- `crates/soup/src/outbound/pg_soup_repo/expanded/tests.rs`.

### Phase 1: Add server-fact hydration

- Add `is_email_attachment` to document detail rows using the indexed existence check.
- Preserve only relation state in optional `SoupDocumentServerFacts`; subtype remains a direct Soup/GraphQL field.
- Add a dedicated Soup repository/service capability that returns authorized items plus optional server facts without changing public `SoupDocument` serialization.
- Use the same SQL result for item and server-fact metadata.
- Cover flat initial, continuation, frecency if selected by the same GraphQL query, and bounded realtime ID hydration.
- Verify representative query plans and avoid N+1 lookups.

Likely files:

- `crates/soup/src/domain/models.rs`;
- `crates/soup/src/domain/ports.rs`;
- `crates/soup/src/domain/service.rs`;
- `crates/soup/src/outbound/pg_soup_repo/expanded/dynamic.rs`;
- related Soup repository/service tests.

Any changed SQLx query must follow the repository's root-level `just prepare_db` workflow after database-backed tests; do not hand-edit `.sqlx` metadata.

### Phase 2: Define v2 validation and the typed supplement wire

- Add subtype and explicit attachment tokens/encodings for complete client documents.
- Keep strict Soup-specific complete-profile validation separate from supplement validation.
- Extend `soup-filter-projection` to compile only relation hydration into `SoupCacheProjectionSupplement`.
- Define a separately versioned 1 KiB single-entity capsule containing only target profile, record key, document partition, and attachment Boolean, with native/WASM round-trip fixtures.
- Expose a decoder returning the dedicated supplement type, never `IndexDocument`.
- Keep generic `predicate-index` types free of GraphQL and Soup semantics.

Likely files:

- `crates/item_filter_index/src/lib.rs`;
- `crates/soup_filter_projection/src/lib.rs`;
- `crates/soup_filter_cache_adapter/src/lib.rs` or a small dedicated wire module/crate;
- corresponding tests.

### Phase 3: Emit supplements from `GraphqlSoupEntity`

- Add the opaque scalar and nullable argument-free `cacheProjection` field to the `GraphqlSoupEntity` interface.
- Implement the field on every concrete interface implementor; only authoritative Documents return supplements, while Projects, Chats, unsupported variants, and absent relation hydration return `null`.
- Extend GraphQL entity construction to retain optional document server facts without changing public Soup domain models.
- Refactor flat `SoupPage` construction so each Document receives relation metadata from the same repository result.
- Refactor `SoupUpdated.item` hydration so one loader result supplies both the entity and its supplement source.
- Add `cacheProjection @cacheOnly` to the shared `SoupItemFields` fragment.
- Keep authorization and access filtering entirely in the existing Soup service path.
- Regenerate composed SDL and GraphQL client documents and update the shared-interface contract test.
- Confirm that `SoupPage` and `SoupUpdated` gain no projection fields and that `GraphqlSoupDocument` gains no `isEmailAttachment` field.

Likely files:

- `crates/graphql_soup/src/objects.rs`;
- `crates/graphql_soup/src/loaders.rs`;
- `crates/graphql_soup/src/resolvers.rs`;
- `crates/complete_graph` schema tests;
- `static_assets/schema.graphql`;
- `apps/web/src/lib/service-clients/service-storage/graphql/soup.graphql`;
- `apps/web/src/lib/service-clients/service-storage/graphql/soup-updates.graphql`;
- generated client GraphQL output.

### Phase 4: Compose supplements atomically in the browser

- Extract/decode each selected document capsule to the dedicated supplement type in the Soup-specific WASM composition edge.
- Derive all direct facts, including subtype, from the same selected GraphQL object.
- Validate target profile, normalized key, and partition; merge the supplement; then validate one complete `soup-flat-v2` document.
- Emit exactly one complete replacement per entity; never pass a decoded supplement directly as `ProjectionMutation::Replace`.
- Persist all normalized records and composed projection mutations for one emission atomically.
- Mark missing/incompatible data incomplete.
- Preserve existing deletion ordering and revision fan-out.
- Add mutation/subscription ordering coverage and, if necessary, safe authoritative direct-field patch support.

Likely files:

- `crates/client/cache-wasm/src/shell.rs`;
- `crates/client/cache-core/src/predicate.rs` and `src/engine.rs` only for generic lifecycle capability;
- `crates/client/cache-turso` only if generic lifecycle support changes;
- normalized-cache exchange tests for query/subscription ordering;
- worker/WASM protocol tests as required.

No Soup-specific token or typename switch may be added to `cache-core` or `cache-turso`.

### Phase 5: Compile Documents predicates and switch authority

- Enable v2 compilation for subtype and attachment literals.
- Point browser entity filtering at v2.
- Ensure the production Documents preset requests become eligible.
- Verify a `SoupUpdated` ordinary document advances the revision and causes local list membership to recompute without another Soup HTTP query.
- Verify an attachment update appears only in Attachments and not Owned/Shared.
- Verify tasks/snippets remain excluded according to the active preset.

Likely files:

- `crates/item_filter_index/src/lib.rs` and tests;
- `crates/soup_filter_cache_adapter/src/lib.rs` and tests;
- `apps/web/src/lib/queries/soup/graphql/items.test.ts`;
- real WASM/browser cache tests.

### Phase 6: Backfill, rollout, and observability

- Compose supplements with direct response facts during backfill and preserve checkpoint safety.
- Add telemetry and rollout dashboards.
- Run old-client/new-server and new-client/old-server compatibility tests.
- Enable v2 locally only after real WASM/Turso tests and production-shape differential tests pass.
- Update `entity-filter-cache-index-plan.md` and `soup-flat-v1-support-manifest.md` with the v2 support contract and measured request-shape impact.

## Test matrix

### Authoritative semantics

- regular document supplement emits attachment `false`;
- `document_email`-linked document supplement emits attachment `true`;
- Projects, Chats, unsupported entities, and unenriched Documents emit no capsule;
- the capsule contains no subtype or other direct/membership/sort facts;
- null `subType` derives no subtype posting in browser composition;
- task, snippet, and skill `subType.__typename` values derive exactly one canonical subtype posting;
- composed projection membership equals authoritative PostgreSQL filtering for both Boolean attachment values and every supported subtype;
- relation insert is visible to hydration only after commit;
- deletion removes the normalized record and projection.

### Wire and validation

- composed SDL exposes nullable argument-free `cacheProjection` on `GraphqlSoupEntity` and every concrete implementor;
- composed SDL leaves `SoupPage` and `SoupUpdated` projection-free;
- `@cacheOnly` delivers capsules to cache hydration while omitting them from the Soup UI operation result;
- deterministic native/WASM single-entity supplement round trip;
- decoded API is a dedicated supplement type, not `IndexDocument`;
- unknown wire version;
- unknown target-profile version;
- oversized capsule/token/record key;
- complete composed document rejects duplicate or missing attachment facts;
- complete composed document rejects invalid subtype;
- capsule record key differs from the surrounding entity;
- partition/typename mismatch;
- corrupted base64/binary/JSON;
- null field for a supported entity that should carry the active profile;
- null field for unsupported entity variants;
- multiple entities in one page bind and commit independently.

Every malformed case must produce incomplete/network fallback without crashing the worker or exposing a partial local result.

### Cache lifecycle

- all entity records and composed supplement-backed replacements in one page commit in one revision;
- the `SoupUpdated.item` record and its composed supplement-backed replacement commit in one revision;
- storage fault leaves both old record and old facts intact;
- composed complete replacement removes stale facts;
- explicit deletion cascades facts;
- cache clear and the selected explicit v2 cutover mechanism remove v1 state;
- backfill reopen preserves v2 facts;
- optimistic patch preserves attachment state;
- uncertain optimistic create returns incomplete for attachment-dependent queries;
- mutation response before and after Soup update converges to complete v2 state;
- engine generation replacement clears revision authority as before.

### Compiler/reference/Turso conformance

- subtype and attachment literals under direct, `And`, `Or`, and `Not` shapes;
- Owned, Shared, Attachments, and All production filters;
- snippets enabled and disabled;
- ascending and descending Created/Updated sort;
- reference evaluator equals Turso;
- unsupported sibling literal causes whole-query fallback;
- no normalized record blob scan occurs during predicate execution;
- `EXPLAIN QUERY PLAN` uses exact-fact and sort indexes.

### Frontend and browser end to end

1. Establish a network-authoritative Owned Documents page at revision `R`.
2. Receive `SoupUpdated.item` for an ordinary owned document with complete direct fields and a valid v2-targeted supplement capsule.
3. Observe revision `R+1` and local authority reevaluation.
4. Assert the document appears without a new Soup HTTP execution.
5. Receive an email-attachment document and assert it appears in Attachments but not Owned/Shared.
6. Receive a task/snippet and assert Documents preset subtype rules remain exact.
7. Send malformed/missing capsule and assert stale data is retained while network fallback remains safe.
8. Repeat against the real WASM/Turso worker, not only mocked `entityFilter` results.

## Failure behavior

- **Server cannot derive its relation fact:** return no supplement for that Document and let the client mark attachment-dependent v2 composition incomplete.
- **Capsule absent:** canonical v2 document hydration marks the response record missing/incomplete; Projects and Chats require no capsule because all their facts are direct.
- **Capsule malformed or unsupported:** reject it, record bounded telemetry, and use network authority.
- **Projection/record mismatch:** reject the mismatched projection; never attach facts to a different normalized key.
- **Atomic storage failure:** retain the prior complete record/facts and surface normal cache degradation.
- **Realtime update missed:** the next canonical Soup page/backfill refresh rehydrates the projection; local facts are never server authorization authority.
- **Relation changes without an event:** this is a server invalidation bug; adding any future relation fact requires lifecycle-event coverage before enabling compiler support.
- **Mixed deployment:** absence of a mutually supported profile means network fallback, not v1 reinterpretation.

## Adding a future server fact

A future fact family should require only profile/adapter changes, not generic cache schema changes. Its implementation checklist is:

1. Document demonstrated query demand and authoritative semantics.
2. Identify whether the fact is direct, relation-backed, viewer-scoped, time-dependent, or authorization-sensitive.
3. Add only non-direct facts to the authorized Soup server-fact query without per-item N+1 access; direct GraphQL facts never enter the capsule.
4. Audit every mutation of the source data and ensure it emits an affected Soup update/deletion.
5. Add a stable vocabulary token and typed bounded supplement encoding.
6. Add server supplement generation, supplement binding validation, and separate complete client-profile validation.
7. Extend complete-query eligibility/compiler support.
8. Define optimistic patch/uncertainty semantics.
9. Bump the profile whenever old complete projections cannot safely answer the new predicate.
10. Add PostgreSQL/reference/Turso differential tests and realtime end-to-end coverage.
11. Measure payload, compile, persistence, and local-query costs before rollout.

Facts that are query-time dependent, authorization proofs, correlated multi-row values, or high-fanout relations require a separate design. The existence of the capsule is not permission to encode them approximately.

## Performance constraints

- No N+1 server relation queries.
- No normalized record blob scan for predicate filtering.
- Supplement compilation work is linear in returned hydrated Documents and constant-sized for capsule-v1.
- One capsule decode per hydrated Document and one atomic cache write per GraphQL operation emission.
- Per-capsule and aggregate per-emission decoded allocations are strictly bounded before persistence.
- Existing indexed `document_email(document_id, email_attachment_id)` lookup is used.
- Backfill throughput and websocket subscriber buffers must be measured with capsule payloads.
- Select the scalar with `@cacheOnly` so it never enters Soup UI query data; measure the cost if the existing normalizer also persists the opaque scalar on the entity record.

## Acceptance criteria

- `GraphqlSoupDocument` and `SoupDocument` do not expose `isEmailAttachment` or any other direct projected business fact; the only GraphQL addition is the generic opaque interface field.
- `GraphqlSoupEntity` owns nullable argument-free `cacheProjection`; `SoupPage`, `SoupUpdated`, and any synthetic per-item wrapper do not carry projection fields.
- The server derives attachment state from committed authoritative storage and emits a valid opaque v2-targeted supplement only for hydrated Documents returned by flat Soup pages and `SoupUpdated.item`; Projects, Chats, and unsupported entities emit no capsule.
- The capsule encodes only the attachment Boolean plus defensive wire/target-profile/record/partition bindings; it cannot decode to `IndexDocument`.
- The browser derives subtype and every other direct fact from the same GraphQL response, merges the supplement, and validates one complete v2 Document with exact subtype semantics and an explicit attachment Boolean.
- The composed complete projection and normalized entity write are atomic and install one cache revision.
- Production Documents Owned, Shared, Attachments, and All filter shapes are locally eligible under supported sorts unless another deferred filter is active.
- Complete direct fields plus a valid supplement on `SoupUpdated.item` cause the Files/Documents list to recompute membership without another Soup HTTP query.
- Ordinary documents, attachment documents, tasks, and snippets enter only the correct tabs.
- Missing or invalid capsules never produce approximate local membership.
- Optimistic writes preserve known server facts or return incomplete when they cannot.
- `cache-core` and `cache-turso` contain no Soup-specific vocabulary or relation logic.
- The server remains authorization/corpus authority and never trusts client-stored facts.
- Real PostgreSQL, reference evaluator, Turso, WASM, worker, and frontend tests cover the complete path.

## Verification

Follow repository test and SQLx rules. From the repository root, with `SQLX_OFFLINE` unset for tests:

```bash
cargo test -p soup
cargo test -p graphql_soup
cargo test -p complete_graph
cargo test -p predicate-index
cargo test -p item-filter-index
cargo test -p soup-filter-projection
cargo test -p soup-filter-cache-adapter
cargo test -p cache-core
cargo test -p cache-turso
cargo test -p cache-wasm
```

Regenerate and verify GraphQL artifacts using the repository's documented commands. If Rust SQLx queries change, initialize the required local database and run root-level:

```bash
nix develop --command just prepare_db
```

Do not manually edit `.sqlx/query-*.json`, do not create an application database migration for the existing `document_email` relation, and do not run migrations without explicit user approval.

Run focused frontend tests for GraphQL AST compilation, Soup query authority, websocket write-through, backfill, and the real WASM/Turso browser path. Add `EXPLAIN` assertions for the relation existence lookup and local exact-fact query plans.

After each successful implementation verification step, follow repository policy with `jj desc -m "..." && jj new`.
