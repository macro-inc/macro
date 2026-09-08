# Explicit team sharing: writer contract and rollout

## Status and schema

This document defines the target contract; the additive migration alone does not
upgrade writers or reconcile grants. Do not deploy intermediate feature commits
as a completed rollout.

`SharePermission` gains:

| Column | Type/default | Meaning |
| --- | --- | --- |
| `team_share_access_level` | nullable `"AccessLevel"`, default NULL | Explicit consent: `view`, `comment`, or `edit`; never `owner`. |
| `team_share_team_id` | nullable `UUID`, default NULL | Internal attribution to the team whose direct grant is managed. |
| `team_share_revision` | `BIGINT NOT NULL DEFAULT 0` | Internal, nonnegative concurrency/compensation version. |

The level and managed team must be jointly NULL or jointly non-NULL. Existing
rows receive NULL/NULL/0. The migration neither backfills consent nor inserts,
changes, or deletes `entity_access` grants. The team ID intentionally has no
cascading foreign key: revocation needs the recorded team even after membership
changes, and team deletion must clear consent and grants together.

Only the level is public. Do not expose managed-team IDs or revisions in REST,
GraphQL, generated clients, or sharing indicators. Inherited access and team link
sharing are not explicit team consent.

## Current writer audit

Repository source was inspected for `entity_access` inserts/upserts/deletes,
`EntityAccessSourceType::Team`, and callers of generic grant helpers. This is a
source audit, not a claim about deployed binaries, external scripts, or production
data.

| Current path | Behavior to retire or consolidate |
| --- | --- |
| `crates/documents/src/outbound/pg_document_repo/share.rs::share_with_team` | Inserts a direct document team grant at Comment, ignoring conflicts. |
| Same file, `set_team_share` | Upserts Edit or deletes the owner's current team's direct grant; does not record consent or historical attribution. |
| `crates/documents/src/domain/create.rs` → `domain/service.rs::handle_task_properties` → repository `share_with_team` | Task creation shares after document creation, best-effort, using the supplied team ID. Replace with atomic Comment initialization using persisted owner membership. |
| `crates/call/src/outbound/pg_call_repo/edit.rs::set_share_with_team` | Updates active/archived flags, inserts View ignoring conflicts, or deletes the creator's current team's direct grant. |
| `crates/call/src/outbound/pg_call_repo.rs::archive_call` | Uses `insert_entity_access_row` to grant the creator's current team View when the legacy flag is true. Must preserve canonical state instead of creating new consent on archive. |
| Same file, `toggle_share_with_team` and `create_call` | Toggle only the active flag or create the initial permission/owner/channel grants; these paths must also adopt canonical state rather than rely on archive-time sharing. |
| `tooling/seed_cli/src/service/db.rs::insert_call_record` | Additional independent direct-team caller of `insert_entity_access_row`: seeds archived calls with View when a team is supplied. |
| Same file, `upsert_entity_access`, called by `tooling/seed_cli/src/entity/scenario/apply.rs::apply_access_rows` | Additional generic seed writer: scenario team shares and task Comment sharing can create direct grants without canonical bookkeeping. `share_to_row` accepts team targets. |

The audit **does not confirm the assumption that no additional independent
callers exist**: the seed writers above are real exceptions. They must be upgraded
or disabled for canonical entities before exclusive ownership of direct-team rows
can be asserted. Keep intentional legacy/unknown-grant fixtures isolated from
normal canonical seeding. Updating seed code is follow-up work, not part of this
schema migration.

No other independent runtime direct-team caller was found in the inspected
repository. Other `insert_entity_access_row` callers create user-owner or channel
grants. `upsert_user_entity_access_bulk` and mention sharing write user grants;
`update_entity_access_channel_share_permissions` writes channel grants.
`crates/entity_access_management/src/outbound/pg_repo.rs` copies project grants
with `granted_from_project_id` set: those are inherited contributions, not direct
consent. It must participate in the topology/locking protocol below.

## Authoritative ownership and authorization

| Entity | Persisted owner source |
| --- | --- |
| Document, task, snippet | `"Document".owner` |
| Project | `"Project"."userId"` |
| Chat | `"Chat"."userId"` |
| Active / archived call | `calls.created_by` / `call_records.created_by` |
| Email thread | `email_threads.link_id = email_links.id` → `email_links.macro_id` |

Compare `receipt.acting_user_id()` with this persisted owner, not an effective
Owner grant, project owner, channel member, or an email alias/link-access mapping.
Domain services validate supplied operations and produce commands carrying the
expected owner, team, and canonical state/revision. HTTP and GraphQL adapters
forward verified receipts; SQL adapters recheck facts, not invent authorization.
Maintenance and creation use separate internal contracts, not fabricated owner
receipts.

## Common transaction protocol

Reserve one database-wide transaction-scoped advisory guard for this feature:

```sql
SELECT pg_advisory_xact_lock(1413824845, 1);
```

The first integer identifies the `TEAM` namespace; the second is protocol version
1. Every participant must use this exact two-integer key on the same database.
Do not substitute per-entity locks or session-scoped locks. This is deliberately
conservative; measure contention before changing granularity.

1. Begin the transaction and acquire the guard **before row locks or mutations**.
   Take it for canonical sharing, reconciliation, owner membership changes
   (including removal and compensation), team deletion, ownership/email-link changes,
   call creation/archive/toggle, and project-topology changes (including
   creation, copy, move, and restore) that affect inherited access.
2. Read authoritative owner, current membership, canonical state/revision, and
   relevant topology under the guard. Reject missing entities or stale command
   facts with distinct typed conflicts before writes. Use fresh reads after
   acquiring the guard; do not reuse a pre-lock snapshot as authorization.
3. Mutate the permission row and its managed direct grant in the same transaction.
   A direct grant has `source_type = 'team'` and
   `granted_from_project_id IS NULL`, keyed by entity ID/type and team source ID.
   Set the exact requested level, including downgrades. Clear only the grant
   identified by the previously recorded managed team, not current membership.
4. Increment the revision on every supplied operation, including same-value
   updates, repeated legacy true, and repeated explicit clears. Omission changes
   neither canonical state, grants, nor revision. Do not reset revisions during
   cleanup or reuse stale compensation snapshots.
5. For shared projects, synchronize descendants in this transaction, attributing
   each contribution to its sharing root via `granted_from_project_id`. Preserve
   direct descendant shares and other roots' contributions. Commit accompanying
   metadata/topology changes atomically; helpers never commit their caller's
   transaction. Publish events/invalidation only after commit.

Lifecycle cleanup clears canonical state and attributable grants even when the
owner no longer has a membership row. Compensation snapshots contain root entity,
managed team, level, and revision; restore only unchanged eligible snapshots and
rebuild inheritance from current topology. Joining a different team never reshares
old items automatically.

### Unknown historical grants

An untracked direct-team row is not permission to adopt or delete it, even if its
team and level match a new request. Reject a conflicting write atomically with a
typed unknown-grant conflict; leave consent, grants, revision, and accompanying
metadata unchanged. Clearing NULL state can succeed and advance the revision
without deleting unexplained rows. Never infer explicit consent from an inherited
row or remove unrelated direct grants. A separate guarded reconciliation adoption
operation may attribute a reviewed historical grant; normal writes must not do so.

### Creation and compatibility

- Ordinary documents, snippets, projects, chats, threads, imports, and copies
  initialize NULL consent; inherited grants do not change that. Copies never copy
  canonical consent or internal bookkeeping from their source.
- Explicit task sharing initializes Comment and its grant atomically.
- **Call-creation exception:** a new call initializes View, its managed grant, and
  the compatibility flag atomically when its persisted creator has a team.
  Otherwise initialize NULL/NULL and `share_with_team = false`. Archiving must
  not grant access to a team joined later or resurrect a revoked share.
- Explicit enable without an owner team fails; an owner-checked clear succeeds.
  Owner access level is invalid. Omitted REST input preserves state; explicit
  NULL clears it. GraphQL must preserve undefined/null/value separately.
- Legacy document enable defaults to Edit and call enable to View only when
  currently unshared. Repeated true preserves the chosen level. Contradictory
  legacy and explicit inputs fail before any writes. Every supplied toggle or
  explicit operation, including repeated clears, requires actual ownership.

## Rollout gates

1. Apply the additive migration. Leave legacy grants untouched and existing
   canonical state NULL/NULL/0; this is not a backfill.
2. Complete and coordinate deployment of canonical writers, readers, owner
   checks, inheritance, and lifecycle handling. Retire the old document/call/task
   writers and upgrade or disable the seed writers listed above. Drain old
   processes/jobs: concurrent old writers do not honor the guard.
3. Before reconciliation, audit all direct-team sources again, including external
   scripts. Do not reserve exclusive canonical ownership while any independent
   writer remains active. Do not deploy intermediate feature commits as a mixed
   writer rollout.
4. Run reconciliation in dry-run mode first. Classify attributable candidates
   separately from unknown or conflicting grants; operators must review the
   latter. Apply only through guarded, conditional, idempotent operations after
   writer retirement. Never blindly adopt or delete ambiguous historical rows.
5. Verify NULL/level reads, exact grant levels, project attribution, lifecycle
   revocation, and revision-safe compensation before declaring rollout complete.
   Production reconciliation is an explicit operator action; this migration
   performs no remote data maintenance.

Detailed reconciliation commands and operational validation belong in the
reconciliation implementation's update to this document. The generated down
migration removes only these columns/constraints, not grants; do not use it after
canonical writers are enabled, because it discards revocation attribution.
