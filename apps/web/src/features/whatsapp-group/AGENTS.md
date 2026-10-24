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

- Viewing follows ordinary entity sharing. WhatsApp membership controls sending.
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
  reports `done` or `partial`.
- Images, video and audio play inline: `fileUrl` resolves the imported
  document's presigned URL and `InboundMedia` hands it to Chat's
  `MediaPreview` (or an audio player); `groupMessageData` keeps them out of
  the document chips. DSS's declared width/height reserve the space (keeps
  the open-at-bottom scroll right); stickers, GIFs and voice notes follow the
  attachment's `presentation`.
- `kind: 'system'` rows render through Chat's `SystemActivityLine`
  (`components/system-line.tsx`, words in `core/rich.ts`) and enter the list
  meta as `activity` entries; they never count toward the unread divider.
- `rich` polls, locations, contacts and events are small cards
  (`components/rich-cards.tsx`); votes happen in WhatsApp only. Map links are
  built from coordinates; nothing is fetched to draw them.
- Received `@<token>`s become Chat's user-mention chip for verified Macro
  users, else the WhatsApp name in bold (`core/mentions.ts`). Bare URLs become
  Markdown links in `whatsappToMarkdown`, so Chat's link preview applies.
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
