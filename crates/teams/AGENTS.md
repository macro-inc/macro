# teams

## What it is

Part of account/workspace management — team membership, invites, roles,
CRM/analytics settings, and the `macro.teams` lifecycle event producer that
other features (billing, CRM) subscribe to. See `README.md` for the full
event contract (schema, sanitization, delivery semantics).

## Start here

- `src/domain/team_service.rs`: the main service — creation, invites,
  membership, role changes, auto-join-domain toggle. Team-wide settings
  (default link share, interface language) are fields on `PatchTeamRequest`.
- `src/domain/team_service/invite_link.rs`: the team's shareable invite link
  (`TeamInviteLinkService`) — who may see, create, reset, or turn it off, and
  joining through it via the same direct-join path as domain auto-join.
- `src/domain/domain_notice.rs` + `join_announcement.rs`: the one-time email a
  new work-domain team sends to the creator's same-domain contacts who are not
  on Macro yet (`POST /team/domain-notice`, at most 25 per team). Its
  unsubscribe link is signed by the notification service at send time.
- `src/domain/team_service/invite_reminders.rs` +
  `src/inbound/invite_reminder_worker.rs`: reminder emails for unanswered
  invites, swept hourly in `authentication_service`. The repository claims
  due invites and counts the reminder before sending, so replicas never
  double-send and a failed send drops that reminder rather than retrying.
- `src/domain/invite_rewards.rs`: the `InviteRewarder` port, called when an
  invite is accepted or someone joins through an invite link (rewarding the
  sender or `team_invite_link.created_by`). Billing implements it in
  `authentication_service`; `teams` cannot depend on `ai_billing`.
- `src/domain/owned_entity_cleanup.rs` + `open_seat_release.rs`: account/team
  deletion side effects (owned-entity transfer, seat release). Team deletion
  calls `OwnedEntityCleanup::release_computers` after the purge and before
  cancelling the subscription, so computers leave through their own lifecycle.
- `src/domain/subscription_items.rs`: `TeamSubscriptionItems`, non-seat items
  (Macro computers) on the team subscription. Each computer bills ONE item at
  a price of its own (`create_computer_price` copies the catalog price; Stripe
  refuses two items of one price) carrying `computer_id` in item and price
  metadata, so items are matched by computer, never by price or count.
  `remove_team_subscription_item` treats an item or subscription already gone
  as `ItemRemoval::AlreadyGone`; `settle_subscription_item_change` ends an
  unknown outcome for good (`abandoned` receipts are never sent again). One Stripe update per
  change set, under the team billing lock, invoiced now with
  `error_if_incomplete` (a decline is `CustomerError::PaymentFailed`) and
  idempotent by key (`subscription_item_change` durable requests/receipts plus
  an atomic `macro_item_change` provider marker and Stripe's `Idempotency-Key`).
  Replay the receipt before resolving current subscription/prices. A change
  left pending is settled by the next holder of the subscription guard (applied
  iff its provider marker landed, else `abandoned`), so it never wedges seat,
  plan or computer changes. One younger than `PENDING_SETTLE_AFTER` (5 min)
  may still be in flight at Stripe (its sender let go of the guard, but its
  request may still be running), so instead of abandoning it the guard sends
  its exact stored request again under its own `Idempotency-Key`
  (`finish_in_flight_locked`): Stripe runs a key at most once, answers a
  finished request with its saved result and a running one with 409. Only a
  409 or other unknown answer refuses with `ItemChangeInFlight`. Callers
  keep one key per intent across retries (e.g. `computer-remove:{effect}:{n}`
  moves to `n+1` only once `n` definitely did not apply), so a retry replays
  its own change rather than being refused by it. A trialing subscription never
  gains a computer item (`SubscriptionTrialing`); its own replay sends the stored endpoint and exact
  request, including scheduled updates. Settling a key with no receipt writes
  an `abandoned` one on the team's subscription, fencing a send still on its
  way. Removing a computer's item archives its own price. Retain
  receipts after subscription/team deletion to prevent delayed duplicate charges.
  Seat prices passed here change seat items too.
- `src/inbound/axum_router.rs` / `src/inbound/toolset.rs`: HTTP routes and AI
  tool surface.
- `src/outbound/team_repo.rs`: the Postgres repository; reads use the supplied pool.
- `src/domain/team_repo.rs`: reuse `get_user_teams` for viewer teams and `get_all_team_members` for team membership, including owners.

## Scope

- Owns: the `"Team"` table's lifecycle, membership, invites, and the
  `macro.teams` Kafka producer.
- Not here: billing/seat pricing logic → `crates/ai_billing` (consumes this
  crate); CRM company/contact sync → `crates/crm` (this crate only enqueues).

## Boundaries

- Depends on: `entity_access`, `contacts` (feature `outbound`), `channels` (feature `backfill_binary`),
  `analytics_client`, `ai_toolset` (feature `ai_tools`).
- Used by: `services/authentication_service`, `services/document_storage_service`,
  `services/calendar_service`, `services/agent_harness_service`,
  `services/agent_harness_service`, `crates/scheduled_action`, `crates/ai_tools`,
  `crates/ai_billing`, `crates/calendar_scheduling`.

## Recipes

- Add a team mutation: `src/domain/team_service.rs` → `src/domain/events.rs`
  (new event variant, if it should publish) → `src/outbound/team_repo.rs` →
  `src/inbound/axum_router.rs`.
- Repair missed teammate DMs: `just crates/teams/backfill_teammate_dms_local`
  (see README's "Delivery semantics" for when this is needed).

## Gotchas

- Carry async-stripe's `stripe::PriceId` through generic item changes; validate
  once at configuration/provider boundaries.

- A user is on at most one team, enforced only by the `team_owner_id_unique`
  and `team_user_user_id_unique` constraints. `create_team` maps either
  violation to `CreateTeamError::AlreadyOnTeam` (409); a new insert path into
  `team` or `team_user` must map them too, or it answers 500.
- A trialing subscription that gains its first Max seat ends the trial and
  starts a new billing cycle immediately. Every other seat change keeps the
  trial, including on a subscription already trialing on Max, so its scheduled
  downgrades still apply at the trial's end.
- Creating or linking a team moves the owner's personal subscription onto the
  team, but the owner keeps the `professional_subscriber` role it granted. When
  the team subscription lapses, `revoke_permissions_for_team_members` removes
  that role too, unless the owner's Stripe customer still has an active or
  trialing subscription (another one, or the team's own when the lapse event
  is stale).
- Team routes resolve the caller's current team from the principal. A client
  holding a team (the SDK's `Team` handle) passes it as `team_id` to
  `POST /team/invite` and `GET /team/invites`, and `is_expected_team` answers
  409 in that same request when it is no longer the caller's team; without
  `team_id` the routes act on whatever team is current.

- Invite and reminder emails carry the inviter's display name
  (`TeamRepository::get_user_display_name`). A failed lookup is logged and the
  email falls back to the inviter's address, so it never blocks an invite.

- `team_invite.is_agent` makes an address with no account sign up as an agent.
  `authentication_service`'s agent setup joins the team, so the seat is added
  without a separate acceptance. Existing accounts accept like any other invite.
  Its email links to the agent signup page (`/app/signup/agent?team_invite=<id>`).

## Billing identifiers

- Use `stripe::PriceId` for seat price configuration, item quantity changes, and price lookups; its parse accepts any string, so callers validate configured ids before building `SeatPrices`.

## Checks

- `cargo test -p teams` (`SQLX_OFFLINE` unset).
- After query changes: `nix develop --command just prepare_db` from the repo root
  inside Nix.

- Registered external chats are human-owned; owned-entity cleanup treats their dependency order like other conversations.

## Related

- Docs: `crates/teams/README.md` · Rules: `.agents/rules/rust/db.md`

- Subscription item/pricing data errors are typed in `customer_repo/subscription_error.rs`, bridged to the existing customer error contract.

- `customer_repo/billing.rs` handles subscription locks, schedules, and request construction; `subscription_items.rs` handles item quantities and provider value mapping.

## Team vault cleanup

- Run `OwnedEntityCleanup::prepare_team_deletion` before census and ordinary cleanup;
  namespace failures stop before entity, session, subscription or team deletion.
  Retain its optional opaque guard in `ClearedTeam` through billing and row deletion.
- Keep membership removal and rollback unchanged: vault items belong to the team,
  retain their creator, and lose departing members through current membership checks.
