# Guest call chat on the shared message surface

Status: in progress.

## Goal

A call has exactly two discussion paths, decided by the stored `CallDiscussion`:

1. `ChannelThread`: the call is a thread in its channel (`ChannelCallPanel`).
2. `CallChat`: the call's own thread on `MessageParent::Call(call_id)` (`CallChat`).

Quick and scheduled calls are always `CallChat`, with or without guests. A guest is
an access mode of `CallChat`, not a third chat: guests see and use the same
`MessageThread` and `ChannelInput` as signed-in people, with replies (quote replies),
reactions, and editing or deleting their own messages. `GuestCallChat` is removed.

The discussion data model does not change: no migration, no backfill.

## Guest API contract

Mounted beside the existing guest routes (outside account auth). Every request
authorizes the `Authorization: Bearer <guest RTC token>` with `GuestCallAuthorizer`
and acts only on `MessageParent::Call(call_id)`, as the guest sender
(`ChannelSender::new_from_guest`). The legacy `GET`/`POST /call/guest-chat/{call_id}`
routes stay unchanged for clients already loaded; remove them in a later change.

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| GET | `/call/guest-chat/{call_id}/thread` | | `GuestChatThread` |
| POST | `/call/guest-chat/{call_id}/messages` | `GuestChatPost { id, content }` | `Message` |
| PATCH | `/call/guest-chat/{call_id}/messages/{message_id}` | `GuestChatPatch { content }` | `Message` |
| DELETE | `/call/guest-chat/{call_id}/messages/{message_id}` | | 204 |
| POST | `/call/guest-chat/{call_id}/messages/{message_id}/reactions` | `ReactionInput { emoji, add, nonce? }` | `Message` |

```text
GuestChatThread {
  viewer_id: string            // the guest's own sender_id, as its messages carry it
  thread: MessageThread | null // { state, root, replies }; null before the first message
}
```

- The first post becomes the root (id = call id), later posts reply to it, exactly as
  the account path and the legacy guest post do. Quote replies are content with a
  leading `m-reply-target`; nothing else is needed.
- PATCH and DELETE accept only the guest's own messages. Reactions go to any message
  in the thread. All reuse `MessageService` rules (call roots, deleted messages,
  emoji validation) and publish the same events as account changes.
- Guests post text only: no mentions, attachments, or anchors.

### Identity redaction

Every `Message` returned to a guest is redacted so no account identity leaves:

- Account (user) senders: `sender_id` becomes `participant:<uuid v5 of call_id + sender_id>`,
  stable within the call, and `imported_author` is `{ name }` with the display name the
  legacy projection used. Bot senders keep their bot profile; guest senders keep their
  guest `sender_id` and `guest_name`.
- Reactions: account reactor ids are replaced with the same opaque ids, and their names
  are returned in `CountedReaction.names?: Record<string, string>`, keyed by the
  opaque reactor id, as external-chat reactions do for people outside Macro.
- `mentions`, `attachments`, `triggered_by` and any other account or entity references
  are emptied.
- Guest quote input must reference a message in the same call and use that
  message's guest-visible sender ID; invalid quote targets are rejected.

## Frontend seams

- `@core/messages/message-transport.tsx`: `MessageTransportProvider` swaps how
  `MessageThread` patches, deletes and reacts; `MessageViewerProvider` says who the
  viewer is (`sender_id`) for own-message checks. Absent providers mean the account API
  and the signed-in user.
- `CallChat` takes `access: { kind: 'member' } | { kind: 'guest'; session: { token; participantId } }`.
- `CallDiscussionContent` is the only place a call chooses its discussion, for every
  host. `CallOverlay` has no guest branch and no bare `CallChat` fallback.
- The shared thread, message rows and composer run without the app-only providers
  (`AppProviders`) that meeting pages lack.
- Guests poll the thread every 3 seconds; live delivery over the connection gateway is
  out of scope.
