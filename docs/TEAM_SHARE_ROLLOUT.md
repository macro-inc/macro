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
2. Before the writer cutover, temporarily suspend conflicting share, membership/
   team-deletion, ownership/email-link, call archive, and project-topology mutations
   wherever all participants cannot be upgraded together. Drain in-flight work.
   Complete and coordinate deployment of canonical writers, readers, owner checks,
   inheritance, and lifecycle handling. Retire the old document/call/task writers
   and upgrade or disable the seed writers listed above. Drain old processes/jobs:
   concurrent old writers do not honor the guard. Keep seed/scenario and external
   grant writers disabled until audited.
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

6. Retain dry-run, apply, and verification reports with the deployment record. Resolve
   or explicitly disposition every review finding. Resume suspended mutations only
   after the verification gates below pass. Monitor guard wait time, transaction
   failures, permission conflicts, and access regressions after resumption.

The generated down migration removes only these columns/constraints, not grants;
do not use it after canonical writers are enabled, because it discards revocation
attribution. If rollout fails, stop reconciliation and conflicting mutations, retain
canonical state, and roll forward with upgraded writers. Do not redeploy legacy
writers or reset revisions as a rollback strategy.

## Reconciliation command

`reconcile_team_sharing` is an operator-only CLI; it does not start the application,
contact remote services, publish events, or run automatically at deployment. It
loads the existing `DATABASE_URL` through `macro_env_var`. Select the database
explicitly in the operator's environment; do not put credentials in command history
or reports. Builders must use **disposable local fixtures only**, never remote data.

From the repository root (inside the pinned Nix shell):

```bash
cargo run -p document_storage_service --bin reconcile_team_sharing -- --help
# No --apply: inspect at most 100 roots, with no persisted writes.
cargo run -p document_storage_service --bin reconcile_team_sharing
# Resume after the exact resume_after value printed by the preceding batch.
cargo run -p document_storage_service --bin reconcile_team_sharing -- \
  --batch-size 100 --after 'document/20000000-0000-0000-0000-000000000002'
```

The cursor is an exclusive, byte-ordered `type/UUID` key, not an offset. Each
invocation processes one batch (1–1000 roots), with short per-root transactions.
Continue until `end_of_scan=true`. Retain each complete report before recording its
`resume_after` checkpoint. On failure or lost output, replay from the last retained
checkpoint: committed repairs are idempotent. A full batch may require one final
empty invocation. A resumed scan is not a stable database snapshot; restart from
an empty cursor for final verification and to discover concurrent inserts behind
the cursor. Do not reuse an apply checkpoint for a new verification pass.

### Evidence and classification

The scan covers documents (including tasks/snippets), projects, chats, calls, and
email threads, plus orphan direct-team grants for these kinds. It does not use
`linkShare = TEAM` or inherited grants as evidence. Missing entities/permissions
are reported, not lazily created. Classification and writes are separate; apply
reloads all evidence under the shared READ COMMITTED guard and skips changed facts.

| Finding | Operator action / automatic behavior |
| --- | --- |
| `UnknownDirectGrant` | Preserved. A same-team grant alone does not prove managed provenance. Projects/chats/threads are never historically adopted by this tool. |
| `ManagedDocumentCandidate` | Requires `--reviewed-document UUID`, a single direct grant for the sole extant current owner team, valid owner/permission facts, and NULL canonical state at revision zero. Adopt the **actual** View/Comment/Edit level. |
| `ManagedCallCandidate` | Same grant/state requirements; all extant active/archived flags must be true and creator/permission evidence consistent. Adopt the actual level, not a View override. |
| `LegacyCallMissingGrant` | Only revision-zero NULL calls with consistently true flags, consistent ownership/permission rows, exactly one extant current owner team, and **no direct team grants** qualify. Repair at View under the approved automatic-call policy, then canonically adopt in the same transaction. |
| `OwnerGrant`, `StaleTeamGrant` | Preserved for review, never downgraded, adopted, or deleted. Stale includes deleted teams and grants not matching current membership. Multiple grants block historical adoption/automatic call repair. |
| `CallFlagDisagreement` | Review only: mismatched active/archive flags, false flags with grants/consent, or true flags after a newer clear. This tool does not rewrite compatibility flags. |
| `ProtectedRevision` | A nonzero NULL state is a newer clear, not an uninitialized row. Never resurrect it, even if an operator supplies a reviewed document ID. |
| `CanonicalGrantMismatch` | Restore the exact existing canonical grant only with unchanged facts, unambiguous current membership, and no conflicting Owner-level grant/call flags. Preserve the canonical level/team/revision. Project grant repair also synchronizes its attributed descendants. |
| `CanonicalVerified` | The managed team and exact direct level match. Extra unknown/stale grants and flag disagreements are still reported separately; this finding alone is not rollout approval. |
| `StaleCanonicalTeam`, `AmbiguousOwnerTeam`, `MissingOrInvalidFacts` | Operator review; do not infer new consent or delete unexplained rows. Missing/ambiguous membership and soft-deleted roots cannot gain new grants. |

Document review is deliberately explicit because historical runtime and seed writers
share the same row shape: the database has no reliable per-writer provenance marker.
Before supplying an ID, establish historical document/task managed-writer provenance
from audited deployment/seed history or retained audit evidence. Current membership,
link sharing, access level alone, or a document's task subtype are insufficient.
Record the reviewed ID list and evidence in the change ticket. If evidence cannot
be established, leave the grant unknown and seek owner/operator resolution. Do not
bulk mark every same-team grant as reviewed.

Dry-run the exact reviewed list, then explicitly apply it after approval:

```bash
cargo run -p document_storage_service --bin reconcile_team_sharing -- \
  --reviewed-document 20000000-0000-0000-0000-000000000002
cargo run -p document_storage_service --bin reconcile_team_sharing -- \
  --apply --reviewed-document 20000000-0000-0000-0000-000000000002
```

Repeat reviewed IDs as needed and retain the same list while paging. Review findings
are not fatal process errors: inspect `findings` and `action` on every root.
`applied=true` means the transaction committed and verified both the canonical setting
and its exact managed direct grant. `changed_since_review=true` means no repair was
committed for that root; rescan it rather than skipping it permanently. Each apply
reclassifies current evidence; a previous dry-run is not a durable authorization.
Adoption advances revision zero to one. Canonical grant-only repair preserves the
revision because it restores unchanged consent rather than supplying a user edit.
No grant repair overwrites a newer canonical update: all writers must hold the guard.

## Verification and completion gates

1. On a disposable local database, save a data dump, run without `--apply`, and
   compare the data afterward. There must be no persisted row changes, including
   permission associations, compatibility flags, grants, and revisions.
2. Apply the reviewed fixture batch twice. The second pass must report `repairs=0`.
   Check the actual levels, not just the count. Reconciliation tests cover these
   invariants and inherited/link-team exclusion.
3. After operational apply, rescan **all batches from the beginning**, without
   `--apply`. Every canonical root must have its expected exact grant; every adopted
   managed grant must have the matching setting. Require no remaining repair actions
   and disposition all unknown/stale/Owner/flag/invalid-state findings. A zero repair
   count alone does not prove all findings were resolved.
4. Separately audit orphan `SharePermission` rows and permission associations, which
   may have no authoritative root to scan; do not manufacture entities to adopt them.
   Validate project descendant attribution/inheritance, fresh REST/GraphQL reads,
   access enforcement, lifecycle revocation, and revision-safe compensation. The CLI
   verifies direct root grants, not an exhaustive project topology/access audit.
5. Refresh/reload affected clients and invalidate relevant application caches through
   approved operational procedures before resumption; the CLI intentionally emits no
   application events. Resume only coordinated canonical writers, then monitor.

Developer checks (leave `SQLX_OFFLINE` unset for tests):

```bash
cargo test -p document_storage_service team_share_reconciliation
cargo run -p document_storage_service --bin reconcile_team_sharing -- --help
nix develop --command just prepare_db
```
