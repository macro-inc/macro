# notification_routing

## What it is

Part of Notifications: notification stacks, a person's own rules for routing a
notification into a lane before it is delivered. A stack captures what its
capture rules match and files it in its lane (noise only for now), except what
its release rules let through.

## How it works

`notification` calls `StackRouter` at ingress, after recipient filtering. The
router loads the recipients' enabled stacks in one query, reads the payload as
a `NotifEvent`, and for each recipient tries their stacks in position order:
the first with a matching capture rule takes the notification, then its
release rules decide between captured and released. `notification` stores the
answer on the recipient row and delivers by it.

## Start here

- `src/domain/evaluate.rs`: the pure evaluator. `Conversation::of` decides
  which notification kinds stacks can capture and what the rules can ask about
  them; `route` and `StackRule::matches` are the whole rule semantics.
- `src/domain/models.rs`: `NotificationStack`, `StackRule`, `StackSource`,
  `StackKind`, the `RoutingRecord` stored in `user_notification.routing`, and
  the limits.
- `src/domain/router.rs`: `StackRouter`, the `NotificationRouter` implementation.
- `src/domain/service.rs`: create, edit, delete and reorder, with validation.
- `src/outbound/pg_stack_repo.rs`, `src/outbound/pg_document_placements.rs`
  (feature `postgres`), `src/inbound/axum_router.rs` (feature `inbound`).

## Scope

- Owns: the `notification_stack` table, the rule grammar, routing decisions.
- Not here: storing the route, and delivering by lane → `crates/notification`;
  lane-aware readers → each reader's crate; the lane enum →
  `crates/notification_state`.

## Boundaries

- Depends on: `notification` (the `NotificationRouter` port and route types),
  `model_notifications` (`NotifEvent`), `feature_flags`, `system_properties`
  (a task's project, feature `postgres`).
- Used by: `services/notification_service`.

## Recipes

- Let stacks capture another notification kind: an arm in `Conversation::of`
  → a case in `evaluate/test.rs`. The match is exhaustive on purpose: a new
  `NotifEvent` variant does not compile until it is placed.
- Add a rule condition: a field on `StackRule` (with `#[serde(default)]`,
  stored rules lack it) → `StackRule::matches` and `sets_a_condition` → its
  limit in `valid_rule` (`service.rs`) → `evaluate/test.rs`.
- Add a source: a `StackSource` variant → `StackSource::matches` →
  `valid_source`. If matching needs a lookup, extend `DocumentPlacement` and
  `needs_placement`, never a query per recipient.

## Checks

- `cargo test -p notification_routing --all-features` (`SQLX_OFFLINE` unset;
  needs local MacroDB).

## Gotchas

- Routing fails open. A router error, an unreadable flag, an unreadable
  payload and a missing stack all leave the recipient the natural row, so a
  failure costs noise and never a missed signal. Keep it that way.
- Rules are stored as JSON and read on every routed notification: a rule field
  or variant can be added but never renamed or removed without a migration, or
  every stack of that owner stops routing.
- An empty condition means "not set", so a rule with no condition would match
  everything. The service refuses one, and empty channel name text, for both
  capture and release.
- A channel name comes from the notification payload and a direct message's
  name depends on who reads it, so name text never matches a direct message.
- `StackKind::Reply` is "replies in my threads": a reply notification is only
  sent to the thread's participants.
- The flag (`NOTIFICATION_STACKS_FLAG`, the web's key too) is read at ingress
  only for a recipient a stack would route for, and on every service call.
  Each read is a request to the flag provider; there is no cache.
- Editing or deleting a stack never re-routes stored notifications, and
  `user_notification.stack_id` has no foreign key: a deleted stack's captures
  stay in noise.
- The folder walk in `pg_document_placements.rs` reads `"Document"` and
  `"Project"` directly, read-only and depth-bounded, because no domain API
  returns a document's ancestor folders.

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/observability.md`
- Skills: `cloud-storage-hexagonal-architecture`, `feature-flags`
- Docs: `docs/guides/add-notification-kind.md`
