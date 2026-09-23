# Channel Topics — implementation plan

Status: approved concept, ready to implement in phases.
Owner: Eric Hayes. Branch: `channel-topics`.

This document is self-contained: the interactive prototype this plan is based on
is checked in at [`assets/prototype.html`](assets/prototype.html) (open it in a
browser — it is a working simulation of every interaction described here), and
screenshots of each surface are in [`assets/`](assets/). The prototype's CSS is
**not** the implementation target; build with the app's existing design system
(`@ui` components, phosphor icons, theme color tokens). The prototype
communicates structure, copy, and behavior.

---

## 1. Problem

Macro's channel model has four types (`crates/channels/src/domain/models.rs:481`):

| Type | Reality today |
| --- | --- |
| `Public` | Channel that includes people **outside the company** (guests). Confusing name, but behavior stays as-is. |
| `Private` | Invite-only group channel. **All de-facto team channels live here**, so nothing is discoverable. |
| `DirectMessage` | Fine as-is. |
| `Team` | Fully modeled in the domain (`team_id`, `auto_join_team`, `convert_to_team_channel`) but **unused** — no UI creates one, no UI surfaces one. |

Consequences: a new teammate lands in whatever channels someone remembered to
invite them to, has no way to see what else exists, and the sidebar is one flat
undifferentiated list. A recent "channel labels" feature (shipped, being
replaced by this work) only decorated the flat list.

## 2. Solution shape

**Topics**: a team-owned grouping layer over *team channels*.

- Topics are created by anyone on the team and visible to the whole team.
- A channel can belong to **multiple topics**; a team channel in ≥1 topic never
  appears in the sidebar's `Uncategorized` bucket.
- Joining the team subscribes you to **every topic by default**; you opt out
  (phase 3), rather than opting in.
- **Subscription** (do its channels reach me) and **visibility** (is it in my
  sidebar) and **notification level** (does it badge) are independent,
  per-user settings.
- The sidebar splits: **Topics** (+ Uncategorized) on top, then flat sections
  **External** (`Public` type), **Private**, **Direct messages** below. No
  umbrella heading over the lower three.
- Any private/external channel can be **converted to a team channel**
  (existing backend path), which files it under a topic.

**The channel data model does not change.** No new `ChannelType` variant, no
backfill. Topics are additive tables plus, in phase 3 only, a
read-authorization change that makes team channels listable to
non-participants.

Explicitly **out of scope for all three phases** (deliberately deferred, do not
build): *smart topics* (rule-based membership — prototyped, but the rule
builder is a separate project), favorites changes, and any migration tooling
that bulk-converts existing private channels.

---

## 3. Target UI (reference)

Screenshots are of the approved prototype. Phase gating below says which parts
land when; screenshots show the end state after phase 3.

| Surface | Screenshot | Notes |
| --- | --- | --- |
| Sidebar, default | `assets/sidebar-default.png` | Topics with nested channels; Uncategorized; lower sections. `@ N` mention indicator is **phase 2**. |
| Lower sections | `assets/sidebar-lower-sections.png` | `External` / `Private` / `Direct messages` — three flat sections, no parent heading. |
| Dark theme | `assets/sidebar-dark.png` | Uses standard theme tokens; nothing bespoke. |
| Topic ⋯ menu | `assets/topic-menu.png` | Two labeled groups: **Notifications** (radio: All activity / Mentions only / Nothing) then **Actions** (Move up, Move down, Hide from sidebar, Unsubscribe from topic, Add channels to topic, Rename topic). |
| Channel ⋯ menu → Move to topic | `assets/channel-menu-move-flyout.png` | Single **Move to topic** item opens a right-side flyout listing subscribed topics, current memberships checked. ⌥-click = add without removing (multi-topic). |
| Create menu (+) | `assets/create-menu.png` | New team channel / New private channel / New external channel, then New topic. (Prototype also shows "New smart topic" — do **not** build.) |
| Topic order menu (≡ on the Topics section header) | `assets/topic-order-menu.png` | Custom / A–Z / Recent activity / Unread first. Per-user. |
| Sidebar under "Recent activity" order | `assets/sidebar-sorted-activity.png` | |
| Convert private → team dialog | `assets/convert-dialog.png` | Topic picker chips; explicit consequences copy. |
| Browse topics modal | `assets/browse-topics-modal.png` | Phase 3. |

### Interaction rules (the details that matter)

**Sidebar structure**
- Section order: `Topics`, `Uncategorized` (rendered as a pseudo-topic at the
  bottom of the Topics section, only when non-empty), then `External`,
  `Private`, `Direct messages`. Favorites section: unchanged, stays wherever it
  is today (above Topics).
- Channel rows under a topic are indented one step; rows in flat sections are
  not.
- A channel in N topics renders as a row under **each** of those topics
  (duplicate rows are intentional). No per-row "multi-topic" glyph — the
  duplication itself communicates it; row tooltip lists the topics.
- Topic headers collapse/expand (chevron rotates). **A collapsed topic still
  renders the rows of its channels that currently have unreads or mentions**
  ("peek" rows) — collapsing hides quiet channels, not loud ones. Because peek
  rows are always visible, topic headers carry **no aggregate unread/mention
  badge of their own**.
- Empty topic body shows a muted italic drop hint: "Drop a channel here".

**Topic ⋯ menu** (structure; phases gate which groups exist)
```
NOTIFICATIONS                          ← phase 2
  ✓ All activity     — Unreads and mentions
    Mentions only    — Only when you're named
    Nothing          — No counts, no Activity
  (note: "Channels in this topic inherit this unless you set them individually.")
────────────────────
ACTIONS
  Move up            ← phase 1 (hidden when already first)
  Move down          ← phase 1 (hidden when already last)
  Hide from sidebar  ← phase 2   sub: "Stays subscribed — find it under Hidden"
  Unsubscribe from topic ← phase 3 (destructive style)  sub: "Leaves its channels — rejoin from Browse topics"
────────────────────
  Add channels to topic  ← phase 1
  Rename topic           ← phase 1
```

**Channel ⋯ menu** (team channels)
```
#channel-name (label)
  Mute channel / Unmute channel   ← exists today; keep. sub: "Overrides the topic setting" (phase 2 copy)
────────────────────
ACTIONS
  Move to topic  ▸   ← phase 1. Flyout: subscribed topics, checkmark on current
                       memberships, ⌥-click adds instead of moves.
                       Footer note: "Hold ⌥ to add it to a topic without removing it from this one."
  Remove from <Topic>  ← phase 1, only when opened from a topic; destructive style.
────────────────────
  Leave channel
```
For private/external channels the ACTIONS group instead contains
`Make a team channel…` (phase 1).

**Drag and drop** (phase 1)
- Drag a channel row onto a topic (header or body highlights with an accent
  wash + inset ring) → **moves** it there; ⌥ held at drop → **adds** (stays in
  the source topic too).
- Drop a channel already in the target topic → toast "already in <topic>", no-op.
- Drag a **private/external** channel onto a topic → opens the convert dialog
  instead of moving (see below). Nothing happens without confirmation.
- Drag a **topic header** between topics → reorder; a 2px accent drop-line
  shows the insertion point above/below the hovered topic header.
- Smart-topic bodies reject channel drops (n/a until smart topics exist).
- Every drag gesture has a menu equivalent (Move to topic / Move up / Move
  down) — required for keyboard and screen-reader parity.
- Mutations show a toast with **Undo**.

**Per-user topic ordering** (phase 1)
- ≡ button on the Topics section header → menu: Custom ("Drag topics to
  arrange them"), A–Z ("By topic name"), Recent activity ("Busiest topic
  first"), Unread first ("Mentions, then unreads").
  Footer note: "Your order only — everyone on the team arranges topics their own way."
- Dragging a topic (or Move up/down) while in a non-custom mode **switches to
  Custom and freezes the on-screen order first**, so the first drag never
  scrambles the list. Toast appends "· switched to custom order".
- Order is per-user, server-persisted (see schema).

**Convert private/external → team** (phase 1). Entry points, all → same dialog:
1. Button in the channel header pane: `Make a team channel`.
2. Hover action (↑ icon) on the channel row in the sidebar.
3. Channel ⋯ menu item `Make a team channel…`.
4. Dragging the channel onto a topic.

Dialog copy (from prototype, keep this framing):
> **Make #founders a team channel?**
> It's private today. Everyone on the team will be able to find it and join
> without an invite, and past messages come with it.
> File it under: [Engineering] [Design] [Go-to-market] …
> [Keep it private] [**Make it a team channel**]

External variant of the first line: "It includes people outside the company
today, so converting it removes the guests." Cancel label: "Leave it as is".
Hidden topics sort last in the picker and are suffixed "· hidden".

**Notification indicator** (phase 2 — do not build in phase 1)
- One activity indicator at the right edge of every row, exactly one of:
  - unread: small neutral-grey dot + count — `● 4`
  - mentions: small orange `@` glyph + count — `@ 3` (mentions win over unread)
- Same treatment reused on the Hidden filter pill (aggregate mentions inside
  hidden topics) and Browse topics cards. Muted channels show the bell-off
  glyph and suppress the unread count (mentions still show).
- Topic set to "Nothing" shows a persistent bell-off glyph on its header.
  A topic set to "Mentions only" gets **no** persistent glyph (an `@` in the
  rail must always mean an actual mention).

**Hidden topics** (phase 2)
- Hiding is per-user, reversible, and distinct from unsubscribing.
- A `Hidden` filter pill sits under the sidebar search (with the eye-off
  glyph). Hidden while pill inactive: topic absent from list. Pill active:
  hidden topics render inline at reduced opacity with a "hidden" tag; their ⋯
  menu shows "Show in sidebar".
- Pill carries the mention count aggregated from hidden-but-subscribed topics
  (`@ N`), so hiding never silently swallows a mention. Pill hides entirely
  when nothing is hidden.

**Browse topics modal** (phase 3)
- Footer button `Browse topics` (compass icon) → modal listing **all** of the
  team's topics: name, description, channel list, channel count, mention count,
  and one action button per row: `Subscribe` (not subscribed — primary),
  `Show` (subscribed but hidden — primary), `Leave` (subscribed — quiet).
- Header copy: "Everything the team talks about. Join anything — team channels
  don't need an invite."

---

## 4. Data model (backend)

Existing: `comms_channels` (`channel_type` enum already includes `team`;
`team_id`, `auto_join_team` columns exist), domain crate `crates/channels/`,
models also mirrored in `crates/models_soup/src/comms.rs`.

New tables — generate with `sqlx migrate add` (never hand-name migration
files), in `crates/macro_db_client/migrations/`:

```sql
-- topics, owned by a team
CREATE TABLE comms_channel_topics (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id     UUID NOT NULL REFERENCES teams(id),
    name        TEXT NOT NULL,
    description TEXT,
    sort_order  DOUBLE PRECISION NOT NULL DEFAULT 0,  -- team default order
    created_by  TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (team_id, name)
);

-- many-to-many topic membership
CREATE TABLE comms_channel_topic_channels (
    topic_id   UUID NOT NULL REFERENCES comms_channel_topics(id) ON DELETE CASCADE,
    channel_id UUID NOT NULL REFERENCES comms_channels(id) ON DELETE CASCADE,
    added_by   TEXT NOT NULL,
    added_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (topic_id, channel_id)
);

-- per-user, per-topic preferences. ABSENT ROW = the default:
-- subscribed, visible, notification level 'all', default order.
CREATE TABLE comms_user_channel_topic_prefs (
    user_id      TEXT NOT NULL,
    topic_id     UUID NOT NULL REFERENCES comms_channel_topics(id) ON DELETE CASCADE,
    notif_level  TEXT NOT NULL DEFAULT 'all',   -- 'all' | 'mentions' | 'none'  (phase 2)
    hidden       BOOLEAN NOT NULL DEFAULT FALSE, -- phase 2
    subscribed   BOOLEAN NOT NULL DEFAULT TRUE,  -- phase 3
    sort_position DOUBLE PRECISION,               -- phase 1; NULL = team default order
    collapsed    BOOLEAN NOT NULL DEFAULT FALSE,  -- phase 1 (or keep client-side, see below)
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, topic_id)
);
```

The absent-row-equals-default design is what makes "everyone is subscribed to
every topic by default" free — no fan-out writes when a topic is created.

Per-user **topic sort mode** (custom/alpha/activity/unread) is a single scalar
preference; store it alongside other user view preferences rather than in the
prefs table (frontend already persists view state per user —
`apps/web/src/features/channels-view/persistence.ts` uses
`createUserScopedStorage`; server persistence is preferable so ordering
follows the user across devices, but client persistence is an acceptable
phase 1 cut — decide at implementation time and note it in the PR).
`collapsed` may likewise stay client-side (it's `expandedGroups` today);
`sort_position` and everything else must be server-side.

### Architecture constraints (read before writing Rust)

- Follow the hexagonal rules: new ports on the `channels` domain (or a new
  `channel_topics` domain module inside `crates/channels/`), outbound Postgres
  adapter in `crates/channels/src/outbound/`, inbound axum router in
  `crates/channels/src/inbound/`. Never import another crate's `outbound`
  from an outbound adapter; only the composition root
  (`services/document_storage_service/src/api.rs` mounts the channels routers
  today) constructs adapters. Run the `cloud-storage-hexagonal-architecture`
  skill/check before starting.
- Config through `macro_env_var` / `macro_config` only.
- SQLx: prepare the workspace cache from the repo root inside Nix; never edit
  `.sqlx/query-*.json` by hand. Tests run with `SQLX_OFFLINE` **unset**.

### API surface (sketch — final shapes follow existing router conventions in `crates/channels/src/inbound/`)

Phase 1:
- `POST   /channel-topics`                     — create topic (any team member).
- `PATCH  /channel-topics/:id`                 — rename / description.
- `DELETE /channel-topics/:id`                 — delete (membership rows cascade; channels revert to Uncategorized).
- `PUT    /channel-topics/:id/channels/:channel_id` — add channel to topic.
- `DELETE /channel-topics/:id/channels/:channel_id` — remove.
- `GET    /channel-topics`                     — topics for my team + memberships + my prefs, one call shaped for the sidebar.
- `PUT    /channel-topics/prefs/order`         — bulk set my `sort_position`s (custom order write).
- Conversion: reuse the existing update-channel path (`convert_to_team_channel`,
  `crates/channels/src/domain/service.rs:583`) and extend it (or compose) so a
  topic id can be supplied atomically with conversion.

Phase 2 adds `PATCH /channel-topics/:id/prefs` (`notif_level`, `hidden`);
phase 3 adds `subscribed` to the same endpoint plus the discovery read
(`GET /channel-topics/browse` returning channels of topics the caller is not
a participant of — see the authorization note in phase 3).

Every new endpoint: wrap in the TypeScript SDK per the `add-sdk-endpoint`
skill (`just coverage` will fail otherwise), and regenerate the web client
schemas.

### Authorization invariants

- Topic CRUD and membership edits: any member of the owning team. (Deliberate
  phase-1 choice; revisit if teams grow.)
- Adding a channel to a topic requires the channel to be a **team** channel of
  that team.
- Converting a channel: **channel owner or admin only** (`ParticipantRole` in
  `crates/models_soup/src/comms.rs`). The prototype offered it to everyone;
  the real thing must not — conversion irreversibly exposes history to the team.
- Until phase 3, all reads stay participant-scoped: topics decorate channels
  the user is already in. **Phase 1/2 must not leak the existence of channels
  the user is not a participant of.** (A topic's name and its channel *count*
  are team-visible; its channel rows in the sidebar are only ones you're in.)

---

## 5. Phase 1 — sections, topics, menus, drag & drop, ordering, convert

Everything a user needs to organize. No notification changes (keep whatever
unread/mute indicators exist today, exactly as they are), no hiding, no
subscribe/unsubscribe, no browse modal, no smart topics.

### Backend
1. Migration: all three tables above (create the full prefs table now with all
   columns, so phases 2–3 are code-only — defaults make unused columns inert).
2. Domain: `ChannelTopic` model, port + service methods (create, rename,
   delete, add/remove channel, list-for-user, set order), outbound PG repo,
   inbound router. Owner/admin gate on the conversion path.
3. Extend the channel-update flow so `convert_to_team_channel: true` can carry
   an optional `topic_id`.
4. Tests in-crate: `cargo test -p channels` from repo root (`SQLX_OFFLINE`
   unset). Cover: topic CRUD authz (non-team-member rejected), add non-team
   channel rejected, multi-topic membership, delete-topic → channels
   uncategorized, order write/read, convert requires owner/admin.

### Frontend (`apps/web/src/features/channels-view/`)
Key existing files: `types.ts` (`ChannelsGroup`, `ChannelsRailSection`),
`constants.ts`, `queries.ts` (`CHANNELS_QUERY_DEFINITIONS` — note `channels`
scope currently excludes only `direct_message`), `persistence.ts` (zod-guarded
per-user view state), `components/rail/ChannelsRail.tsx`
(`CHANNEL_RAIL_SECTIONS = ['favorites','channels','direct_messages']`),
`ChannelsRailSection.tsx`, `ChannelRailItems.tsx`, `ExpandedChannelsRail.tsx`.
Channel queries live in `apps/web/src/lib/queries/channel/`.

1. New query module for topics (SDK client), joined client-side with the
   existing participant channel list.
2. Rail sections become: `favorites`, `topics` (new composite section:
   one collapsible group per topic + Uncategorized), `external`, `private`,
   `direct_messages`. Splitting today's `channels` scope: `external` =
   `channel_type == 'public'`, `private` = `channel_type == 'private'`;
   team channels appear only under topics/Uncategorized. Update
   `persistence.ts` schema (bump storage version) for the new
   expanded-state keys.
3. Topic header row: chevron, name, hover actions (+ = add channel, ⋯ = menu).
   Peek rows for collapsed topics (reuse existing unread signals). No header
   badges.
4. Menus (reuse the app's menu component):
   - Topic ⋯: Move up / Move down / Add channels to topic / Rename topic.
   - Channel ⋯ additions: Move to topic ▸ flyout (with ⌥ add), Remove from
     <topic>; Make a team channel… on private/external.
   - Sidebar + menu: New team channel (with topic picker) / New private
     channel / New external channel / New topic.
5. Drag & drop per the interaction rules above (channel→topic move/⌥-add,
   topic reorder with drop-line, private→topic opens convert dialog). Include
   the toast-with-undo pattern if the app has one; otherwise plain toasts.
6. Topic order: ≡ menu with 4 modes; switching to Custom freezes on-screen
   order; drag/Move up/down auto-switches to Custom.
7. Convert dialog with topic chips (see copy above), wired to all four entry
   points.
8. Update `docs/AGENT_GUIDE/` (creation flows and sidebar changed — required
   by repo guardrails) and run `just check`; exercise in a browser via the
   `run-app` flow.

Phase 1 acceptance: a team can create topics, file team channels under them
(multi-topic works), reorder topics per-person, convert a private channel to a
team channel into a topic, and the lower sidebar shows External / Private /
Direct messages — with zero change to notification behavior.

## 6. Phase 2 — notification settings, new indicator, hide topics

1. Backend: `PATCH /channel-topics/:id/prefs` for `notif_level` + `hidden`.
   Notification pipeline (`crates/channels/src/outbound/notification_sender.rs`,
   `notification_service`) resolves effective level:
   **channel-level user setting (existing mute) > topic `notif_level` > 'all'**.
   A channel in multiple topics takes the **most permissive** of its topics'
   levels (a mention-only topic must not silence a channel that another
   subscribed topic wants loud). Document this rule in the code.
2. `mentions` level: only direct @-mentions badge/notify; `none`: nothing
   badges, nothing reaches Activity from that topic's channels (unless
   channel-level override).
3. Frontend: Notifications group in the topic ⋯ menu (radio + inheritance
   note); "Overrides the topic setting" sub-copy on channel Mute.
4. New unified indicator everywhere in the rail: `● N` unread / `@ N`
   mentions (spec in §3). Replace existing indicator styles in the channels
   rail only — do not restyle other app surfaces.
5. Hide topics: menu action, Hidden filter pill with aggregate `@ N`, inline
   reveal at reduced opacity, "Show in sidebar" to restore.

## 7. Phase 3 — discovery

1. **The authorization change** (the point of the whole feature): team
   channels become listable and joinable by any team member.
   - Read: new browse endpoint returns all topics with their channels
     (name, description, participant count) regardless of participation.
     Existing name-resolution for non-participants:
     `crates/channels/src/domain/list_service.rs` / `outbound/channel_name.rs`
     currently render placeholders for public/team channels — make team
     channel names real for team members.
   - Join: joining a team channel needs no invite (the domain's
     `ParticipantJoined` event already models self-join for
     public/private/team — see `crates/channels/src/domain/side_effects.rs`).
2. Subscribe/unsubscribe per topic (`subscribed` pref):
   - Unsubscribe = leave the topic: its channels drop from your sidebar. If a
     channel is also in another topic you're subscribed to, it stays.
     Decision needed at implementation: does unsubscribing **remove channel
     participation** or merely un-render? Recommendation: un-render only
     (participation untouched) — cheaper, reversible, and consistent with
     "absent row = subscribed". Membership-changing semantics can come later.
   - Subscribing to a topic shows its channels; whether it auto-joins you to
     them as a participant follows the same decision above.
3. Browse topics modal (spec + screenshot in §3) with Subscribe / Show / Leave.
4. New-teammate default: on joining a team, no prefs rows exist → subscribed
   and visible to everything. Verify onboarding renders the full sidebar.

## 8. Cross-cutting

- **Feature flag**: gate each phase's UI behind a frontend flag via
  `defineFlag` (see the `define-feature-flag` skill). Suggested:
  `ENABLE_CHANNEL_TOPICS`, checked at the rail-composition level so the old
  sidebar renders when off.
- **Testing bar per phase**: crate tests (`cargo test -p channels`),
  `just check` (or `just check full`), SDK coverage (`just coverage`),
  browser exercise of the changed flows, and `docs/AGENT_GUIDE/` updates
  whenever routes/creation flows/sidebar behavior change.
- **Realtime**: topic membership and prefs changes should propagate over the
  existing channel-update push path (websocket/sync) so two open clients
  agree; check how channel renames propagate today and mirror it.
- **Ordering representation**: `sort_position` is a float (fractional
  indexing) to avoid rewriting all rows per drag; bulk-write endpoint exists
  for normalization.

## 9. Open questions already decided (do not re-litigate)

| Question | Decision |
| --- | --- |
| New `ChannelType`? | No. Use existing `Team` type + additive tables. |
| Who creates topics? | Any team member (phase 1). |
| Who converts private→team? | Channel owner/admin only. |
| Default for new teammates? | Subscribed + visible to all topics (absent prefs row). |
| Hide vs unsubscribe collapsed into one? | No — independent controls, different menu groups. |
| Header badges on topics? | None; collapsed topics peek their loud channels instead. |
| Indicator style | `● N` grey for unread, `@ N` orange for mentions (phase 2). |
| Smart topics | Deferred entirely; leave hooks (`comms_channel_topic_channels` is already rule-agnostic). |
| Bulk migration of existing private channels | Deferred; conversion is manual per-channel. |
