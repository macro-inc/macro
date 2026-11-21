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
  `MacroClient` wraps its search service client in the process's search
  limit when one is set (`setDefaultSearchLimit` in `utils/concurrency.ts`,
  `limitSearches` in code mode, whose bootstrap installs 4): every client's
  searches, every entity's search included, share it and wait in call order.
  Other processes (agent teammates, workers, npm users) set none.
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
  `steps` (generated `CodeStep`s whose `entity` knobs hold an
  `EntityReference` to a handle, sent as its id, or `null` when unpicked, so
  a stored step passes back with each picked item given again by `byId`;
  agent steps with `Agent` handles) and `dangerouslyOperateAsUser`, which
  its TSDoc restricts to an explicit user request, or the older single agent
  task. `appearance` (`RoutineCommonOptions`) is the agent's pick of an icon
  from Macro's set and a colour, for create, update and `check`; the server
  refuses an icon outside the set and never lets a pick replace a look the
  owner chose. Its examples use steps only: agents copy them, and a routine
  draft hands back steps, converting a single agent task when it can
  (`scheduled_action` drafts).
  `routineBody` maps both onto the
  scheduler's `RoutineTask`. `routines.create(options, { key })` passes
  `?key=`; inside a routine's run the server makes the new routine a
  sub-routine of the running routine, from the credential alone, and a
  repeated key updates it. `routines.list()` returns top-level routines;
  `{ includeChildren }` adds active sub-routines and `{ parent }` returns one
  routine's. `Routine.parent()`, `createdByRun()` (a `RoutineRun`), `key()`,
  `children()` and `keepAsOwn()` read and change the link, and
  `RoutineExecution.created` holds the routines a run created. The rules an
  agent needs are in the `@agent` block on `RoutineNamespace`, which the
  routine drafter also reads; code mode follows it with the Compose Routines
  skill (`crates/system_skills`), how a session writes one from a chat.
  `routines.check` sends the same body to
  `POST /scheduled-actions/check` (as `{routine, created, missingApps}`),
  which runs saving's checks and saves nothing; code mode's catalog lists
  it as a read. `created` takes handles with an `entityType`
  (`CreatedEntity`) and is kept with a routine draft for its review;
  `missingApps` names apps its Ask AI step needs that aren't connected, for
  the draft's review to ask for. A routine's `apps` (`RoutineApp`) are its
  task's `mcp_servers`, sent only when given.
- `src/entities/task-templates/`: personal/team template handles, replay-safe
  creation keys, optional default task titles and task-sharing defaults, selected
  fields with optional defaults, and revision-guarded writes. Team membership and
  creator/admin management stay server-authorized.
- `users.search(nameOrEmail)` is one `GET /contacts/search`: the server
  ranks the caller's contacts and current team (teammates first, then, for a
  caller on the list-aware directory, `interacted`/`invited` and then email
  contacts; at most 20; each person carries `lists`)
  and the SDK seeds User handles with each name and agent flag, keeping that
  order. It is not a global directory, and the full `GET /contacts` list stays
  out of the SDK.
- `src/entities/sharing/`, `messages/`: scoped access requests and message threads.
- `src/entities/databases/query.ts`: SQL statements, typed table/row references and version guards.
- `Contact.addEmail` / `removeEmail` / `setEmail` (choose the primary) edit a
  contact's addresses; `setCompany(company)` links or switches a contact with a
  personal-provider primary and `unlinkCompany()` removes the link. The server
  refuses to unlink or move a company-domain contact (`companyDomain`).
- `src/entities/databases/saved-query.ts`: `database.saveQuery()` / `table.saveQuery()`
  (or `databases.saveQuery()` for a question that spans databases, sent with no
  `databaseId`) save a checked `SELECT` server-side and return a `SavedQuery` whose `toBlock()` is the
  document's `<m-db-query>` block. The block format must match lexical-core's
  `parseDatabaseQueryData`; `withView()` follows the AI editor's `setDatabaseQueryView` rules.
- `src/entities/crm/pipeline.ts`: pipeline-authorized table/row/view handles;
  `PipelineTable.views()` returns views whose `positions()` reads saved board order.
- `crm.pipelines.listWithFields()` returns every pipeline with its fields
  (Stage's options are its stages) and version in one
  `GET /crm/pipelines/details`; `list()` stays the plain pipeline list.
- `src/entities/crm/pipeline-entry.ts`: `PipelineEntry` handles from the
  name-based pipeline methods (`find`, `addRecords`, `updateEntries`,
  `removeRecords`, `edit`, `importCsv`/`exportCsv`), which call
  `crm::inbound::pipeline_workflows`; field values are tagged by kind.
- `src/entities/saved-views/`: `macro.savedViews` over the revision-guarded
  `/saved_views/definitions` routes; `edit` and `remove` send the revision the
  handle last saw. Successful writes clear cached detail so chained writes reload the current revision even when appearance and definition responses arrive out of order. `appearance()` reads shared icon/color overrides; `setAppearance()` updates them without advancing the filter revision, and creation accepts optional initial appearance.
- `src/entities/external-chat/`: added provider chats (`macro.externalChats`, entity type
  `external_chat`) and their message/send/upload/participant handles.
- `src/entities/connected-apps/`: `macro.connectedApps.list(execution)` returns the
  connected apps and custom MCP servers a running code execution's session
  agent was given; `app.tools()` and `tool.call(args)` go through the harness,
  which stamps the credential and holds each owner-account call in a turn
  someone else prompted for the owner's approval. `discover(execution, name)`
  and `Connector.inspect()` mirror `DiscoverConnectors`; `addServer` mirrors
  `ConnectMcpServer`. Only works inside a running execution.
- `src/entities/ui/`: `macro.ui.open(execution, item)` opens an item (a handle
  with `webUrl()`, or `macro.ui.link(url)`, which refuses non-Macro links) in a
  new pane of the tab the user prompted from, through the harness's
  `ui-commands` route; it resolves `sent`, `no_client` or `declined` with the
  item's `url` to link instead. Only works inside a running execution.
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
  bot-management tools in its favour, `IssueBotCredential` too: a program
  presents a `botCredential` view, whose card mints a token the model never
  reads.
- `src/entities/imports/`: `macro.imports`, the import ledger (cognition
  `/import/entities`, `/import/notion/pages`): `list`, `track`,
  `recordImported`, `importNotionPage` and `ImportEntry.decline()`; code mode
  hides the matching ledger tools. `ImportEntry.item()` maps the row's
  `entity_type` (`md`, `task`, `channel`, `database`, `project`,
  `initiative`) to a handle.
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
- A fix to the generated client's runtime (`generated/*/core/`) is a patch of
  `@hey-api/openapi-ts`'s template in `apps/web/patches/` (root
  `patchedDependencies`; the Nix node_modules build reads patches only there),
  then `bun run generate`. `hey-api-openapi-ts-0.99.0.patch` makes stopping an
  SSE stream quiet and reconnects a stream the server ended (a restart or
  deploy), like `EventSource`; carry it forward on a generator upgrade.
  `listen({ onDrop, onOpen })` tells callers each drop and each open; resync
  after a reopen, not at the drop. `resume` (with `onEventId` for the cursor)
  asks the server to replay its short, per-process window: still resync.
- Keep the human-session-only Passwords vault endpoints, including batch import
  and name matching, private favorites and the human review of agent access requests, in coverage
  exclusions; normal human-session authorization and secret disclosure are
  outside v1 agent capabilities.
- `src/entities/passwords/`: `macro.passwords.forAgent(team, { wake })` is the
  agent vault for the agent's own API key; every call sends that wake's
  `X-Macro-Agent-Session-Id`. Its classes are `@mcp-exclude` and stay out of the
  code-mode catalog: disclosed values and codes go to the agent's secrets
  capability, never to model context.
- Keep WhatsApp pairing, passkeys, connection setup/disconnect and rollout configuration out of the handwritten public SDK; operate on accounts linked in the app, with personal bearer sessions for account/access controls. External chat sends/uploads accept the connection owner's session or own API token; bots never send.
- Keep hosted-computer management, Claude sign-in and internal provisioning
  routes in app-only coverage exclusions.

- Use POST to start channel calls and call-id scoped joins/leaves; the legacy GET starts a call as a side effect.
- One item's mute, snooze and unmute are `muteNotifications`/`unmuteNotifications` on every favoritable handle; keep mute-all, email unsubscribe and bulk item preferences in the app-only coverage exclusions.
- `notifications.send` pings people about an entity: it takes a required `body` (at most 280 characters; a ping has no title), a `NotificationLink` handle and `User` handles (`to` omitted pings the caller) and returns `{ notified, skipped }`, never raw ids; a recipient without access or whose inbox would not list the link is skipped with its reason, never shared with.
- Keep additive `/channel-sections` endpoints app-only; the public channel-label API retains its legacy membership semantics.
- Keep `external-chat/` provider-neutral; provider-specific reads (WhatsApp community chats) branch on `provider` with an exhaustive match.
- Use existing entity handles for reads and mutations. Follow the
  [SDK rule](../../.agents/rules/sdk.md) and `add-sdk-endpoint` skill.
- `appearance()` / `setAppearance()` live on supported entity handles; writes replace icon/color together, carry the `edited` SDK verb and idempotent `@write` hint, and invalidate cached detail only after success.
- `../sdk-docs/` generates the public TypeDoc reference and static docs Worker.
  Consumer application bundles belong to their consumer. The calls entry points
  are built separately from core, with LiveKit and OpenTelemetry external.

## Checks

Run from this directory: `bun test`, `bun run check`, `bun run coverage`, and
`bun run lint`. After building, run `bun run check:pack` to verify isolated
consumer imports, types, and bundle separation. Coverage requires each generated
endpoint to be wrapped or explicitly classified in `src/coverage/skipped.ts`, and
every wrapped method to have a verb in `src/utils/verbs.ts`. Build output in `dist/` is
excluded from source linting.

## Local agent APIs

The default cognition and routine URLs use the harness host port 8101, with
`/cognition` and `/scheduled-action` respectively. Deployed base URLs retain
the existing gateway prefixes.

## Gotchas

- The SDK is a root Bun workspace member: its dependencies resolve from the
  root `bun.lock`, and there is no `bun.lock` here.
  Remove obsolete package-local `node_modules` before generation so they cannot
  shadow the patched generators installed at the root.
- Dependency changes require refreshing both platform hashes in
  `nix-support/node_modules-hashes.json`; use
  `tooling/scripts/update-node-modules-hash.sh` on each platform. Nix code-mode
  generation otherwise restores dependencies from the old SDK snapshot.
- Every public method carries one MCP hint tag (`@readonly`, `@write`, `@send` or
  `@destructive`, plus `@openworld`/`@idempotent` when true) or
  `@mcp-exclude <reason>`; `../sdk-mcp` turns methods into ChatGPT MCP tools
  by them and fails on an untagged method. A new or changed public method
  signature or hint tag updates that package's tool snapshots (`bunx vitest
  run -u` there); doc text alone does not.
- Give each code-mode documentation topic exactly one `@routing` sentence
  ("Use when …; not …") on a participating namespace class; tasks and task
  templates share that sentence. An `@agent` block describes the area for agents
  only. Both tags are stripped from the public reference, and code-mode
  generation fails without the routing sentence. Put area rules there, never
  in `crates/prompt`; cross-namespace search guidance lives on
  `SearchNamespace` in `search/namespace.ts`.
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
  When a merge conflicts in `generated/`, first run them on the merged specs,
  since `code_mode_assets` (built by the OpenAPI exporters) type-checks the
  handwritten SDK against these clients; then regenerate the clients, and run
  them again on the exported specs.
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
- Code-mode programs are untyped JavaScript, so a mistyped option key is
  dropped silently. Create-style methods call `rejectUnknownOptions`
  (`src/utils/options.ts`) so it throws instead; the documents and tasks namespaces do.
- Async iterators are lazy; `pageSize` (or `limit`, where an iterator already
  named it so) is page size. Build every public auto-paginating iterator with
  `iterate` (`src/utils/pagination.ts`): it rejects unknown options and caps
  the total at `maxItems` without fetching past it. Say "`maxItems` caps the
  total" in the doc's first sentence, which is all the code-mode index shows.
  Preserve filters on every page and do not fetch another page after the
  caller breaks the loop.
- Handles must serialize identity or loaded detail, never authenticated clients.
- Lazy detail invalidation fences in-flight reads so a pre-write response cannot restore stale cached fields.
- Listings seed handles with `withListed` (`Channel.fromListing`, `EmailThread.fromPreview`, `Document.recent`), so `field()` reads skip the detail request. Seed only fields whose listing value means the same as the detail's; empty values still load, and any write or load drops the seed. Seeds never serialize.
- Draft writes must select the draft's inbox with `X-Email-Link-Id`; callers
  supply plain HTML and the SDK encodes it for the draft wire contract.
- Read many task or initiative names with `tasks.summaries` (`/documents/preview`)
  or `initiatives.summaries` (the list response); `name()` per handle loads each
  entity. `initiatives.list(filters)` pages `/initiatives/page` and maps
  the system Status and Priority option ids to names; keep its tables in step
  with `system_properties`' `StatusOption` and `PriorityOption`. Task create
  `propertyValues` replace the service defaults (creator assigned, Not
  started), so `Task.create` spells them out when it sends any.
- Omit `shareWithTeam` from task requests when unspecified so the backend applies session-aware defaults; preserve explicit true and false.
- `crm.emailPrivacy` (`src/entities/crm-email-privacy/`, the `crmEmailPrivacy` code-mode category) wraps own-member policy and existing privacy endpoints; preserve exact observed tokens, caller-supplied idempotency keys, preview slot identities and explicit partial counts. Never refresh a token or retry a sharing decision after a conflict. Rule target handles do not fetch content on inspection. Validation and replacement share server admission limits; preserve their named errors and never treat validation as reserved capacity. Live growth may later fail a Team read; withdrawal stays available.
- CRM records and initiatives share `messages/discussion.ts`: their comments are
  messages under a `crm_company`, `crm_contact` or `initiative` parent.
- `crm.blockDomain` refuses domains covering a team member's connected primary
  mailbox; preserve the server's validation message through `MacroApiError`.
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

- `Team.members()` includes effective `crmAccess`; `Team.setMemberCrmAccess(user, enabled)` changes it through the existing team API. `crm.access()` reads current viewer authority even when denied. Backend permission checks apply equally to SDK and generated MCP operations.

The email SDK coverage excludes `imapConnect`, `imapDiscover`, and `imapSuggestion`.
These routes belong to the signed-in account enrollment flow, whose password entry and
server confirmation run in the web application. The generated email client retains
the complete wire types.
The owner-only account configuration routes `getImapMailboxSettings` and
`updateImapMailboxSettings` share the existing settings exclusion. The generated
client includes these operations, which read server usernames or change folder routing.
The internal IMAP service callback `imapNotification` is also excluded.
