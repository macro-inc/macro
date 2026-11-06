# Macro SDK

## What it is

The public TypeScript SDK wraps generated service clients in entity handles.
Authentication and service hosts come from `MacroClient`; permissions remain
enforced by the ordinary backend APIs.

## Start here

- `src/macro.ts`: public exports and namespace registration.
- `documents.createCanvas()` creates shared content before returning a Document handle;
  it requires no browser open or upload.
- File bytes must work inside code mode, whose sandbox reaches only Macro hosts:
  `documents.upload()` posts them to storage's `/documents/upload`, and
  `Document.bytes()` downloads through the CloudFront export host (`document-content`
  in the harness's `sdk_hosts`). Never return a presigned S3 URL as the only path.
- `src/entities/entity.ts`: lazy detail reads, mutation invalidation and safe JSON.
- `src/entities/workspace/namespace.ts`: filtered activity pages and iteration,
  agent sessions included.
- `src/entities/search/namespace.ts`: `macro.search`, one unified search across
  every kind of item with the direct search tools' filters (types, exact match,
  tags, inbox, agent session transcripts), returning typed handles.
- `src/entities/routines/`, `agents/`, `harnesses/`: automation and agent hosts.
- `users.search(nameOrEmail)` searches existing Macro contacts with batched auth
  names and returns seeded User handles; it is not a global directory. Empty
  contact sets are 404, but authorization/service errors must propagate.
- `src/entities/sharing/`, `messages/`: scoped access requests and message threads.
- `src/entities/databases/query.ts`: SQL statements, typed table/row references and version guards.
- `src/entities/crm/pipeline.ts`: pipeline-authorized table/row/view handles;
  `PipelineTable.views()` returns views whose `positions()` reads saved board order.
- `src/entities/external-chat/`: added provider chats (`macro.externalChats`, entity type
  `external_chat`) and their message/send/upload/participant handles.
- `src/entities/connected-apps/`: `macro.connectedApps.list(execution)` returns the
  connected apps and custom MCP servers a running code execution's session
  agent was given; `app.tools()` and `tool.call(args)` go through the harness,
  which stamps the credential and holds each owner-account call in a turn
  someone else prompted for the owner's approval. `discover(execution, name)`
  and `Connector.inspect()` mirror `DiscoverConnectors`; `addServer` mirrors
  `ConnectMcpServer`. Only works inside a running execution.
- `src/entities/whatsapp/`: the owner's WhatsApp account and chat list; `WhatsAppChat.add()`
  returns an `ExternalChat`.
- `src/entities/me/`: `macro.me.update()` sets the caller's name and profile
  picture; `macro.me.uploadProfilePicture()` stores the image through the auth
  service, because static file storage does not accept API keys. `team.invite(emails, { agent: true })`
  invites agents; their token only ever appears in the web app's setup modal.
- `src/entities/images/`: `macro.images.generate()` (cognition
  `POST /images/generate`, admitted against the user's AI allowance) returns a
  sized `GeneratedImage`; `StaticImage` handles attach to `channel.send(text,
  { images })` and `thread.reply` as `static/image` attachments.
- `src/entities/web/`: `macro.web.search()` / `macro.web.fetch()` (cognition
  `POST /web/search`, `/web/fetch`, Tavily via `crates/web_search`), admitted and
  metered against the user's AI allowance; code mode hides the `WebSearch` /
  `WebFetch` tools in their favour.
- `src/entities/bots/`: `macro.bots` manages bots (`Bot`: profile, channel
  grants, webhook URLs, `BotToken`s) with user auth, and reads the
  authenticated bot (`me`, `channels`) with bot auth. Code mode hides the
  bot-management tools in its favour; `IssueBotCredential` stays, because its
  chat card mints a token the model never reads.
- `services.ts`, `openapi-ts.config.ts`: generated service contract inputs.
- `../sdk-calls/`: optional Node and browser LiveKit room helpers for call handles.
- `src/entities/calls/`: live and recorded call handles; token-bearing `CallConnection` never serializes its token.

## Boundaries

- Keep handwritten behavior in `src/`; never edit `generated/` or `specs/`.
- Keep WhatsApp pairing, passkeys, connection setup/disconnect and rollout configuration out of the handwritten public SDK; operate on accounts linked in the app, with personal bearer sessions for account/access controls. External chat sends/uploads accept the connection owner's session or own API token; bots never send.
- Use POST to start channel calls and call-id scoped joins/leaves; the legacy GET starts a call as a side effect.
- Keep notification mute, unmute, and snooze endpoints, including bulk item preferences, in the app-only coverage exclusions.
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

- Every entity's namespace class carries one `@routing` sentence ("Use when …;
  not …") that agents route on, and may carry an `@agent` block: how that area
  of Macro works, for agents only. Both are stripped from the public
  reference, and code-mode generation fails without the routing sentence. Put
  an area's rules there, never in `crates/prompt`; cross-namespace search
  guidance lives on `SearchNamespace` in `search/namespace.ts`.
- Code mode puts each relevant entity's index in the agent turn, at most 48
  KiB: a method's signature and the first sentence of its doc, cut at 160
  characters. Anything else reaches an agent only through `ReadCodeDocs`, which
  it calls for the methods a program uses and rarely for a class. Open a
  method's doc with the rule an agent must follow, and put the detail on that
  method, not only on the namespace class.
- Calendar occurrences carry each copy's `inbox` and `role`; one meeting on
  several of the user's inboxes is one event per inbox. `update`,
  `inviteGuests` and `delete` take the copy's `inbox`, and an agent run that
  omits it on such a meeting is refused with `copy_choice_required`.
- `inbox` is the account syncing a calendar, so it stays the user's address on
  a colleague's calendar. Occurrences name the calendar (`calendarName`) and
  whether it is on the user's schedule (`contributesToAvailability`); provider
  access says nothing about whose calendar it is, and `role` counts `organize`
  only on such a calendar, since writing someone's calendar grants it too. An
  own attendee row marked organizer counts only on a copy the user can change
  (`isReadOnly` false): Outlook names the mailbox owner as organizer on every
  event of a read-only calendar. `eventRole` and `EventRole::of` must stay
  in step.
- Regenerate Rust OpenAPI and web service clients before `bun run sync-specs &&
  bun run generate`; do not copy deployed schemas over a local API change.
- Run `bun run generate` to regenerate SDK clients and normalize whitespace-only
  lines; do not hand-edit generated output to satisfy whitespace checks.
- The SDK reference (`../sdk-docs`) and the code-mode bundle and documentation
  (`crates/code_mode_assets`) are generated from this source at build time and
  never committed; run `bun run test` in `../sdk-docs` and `../code-mode-sdk`
  after changing public API or comments.
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
- Team routes act on the caller's current team, which the auth service
  resolves from the principal. `Team.invite` and `Team.invites` send the
  handle's `team_id`, which the route checks in the same request (409 on a
  mismatch); `members` checks the team in the `GET /team` response it reads.
  `/team/invite` answers 304 when it created no invite; `Team.invite` reports
  that as `false`. A 204 from `GET /team` (no team) parses as an empty
  object, not `undefined`.
- Keep access-request resolution snapshots: resolved requests leave pending lists.
- `CrmPipeline.stageRequirements()` and `setStageRequirements()` use pipeline
  column and option handles; `PipelineColumn.options()` supplies stable options.
  Stage requirements are enforced on every pipeline operation batch.
- Pipeline schema reads share the parent's cache; successful op batches clear it.
- Email sends and other writes against hosted data are real actions; use mocks
  for automated SDK mutation tests.
- `email.send`, `EmailThread.reply` and `calendar.createEvent` are refused
  (403) for an agent's program, and so are `EmailDraft.send`/`schedule`
  without `userConfirmation`. Programs act through
  `execution.reviews.create` or the confirmed methods: `email.sendConfirmed`
  and `EmailMessage.forwardConfirmed` (cognition `send-confirmed`, typed with
  the generated `SendEmail`/`SendEmailResponse` review types) and
  `calendar.createConfirmed` (`CreateCalendarEvent_Deserialize`,
  `ToolCalendarEvent`); the OpenAPI schemas are opaque.

- Carry the generation read with the draft through each mutation, including
  transfer and save. Attachment handles retain their reservation generation
  through completion and removal. A stale-generation rejection requires a fresh
  draft read and explicit reapproval; never refresh the generation to replay an
  old edit.
- SQL result schemas are dynamic typed-cell unions; inspect `truncatedTables` before interpreting aggregates. Queries can write and are never retried automatically.

- Workspace-import report/cancel endpoints remain app-only review plumbing,
  explicitly classified alongside the existing Notion routes in coverage skips.

- `AgentSession.activity()` and invocation handles iterate durable agent-correlated history lazily; session visibility controls the feed.
