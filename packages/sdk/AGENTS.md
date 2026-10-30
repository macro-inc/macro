# Macro SDK

## What it is

The public TypeScript SDK wraps generated service clients in entity handles.
Authentication and service hosts come from `MacroClient`; permissions remain
enforced by the ordinary backend APIs.

## Start here

- `src/macro.ts`: public exports and namespace registration.
- `documents.createCanvas()` creates shared content before returning a Document handle;
  it requires no browser open or upload.
- `src/entities/entity.ts`: lazy detail reads, mutation invalidation and safe JSON.
- `src/entities/workspace/namespace.ts`: filtered activity pages and iteration.
- `src/entities/routines/`, `agents/`, `harnesses/`: automation and agent hosts.
- `users.search(nameOrEmail)` searches existing Macro contacts with batched auth
  names and returns seeded User handles; it is not a global directory. Empty
  contact sets are 404, but authorization/service errors must propagate.
- `src/entities/sharing/`, `messages/`: scoped access requests and message threads.
- `src/entities/databases/query.ts`: SQL statements, typed table/row references and version guards.
- `src/entities/crm/pipeline.ts`: pipeline-authorized table/row handles.
- `src/entities/external-chat/`: added provider chats (`macro.externalChats`, entity type
  `external_chat`) and their message/send/upload/participant handles.
- `src/entities/whatsapp/`: the owner's WhatsApp account and chat list; `WhatsAppChat.add()`
  returns an `ExternalChat`.
- `services.ts`, `openapi-ts.config.ts`: generated service contract inputs.

## Boundaries

- Keep handwritten behavior in `src/`; never edit `generated/` or `specs/`.
- Keep WhatsApp pairing, passkeys, connection setup/disconnect and rollout configuration out of the handwritten public SDK; operate on accounts linked in the app, with personal bearer sessions for account/access controls. External chat sends/uploads accept the connection owner's session or own API token; bots never send.
- Keep `external-chat/` provider-neutral; provider-specific reads (WhatsApp community chats) branch on `provider` with an exhaustive match.
- Use existing entity handles for reads and mutations. Follow the
  [SDK rule](../../.agents/rules/sdk.md) and `add-sdk-endpoint` skill.
- `../sdk-docs/` generates the public TypeDoc reference and static docs Worker.
  Runtime-specific bundles belong to their consumer, not this package.

## Checks

Run from this directory: `bun test`, `bun run check`, `bun run coverage`, and
`bun run lint`. Coverage requires each generated endpoint to be wrapped or
explicitly classified in `src/coverage/skipped.ts`. Build output in `dist/` is
excluded from source linting.

## Local agent APIs

The default cognition and routine URLs use the harness host port 8101, with
`/cognition` and `/scheduled-action` respectively. Deployed base URLs retain
the existing gateway prefixes.

## Gotchas

- Code mode puts at most 48 KiB of SDK docs in each agent turn; a section
  larger than that (calendar is about 78 KB) arrives as its namespace class
  page only. Put rules an agent must follow on the namespace class or the
  methods it lists, not only on an entity's methods, which agents read only
  when they request the section.
- Calendar occurrences carry each copy's `inbox` and `role`; one meeting on
  several of the user's inboxes is one event per inbox. `update`,
  `inviteGuests` and `delete` take the copy's `inbox`, and an agent run that
  omits it on such a meeting is refused with `copy_choice_required`.
- Calendar notes accept a document handle and the occurrence returned by calendar
  reads. `CalendarNote` owns optional team sharing and unlinking; clearing its team
  sends explicit null and never changes the document's other permissions.
  `Document.meetingNotes()` discovers visible meeting links for readers and
  durable grants for owners to revoke after losing
  meeting access.
- Regenerate Rust OpenAPI and web service clients before `bun run sync-specs &&
  bun run generate`; do not copy deployed schemas over a local API change.
- Regenerate `../sdk-docs/reference` after SDK source or generated type changes;
  run that package's checks because web CI verifies the reference is current.
- Run `bun run generate` and the checks in `../code-mode-sdk` after SDK changes
  to keep the embedded Deno bundle, agent documentation, and operation catalog current.
  Commit `crates/agent_code_mode/src/domain/documentation.json`; CI's Typecheck
  fails when it is stale.
- `generated/agent-fold/` is not from OpenAPI: `cargo run -p agent_fold --bin
  export_types` writes it, and `foldedLog()` casts the opaque wire schema to it.
- System events project separately in fold metadata and never appear as user
  messages in `foldedLog()`; silent notification turns have no assistant message.
- Fold metadata notifications use a generated `kind`-discriminated payload union;
  keep its phased serialization types and stored JSON shape aligned.
- Workspace advanced filters use the server's serialized AST names, not Rust
  enum variant names. Validate new filter examples against the real local API.
- Async iterators are lazy; `limit` is page size. Preserve filters on every page
  and do not fetch another page after the caller breaks the loop.
- Handles must serialize identity or loaded detail, never authenticated clients.
- Draft writes must select the draft's inbox with `X-Email-Link-Id`; callers
  supply plain HTML and the SDK encodes it for the draft wire contract.
- Read many task or initiative names with `tasks.summaries` (`/documents/preview`)
  or `initiatives.summaries` (the list response); `name()` per handle loads each
  entity. Task create `propertyValues` replace the service defaults (creator
  assigned, Not started), so `Task.create` spells them out when it sends any.
- Meeting list lookup only covers the owner's newest 100 standalone meetings;
  handles seeded from invitations retain their token for refetching after writes.
- Keep access-request resolution snapshots: resolved requests leave pending lists.
- Pipeline schema reads share the parent's cache; successful op batches clear it.
- Email sends and other writes against hosted data are real actions; use mocks
  for automated SDK mutation tests.

- Carry the generation read with the draft through each mutation, including
  transfer and save. Attachment handles retain their reservation generation
  through completion and removal. A stale-generation rejection requires a fresh
  draft read and explicit reapproval; never refresh the generation to replay an
  old edit.
- SQL result schemas are dynamic typed-cell unions; inspect `truncatedTables` before interpreting aggregates. Queries can write and are never retried automatically.

- Workspace-import report/cancel endpoints remain app-only review plumbing,
  explicitly classified alongside the existing Notion routes in coverage skips.
