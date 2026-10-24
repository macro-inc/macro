# WhatsApp group

## Scope

Owns the shareable WhatsApp conversation at `/whatsapp-group/:groupId`.
It has independent message storage and queries. Reuse `channel/Message` only
for presentation; never use channel queries, services, membership or context.
Pairing and account management belong to `features/whatsapp-linked`.

## Map

- `core/`: feature vocabulary, sending identity and edit eligibility.
- `context/`: source and action contracts; no production imports.
- `primitives/conversation.ts`: drafts, quotes, uploads and deliberate sends.
- `components/`: supplied values and callbacks only.
- `views/`: conversation composition and read lifecycle.
- `queries/`: generated wire decoding and production source construction.
- `whatsapp-group.tsx`: app host, attachments and generic ShareModal.
- `whatsapp-group-entry.tsx`: flag gate for routed and restored panes.
- Generic sharing uses direct people grants and view-only link/team controls;
  never forward groups into a channel to establish access.
- `lib/queries/whatsapp-groups`: isolated query keys and server mutations.

## Gotchas

- Viewing follows ordinary entity sharing. WhatsApp membership controls sending.
- Every write uses the viewer's own connected WhatsApp account.
- Never retry an unknown send automatically; it may already have arrived.
- Preserve drafts during polling and after ambiguous failures.
- Use backend limits for text, files, edits and deletes.
- Keep phone numbers and message bodies out of telemetry.
- Soup/search registration is deferred; External is the list entry point.

## Checks

- `bunx vitest run --project app src/features/whatsapp-group src/features/whatsapp-linked`
- `bun run test:functional -- 'whatsapp-linked.spec.ts$'`
- `bun run check`
