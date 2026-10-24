# whatsapp-linked

## What it is

Personal WhatsApp accounts linked as devices (External tab → WhatsApp): link an
account by QR, list its WhatsApp chats, and add a group as its own shareable
Macro entity. Each person sends from their own account. Behind the `enable-whatsapp-linked` flag.

## Start here

- `whatsapp-linked.tsx`: production wiring (shared queries + split navigation).
- `context/whatsapp-linked-context.tsx`: the capability contract tests fake.
- `views/whatsapp-page.tsx`: account states, the header (search + account
  strip), the Add to Macro and Can't be added sections (plus In Macro while
  searching), and the pairing/confirm dialogs.
- `components/chat-list.tsx`: one-line chat rows styled like Macro's list rows
  (`bg-list-hover`, actions on hover/focus, always on touch).
- `core/chat.ts`: chat sections, search matching and row wording.

## Scope

- Owns: the WhatsApp account page, pairing dialog and one-click adoption
  (no dialog; DSS names the group after WhatsApp).
- Group timeline and sending: `features/whatsapp-group`; no channel integration.
- One account at a time: there is no replace flow; switching means
  Disconnect, then Connect.
- Not here: the External tab shell, the groups nested under WhatsApp in its
  sidebar and the
  `/external/whatsapp/:groupId` route → `features/external-view`;
  HTTP → `lib/service-clients/service-storage/whatsapp-linked.ts`; shared
  queries → `lib/queries/whatsapp-linked`; DSS routes → `crates/whatsapp_linked`.

## Gotchas

- Mutations open `whatsapp.*` operation spans in the shared queries; HTTP
  trace propagation uses `safeFetch`. Record outcomes without server error bodies
  or pairing material.
- Pairing material (QR, codes) stays in the `ph-no-capture` dialog and the
  never-persisted, `gcTime: 0` pairing query. Never put it in a URL or log.
- The QR is encoded locally with `uqr`; never send the value to an image service.
- `core/pairing.ts` matches DSS's pairing states exhaustively; a new state
  must be handled there, not fall through to "preparing".
- Wire types come from DSS's generated `@service-storage/generated/schemas`
  (`Linked*`); change `crates/whatsapp_linked` and regenerate, never hand-type.
- Adoption failures carry DSS's `LinkedError` code (`whatsappErrorResponse`);
  `core/adopt.ts` words each one. Never show a catch-all message.
- The chat list (`GET /meta/linked/chats`) arrives sorted by recent activity;
  keep DSS's order. Sections follow its `group`/`shared`/`can_add`/
  `cannot_add_reason` fields; direct chats are listed but not addable until DSS
  says `can_add` (it does now; only the chat with yourself isn't).
  User-facing copy says "chat", not "group". Community groups show as "Community · Group"
  (`communityTitle`); disappearing and community groups are addable, a
  community itself is not.
- Adoption grants access only to its owner; the generic Share dialog manages
  later access. No special audience lists or WhatsApp membership requirement
  for viewing.

## Checks

- `bunx vitest run --project app src/features/whatsapp-linked`
- `bun run test:functional -- 'whatsapp-linked.spec.ts$'` (mocked `/meta/linked` routes)

## Related

- Rules: `.agents/rules/web/architecture.md` (FE-33) · Docs:
  `docs/agent-guide/external.md`
