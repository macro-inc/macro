# Macro SDK

## What it is

The public TypeScript SDK wraps generated service clients in entity handles.
Authentication and service hosts come from `MacroClient`; permissions remain
enforced by the ordinary backend APIs.

## Start here

- `src/macro.ts`: public exports and namespace registration.
- `documents.createCanvas()` creates shared content before returning a Document handle;
  it requires no browser open or upload. `document.canvas()` (`entities/canvases/canvas.ts`, its own code-mode entity)
  reads (`scene`), edits (`apply` code against a revision, `edit` by instructions) and
  renders the live scene over DSS `/documents/{id}/canvas/*`; `render` returns a
  `StaticImage` the server stored, since static file storage rejects API keys.
  `Canvas.webUrl()` is `/app/canvas/<id>`; `Document.webUrl()` uses the loaded
  native file type's route and falls back to `/app/md/` before detail loads.
- `documents.createSpreadsheet()` and `documents.spreadsheet(document)` return a
  `Spreadsheet` (`src/entities/spreadsheets/spreadsheet.ts`, its own code-mode entity) whose `read`,
  `calculate` and `applyEdits` run the spreadsheet tools' engine, and whose
  `edit(instructions)` overrides `Document.edit` with the worker's spreadsheet
  writer model; code mode hides `ReadSpreadsheet`, `CalculateSpreadsheet` and
  `EditSpreadsheet`.
- File bytes must work inside code mode, whose sandbox reaches only Macro hosts:
  `documents.upload()` posts them to storage's `/documents/upload`, and
  `Document.bytes()` downloads through the CloudFront export host (`document-content`
  in the harness's `sdk_endpoints`). Never return a presigned S3 URL as the only path.
- `src/entities/entity.ts`: lazy detail reads, mutation invalidation and safe JSON.
- `Document.readPresentation`/`editPresentation`/`copyPresentation`,
  `readWord`/`editWord`, and `readDesign`/`readPhotoshop`/`readIllustrator`
  run the matching direct tools' services through storage routes; the edit
  operation unions are generated from `pptx_engine::EditOp` and
  `WordDocumentOperation` (`office-files.ts` aliases them).
- `src/entities/workspace/namespace.ts`: filtered activity pages and iteration,
  agent sessions included.
- `src/entities/search/namespace.ts`: `macro.search`, one unified search across
  every kind of item with the direct search tools' filters (types, exact match,
  tags, inbox, agent session transcripts), returning typed handles.
- `src/entities/calendar/booking-namespace.ts`: `macro.calendar.booking`, booking links
  (`BookingLink`), settings, booked meetings (`Booking`) and insights over calendar
  `/scheduling`. Link writes carry the user's quoted `userConfirmation`, which the
  route rejects when blank; `BookingLink` handles keep their `team` for edits.
- `src/entities/routines/`, `agents/`, `harnesses/`: automation and agent hosts.
  `harnesses.directory()` lists teammates' hosts and `Harness.requestAccess()`
  asks for one. Granting takes the owner's own session, so the server refuses
  `Harness.access.grant` and `resolve` from any SDK credential.
  `agents.list()` reads storage agent records, which built-in personas lack;
  `agents.coding()` reads the harness `GET /coding-agents` listing (Cursor
  included) that the `ListCodingAgents` tool serves. `routines.create` takes
  either the single agent task or `steps` (generated `CodeStep`s, agent steps
  with `Agent` handles) and `dangerouslyOperateAsUser`, which its TSDoc
  restricts to an explicit user request; `routineBody` maps both onto the
  scheduler's `RoutineTask`. `routines.check` sends the same body to
  `POST /scheduled-actions/check` (as `{routine, created}`), which runs
  saving's checks and saves nothing; code mode's catalog lists it as a read.
  `created` takes handles with an `entityType` (`CreatedEntity`) and is kept
  with a routine draft for its review.
- `users.search(nameOrEmail)` searches existing Macro contacts with batched auth
  names and returns seeded User handles; it is not a global directory. Empty
  contact sets are 404, but authorization/service errors must propagate.
- `src/entities/sharing/`, `messages/`: scoped access requests and message threads.
- `src/entities/databases/query.ts`: SQL statements, typed table/row references and version guards.
- `Contact.setEmail(address)` adds a missing address; `setCompany(company)`
  links or switches a known personal-provider contact. Neither accepts clearing.
- `src/entities/databases/saved-query.ts`: `database.saveQuery()` / `table.saveQuery()`
  save a checked `SELECT` server-side and return a `SavedQuery` whose `toBlock()` is the
  document's `<m-db-query>` block. The block format must match lexical-core's
  `parseDatabaseQueryData`; `withView()` follows the AI editor's `setDatabaseQueryView` rules.
- `src/entities/crm/pipeline.ts`: pipeline-authorized table/row/view handles;
  `PipelineTable.views()` returns views whose `positions()` reads saved board order.
- `src/entities/crm/pipeline-entry.ts`: `PipelineEntry` handles from the
  name-based pipeline methods (`find`, `addRecords`, `updateEntries`,
  `removeRecords`, `edit`, `importCsv`/`exportCsv`), which call
  `crm::inbound::pipeline_workflows`; field values are tagged by kind.
- `src/entities/saved-views/`: `macro.savedViews` over the revision-guarded
  `/saved_views/definitions` routes; `edit` and `remove` send the revision the
  handle last saw, and keep the response's record so chained writes stay guarded.
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
  service, because static file storage does not accept API keys. `update` takes a
  `StaticImage`; `macro.images.byId(savedId)` rebuilds one to switch back without
  re-uploading. `me.profilePicture()`, `User.profilePicture()`
  and `users.profilePictures()` read `POST /user/profile_pictures`, returning a
  `StaticImage` for static file URLs (path `/file/<uuid>`, any public base) and an
  `ExternalProfilePicture` (`{ url }`) for legacy ones (`users/profile-picture.ts`). `team.invite(emails, { agent: true })`
  invites agents; their token only ever appears in the web app's setup modal.
- `src/entities/images/`: `macro.images.generate()` (cognition
  `POST /images/generate`, admitted against the user's AI allowance) returns a
  sized `GeneratedImage`; `StaticImage` handles attach to `channel.send(text,
  { images })` and `thread.reply` as `static/image` attachments, and
  `Document` handles as `document` attachments (`{ documents }`).
  `toMarkdown()` (also `markdown` in `toJSON()`) writes the `<m-image>` tag that
  shows one inline. It must match lexical-core's `I_IMAGE_CONSTRAINED`
  (pinned in `lexical-core/tests/generated-image.test.ts`).
- `src/entities/documents/text-comment.ts`: `Document.commentOnText()` anchors a
  thread to quoted text (`POST /documents/{id}/comments/text`, the
  `CommentOnText` tool's domain function); a 422 becomes
  `CommentQuoteNotPlacedError` carrying the reason.
- `src/entities/web/`: `macro.web.search()` / `macro.web.fetch()` (cognition
  `POST /web/search`, `/web/fetch`, Tavily via `crates/web_search`), admitted and
  metered against the user's AI allowance; code mode hides the `WebSearch` /
  `WebFetch` tools in their favour.
- `src/entities/bots/`: `macro.bots` manages bots (`Bot`: profile, channel
  grants, webhook URLs, `BotToken`s) with user auth, and reads the
  authenticated bot (`me`, `channels`) with bot auth. Code mode hides the
  bot-management tools in its favour; `IssueBotCredential` stays, because its
  chat card mints a token the model never reads.
- `src/entities/memory/`, `activity/`: `macro.memory.read()`/`edit()` (cognition
  `/memory/explicit`) and `macro.activity.mine()` (cognition `/activity`);
  `User.activity()` reads `/memory/activity` and `Initiative.activity()` DSS
  `/initiatives/{id}/activity`. Code mode hides the matching direct tools.
- `services.ts`, `openapi-ts.config.ts`: generated service contract inputs.
- `src/calls/`: optional Node and browser LiveKit helpers, exported only as
  `@macro-inc/sdk/calls/node` and `@macro-inc/sdk/calls/browser`. Keep them out of
  `src/macro.ts` and its dependency graph; LiveKit runtimes stay optional peers.
- `src/entities/calls/`: live and recorded call handles; token-bearing `CallConnection` never serializes its token.

## Boundaries

- Keep handwritten behavior in `src/`; never edit `generated/` or `specs/`.
- Keep WhatsApp pairing, passkeys, connection setup/disconnect and rollout configuration out of the handwritten public SDK; operate on accounts linked in the app, with personal bearer sessions for account/access controls. External chat sends/uploads accept the connection owner's session or own API token; bots never send.
- Use POST to start channel calls and call-id scoped joins/leaves; the legacy GET starts a call as a side effect.
- One item's mute, snooze and unmute are `muteNotifications`/`unmuteNotifications` on every favoritable handle; keep mute-all, email unsubscribe and bulk item preferences in the app-only coverage exclusions.
- Keep `external-chat/` provider-neutral; provider-specific reads (WhatsApp community chats) branch on `provider` with an exhaustive match.
- Use existing entity handles for reads and mutations. Follow the
  [SDK rule](../../.agents/rules/sdk.md) and `add-sdk-endpoint` skill.
- `../sdk-docs/` generates the public TypeDoc reference and static docs Worker.
  Consumer application bundles belong to their consumer. The calls entry points
  are built separately from core, with LiveKit and OpenTelemetry external.

## Checks

Run from this directory: `bun test`, `bun run check`, `bun run coverage`, and
`bun run lint`. After building, run `bun run check:pack` to verify isolated
consumer imports, types, and bundle separation. Coverage requires each generated
endpoint to be wrapped or explicitly classified in `src/coverage/skipped.ts`. Build output in `dist/` is
excluded from source linting.

## Local agent APIs

The default cognition and routine URLs use the harness host port 8101, with
`/cognition` and `/scheduled-action` respectively. Deployed base URLs retain
the existing gateway prefixes.

## Gotchas

- Dependency changes require refreshing both platform hashes in
  `nix-support/node_modules-hashes.json`; use
  `tooling/scripts/update-node-modules-hash.sh` on each platform. Nix code-mode
  generation otherwise restores dependencies from the old SDK snapshot.
- Every public method carries one MCP hint tag (`@readonly`, `@write` or
  `@destructive`, plus `@openworld`/`@idempotent` when true) or
  `@mcp-exclude <reason>`; `../sdk-mcp` turns methods into ChatGPT MCP tools
  by them and fails on an untagged method. A new or changed public method
  signature or hint tag updates that package's tool snapshots (`bunx vitest
  run -u` there); doc text alone does not.
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
- Lazy detail invalidation fences in-flight reads so a pre-write response cannot restore stale cached fields.
- Draft writes must select the draft's inbox with `X-Email-Link-Id`; callers
  supply plain HTML and the SDK encodes it for the draft wire contract.
- Read many task or initiative names with `tasks.summaries` (`/documents/preview`)
  or `initiatives.summaries` (the list response); `name()` per handle loads each
  entity. `initiatives.list(filters)` pages `/initiatives/page` and maps
  the system Status and Priority option ids to names; keep its tables in step
  with `system_properties`' `StatusOption` and `PriorityOption`. Task create
  `propertyValues` replace the service defaults (creator assigned, Not
  started), so `Task.create` spells them out when it sends any.
- CRM records and initiatives share `messages/discussion.ts`: their comments are
  messages under a `crm_company`, `crm_contact` or `initiative` parent.
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

## Call media entry points

- See `CALLS.md` for the optional room helpers. `src/calls/common.ts` owns connection
  cleanup, `node.ts` publishes caller-supplied frames, and `browser.ts` publishes
  MediaStreams. Keep the existing one-time leave and audio DTX defaults.
- Never log, trace, or serialize room tokens. Call spans use `@opentelemetry/api`
  and are no-ops without a host tracer provider.
- Node has no room-wide publish defaults, so `publishTrack` is wrapped to disable
  audio DTX. Unpublish Node tracks by publication SID; browser tracks by object.
- Keep LiveKit and OpenTelemetry external in the calls build so room objects and
  tracing use the consumer's runtime instances. Do not re-export calls helpers
  or their runtime types from `src/macro.ts`.
