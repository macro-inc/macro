# Chat workspace

## What it is

Chat owns conversation navigation, desktop sidebar sections, and the touch
conversation feed. Channel messages and call media belong to `features/channel`.

## Start here

- `channels-view.tsx` composes desktop and touch views over shared sources.
- `components/rail/ChannelsRail.tsx` owns sidebar navigation and section state.
- `components/rail/next/ExpandedChannelsRail.tsx` renders the sectioned sidebar;
  `components/rail/ExpandedChannelsRail.tsx` renders the flag-off sidebar.
- `components/ChannelsMobileView.tsx` and `components/rail/next/mobile/` own
  touch lists and section tabs.
- `live-calls-sidebar.tsx` composes the existing active-call queries and ringing
  store into the shared `features/meetings/components/live-calls-sidebar.tsx`.

## Gotchas

- Mount `ChannelsLiveCallsSidebar` below the header and above the conversation
  tree in both desktop renderers, outside virtualized sections and search results.
- Keep all visible active channel/DM calls, including the joined call. Preserve
  newest-first channel ordering, then quick-call source ordering. Deduplicate a
  quick call's backing channel call, not its conversation in the sections below.
- Dismiss only the ringing state, through `dismissIncomingCallEverywhere`;
  a dismissed call remains joinable until it ends. Join the selected call ID.
- Keep live calls in the existing queries/cache writers; websocket events update
  the all-active cache. Do not add another call store or polling loop.
- The standalone Live section is desktop-only. Touch lists retain inline call
  controls and waveform indicators rather than a second call list.

## Checks

Run from `apps/web`:

- `bun run test src/features/channels-view src/features/meetings/components/live-calls-sidebar.test.tsx src/features/meetings/queries/active-quick-calls.test.ts src/lib/queries/call/call.test.ts`
- `bun run check`

Run `just check` from the repository root. Exercise signed-in call start, join,
dismiss, and end on desktop, plus unchanged touch behavior at 390×844.

## Related

- `docs/agent-guide/channels.md`: sidebar behavior and verification.
- `docs/agent-guide/calls.md`: call lifecycle and diagnostics.
