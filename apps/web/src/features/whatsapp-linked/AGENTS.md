# whatsapp-linked

## What it is

Personal WhatsApp accounts linked as devices (External tab → WhatsApp): link an
account by QR, list its WhatsApp chats, and add a group or direct chat as its
own shareable external chat (`POST /external-chats` with `provider:
'whatsapp'`). Each person sends from their own account. Behind the `enable-whatsapp-linked` flag.

## Start here

- `whatsapp-linked.tsx`: production wiring (shared queries + split navigation).
- `context/whatsapp-linked-context.tsx`: the capability contract tests fake.
- `views/whatsapp-page.tsx`: account states, the header (search + account
  strip), the chat sections and Can't be added, and the pairing/confirm
  dialogs.
- `components/conversation-sections.tsx` + `core/chat.ts`
  `conversationSections`: Direct messages / Groups / one section per
  community, on view-shell's `CollapsibleSection` (what Chat's rail uses);
  External's sidebar renders the same sections. Open state is
  `primitives/open-sections.ts`, per user.
- `components/chat-list.tsx`: one-line chat rows styled like Macro's list rows
  (`bg-list-hover`, actions on hover/focus, always on touch).
- Starting chats: `core/chat.ts` `chatSections` puts saved contacts nobody
  wrote to (direct, no `lastActivityAt`) in `contacts`, shown as the page's
  Contacts section. `components/new-chat-dialog.tsx` takes a number
  (`core/new-chat.ts` normalises it to E.164 and words each
  `NewChatFailure`); the `startChat` capability looks it up
  (`useLookUpWhatsappNumberMutation` polls `GET /whatsapp/lookups/{id}`),
  then adds and opens the chat.
- `components/history-import-prompt.tsx`: the app-wide bottom-right prompt
  (mounted lazily in `Layout.tsx`) to import earlier messages of the owner's
  chats waiting for their phone (`core/history-import.ts`); its **Import** is
  the only thing that asks the phone (`POST /whatsapp/history-import`).
- `core/chat.ts`: chat sections, search matching and row wording.

## Scope

- Owns: the WhatsApp account page, pairing dialog, one-click add (no
  dialog; DSS names the chat after WhatsApp) and the New chat dialog.
- Chat timeline and sending: `features/external-chat`; channels only reach a
  chat through a mention, which shares it (`MentionsMenu`).
- One account at a time: there is no replace flow; switching means
  Disconnect, then Connect.
- Not here: the External tab shell, the chats nested under each provider in
  its sidebar and the `/external/chat/:chatId` route →
  `features/external-view`; HTTP → `lib/service-clients/service-storage/whatsapp-linked.ts`
  (DSS `/whatsapp/*`) and `external-chats.ts` (adding); shared queries →
  `lib/queries/whatsapp-linked`; DSS routes → `crates/whatsapp_linked`.

## Gotchas

- Mutations open `whatsapp.*` operation spans in the shared queries; HTTP
  trace propagation uses `safeFetch`. Record outcomes without server error bodies
  or pairing material.
- Pairing material (QR, codes) stays in the `ph-no-capture` dialog and the
  never-persisted, `gcTime: 0` pairing query. Never put it in a URL or log.
- The QR is encoded locally with `uqr`; never send the value to an image service.
- `core/pairing.ts` matches DSS's pairing states exhaustively; a new state
  must be handled there, not fall through to "preparing".
- `primitives/pairing-flow.ts` replaces an expired pairing on its own (like
  WhatsApp Web) only when the server says `expired`, the tab stayed visible,
  and fewer than `AUTO_ROLLS` codes rolled since the last click; otherwise the
  QR square offers **Show a new code**. A pairing that arrives after Cancel is
  cancelled at once.
- Disconnect results are toasts, not page state.
- Wire types come from DSS's generated `@service-storage/generated/schemas`
  (`WhatsApp*`, `ExternalChat*`); change `crates/whatsapp_linked` and
  regenerate, never hand-type.
- Add failures carry DSS's `LinkedError` code (`whatsappErrorResponse`);
  `core/add.ts` words each one. Never show a catch-all message.
- The chat list (`GET /whatsapp/chats`) arrives sorted by recent activity;
  keep DSS's order. Sections follow its `added`/`shared`/`canAdd`/
  `cannotAddReason` fields; direct chats are addable, except the chat with
  yourself. DSS sends reason codes (`cannotAddReason`, and
  `cannot_add_<reason>` on a refused add); `core/chat.ts` words them.
  User-facing copy says "chat", not "group". Community groups show as "Community · Group"
  (`communityTitle`); disappearing and community groups are addable, a
  community itself is not.
- Adding grants access only to its owner; the generic Share dialog manages
  later access. Viewing never requires WhatsApp membership.

## Checks

- `bunx vitest run --project app src/features/whatsapp-linked`
- `bun run test:functional -- 'whatsapp-linked.spec.ts$'` (mocked `/whatsapp` and `/external-chats` routes)

## Related

- Rules: `.agents/rules/web/architecture.md` (FE-33) · Docs:
  `docs/agent-guide/external.md`
