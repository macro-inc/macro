# channel-notification-stacks

## What it is

Chat: the desktop channel gutter, left of the 920px message column. It shows
a Mark done check beside each not-done notification stack, and a toggle (a
bell) that opens a list of the channel's not-done or unread stacks. One flag,
`enable-channel-notification-gutter` (`VITE_ENABLE_CHANNEL_NOTIFICATION_GUTTER`),
covers all of it.

## How it works

- Stacks are the inbox's: `stackNotifications` groups new top-level messages
  into one stack, each thread into one, and each top-level mention into one
  (`core/channel-stacks.ts`). Reactions are left out.
- Not done reads `ChannelActiveNotifications`
  (`@queries/channel/active-notifications`): unseen and seen message, reply and
  mention notifications, newest first, at most 200. Unread reuses the
  channel's existing unread read (`createChannelUnreadNavigation`) and fetches
  nothing.
- Nothing loads until the channel is open on a non-touch device, outside a
  call panel, with its first rows on screen.
- Tracing: the first not-done read runs in `channel.active_notifications.read`
  (channel id, count, limit reached), inside the channel view's trace while
  that view still loads; the request's `graphql.transport` span sits under it.
  Marking runs in `channel.notification_stack.mark_done` or `mark_read`.
- A check sits beside its stack's newest message. A thread's check sits
  beside its newest notified reply, or beside the top-level message while that
  reply is hidden (`views/stack-checks.tsx`).

## Start here

- `channel-notification-gutter.tsx`: production wiring that `Channel.tsx` mounts.
- `core/channel-stacks.ts`: stacking, anchors and the per-thread index.

## Gotchas

- Checks render through `ChannelThread`'s `gutter` slot (`Thread.GutterSlot`)
  and show only when the pane is ≥1008px wide (`@container/channel-pane`, set
  in `Channel.tsx` only while the flag is on, on desktop, because a
  size container also contains layout). Replies inherit
  `--thread-gutter-inset`, so every check lines up in one lane.
- The list docks in the gutter as a `Card` (filled, depth 3) when the gutter
  is ≥240px wide, and opens as a popover (`menu-surface`) otherwise. Below
  72px it hides. It leaves the checks their 44px lane.
- The toggle and list show only while the channel has a not-done stack (or
  the not-done read failed, to offer Retry): never while that read loads, and
  not on the Unread tab once everything is done. Unseen stacks carry the
  inbox's unread dot (`UnreadIndicator`), and the toggle shows the same dot
  after its count while any not-done stack is unseen. The toggle's dot and
  the Not done rows use the not-done read; Unread rows use the channel's
  unread read.
- A row's label breaks anywhere (`wrap-anywhere`) and clamps to two lines;
  the row repeats it in a tooltip only when the clamp hid some of it. A long
  address must never widen the row, or the list's scroller cuts it off.
- Marking uses the global notification source's bulk done/seen, which applies
  local overrides at once. Apply `withLocalOverrides` to every read here, or
  marked stacks stay on screen until the refetch.

## Checks

- `bunx vitest run src/features/channel-notification-stacks src/features/channel src/lib/queries/channel`
- Backend-free desktop regression over the real checks, list and stacking:
  `bunx playwright test --config src/features/channel-notification-stacks/browser-test/playwright.config.ts`
  (`gutter.html?pane=<px>&theme=light|dark` to look at it; `&names=long` for
  long senders).
