# Call chat in the channel

Status: implemented behind the server flag `enable-call-channel-thread`, off by default.

Mockup: [Call chat in the channel](https://claude.ai/artifact/V1h77fWX2oMtqLihZbuaeA)
(every artboard is clickable; start at the first one).

## Summary

A new call in a channel gets a real thread in that channel. The call's row in the
channel is the thread's root, and the call panel shows the channel, opened on that
thread. The separate call chat does not exist for these calls.

| Call | Discussion | Experience |
| --- | --- | --- |
| New call with a channel | Thread in the channel | New |
| Past channel call, or one running at launch | Call parent, not migrated | As today, including its ended row and chat on the record |
| Call with no channel (quick, scheduled) | Call parent | As today |

Nothing is migrated. We accept maintaining two chat experiences.

## Keeping the branch high

The split must not become nullable fields and conditionals in rendered components.
There is one type, decided once and stored:

```rust
pub enum CallDiscussion {
    /// A thread in the call's channel. `root_id` equals the call id.
    ChannelThread { channel_id: Uuid, root_id: Uuid },
    /// The call's own discussion on `MessageParent::Call`.
    CallChat { call_id: Uuid },
}
```

- **Stored, not inferred.** Past channel calls have a `channel_id` and still use
  `CallChat`, so `channel_id` cannot decide this.
- **Two client paths, not three.** Past channel calls and calls with no channel look
  the same to the client.
- **One client branch for the panel.** The host picks the discussion component and hands
  `CallOverlay` a slot.
- **One branch for the timeline.** The call is its own timeline entry kind, not
  optional fields on a message or activity row.
- **Live and ended are separate components**, chosen from a status union, rather than
  one row full of conditions.

## Behavior

### In the channel

The row sits at the call's start time and replies do not move it. It looks similar to
today's system line: icon, bold name, time, no avatar or message hover.

| State | Row | Under it |
| --- | --- | --- |
| Live, not in the call | `<name> started a call`, call time, live avatars, **Join** | Thread indicator with updates (if any messages), or `+` with none |
| Live, in the call | Same, with **Return to call** | Same |
| Live, expanded | Same | Messages on the thread rail, `+` |
| Ended | `<name> started a call that lasted <duration>` | Thread indicator (if any messages), or `+` with none |
| Record deleted | `<name> started a call`, no link to the record | Thread unchanged |

The thread is collapsed by default in every state, and replies like any other thread: no input is open until someone asks for one.

While the row is scrolled out of view during a live call, the `ActiveCallMessage`
banner shows, with a live message count. Clicking it scrolls to the row.

### In the call panel

- Open by default on desktop and tablet, closed on phones. Calls without a channel keep
  today's closed default.
- The first tab is labelled with the channel name.
- An empty thread opens on a full-height blank slate under the action line. A thread
  with messages opens at the newest message. The channel history is above in both cases.
- Channel rows newer than the call's root are not shown in the panel.
- The composer always has a thread target, the call thread by default. It cannot post a
  top-level channel message.
- Scrolling up shows **Back to call thread**.
- A popup above the composer counts top-level channel messages from anyone else, newer
  than the later of the user's join and their last visit to the channel from the popup.
  Thread replies do not count, because they do not appear after the call in the channel.
- **View** swaps to the Messages tab at the latest message, with a New divider. The call
  stays connected, and toggling tabs works as it does today. On the meeting page, which
  has no channel tabs, **View** navigates to the channel.
- While the panel is closed, a dot on the panel button shows there is something to see.

iOS keeps its native call screen, and people reply through the channel.

### Replies

Threads are one level deep, and the service rejects a reply to a reply. So a reply to a
message in the call thread is a quote reply: a new message in the same thread with a
leading `m-reply-target`. There is no new reply type.

| The user replies to | `thread_id` | Quote |
| --- | --- | --- |
| Nothing (default composer) | The call's root | No |
| A message in the call thread | The call's root | Yes |
| A top-level channel message | That message | No |
| A reply in another channel thread | Its root | Yes |

Everything is on the channel parent, so `buildReplyTargetValue` already behaves this way.
A quote always stays in the quoted message's thread.

The panel reuses `createUnifiedInputManager`, which already models a thread root plus an
optional reply. Closing a target returns to the call thread rather than to no target.

### Notifications

Normal thread rules apply, with two differences for call threads:

- **Connected people get nothing.** Followers are computed as usual, including through
  mentions, and notifications are dropped at send time for anyone connected to the call.
  When they leave, the next reply reaches them. The only thing they are never notified
  about is a message sent while the thread was in their call.
- **The caller is not a follower for starting the call.** People follow by sending a
  message or being mentioned.

A normal channel mention still reaches someone during a call.

### Access and deletion

- Chat on the record of a `ChannelThread` call is visible only to people with access to
  the channel, read-only, with **Open in channel**. Sharing a call record does not open
  part of a channel. Without channel access the section is absent, not an error.
- Deleting a call record removes the transcript and recording. The discussion stays.
- Past calls render as they do today, and their chat stays on the call record.

## Backend

### Schema

One migration, with its constraints validated in a second, runs before any code uses it:

- `call_entities.discussion`: `text NOT NULL DEFAULT 'call_chat'`, with `'channel_thread'` as
  the other value. `call_entities` is the durable identity of a call through archival, so
  archiving needs no copy.
- `comms_messages.kind`: `text NOT NULL DEFAULT 'message'`, with `'call_root'` as the other
  value.

`cleanup_call_messages` only deletes `parent_entity_type = 'call'`, so deleting a record
already leaves a channel thread alone.

### Creating the thread

`get_or_create_call` is the only place a channel call is created. `Meeting.channel_id`
exists only for links to existing channel calls, so the meeting path always creates calls
with no channel.

Before creating the call, the service reads the flag for the caller through the `ChannelThreads`
port. Off, or a failed load, stores `call_chat`. The value is written in the transaction that
creates the call, so nobody can read the call with a discussion it will not keep.

The race winner then calls `ChannelThreads::ensure_root`, which reaches
`MessageService::ensure_call_root(call_id)`. It takes no receipt, because everything it writes
comes from the call's record: the channel, the sender and the text. It is idempotent on the
call id.

A failed post never blocks the call. The first reply retries it: when a channel post names a
`thread_id` with no thread and that id is a `channel_thread` call of this channel, the service
creates the root first.

### Call root kind

`MessageKind` is on `Message`. Only `ensure_call_root` writes anything other than
`MessageKind::Message`, and no client input reaches it. A `call_root` message:

- is announced by its own `MessageChange::CallRootPosted`. The match on that enum is exhaustive,
  so every consumer decided what a root does: viewers get it live and the channel moves up the
  list, while notifications, interaction tracking, agents, routines, webhooks and search documents
  never see it,
- is left out of `get_channel_message_count`, so the first real message still sends
  first-message invites,
- rejects edit, delete and reactions in `MessageService`, for every caller including bots and
  agent tools. Channels have no thread delete or thread patch.

Its thread replies are ordinary messages and trigger everything normally. Agents in call
threads therefore follow channel rules, not the owner-based call rules.

The plain text `started a call` is what notification previews, agents and the channel list read.
A surface that shows a root outside the timeline (a standalone thread, the Threads view, the call
record) draws it as the action line from `kind`.

### Timeline

`MessageTimelineEntry` gains a third kind. `timeline_entries` turns `call_root` messages into it
as the last step, with one batched read of `call_entities` per page, so paging and windows are
unchanged. Clients already ignore entry kinds they do not know.

```rust
Call {
    /// The root message, its thread state and its reply preview.
    message: Box<MessageListItem>,
    status: CallEntryStatus,
}

pub enum CallEntryStatus {
    Live,
    Ended { ended_at: DateTime<Utc>, duration_ms: i64 },
    RecordDeleted,
}
```

`RecordArchived` carries `channel_thread`. For those calls the ending is recorded against the call
entity rather than the channel, so the activity feed keeps the fact and the channel timeline shows
no second row. Past calls keep their channel-targeted `CallEnded`.

### Notifications

In `crates/channels/src/domain/side_effects.rs`, connected participants are left out of the
recipients of all three effects: `Reply`, `UserMention` and document mention.
`get_thread_notification_context` reads them from active `call_participants` rows, only when the
thread's root is a `call_root`. A failed read notifies rather than loses the notification.

Followers exclude a `call_root`'s sender: `get_channel_participants_for_thread_id` (both
copies) counts only `kind = 'message'` senders, `parent_sender_id` is empty for call roots,
and the Soup thread filters (`channelThreadParticipantId`, `channelThreadRootSenderId`) match.

### Rejecting stale writes

`MessageService::post` rejects `MessageParent::Call` posts on a `channel_thread` call, so a
stale client cannot write to a chat nobody will see.

### Flag

`enable-call-channel-thread`, through `crates/feature_flags`, evaluated for the caller when
the call is created and targeted by team in PostHog. The stored type then applies to everyone
on that call, so people on one call cannot end up in different discussions. There is no client
flag. `document_storage_service` requires `POSTHOG_API_KEY` at startup and always wires
`PostHogFeatureFlags`. Evaluation has a 300 ms timeout; a failed load keeps that call
`call_chat` for its lifetime. Joining an existing call does not evaluate the flag again.

## Frontend

New UI goes in `features/channel/Call/discussion/`, following the layered feature layout,
with user-visible text through `t()`.

### Discussion type

- `CallRecord.discussion` carries `CallDiscussion`. The live record query is already mounted for an
  active call, so nothing else on the wire needs it.
- `ChannelCallTab` and the meeting route hand `CallOverlay` a `discussion` slot, which supplies the
  panel content, the tab label and the default open state. `CallDiscussionContent` is the one place
  a signed-in call chooses between `ChannelCallPanel` and `CallChat`.
- Guests have no discussion slot and keep `GuestCallChat`. A new meeting has no channel and keeps
  `CallChat`.
- The meeting page renders without the app's providers, so it mounts `MeetingDiscussionHost` around
  either discussion, only when the panel opens: the call's own chat renders app messages too.
- `CallDiscussionHistory` is the one place a call record chooses between `CallChatHistory` and the
  read-only channel thread section.

### Channel timeline

- `buildMessageIndex` keeps a `callStatusByKey` beside `byId`, and call rows are left out of `keys`,
  so keyboard selection skips them as it skips activity.
- `Channel.tsx` passes `ChannelThread` a `rootSlot` for those rows, rendering `CallRootLine`, which
  picks a live or past line from `status`. Everything else about the row is the ordinary thread:
  `ThreadCollapsedIndicator`, `ThreadReplyButton`, the rail, `threadManager` and quote replies.
- `hideCollapsedPreview` on `ChannelThread` collapses the row to its indicator.
- `call_root_posted` and `call_ended` invalidate the channel's timeline, because the row carries
  facts only the server has.
- `ActiveCallMessage` hides while the live row is on screen, and adds the count for `ChannelThread`
  calls. A `CallChat` call running at launch keeps today's banner.

### Call panel

- `ChannelCallPanel` renders `Channel` with a `callPanel` prop, which is the only branch in that
  component: rows are cut off at the root, older pages load until the root is found, the row's
  minimum height is the scroll viewport so its first frame is the blank slate, and channel view
  tracking is off so what's new stays new.
- The panel always uses the unified composer. `createUnifiedInputManager` takes a `defaultThreadId`,
  so closing a reply returns to the call thread, and the top-level composer is unreachable.
- The popup comes from `outsideMessages` over the channel's timeline index, following the count
  rules above. `MessageReadVisibility` already requires a message to be on screen, so nothing is
  marked read from the panel.

### Links

A message in a call thread is an ordinary channel message, so `buildMessageLink` and channel
message targets cover it. `buildCallMessageLink` stays for `CallChat`.

## Edge cases

| Case | Behavior |
| --- | --- |
| Call running at launch | Stays `call_chat`, with today's panel and row. |
| Root post fails and nobody replies | No row for that call. Logged at error level. |
| Flag load fails | `call_chat`. The call behaves as today. |
| Stale client on a `channel_thread` call | Its post is rejected and the existing "could not be sent" message shows. |
| Member removed from the channel | Loses the thread at once, because access is the channel's. |
| Person with the record but not the channel | Sees the transcript and summary, no chat section. |
| Channel deleted | Thread goes with the channel, and the record keeps its transcript and recording. |
| Every thread message deleted | Row remains, with no indicator. |
| Mentioned while connected, then leaves | Not notified of that message; receives later replies. |
| Connection state is stale | Someone just disconnected may lose one notification. Accepted. |

## Observability

- Backend: `call.discussion.create_root` with the call id and outcome, and `messages.call_entries`
  for the timeline read with a row count.
- Web: `channel.call-panel.view` is its own flow. Opening from the popup is a `beginInteraction`,
  `call.panel.view_channel`, recording the call, channel and count.
- Never record message content or quote text.

## Rollout

Everything ships together, with the flag at 0%, so no call becomes `channel_thread` until the client
that reads `discussion` has reached people.

1. Provision `POSTHOG_API_KEY` in `cloud-storage-service`'s Doppler `dev` and `prd`
   configs and `local/lcl_personal` before deployment. `--no-doppler` uses a boot
   placeholder, which cannot enable remote flags.
2. Merge and deploy. All calls are still `call_chat` while the flag is at 0%.
3. Wait for the web bundle to reach clients.
4. Enable `enable-call-channel-thread` in dev, then by team.
5. Clean up: remove the flag and `CallEnded` handling once no past-call row needs it. `CallChat`,
   `GuestCallChat` and `CallChatHistory` remain for calls with no channel and past calls.

## Tests

- `crates/call`: flag on, off and failing; winner-only root creation; the discussion type survives
  archival; deleting a record keeps the thread.
- `crates/messages`: root rejects edit, delete, thread delete and reactions for users, bots and agent
  tools; a client cannot set `kind`; first-reply retry creates the root once under races; call-parent
  posts are rejected on `channel_thread`; timeline entries for each status, with one query per page.
- `crates/channels`: connected people get nothing on all three effects, and normal thread rules for
  everyone else; the caller is not a follower for starting the call; a call root does not suppress
  first-message invites; normal channel mentions during a call still notify.
- `crates/agent_trigger`, `crates/scheduled_action`: a root triggers nothing, and a reply triggers
  normally.
- `apps/web`: the reply table through real interactions; no path posts top-level from the panel; popup
  count rules; the record section with and without channel access.
- Browser, backend-free, desktop and phone: blank slate fills the panel, a thread with messages opens
  at the newest, history scrolls up, the popup opens the channel at the latest message, a draft survives
  a target change, and a collapsed row does not jump when a message arrives. Extend
  `lib/core/messages/browser-test`, which already covers discussion scrolling.
- Live: a member outside the call replies from the channel and people in the call see it without a
  notification, and the reverse.

## Docs

Done in this change: `docs/agent-guide/calls.md`, `channels.md`, the `AGENTS.md` of `crates/call`,
`crates/messages` and `services/document_storage_service`, and `docs/design/entity-messages.md`.
