# Call chat in the channel

Status: proposal. No product code has changed as part of this document.

Mockup: [Call chat in the channel](https://claude.ai/artifact/V1h77fWX2oMtqLihZbuaeA)
(every artboard is clickable; start at the first one).

## Summary

A channel call's chat stops being a separate conversation. It appears in the
channel as a thread under the call's action line, and the call panel shows the
channel, opened on that thread.

Messages stay stored under `MessageParent::Call`. The channel timeline gains the
call's start row and a summary of its thread, so every existing channel call
gets its chat in the channel with no data migration.

Quick and external calls keep today's call chat panel.

## Behavior

### In the channel

| State | Action line | Under it |
| --- | --- | --- |
| Live, not in the call | `<name> started a call`, live timer, **Join** | Collapsed thread pill (if any messages), reply input |
| Live, in the call | Same, with **Return to call** | Same |
| Live, thread expanded | Same | Messages on the thread rail, reply input |
| Ended | `<name> started a call that lasted <duration>` | Collapsed thread pill (if any messages), `+` reply button; no input until `+` is pressed |
| Ended, no messages | Same | `+` reply button only |
| Call record deleted | Same | Nothing; its messages are deleted with the record |

The row sits at the call's start time. Replies do not move it.

### In the call panel

- The panel's Chat tab is labelled with the channel name.
- The panel opens scrolled to the call's action line. The call section is at
  least as tall as the panel, so the channel above it is out of view until the
  user scrolls up.
- An empty thread shows a blank slate saying where messages are saved.
- Channel rows newer than the call's start row are not shown in the panel.
- The composer always has a thread target. It defaults to the call thread and
  cannot post a top-level channel message.
- Scrolling up shows a **Back to call thread** pill.
- A popup above the composer counts top-level channel messages that arrived
  since the user joined, from anyone else. Replies in other threads do not count,
  because they do not appear after the call in the channel. **View** switches to
  the Messages tab at the latest message with a New divider, and clears the count.
- The call continues while the user is on the Messages tab, as it does today.

### Replies

Threads are one level deep: the service rejects a reply to a reply, and a call
parent only accepts messages in its own thread (`call messages belong to the
call thread`). So a reply inside a call thread is a quote reply, a new message in
the same thread with a leading `m-reply-target`. This needs no new reply type.

The first call message is the stored thread root (its id is the call id), but it
reads as one more message under the action line. It quotes like the others, which
`buildReplyTargetValue` already does for any non-channel parent.

| The user replies to | Posted as | Parent | `thread_id` | Quote |
| --- | --- | --- | --- | --- |
| Nothing (default composer) | Message in the call thread | call | call id, or none for the first message | No |
| Any message in the call thread | Message in the call thread | call | call id | Yes |
| A top-level channel message | Reply starting or joining its thread | channel | that message | No |
| A reply in another channel thread | Reply in that thread | channel | its root | Yes |

A quote always stays in the quoted message's thread. Nothing can quote across
threads or parents from these surfaces, so a quote's navigation target is always
on the current surface or reachable through its own parent.

The reply target is one binding at a time: `createUnifiedInputManager` already
models a thread root plus an optional reply for quote replies, and the panel reuses
it. Closing a target returns to the call thread rather than to no target.

## Data model

Keep `MessageParent::Call` as the store. Use the existing `call_id` on the
channel's call activity to join the two.

- Call access already follows the channel: a channel call grants its channel on
  creation, and `channel_call_chat` tests that current channel grants decide access
  without direct participant grants. Channel members who never joined can read and
  reply.
- Every past channel call's chat appears under its line without a migration.
- Call detail history, guests on quick calls, retry deduplication of the first
  message, and cleanup with the call all continue to work.
- Everything under the channel parent is outside the call by construction, which
  makes the popup's count a simple read.

Rejected: moving call chat to `MessageParent::Channel`. It needs a synthetic root
message for every call that message lists, previews, unread counts and
notifications must each learn to hide, a migration for existing chat, and a second
path anyway, because quick calls have no channel. What it would bring for free is
listed under [Known limits](#known-limits); those can be added later without
moving the data.

## Backend

### Timeline

`CHANNEL_TIMELINE` shows `CallEnded` only. `CallStarted` is already recorded as a
channel activity with the `call_id`, so no new event is needed.

1. Add `ActionTag::CallStarted` to `CHANNEL_TIMELINE`. This also makes
   `timeline_parent` deliver the row live.
2. Add a `call_thread` summary to `MessageTimelineEntry::Activity`, set on call
   start rows and absent otherwise:

   ```rust
   pub struct CallThreadSummary {
       /// Live messages, including the stored root.
       pub message_count: u32,
       pub latest_message_at: Option<DateTime<Utc>>,
       /// Up to four distinct senders, for the collapsed pill.
       pub sender_ids: Vec<String>,
       /// Set once the call is archived.
       pub ended_at: Option<DateTime<Utc>>,
       pub duration_ms: Option<i64>,
       /// The call record no longer exists.
       pub deleted: bool,
   }
   ```

   Read it with one batched repository query per timeline page, in
   `activity_timeline`, never per row. A start row must describe its call on its
   own: the matching `call_ended` row can be on a page that has not loaded.
3. Accept posts to an archived channel call and add a test. `CreateMessage` checks
   `call_entities`, which covers archived calls, but the read-only `CallChatHistory`
   means this path has never been used in practice.
4. Remove `CallEnded` from `CHANNEL_TIMELINE` only in the final cleanup, once no
   client needs it.

### Notifications

`DiscussionDelivery` returns early for call parents, so call chat notifies nobody.
That was reasonable when everyone reading it was in the call. For calls with a
channel, notify:

- people mentioned, and
- earlier senders in the thread,

excluding the sender and anyone connected to the call. Plain messages do not notify
the whole channel, matching channel thread replies. Calls without a channel keep
today's behavior.

Add a typed notification event carrying channel id, call id and message id, and map
it in `notification-metadata`, `notification-navigation`, `notification-preview` and
notification sound categories. `notification-event-coverage.test.ts` enforces most
of this.

### Unchanged

- Messages under a call parent are not in the channel's unread count. Activity
  rows are already not unread targets.
- Agent mention rules for call parents stay as they are: the mention menu inside a
  call thread reads call-parent bots, not channel bots.

## Frontend

New UI goes in `features/channel/Call/thread/`, following the layered feature
layout, with user-visible text through `t()`.

### Channel timeline row

- `core/system-activity.ts`: add a `call_started` kind with `callId` and the summary.
  Decode the summary at the transport boundary and tolerate its absence.
- `CallThreadRow`: action line, then `ThreadCollapsedIndicator` and `ThreadReplyButton`
  (existing components), then `MessageThread` for the call parent when expanded,
  rendered from the activity branch in `Channel.tsx`.
- Key expansion and reply state in the channel's `threadManager` by call id, so they
  survive virtualization and history restoration.
- Reuse `useCallChat`, including its handling of the 404 an empty thread returns.
  Fetch replies on expand, not per row.
- With the flag on, drop `call_ended` rows from the rendered list.
- `ActiveCallMessage` shows only while the live row is out of view, so a call stays
  joinable from a channel scrolled away from it.

### Live updates

- Mounted call rows subscribe with `useMessageSubscription` for their call parent.
  The virtualizer bounds how many are open.
- In `sync.ts`, a posted or deleted call message patches the summary on the matching
  timeline row. Keep the existing refresh of an unloaded thread.
- A delivered `call_ended` activity carries `call_id` and `duration_ms`; fold it into
  the start row in the timeline cache rather than refetching.

### Call panel

- `CallOverlay` mounts a new `ChannelCallPanel` when `callCtx.activeChannelId()` is
  set and the flag is on. `CallChat` and `GuestCallChat` stay for everything else.
- `CallChatPanel` takes the first tab's label from its host.
- Render the channel timeline through `ThreadList`, with rows cut off at the call's
  start row and a final blank-slate item at least as tall as the scroll viewport.
  Extract what this shares with `Channel.tsx` first, rather than adding panel branches
  to that file. Check how it behaves when the Messages and Call tabs swap, because the
  two views read the same timeline cache and need their own scroll state.
- Inline reply inputs are off in the panel; everything binds to the panel composer.
- `ChannelInput` takes its parent from the target: call parent by default, channel
  parent for another thread. Keep a draft per target, and do not remount a focused
  editor when the target changes.

### Popup

A small primitive over the channel's timeline index counts messages where:

- the entry is a top-level channel message, not an activity row or tombstone,
- the sender is not the current user, and
- it is newer than the later of the user's join time and the last time they
  opened the channel from the popup.

Read marking is untouched: `MessageReadVisibility` already requires a message to be
on screen, and these are not rendered in the panel.

### Quotes and links

- Wrap each `CallThreadRow`, and the panel's call section, in
  `MessageReferenceNavigation.Provider` the way `CallChat` does: claim targets for
  that call, expand the thread, and highlight the message.
- Clicking a call message link opens the channel for a channel call, positioned on
  the call's row with the thread expanded. Add a way to anchor the timeline's
  `around` read on a call id, because the message is not in the channel parent.
  `buildCallMessageLink` keeps its call-detail link for calls with no channel, and old
  links keep working.
- `CallChatHistory` on call detail reads the same thread and stays read-only.

### Mobile and native

- Touch uses the unified input already, so replies under a call row go through the
  floating composer, with no inline input. Actions stay on long press.
- The phone web panel is the existing `CallChatPanel` drawer, with `ChannelCallPanel`
  inside it. Keep the blank slate sized to the drawer.
- Native iOS has no Call tab, so its users get the channel row and reply through the
  channel, with the CallKit drawer unchanged.

## Edge cases

| Case | Behavior |
| --- | --- |
| A `call_ended` row with no start row (started event skipped, or call in flight at deploy) | Line is lost with the flag on. `CallStarted` has been recorded as long as the activity table has existed, so this is rare and acceptable. |
| First message races | Existing advisory lock turns the loser into a reply. |
| First message deleted | Root stays as a tombstone and the thread continues. The count excludes it. |
| Every message deleted | Treated as no messages: no pill. |
| Member removed from the channel | Loses access at once, because grants are read live. |
| Call shared with the team | Team members can already read the call's chat on its record. Channel members replying after the call now add to that. Show nothing new, but test that a team-only viewer cannot post through the channel. |
| Long thread, live call, collapsed | Pill and input remain; expansion is the user's choice and does not auto-expand on new messages. |

## Observability

- Backend: span the summary query (`messages.call_thread_summaries`) with channel id
  and row count.
- Web: the panel is its own flow (`channel.call-panel.view`), with `call.id` and
  `channel.id`, and phases for the timeline and the thread. Opening from the popup is a
  `beginInteraction`, recording the count. Expanding a row is `useFlow().task`.
- Never record message content or quote text.

## Rollout

Gate the client with a `defineFlag` flag, read reactively, off by default. The server
changes are additive.

The order matters: an unknown timeline action decodes to `unknown` and renders
"updated the channel", so clients must learn the new action before the server sends it.

1. **Web:** decode `call_started` and hide it unconditionally.
2. **Backend:** `CallStarted` in the timeline, summaries, archived-post test.
3. **Web, flagged:** `CallThreadRow`, live updates, `ActiveCallMessage` change, `call_ended` hidden.
4. **Web, flagged:** `ChannelCallPanel`, composer targets, popup.
5. **Backend and web:** notifications, channel links for call messages.
6. **Cleanup:** remove the flag, `CallEnded` from the timeline, and panel code only
   channel calls used.

## Tests

- `crates/messages`: summary counts, tombstones, senders, ended and deleted calls, one
  query per page; channel call delivery notifies mentions and earlier senders only, not
  connected participants.
- `apps/web`: reply table above, through real interactions; quote stays in its thread;
  no path posts top-level from the panel; the popup's count rules.
- Browser, backend-free, desktop and phone: blank slate fills the panel, history scrolls
  up, popup opens the channel at the latest message, draft survives a target change, and
  a collapsed row does not jump when a message arrives. Extend
  `lib/core/messages/browser-test`, which already covers discussion scrolling.
- Live: a second member outside the call replies from the channel and the people in the
  call see it, and the reverse.

## Known limits

Consequences of keeping the call parent, none blocking:

- Call threads are not in the Threads view (`channelThreadParticipantId` covers channel
  parents).
- Channel message search does not return call chat under the channel.
- Agents reading channel history do not see call chat.

## Docs to update when this ships

`docs/agent-guide/calls.md`, `docs/agent-guide/channels.md`, the `AGENTS.md` of `crates/call`
and `crates/messages`, and `docs/design/entity-messages.md` if the parent model changes.

## Open decisions

The spec assumes these. Each one changes scope if the answer differs.

1. **Popup destination.** The Messages tab, leaving the video, as written above. Showing
   the channel inside the panel would keep the video on screen but adds a third channel
   view with its own posting rules.
2. **Who gets notified.** Mentions and earlier senders only, as written above. Any reply
   to a channel notifying all members would be louder than channel threads are.
3. **Threads view.** Left out of the first version. Adding it means teaching the Soup
   thread filters about call parents.
