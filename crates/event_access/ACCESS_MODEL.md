# Event access model

Who receives which Macro events outside Macro (live streams and webhooks,
through the public API and the SDK), why, and how a crate exposes its events.
Every claim below names the code that makes it true; when the two disagree,
the code wins and this file is stale.

## The contract

Every broker event declares its access by implementing
[`EventAccess`](src/lib.rs) (`crates/event_access/src/lib.rs`):

```rust
pub trait EventAccess {
    type PublicPayload: Serialize + Clone;
    fn access(&self) -> Result<Access<'_, Self::PublicPayload>, AccessError>;
}
```

- `macro_event_broker::TopicEvent` requires it as a supertrait
  (`crates/macro_event_broker/src/domain/models.rs`), so a topic event that
  does not declare its access does not compile. There is no default.
- `access()` matches every variant with no wildcard arm (ast-grep
  `rust-access-no-wildcard-arm`), so a new variant must be classified.
- It is pure: it reads only the event. It names *whose* access counts; it
  never looks access up.
- It answers one of two things:
  - `Access::Internal { reason }`: the event never leaves Macro. The reason
    says why it is internal by design (plumbing, a projection of other
    events, a protocol that must not become API) or what is missing before
    it could be public (such as an audience the payload lacks).
  - `Access::Public(PublicEvent { name, entity, audience, stage, payload })`:
    the public event name (also the payload's `event_type` tag), the entity
    it is about (its id is the ordering key and what `ids` filters match),
    the [`Audience`](#audiences), the rollout [`Stage`](#preview-stage), and
    the public payload.
- Nothing leaves Macro unless an event says `Public`. Both deliveries read
  the declaration through one function, `normalize`
  (`crates/event_stream/src/domain/normalize.rs`), and drop a public event
  whose name is not registered in the catalog.
- `AccessError` means the event broke a contract its access relies on (a
  malformed id, a private event with no recipient). Retrying cannot fix it;
  delivery logs and skips the event.

## Who can receive anything

No event is broadcast to all users: there is no "everyone" audience, and
every delivery resolves the declared audience against current access when it
delivers. Subscribers are:

- **Live streams** (`GET /events/stream`): held by a principal, a user's own
  credential, a bot acting as a user, an account manager or a harness
  runtime acting for a user (`crates/event_stream/src/domain/models.rs`,
  `PrincipalKind`). A stream is personal-scoped or team-scoped. A filter
  match (including `*`) only selects candidate streams; each candidate is
  then admitted by `AudienceResolver::admits`
  (`crates/event_stream/src/domain/access.rs`).
- **Webhooks**: each belongs to a workspace, a user's personal workspace
  (the user id) or a team's (the team id). Ingestion turns the audience into
  workspace ids and only webhooks in those workspaces match
  (`resolve_audience_and_enqueue` in `crates/webhook/src/domain/ingestion.rs`).

A lookup that cannot answer (an unsupported entity type) admits nobody
(`crates/event_stream/src/domain/access.rs`), and a resolution error drops
that event for those subscribers without closing their streams
(`crates/event_stream/src/domain/fan_out.rs`).

### Link-share viewers are excluded

Entity audiences mean explicit accessors only: the owner, direct grants,
active channel participants, team grants and project inheritance through
`entity_access`. Someone who can open an entity only through a share link
is never in its audience (`EntityAccessService::is_accessor` and
`get_users_by_entity_uncached` in `crates/entity_access/src/domain/ports.rs`;
`crates/event_stream/src/outbound/entity_access.rs`).

## Audiences

`Audience` (`crates/event_access/src/lib.rs`) says whose current access
decides delivery. Only the first two classes are entity-access checks; the
rest are decided by team membership, the contact graph, a GitHub claim, or
users named in the event.

| Audience | Decided by | Entity-access check? | Live streams admit | Webhooks match |
| --- | --- | --- | --- | --- |
| `Entity { entity_type, entity_id }` | the entity's explicit accessors (`entity_access`) | **Yes** | a stream whose user is an accessor, any scope | the accessors' personal workspaces, and the workspaces of teams that hold access themselves ([Team webhooks](#team-webhooks)) |
| `EntityAtLeast { .., min_level }` | explicit accessors at or above `comment`, `edit` or `owner` | **Yes** | a stream whose user's level is at least the floor | those accessors' personal workspaces, and teams granted at or above the floor |
| `Team { team_id, min_role }` | `team_user` membership and role | No: team membership | a stream whose user is a member (or admin) of the team | `member`: the team workspace; `admin`: each current admin's personal workspace |
| `TeamsOf { user_id }` | the user's teams | No: team membership | team-scoped streams whose holder's workspace (their most privileged team) is one of the user's teams | the user's personal workspace |
| `ContactsOf { user_id }` | the user and their contact graph | No: contacts | personal streams of the user and of each contact | the user's personal workspace (webhooks cannot enumerate contacts) |
| `GithubInstallation { installation_id }` | a claim on the installation (`has_claim`, the rule routines use) | No: GitHub claim | a stream whose user holds a claim | claimants' personal workspaces (no team expansion), and owning teams' workspaces when the webhook's creator holds a claim |
| `Recipient { user_id }` | the one user named in the event | No: explicit user | that user's personal streams; on flagged streams a bot only if the user owns it | that user's personal workspace only |
| `Owner { user_id }` | the owning user named in the event | No: explicit user | as `Recipient` | the owner's personal workspace |
| `Snapshot { user_ids }` | users the producer captured (grants already gone) | No: explicit users | those users' personal streams, bots acting for them included | each user's personal workspace |
| `Person { user_id }` | the user named in the event | No: explicit user | that user's own streams, any scope | never (live streams only) |
| `Workspace { workspace_id }` | one webhook workspace | No: workspace | the stream whose workspace it is (personal: its user; team-scoped: its holder's most privileged team) | that workspace |
| `Any([..])` | union | as its members | if any member admits | the union of its members |

Code: streams `AudienceResolver::admits` in
`crates/event_stream/src/domain/access.rs`; webhooks
`resolve_audience_and_enqueue` in `crates/webhook/src/domain/ingestion.rs`
(`teams_with_access` for team workspaces).

On flagged streams, webhook, bot and API key lifecycle events reach only the
account holder (their own credential, a bot they own, or a harness runtime
acting for them; `is_account_holder` in
`crates/event_stream/src/domain/models.rs`; `ACCOUNT_HOLDER_FAMILIES` in
`crates/event_stream/src/domain/catalog.rs`, `eligible` in
`crates/event_stream/src/domain/registry.rs`).

### Team webhooks

A team workspace's webhooks receive an event only when the team itself is in
the audience, never because one of its members is:

- an `Entity` or `EntityAtLeast` event, when the team holds access to the
  entity as a team (`EntityTeamAccess::get_teams_by_entity` in
  `crates/entity_access/src/domain/ports.rs`, read uncached by
  `teams_with_access` in `crates/webhook/src/domain/ingestion.rs`):
  - the entity carries a `team` grant for the team, or a grant to a channel
    the team owns (a team channel), including grants inherited from a project
    (`queries/entity_teams.rs` in `crates/entity_access`); under an access
    floor, only grants at or above it count;
  - a channel event, when it is the team's own channel; a call, when it
    belongs to such a channel;
  - a CRM company or contact the team owns, or a CRM pipeline granted to
    it, while some member may see it;
- a `Team { member }` event for that team, a `Workspace` event naming it, or
  a GitHub installation it owns (gated on the webhook creator's claim).

A team workspace's webhook delivers to whatever endpoint its creator set, so
two more checks apply to the creator, per event, after matching
(`crates/webhook/src/domain/ingestion.rs`):

- **Membership.** It is admitted only while its creator is a current member
  of the team (`creator_member_gated`, through `TeamDirectory::members`).
  Without a team directory, team webhooks receive nothing.
- **CRM access.** A team workspace reached through a CRM company, contact or
  pipeline admits the webhook only when its creator may see that record as
  a member of the team (`crm_gated`, through
  `EntityTeamAccess::get_team_crm_viewers`): CRM access (`crm_access`, or a
  role above member) and, for a hidden company or contact (or a contact of a
  hidden company), an admin or owner role, the rule `crm_entity_users` and
  `crm_company_access` apply. Not every member of a team may see its CRM
  records.

So a member's private DM, a document shared with the member alone, or the
member's own agent sessions reach the member's personal workspace and no team
workspace. `Owner`, `TeamsOf` and `ContactsOf` reach the named user's
personal workspace only. Revoking the team's grant stops delivery to the team
workspace from the next event, since the lookup is uncached.

Live streams are unchanged: a team-scoped stream authenticates as one user
and is admitted on that user's access.

## Preview stage

A public event is `Stage::Stable` or `Stage::Preview`. Preview events reach
only holders of the `public-event-stream` feature flag: on streams, the
stream's user (`eligible` in `crates/event_stream/src/domain/registry.rs`);
on webhooks, the webhook's creator (`admitted_webhooks` in
`crates/webhook/src/domain/ingestion.rs`). The flag also gates cursors,
replay and family wildcards (`document.*`) on streams, and wildcard matches
on webhooks. New families ship `Preview` and flip to `Stable` in a later
change.

## When someone loses access

- **Live streams** cache each looked-up fact (accessor sets, exact and
  at-least-level checks, team members, a user's teams, contacts, GitHub claims) for 5 s
  (`ACCESS_CACHE_TTL` in `crates/event_stream/src/domain/access.rs`). The
  access adapters themselves do not cache. Events that change access
  (sharing, participants, team membership) evict the affected facts before
  anything after them is delivered
  (`crates/event_stream/src/domain/invalidations.rs`,
  `AccessCaches::invalidate`), so staleness is at most 5 s and none after a
  logged revocation. Replaying from a cursor re-resolves each event's
  audience at replay time (`replayable` in
  `crates/event_stream/src/domain/stream.rs`). A bot deletion closes the bot's
  streams as `revoked` (`crates/event_stream/src/domain/fan_out.rs`), and every stream re-validates its credential every 60 s.
- **Webhooks** resolve the audience uncached for every event
  (`users_with_access` and `teams_with_access` in
  `crates/webhook/src/domain/ingestion.rs`): a grant or revocation committed
  before the event is consumed counts. For a team workspace's webhook, the
  creator's membership and, for CRM records, CRM access are read per event
  too: a creator removed from the team, or whose CRM access is turned off,
  stops receiving from the next event, on every topic.
- An event about an entity whose grants are deleted with it cannot reach
  anyone through `Entity`; the producer captures the audience first
  (`Snapshot`) or the event stays internal with a reason saying so
  (`document.purged`, `database.purged`, `form.purged`).

## Exposing a crate's events

### 1. Implement `EventAccess`

Implement `EventAccess` in your crate's `events.rs` (usually
`src/domain/events.rs`), the one place a crate declares who receives its
events outside Macro: the impl, its public projection types and any helper
they use, even when the topic enum lives elsewhere (`broker.rs`). ast-grep
`rust-event-access-in-events-rs` rejects an impl in any other file. An
illustrative `widget` family follows; copy a real one such as
`crates/teams/src/domain/events.rs`:

```rust
impl EventAccess for WidgetTopicEvent {
    type PublicPayload = WidgetPublicEvent;

    fn access(&self) -> Result<Access<'_, Self::PublicPayload>, AccessError> {
        let (name, widget_id, payload) = match self {
            Self::Created(m) => ("widget.created", m.widget_id, WidgetPublicEvent::Created(m.into())),
            Self::Renamed(m) => ("widget.renamed", m.widget_id, WidgetPublicEvent::Renamed(m.into())),
            Self::CacheRefreshed(_) => {
                return Ok(Access::Internal { reason: "cache plumbing, not a fact" });
            }
        };
        Ok(Access::Public(PublicEvent {
            name,
            entity: EntityRef::new(EntityType::Widget, widget_id.to_string()),
            audience: Audience::Entity { entity_type: EntityType::Widget, entity_id: widget_id.to_string() },
            stage: Stage::Preview,
            payload: Cow::Owned(payload),
        }))
    }
}
```

Import the vocabulary from `macro_event_broker::access`, so the crate needs no
extra dependency. A topic with nothing public sets
`type PublicPayload = Unexposed`.

### 2. Choose an audience

Ask, in order:

1. Is it about an entity people are granted access to (document, channel,
   project, chat, database, form, call)? `Entity`. Only some levels should
   see it (form responses for editors)? `EntityAtLeast`.
2. Is it personal data (mail, calendar, notifications, activity, a user's
   own bots or property definitions)? `Recipient`, which says it is
   addressed to that one user.
3. Is it about a team itself (settings, members, team bots)? `Team` with
   `member`, or `admin` when it carries an invitee's email or similar.
4. Are the people who should hear it gone from the grants by the time the
   event is consumed (removed members, deleted entities)? Capture them in the
   producer and add `Snapshot`, usually inside `Any` with the live audience.
5. Is it a GitHub App delivery? `GithubInstallation`. A webhook's own
   lifecycle? `Workspace`.
6. None of these fits, or the payload cannot name the audience? Keep it
   `Internal` and say what is missing.

`Owner`, `TeamsOf`, `ContactsOf` and `Person` exist for events that shipped
with those semantics; reuse them only when the behaviour in the table is the
one you want.

### 3. Write the thin projection

The payload is an explicit projection, not the internal metadata: ids, the
actor, what changed. Routing fields (recipients, snapshots) go on the
audience and never into the payload. It derives `utoipa::ToSchema` behind the
crate's `schema` (or `inbound`) feature so it joins the OpenAPI event union. Never add
secrets, tokens or header values.

### 4. Register the family

- Add its block (topic enum, public payload, each event's entity types,
  audience classes and stage) to `public_event_registry!` in
  `crates/event_stream/src/domain/catalog.rs`. That one registration feeds
  the catalog endpoint, wildcard expansion and the OpenAPI `WebhookEvent`
  union (webhook management and the agent-runtime contract are listed
  `outside_union`).
- Move its topic out of `INTERNAL_TOPICS` into both `declare_topics!` lists
  in `crates/event_stream/src/topics.rs`, and add its
  `ingest_public_event` arm in `crates/webhook/src/inbound/kafka_consumer.rs`.
  The ingestion group starts a new topic at `Latest`.
- Enable the crate's schema feature in `event_stream`'s `schema` feature.
- An event that changes access returns its `Invalidation` in
  `crates/event_stream/src/domain/invalidations.rs`. An internal topic whose
  events only change access goes in `ACCESS_CHANGE_TOPICS` and
  `LogMacroEvent` (`crates/event_stream/src/topics.rs`).
- Regenerate the clients (`bun run gen-api cloud-storage` in `apps/web`, then
  `bun run sync-specs && bun run generate` in `packages/sdk`) and hydrate the
  family in the SDK (`packages/sdk/src/events/hydrate/`, routed from
  `src/events/receiver.ts`; see the `add-sdk-endpoint` skill), and add its
  row to `crates/webhook/README.md`.

### 5. Tests to add

- **Public body**: a JSON-literal test of each public payload, the wire
  contract (for example `every_variant_declares_its_audience_and_thin_public_body`
  in `crates/teams/src/domain/events/test.rs`).
- **Audience per variant**: assert each variant's `access()`, public or
  internal, and its audience, in the producer's tests.
- **Registry consistency**: add a sample of every event type to
  `crates/event_stream/src/domain/catalog/access_samples.json`, or list an
  always-internal type in `ALWAYS_INTERNAL`;
  `the_registry_matches_every_producers_access` in
  `crates/event_stream/src/domain/catalog/test.rs` checks the registry
  against every producer's `access()`.
- **Topic coverage**: `every_topic_is_delivered_or_listed_internal` in
  `crates/event_stream/src/topics/test.rs` fails until a new topic is either
  delivered or listed internal.
