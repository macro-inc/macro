# channel-notification-stacks

## What it is

Chat: the desktop channel gutter, left of the 920px message column. A toggle
(a bell) opens one Unread list: the channel's notification stacks that were
unread when it opened, each held until its check marks the stack done. One
flag, `enable-channel-notification-gutter`
(`VITE_ENABLE_CHANNEL_NOTIFICATION_GUTTER`), covers all of it.

## How it works

- Stacks are the inbox's: `stackNotifications` groups new top-level messages
  into one stack, each thread into one, and each top-level mention into one
  (`core/channel-stacks.ts`). Reactions are left out.
- The list gathers from `ChannelActiveNotifications`
  (`@queries/channel/active-notifications`: unseen and seen message, reply and
  mention notifications, newest first, at most 200; `admitUnread`,
  `primitives/channel-notification-stacks.ts`). Nothing is listed until that
  read's first server answer (a cached answer comes first and can be stale).
  That answer lists every notification that was unread at open: unseen, or
  read since the channel mounted, so the channel's own reads of the messages
  on screen, and a Home or inbox row that marked its stack read on the click
  that opened the channel, still count (`primitives/channel-visits.ts`: from
  15s before the mount, never before the channel was last left in this page;
  a remount within 2s, such as a moved split, continues the visit). A read
  made on this page is timed by the notification source's `localSeenAt`, this
  device's clock; others by the server's `viewed_at`. Later answers add only
  thread replies and mentions, read or not, never new top-level messages. A
  listed notification stays when it is read; a row's unread dot follows its
  current state, and an entry missing from a complete answer (under its 200
  limit) was done elsewhere and leaves. Reopening takes a fresh list.
- A check takes its entry off at once and marks it done together with every
  not-done notification in the channel's inbox stacks that share its key or one
  of its notifications (`notificationsToMarkDone`), so the whole inbox stack
  leaves Home. A failed mark puts the entry back and shows a toast.
- The read waits until the channel is open on a non-touch device, outside a
  call panel, with its first rows on screen.
- Tracing: the first not-done read runs in `channel.active_notifications.read`
  (channel id, count, limit reached), inside the channel view's trace while
  that view still loads; the request's `graphql.transport` span sits under it.
  Marking runs in `channel.notification_stack.mark_done` (channel id, stack and
  notification counts, kinds).

## Start here

- `channel-notification-gutter.tsx`: production wiring that `Channel.tsx` mounts.
- `primitives/channel-notification-stacks.ts`: the gathered list and marking.
- `core/channel-stacks.ts`: stacking, admission and what a check marks.

## Gotchas

- `createChannelNotificationGutter` must be created as the channel mounts:
  its mount time and the last leave bound which reads count as unread at open.
- The list docks in the gutter as a `Card` (filled, depth 3) when the gutter
  is ≥240px wide, and opens as a popover (`menu-surface`) otherwise. Below
  72px it hides.
- The toggle and list show only while something is listed (or the not-done
  read failed, to offer Retry): never while that read loads, and not after the last
  entry is marked done, until a reply or mention arrives. Unread rows carry
  the inbox's unread dot (`UnreadIndicator`), and the toggle shows the same
  dot after its count while any listed stack is unread.
- A row's label breaks anywhere (`wrap-anywhere`) and clamps to two lines;
  the row repeats it in a tooltip only when the clamp hid some of it. A long
  address must never widen the row, or the list's scroller cuts it off.
- Marking uses the global notification source's bulk done, which applies
  local overrides at once. Apply `withLocalOverrides` to every read here, or
  marked stacks stay on screen until the refetch.

## Checks

- `bunx vitest run src/features/channel-notification-stacks src/features/channel src/lib/queries/channel`
- Backend-free desktop regression over the real list, gathering and stacking:
  `bunx playwright test --config src/features/channel-notification-stacks/browser-test/playwright.config.ts`
  (`gutter.html?pane=<px>&theme=light|dark` to look at it; `&names=long` for
  long senders, `&notDone=failed|loading`, `&empty`, `&openedFromRow`).
