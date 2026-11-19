# channel-notification-stacks

## What it is

Chat: the desktop channel gutter, left of the 920px message column. It shows
a Mark done check beside each not-done notification stack, and a toggle that
opens a list of the channel's not-done or unread stacks. Each part has its own
flag (`enable-channel-stack-done-checks`, `enable-channel-notification-list`).

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
- A check sits beside its stack's newest message. A thread's check sits
  beside its newest notified reply, or beside the top-level message while that
  reply is hidden (`views/stack-checks.tsx`).

## Start here

- `channel-notification-gutter.tsx`: production wiring that `Channel.tsx` mounts.
- `core/channel-stacks.ts`: stacking, anchors and the per-thread index.

## Gotchas

- Checks render through `ChannelThread`'s `gutter` slot (`Thread.GutterSlot`)
  and show only when the pane is ≥1008px wide (`@container/channel-pane`, set
  in `Channel.tsx`). Replies inherit `--thread-gutter-inset`, so every check
  lines up in one lane.
- The list docks in the gutter when it is ≥240px wide and opens as a popover
  otherwise. Below 72px it hides. When both flags are on, it leaves the checks
  their 44px lane.
- Marking uses the global notification source's bulk done/seen, which applies
  local overrides at once. Apply `withLocalOverrides` to every read here, or
  marked stacks stay on screen until the refetch.

## Checks

- `bunx vitest run src/features/channel-notification-stacks src/features/channel`
