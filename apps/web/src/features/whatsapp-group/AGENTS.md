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
- Use backend limits for text, files, edits and deletes.
- Keep phone numbers and message bodies out of telemetry.
- Soup/search registration is deferred; External is the list entry point.

## Checks

- `bunx vitest run --project app src/features/whatsapp-group src/features/whatsapp-linked`
- `bunx vitest run src/features/channel` (shared rows and composer)
- `bun run test:functional -- 'whatsapp-linked.spec.ts$'`
- `bun run check`
