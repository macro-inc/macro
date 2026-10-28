# WhatsApp group

## Scope

Owns the shareable WhatsApp conversation, opened inside External at
`/external/whatsapp/:groupId`. It has independent message storage and
queries. It renders with the channel components (`ChannelMessage`,
`ChannelInput` with Macro-only features off) but never uses channel queries,
services, membership or context. Pairing, account management and the External
lists belong to `features/whatsapp-linked` and `features/external-view`.

## Map

- `core/`: feature vocabulary, sending identity, edit eligibility, the
  Markdown ↔ WhatsApp formatting converters and the `MessageData` mapping.
- `context/`: source and action contracts; no production imports.
- `primitives/conversation.ts`: optimistic sends, idempotency keys, quiet
  retries, reply/edit targets, uploads and read state.
- `components/`: supplied values and callbacks only.
- `views/`: conversation composition, scroll and read lifecycle.
- `queries/`: generated wire decoding, write-failure classification and
  production source construction (spans live here).
- `whatsapp-group.tsx`: app host and generic ShareModal.
- `whatsapp-group-entry.tsx`: flag gate for routed and restored panes.
- `lib/queries/whatsapp-groups`: isolated query keys, reads and the
  `whatsapp_changed` gateway sync (`sync.ts`).

## Gotchas

- Despite the name, this is any added WhatsApp chat: `kind` is `group` or
  `direct`. A direct chat has no roster (header shows the person) and only
  its owner sends; shared viewers see "Only <owner> can reply in this chat".
  User-facing copy says "chat"; code, routes and the entity type keep "group".
- Viewing follows ordinary entity sharing. WhatsApp membership controls sending.
- Members, sharing and Stop syncing live in the generic `SidePanel`
  (`components/chat-details.tsx`), floating and closed by default like an
  in-view email thread. The header is `ViewShell.TopBar` (kept visible on
  touch, under the safe area) with Share in a `HeaderActionGroup` and
  `SidePanel.Toggle`. The host
  (`whatsapp-group.tsx`, the functional fixture, tests) supplies
  `SidePanel.Root`; the view renders the `SidePanel.Layout`. While it is
  open on a pane at least 900px wide, the timeline and composer pad
  `SidePanel.FLOATING_CLEARANCE_PX` on the right so the card never covers
  them.
- Every write uses the viewer's own connected WhatsApp account.
- A draft keeps one idempotency key until DSS records it; unknown outcomes
  retry quietly with that key, so a resend can never arrive twice.
- Refusals (`{code,message}` from DSS) remove the pending row, toast the
  reason and restore the draft only if the composer is empty.
- Row actions are getters: `ChannelMessage` reads them once per row.
- Reads do not poll; DSS pushes `whatsapp_changed`, with one fallback
  re-fetch 3 s after opening. Only in-flight sends poll their progress.
- History imported after adding (`backfill` on the detail) lands older than
  the rows shown; the view keeps its distance from the bottom when rows appear
  above, and says "Importing history…" / "Waiting for … phone" until DSS
  reports `done` or `partial`. `waiting_for_message` (no message to import
  from yet) shows nothing.
- Attachments are static files, like Chat's media: `fileUrl` is
  `staticFileIdEndpoint`, and images take Chat's sized variants. Images,
  video and audio play inline: `InboundMedia` hands them to Chat's
  `MediaPreview` (or an audio player); other ready files are
  `AttachmentChip` links that open the file. `groupMessageData` passes no
  attachments to the channel row. DSS's declared width/height reserve the space (keeps
  the open-at-bottom scroll right); stickers, GIFs and voice notes follow the
  attachment's `presentation`. A file whose image, video or audio fails to
  load (deleted or missing), shows
  "Attachment unavailable" instead of loading forever (Chat's media tiles
  report it through `MediaPreview`'s `onError`).
- The timeline and composer use Chat's layout (`macro-message-width` column,
  `CustomScrollbar`, `ChannelInputContainer` → centered column). The view
  follows the bottom (a `ResizeObserver` on the content) until the reader
  scrolls by intent (wheel, touch, keys, scrollbar); layout-driven scroll
  events never change that. Media keep their memoized items so refetches
  don't remount or reload them.
- Files this page sent keep their local preview and size on the stored
  message (`conversation.sentFiles`), so the swap from pending neither
  flashes nor jumps.
- `kind: 'system'` rows render through Chat's `SystemActivityLine`
  (`components/system-line.tsx`, words in `core/rich.ts`) and enter the list
  meta as `activity` entries; they never count toward the unread divider.
- `rich` polls, locations, contacts and events are small cards
  (`components/rich-cards.tsx`); votes happen in WhatsApp only. Map links are
  built from coordinates; nothing is fetched to draw them. Sender-supplied
  links (a location's URL, an event's join link) survive decoding only as
  http(s) (`webLink`).
- Received text is untrusted: `whatsappToMarkdown` turns every punctuation
  mark into a `&#NN;` reference, so no Markdown, HTML or Macro tag a sender
  types takes effect. Only what it writes itself is Markdown: WhatsApp's
  formatting, links for bare http(s) URLs (so Chat's link preview applies),
  and for each `@<token>` DSS matched, Chat's user-mention chip (verified
  Macro users) or the WhatsApp name in bold. Inline code stays a code span
  only when it holds nothing a tag could start with.
- The composer runs `ChannelInput` with `mentions: 'participants'`: the `@`
  menu lists the roster (ids are JIDs, minus the sender) and nothing else;
  `composerMentions` turns the chips into `@<digits>` plus `mentions` on the
  text send.
- Senders show their WhatsApp name (`imported_author`), Macro users included.
- Use backend limits for text, files, edits and deletes.
- Keep phone numbers and message bodies out of telemetry.
- Soup/search registration is deferred; External is the list entry point.

## Checks

- `bunx vitest run --project app src/features/whatsapp-group src/features/whatsapp-linked`
- `bunx vitest run src/features/channel` (shared rows and composer)
- `bun run test:functional -- 'whatsapp-linked.spec.ts$'`
- `bun run check`
