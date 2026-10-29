## Development Commands
- Use `bun` as the package manager and script runner (`bun run build`, `bunx tsc`).
- `bun run test`: run tests 
- `bun run check`: check typescript changes 
- `bun run lint`: lint with biome 
- `bun run format`: format changes with biome 
- `bun run knip`: to check for dead code
- Run Linux native cache-plugin tests from the repository root with `nix develop .#tauri-linux --command cargo test --manifest-path apps/web/tauri/Cargo.toml -p graphql_cache_plugin`; the [Tauri platform shell](../../docs/development/running-locally.md) supplies the required desktop libraries.
- `bun run lint:oxlint` (repository root): type-aware oxlint. `typescript/no-floating-promises` is an error with no suppressions and `ignoreVoid: false` (FE-13), enforced in `just check` and CI; start detached work with `fireAndForget` from `@core/util/fireAndForget`, not `void`. Plain `oxlint` without `--type-aware` skips that rule silently. The ast-grep rule `ts-no-expression-void` covers `() => void p()`, which the lint can't see.
- Email rendering is isolated in `packages/email-renderer` at the repository root. Run `just test-email-rendering` for its Node and Chromium suites. Add fixtures under `packages/email-renderer/tests/fixtures`, run `just test-email-rendering-update`, and review changed images. These are renderer tests, not inbox e2e.
- The app does not register a service worker. Keep `public/sw.js` as a retirement
  endpoint for existing installations; see the [startup bundle rule](../../.agents/rules/web/startup-bundle.md).
  Loro uses async WASM loading and HTML preloads independently of service workers.
- Web asset publication and cache headers are covered by
  [web-app delivery](../../infra/stacks/web-app/README.md); its publisher tests
  are backend-free, and its Pulumi tests must not run real staging/cloud commands.

## Verifying a change in a real browser

During iterative visual tweaks, use focused browser verification; defer full typechecks and CI checks until the batch is ready or the user requests them.

Any user-visible change should be exercised in a browser before you call it fixed — type-check, biome, and vitest all pass on code that still has the interaction bug.

Desktop sidebar view titles staying whole at a typical rail width have a
backend-free regression:
`bunx playwright test --config src/components/view-shell/browser-test/playwright.config.ts sidebar-title.browser.e2e.ts`.

Agent image attachments preserve external and inline image URLs; only configured
static-file endpoints receive thumbnail sizing. The backend-free regression is
`bunx playwright test --config src/features/block-agent/browser-test/attachments.playwright.config.ts`.

Split dragging and composer reflow have a backend-free browser regression:
`bunx playwright test --config src/lib/core/component/Resize/browser-test/playwright.config.ts`.
It exercises the real resize solver, scroll container, and Lexical layout primitive.

Desktop app switches open the requested list in the target split when the
retained detail is claimed by another pane or preview. Keep this check in view
restoration and preserve entity deduplication and native dock stack restoration;
`split-layout/tests/view-restoration.test.tsx` covers Chat and Tasks lists in
either pane, keeping the other pane's detail and history independent.

Database document-reference cells have a backend-free desktop/touch regression:
`bunx playwright test --config src/features/block-database/browser-test/playwright.config.ts references.browser.e2e.ts`.
It uses the real records view with a local source and picker to exercise opening,
replacement, cancellation, keyboard editing, and read-only references. Navigation
adapter tests separately check file types, access failures, and split selection.

Discussion link scrolling has a backend-free browser regression:
`bunx playwright test --config src/lib/core/messages/browser-test/playwright.config.ts`.

Phone sheets stacked on each other (Connect email over Settings, Add guests,
RSVP scope and the delete confirmation over event details) have a backend-free
browser regression for backdrop taps that must not press what the scrim covers,
including mixed pointerdown/pointerup dismissal, and for taps inside the top
sheet that must still press its own controls:
`bunx playwright test --config src/components/app/mobile/browser-test/playwright.config.ts`.

Composer typeahead menus choosing the side with room for their full list
(`floatWithSelection`'s `fullHeight`), above a composer at the bottom of a
phone screen and below one near the top, and the floating format menu staying
beside a scrolling editor whose selection runs past its visible bottom
(`clipToVisible`), have a backend-free browser regression:
`bunx playwright test --config src/lib/core/component/LexicalMarkdown/directive/browser-test/playwright.config.ts`.

Composer `/` menus list Connections between Skills and Pull requests. Keep native
and hosted providers aligned with `mcp_select::select_connections`, prefer native
credentials per provider, and preserve editor focus on pointer and touch selection.

Undo in a large collaborative Markdown document (Loro undo, mirror, reconcile,
caret mapping) has a backend-free timing regression:
`bunx playwright test --config src/lib/core/component/LexicalMarkdown/collaboration/browser-test/playwright.config.ts`.
Keep reconcile and caret lookups linear in the document: no `getChildren()` or
container scan per node.

Collaborative Markdown editing across several peers has a fast-check fuzzer and
the fixed scenarios it found; see
`src/lib/core/component/LexicalMarkdown/fuzz/README.md` before changing
`CollabProvider`, caret mapping, or Loro undo.

Event details placement has a backend-free browser regression: the desktop
popover stays beside its event when join requests arrive after it opens, and
slides into a short window; the phone drawer shows late requests. The same
suite covers the Add guests and Forward invitation editors (the real
`EventGuests` over a stand-in contact picker) on desktop and phone:
`bunx playwright test --config src/features/calendar-view/browser-test/playwright.config.ts`.
Keep the popover's `flip` limited to `left-start`: an end fallback re-places it
above the event whenever a late section changes its height. Keep the guest
editors' `overlap`: without it their height follows the room below the button,
so they never overflow, never flip, and squeeze the chosen people to nothing.

The desktop app's local runtime setup (find an agent, connect, create the
agent, retry, open a session) has a backend-free browser regression over a
scripted runtime:
`bunx playwright test --config src/features/local-runtime/browser-test/playwright.config.ts`.

Meeting-note creation, linking, optional team access, retry, and unlinking have desktop and
phone browser coverage in `features/calendar-notes`:
`bunx playwright test --config src/features/calendar-notes/browser-test/playwright.config.ts`.
The browser fixture uses the real event details popover and mobile drawer over
sample data; keep notes aligned with those existing surfaces and preserve their
dialog open guards. Open the existing document Share dialog for note access,
keep labeled Options controls visible beside truncated titles without redundant
hover tooltips, and use existing team memberships for optional note sharing.
Keep meeting-note reads cached across event opens, show cached Quick Access
matches while note searches refresh, and keep event actions usable while notes
load. Show meeting-derived team viewing in the document's Team access summary;
keep it distinct from additional direct sharing and keep Unlink stable while
team access saves.
Include linked meetings in Markdown side-panel References, behind the same flag;
reuse the shared single-line ReferenceRow with the title and date inline, and
resolve meeting details and opening targets through authorized calendar previews.
Treat missing reference projection fields during backend rollout as unresolved,
not denied; offer Retry on the links query without bypassing the server's
reference authorization.
Gate event notes and document Share meeting-link controls with
`enable-calendar-meeting-notes` before mounting their query sources; it defaults
on in dev and uses PostHog in production.
See `docs/agent-guide/calendar.md` at the repo root.

Share message image paste, file selection, drop, removal during upload, and
upload failure have desktop, phone, and tablet browser coverage:
`bunx playwright test --config src/lib/core/component/ForwardMessageComposer/browser-test/playwright.config.ts`.
Keep the shared uploader from restoring removed attachments or publishing after
the composer is disposed. The Share button and shortcut use the same upload guard.

Menus that find entities by typed name (Command-K, mobile name search, @
mentions) rank with `NAME_MATCH_RANKING` in `@core/util/freshSort`: names equal
to the query first, then names starting with it, then other matches, with tight
matches near the start scoring higher. Each menu's recency weights and type
boosts (Cmd+K's channel and DM boosts) order rows within those groups and never
lift a row past a better name match. The one exception: Cmd+K then keeps Macro
users and DMs ahead of CRM contacts across the people positions, whatever their
match. Tune name relevance there for every menu.
Name groups and match position use the row's label (`getDisplayName`), so search
text can add emails, aliases, or command keywords before or after it. Mention
menus rank loaded entity sources together with `MENTION_RANKING_CONFIG` in
`MentionsMenu/utils/mention-ranking.ts`: name relevance, viewed recency,
brevity, and type boosts. Task projects use the `initiative` bucket; `project`
means a Drive folder. Preserve broader cache/server matches and the existing
People preview/pinning. The channel browser suite below also checks project
ranking and insertion on desktop and phone.

Channel composer draft persistence has a backend-free browser regression:
`bunx playwright test --config src/features/channel/Input/browser-test/playwright.config.ts`.
It checks draft blank lines across remounts, that a sent message renders its
lines with the spacing the draft showed, and pending sends on desktop and phone: clear immediately, restore failed sends, and preserve a new draft typed during delivery.
It also pastes a Macro link and Markdown into a code block, which must keep both as literal text.

Shared GraphQL query metadata has a backend-free desktop and iPhone WebKit regression:
`bunx playwright test --config src/lib/urql-solid/browser-test/playwright.config.ts`.
Publish data and metadata atomically. Reconcile result data only; replace
operation metadata so shared documents,
cached query text, and operation names remain consistent across query changes.

Block formatting passes a forward copy of the selection to Lexical's
`$setBlocksType` so backward selections include their first paragraph and keep
the editor's actual selection direction. The Markdown core browser suite's
`quotes.browser.e2e.ts` checks Quote through the floating toolbar and after saving.

A frontend dev server runs against the **dev** backend, so this needs no local stack, Docker, Rust build, or `sudo`:

```sh
cd apps/web && PORT=3003 bun run dev   # any free port in 3000-3009
```

`import.meta.env.MODE === 'development'` resolves the service clients to `https://dev.macro.com` through Vite’s same-origin development proxy. Sign in on the development hostname; existing `.macro.com` cookies are separate. Vite prints `https://<hostname>:<port>/app/`; `https://localhost:<port>/app/` also works. Trust `infra/local/certs/ca.pem` once in the visiting browser (see `infra/local/certs/README.md`). `MACRO_DEV_HTTPS=false` restores HTTP for workflows that require it. Notes:

- On a remote devbox, open `https://<hostname>:<port>/app/` directly. The dev server serves HTTP/2, gzips modules and links source maps instead of inlining them, so a cold load of the ~7k dev modules moves ~13 MB instead of ~100 MB. Trust the CA on the visiting machine: Chrome caches nothing from a site whose certificate warning was clicked through, so every reload re-downloads every module. Tailscale Serve is an alternative that needs no CA: `sudo tailscale serve --bg --https=443 https+insecure://localhost:<port>`, then open `https://<devbox>.<tailnet>.ts.net/app/` and sign in again there (Serve offers HTTPS ports 443, 8443, and 10000). `MACRO_DEV_COMPRESSION=false` and `MACRO_DEV_INLINE_SOURCEMAPS=true` restore Vite's defaults.
- Never assume port 3000 or 3002 is yours. Check with `lsof -nP -iTCP:<port> -sTCP:LISTEN -t` and confirm the owner's worktree via `lsof -p <pid> | awk '$4=="cwd"'`. Take a free port instead of killing another session's server, and reuse one only if its cwd is this worktree.
- The `.cursor/*.sh` scripts and the `run-app` skill are **Cursor Cloud** entry points. On a local machine they prompt for sudo and are the wrong tool. Only backend (Rust) changes need the local stack.

### When the change needs a local backend

`bun run dev` talks to the deployed dev backend, so a change that adds or alters a backend endpoint can't be fully verified that way (the new route 404s against dev). Start the full local stack from the repository root:

```sh
nix develop --command just run_local --instance <name>
```

- Launch it through `nix develop`: the services are cross-compiled with `cargo zigbuild`, which only exists in the nix dev shell. A bare `just run_local` fails with ``no such command: `zigbuild` ``.
- `--instance <name>` gives an isolated Compose project, volumes, and a deterministic per-name port window, so it never clashes with another worktree's stack. `just status_local --instance <name>` prints the endpoints without starting anything; `just stop_local --instance <name>` stops it (volumes kept) and `just destroy_local --instance <name>` removes it.
- First bring-up is slow (zigbuild of every service plus the agent-harness sandbox image); later runs reuse the caches. While attached, press `r` to rebuild changed Rust services in place and `q` to stop cleanly.
- No accounts are pre-created: passwordless login registers any email on demand, and the one-time code lands in the instance's Mailpit (endpoint in `just status_local`). `just seed-scenario apply --file seed/scenarios/team-perms.json` seeds multi-user team fixtures with printed login links.
- Full details, Doppler vs no-Doppler modes, and port-conflict debugging: `docs/development/running-locally.md`.
- First run in a fresh worktree spends a few minutes on `just ensure-cache-wasm` / `just ensure-agent-fold-wasm` before Vite serves.
- That tab is pointed at **real dev data**. Treat creates, edits, and deletes as real, and discard drafts you open.

### Instrumenting a flash, blank, or remount

A screenshot cannot distinguish a repaint from a remount, and automated browser tabs usually run with `document.visibilityState === 'hidden'`, where `requestAnimationFrame` never fires — do not sample per frame. Tag the nodes you care about and let a `MutationObserver` record every change to a summary string:

```js
window.__inst = { log: [], seq: 0 };
const I = window.__inst;
const tag = (el) => (el.dataset.instId ||= String(++I.seq));
const snap = () => [...document.querySelectorAll('.fc')].map(tag).join(',');
I.last = snap();
new MutationObserver(() => {
  const s = snap();
  if (s !== I.last) {
    I.log.push({ t: Math.round(performance.now()), from: I.last, to: s });
    I.last = s;
  }
}).observe(document.body, { childList: true, subtree: true });
```

Then trigger the interaction and read `window.__inst.log`. `'1,2,3' → '' → '1,2,3'` (the same ids coming back) is a `<Suspense>` detach and re-attach. Fresh ids are a true remount. Nothing at all means the subtree never moved and the cause is elsewhere. Re-running the same interaction a second time is the cheapest way to prove a cold-cache cause: a once-per-session query settles after the first attempt, so the second attempt stays clean.

Column renames have a backend-free desktop/phone regression using the real
schema query and mutation adapter with delayed service responses:
`bunx playwright test --config src/features/block-database/browser-test/playwright.config.ts rename.browser.e2e.ts`.
It checks the optimistic name, header identity, and persistence across reload.

## Canvas collaboration

Document sync uses the `sync-via-gateway` PostHog flag in both deployed dev and
production. Off or unknown flag values use direct sync sockets.
Local stacks with the updated DSS can opt in with `VITE_SYNC_VIA_GATEWAY=true`;
`false` forces direct sync. The choice is made when a sync source is created
and stays fixed for its lifetime. PostHog can serve a cached value on reload;
recreate document sessions after the client receives the updated flag to change
transport. This is not an immediate kill switch for open sessions. Finish deploying the updated
DSS before enabling; the dedicated `/sync/ws` socket hosts routing independently
of the connection-gateway notification socket. The PostHog key keeps its historical name.

Saved canvases use the shared Loro runtime; the stored JSON is only the original
migration seed. Keep whole-file simple-save out of scene editing. Canvas
initialization, WAL/snapshot recovery and teardown live in
`features/block-canvas/queries/canvas-session.ts`; presence is ephemeral and
reference bookkeeping is excluded from scene undo. Run the feature tests and
`bunx playwright test --config src/features/block-canvas/browser-test/playwright.config.ts`
for multiplayer changes.

Canvas **Ask Macro**, including the Drive detail header, attaches the current canvas to the existing agent composer
on desktop and mobile. Tool results render through
`lib/core/component/AI/component/tool/Canvas.tsx`; edits arrive through live sync.
The shared plain-text Lexical codec is `packages/lexical-core/canvas-text.ts`.

## Development Patterns

Route database row rename and delete through `renameDatabase` and
`trashDatabase`; use the row grant for rename, delete, and sharing permissions.

Shared diff and Changes views expand files with at most 40 additions + deletions
by default; keep saved per-capture choices and explicit toggles authoritative.
Use `/app/debug/diff-view-ui` to exercise the 40/41-line boundary.

Project grouping in Soup and its live cache projection uses the system Project
property (initiative membership), with an empty key labeled No Project.

Keep persistent list hotkeys free of mounted-view closures, and clear
virtualizer accessors when their view unmounts.
Keep editor newline handling local; result-opening handlers must yield
Shift+Enter while an editor owns focus instead of adding shared hotkey flags.
A composer renders paragraphs with the spacing its sent message renders with,
so a draft reads as what it will send; drop only the draft's first and last
margins, which the compact single-row layout measures.

- Reuse `src/components/WorkspaceTexture.tsx` for the onboarding and Create
  detail panel grain; pass the surface accent and a unique SVG filter ID.

### Pipedream native authorization

Keep native Pipedream consent in the system browser: the desktop navigation
plugin redirects external popups and breaks the embedded iframe's return path.
`pipedream-connect.html` is a separate Vite entry, served at
`/app/pipedream-connect.html`, without a Macro browser login. The Connect token
and one-time state travel only in its URL fragment, which the page removes on
load. When Connect finishes it opens the `macro://` callback itself, keeping
**Return to Macro** as a fallback link; the Tauri navigation bridge consumes it
without changing the active route. Backend registration still verifies account
ownership. Done, logout, and the ten-minute timeout retire pending callbacks.

Connect can close without reporting success (an OAuth provider severs its
consent popup's opener) even though Pipedream created the account. Every close
without success, on web and native, asks `/pipedream/mcp/recover` to register
the user's newest account for that app from the last fifteen minutes.

### General

- Keep selection controls on shared `Checkbox`, `ToggleSwitch`, and `RadioGroup`;
  preserve their native input semantics and use root sizing instead of internal
  control/glyph overrides. See the [selection-control contract](../../.agents/rules/web/ui-primitives.md#selection-controls).

- Keep model picker triggers bounded with full-name title tooltips; wrap model names in catalog rows, including effort submenus and touch sheets.

Agent split headers show live viewers through `BlockLiveIndicators` with the
resolved session ID; keep the existing `AgentSessionProvider` subscription to
`agent_session` rather than enabling legacy block tracking of placeholder IDs.

- Share URL recognition with `packages/lexical-core/utils/auto-link.ts`; preserve explicit unlink markers when saving and rendering messages. See `packages/lexical-core/README.md` at the repository root.
- Empty human DMs use the shared centered conversations graphic and explain email delivery to nonusers; keep this state out of agent DMs, loading/error states, and populated timelines.
- Keep CRM database discovery row-linked and permission-scoped; use horizontally centered actionable list states raised toward the toolbar and shared skeletons, with separate search-empty and retry states. Company/contact touch headers use a Switch view drawer that honors host collapse and square copy-link islands; keep phone breadcrumbs above the switcher and leave the workspace view strip unchanged. Record search fills the row beside filters with header spacing; section creation replaces the default floating dock action through FloatRegion. See `src/features/crm/README.md` and `docs/agent-guide/crm.md` at the repo root.
- Main Tasks mounts reusable GraphQL saved views; keep embedded Project/CRM task lists unchanged. Read `src/features/tasks-view/AGENTS.md` for filter, draft, navigation, and browser checks.
- Enable persisted email/calendar review controls only for the review’s saved acting account; historical reviews fall back to the session owner. Require session edit access on desktop and mobile.
- Email draft reads compare server generations before choosing cached delivery state over a restored working copy; only a definitive first-submission rejection permits local send recovery without server cancellation.
- Compose settings pages with `features/settings/primitives.tsx` so section headings,
  raised composer cards (`SettingsSurface`), row spacing, and control shapes stay
  consistent; never hand-build a flat `bg-ink/*` card. Integrations is the one
  settings page that spans nearly the full width, for its list columns.
- Preserve email signature HTML through import, preview, and source editing;
  mount Quill only for explicit Rich text editing and confirm custom-layout
  conversion. Keep the settings and composer preview on the same sanitized HTML
  renderer. Phone settings show the preview with desktop-only editing. See the
  [signature walkthrough](../../docs/agent-guide/settings.md#email-signatures)
  for browser coverage. Keep signature commit callbacks on the mutation hook
  so account-list remounts cannot leave an already-cleared draft behind. Offer
  Gmail signature import only when the inbox provider is `GMAIL`, regardless of
  its email domain; keep shared signature instructions provider-neutral.
- Keep personal accounts, team imports and agent tool connections together in
  Settings → Integrations: one searchable list row per integration, styled like
  the Drive/Tasks lists, custom MCP servers then connected ones first,
  described by what each does in Macro; preserve `agent-connections` and `team-connections` as aliases for existing links.
- Keep bot setup focused on the token-and-SDK workflow; Agent and Ownership
  controls live under collapsed Advanced settings. See the
  [Bots walkthrough](../../docs/agent-guide/settings.md#bots).
- Label the notification permission toast **Enable Desktop Notifications** in
  the desktop app and keep its Enable action on the native notification provider.
- Keep signed-out Drive document routes on the shared detail viewer without
  mounting private list/sidebar sources; let document access checks decide visibility.
- Gate account-only queries, comment readers, and account WebSockets on confirmed
  authentication; keep public document loading independent of those services
  and distinguish unresolved identity from confirmed sign-out in UI prompts.
- Probe identity on deploy-preview origins even without a local login hint;
  shared HttpOnly dev cookies are not visible to JavaScript or localStorage.
- Leave the login hint (`syncLoginStorage(true)`) before a full-page hosted
  SSO redirect; the callback sets only HttpOnly cookies, and a load without the
  hint never checks identity, so the returning user sees sign-in again.
- Disable GraphQL cache sessions and clear login hints on confirmed auth 401s,
  even with retained user data; preserve session state on transient failures.
- Treat a repeated worker-ready frame as a coordinator restart: retire the old
  engine and re-register in place, preserving durable storage and never replaying
  uncertain enqueues. Space failed coordinator registrations with bounded,
  cancelable waits; a missing startup frame is not proof of untouched storage.
  See `docs/graphql-normalized-cache-plan.md`.
- Reject already-routed optimistic enqueues with missing replies as uncertain on
  every owner departure; never forward them through network fallback, because
  their durable queue entries may survive the old engine.
- Dispatch live GraphQL notification callbacks before cache persistence so hidden
  tabs can show browser alerts; keep cache-dependent channel reconciliation
  behind ordered writes and never replay alerts when the cache resumes. Link
  cache queue/apply spans to receipt and mark listener failures without stopping
  the remaining callbacks.
- Drain browser cache engines when their last visible consumer hides, then park
  without retiring clients; queue background work until a visible owner reopens
  storage, retaining accepted mutation settlements even if their caller leaves.
  Publish recovery reset outcomes before parking while retaining the read pause.
  Bound foreground resume reads to one second without killing an owner, stealing
  its lock, replaying writes, or treating intentional parking as a failure.
- Coalesce broad browser cache-change hints across the coordinator's in-flight
  backlog, not the engine's per-message queue; keep reset fences, mutation
  settlements, and query-specific invalidations immediate.
- Retry still-current query reads once when engine replacement invalidates their
  snapshot; do not strand urql's in-flight key or revive torn-down or superseded reads.
  Keep network forwarding deduplicated and cache-only reads off the network.
- Mobile dock customization shares the navigation island’s measured capacity; persist ordering per user with `mobile-dock-order.ts`, preserve gated destinations, and keep Search and More fixed. Reorder handles drag without a hold delay; the rest of each row scrolls.
- Share sidebar and mobile dock unread presence through `components/app/use-navigation-unread.ts`; keep badges reactive to read/done changes, guard all query data with `queryReadyGate` so pending preferences or paused queries cannot suspend the shell, and avoid fetching extra pages for counts.
- Name Home thread rows from their latest scoped notification, including document mentions and reactions; use the thread author only when no notification exists. Document rows whose newest outstanding notification is a comment, and calendar event rows whose newest is a join request, say who did it (`row-notification.ts`).
- Use `ChannelTitleIcon` for conversation breadcrumbs so DMs retain participant or agent avatars and named channels retain their pictures; suppress avatar actions inside breadcrumb buttons.
- Normalize thread-only conversation URLs in `channelsSearch` before Home, Chat, or touch views derive their message target.
- Mobile dock search owns transient category/mode state in `features/command/mobile`; reuse the shared entity source and explicit full-text adapter rather than overlaying the dock query on view tabs or saved facets. See `docs/agent-guide/search.md` at the repository root.
- Include known Macro users in typed All/People name searches without requiring a DM or CRM contact; resolve a matching person against both recent DMs and DMs found by the current search while preserving name/email matching.
- Key mobile name-result history ordering and scroll anchors by the other participant for one-to-one DMs, preserving a person's position when their conversation is created; keep group DMs keyed by channel.
- Keep mobile Search history lightweight: save query/category/mode, account-scoped item anchors, and at most 200 ordering IDs per mode; never save row objects or virtualizer caches. Restore from current sources with at most three additional pages, fall back when an anchor disappears, and stop restoration on user interaction or scope changes. Dock navigation starts a fresh search session; cached rows belong to the source, not history.
- Release per-history-entry state when its router entry is replaced, pruned, or closed; retain only the latest per-view session snapshot and the latest split event outside reachable Back/Forward history.
- Keep Quick Access cache availability reactive to the GraphQL rollout flag; it can arrive after the provider mounts, and email has no legacy source fallback.
- Cmd+K and mobile name search take task projects from the Quick Access `initiative` bucket (typed All queries and the Projects category), searched from the GraphQL cache like other entities. Don't give them a per-query server search: its rows drop out while each new query loads, so projects flash as you type.
- Merge the complete channel list into Quick Access even with the GraphQL cache enabled; preserve newer viewed timestamps and apply the channel boost before the extra DM boost in shared command/mobile name ranking.
- Include all channel metadata in Quick Access item versions; record complete, cached-recent, and merged channel counts plus the last index-build duration on cache-search traces.
- Virtualize mobile name results like desktop Command Menu; local Quick Access sources are unbounded, and mounting them all stalls iOS keyboard focus during layout. Load additional search pages near the scroll end instead of reserving a paging bar.
- Reconcile mobile full-text rows by entity ID so appending a page preserves DOM rows and scroll position; restore item anchors after responsive row measurement and disable browser scroll anchoring so layout changes cannot override restoration.
- Reserve the safe area plus the category row above mobile Search, and only the safe area above Channels; their hidden split headers must not add another blank strip.
- Follow [mobile layout and chrome](../../.agents/rules/web/mobile.md#layout-and-chrome) for full-frame views and record tabs; verify their first controls below the navigation with a nonzero safe area on phones and tablets.
- Keep split chrome portal targets reactive so cached views can mount before their header, and clear a retiring header's targets only while it still owns them.
- Opt views into session restoration with `split-layout/view-restoration` and set `resume: true` on ordinary layout navigation; publish captured state only through the leave guard's `onCommit`, keep explicit links and new splits fresh, and reuse entry-state captors rather than hidden mounted views.
- Let `ViewShell.TopBar` own split close and navigation controls; do not add a second split close button inside Agents headers or their preview `headerLeading`.
- Desktop tabs (`components/app/tab-layout`, macOS + `enable-desktop-tabs`) hold one split layout per tab over the router's `layoutSnapshot`/`restoreLayout`; only the active tab is live, and the strip renders in the title bar's center slot. Cmd+click becomes a background tab through `openInNewTabMiddleware`, so tab operations must disarm the intent tracker before navigating. Tabs are not draggable. See the tabs section of `docs/agent-guide/navigation.md` at the repository root.
- Show only the Recent conversation feed in mobile Channels, without view tabs or a persisted mobile tab selection; render its rows with Home's touch row (`ChannelCardLayout` and `InboxDivider`) and pin at most six channel favorites above it.
- Mount the mobile search input before focusing it inside the dock tap; keep navigation in that handler so focus does not trigger a second navigation or lose iOS keyboard activation.
- Preserve focused chrome editors during deferred split insertion/removal autofocus; explicit return-focus commands may still focus the pane.
- Reconcile global focus when focused DOM subtrees are removed; iOS can omit blur events, otherwise floating creation actions stay hidden after search or editor teardown.
- Mount the floating mobile AI composer only on the Agents view; other views keep their New action or their own reply/comment composer.
- Keep desktop New actions on `ViewCreateButton`: full width below the inner
  sidebar title and compact in list controls; retain each view's creation
  workflow and mobile controls. Use `ListHeader` for the single-row Email, Drive,
  and Tasks headers: title, filters, view options, New, expandable Search. Put sidebar search in
  `ViewSidebar.Header` so its icon precedes collapse and its field opens above New.
- Keep desktop headers on the shared `ListHeader` / `HeaderActionGroup` pattern: view `Tabs` as pills after the title, `sm`/`icon-sm` semantic islands (28px controls) with 8px gaps on the right, fully rounded frames, New then expandable Search; retain `md` sizing for Tabs, New, and Search. Drive and Tasks list-header filter, layout, sort, and grouping islands use `md`/`icon-md` (32px) to match New and Search. Preserve touch layouts. Compose ButtonGroup actions with explicit `ButtonGroup.Button` segments; use `variant="secondary" finish="raised"` on action frames. Standalone Buttons do not inherit group styling. Pick each control by role from the [design system rule](../../.agents/rules/web/design-system.md); see [UI conventions](../../docs/agent-guide/ui-conventions.md#top-bars). Never use recessed/inset backgrounds in headers.
- Keep desktop model and effort controls separate: the model selector opens the catalog and the speedometer opens the runtime's advertised slider stops; retain the mobile effort sheet.
- Passive PR mentions must not retry initial GitHub status failures on remount; preserve confirmed status through refetch errors and keep pending data reads out of their parent Suspense boundary.
- PR description and comment images are remote URL images: rewrite GitHub blob/`raw` links to `raw.githubusercontent.com` and load them through the image proxy so COEP does not block github.com.
- Keep native booking exit navigation in the route shell, outside page loading boundaries, and use the router so the native hash route stays intact.
- Diagnose native full reloads with `native_webview_started`, `native_diagnostic_recovered`, and the shared `frontend_instance_id`; use `reloadApp(reason)` for frontend reloads and keep breadcrumbs content-free. Treat `previous_document_*` checkpoints as last-observed lifecycle evidence, never a crash verdict; clear them on logout. `previous_document_last_*` comes from the native navigation breadcrumb (route and entity type, never ids). See [frontend checkpoints](docs/native-reload-diagnostics.md) and `tauri/src-tauri/README.md`.
- Pass `$APPLOCALDATA` (Application Support on Apple platforms) as the native HTTP cookie storage directory; the plugin owns the `.cookies` filename. Never use purgeable caches. The location change intentionally requires one new sign-in, without migration. See `tauri/src-tauri/README.md#native-authentication-cookies`.
- Inline agent steps reuse the session code-execution query for live SDK operation
  names; completed step snapshots come from the shared fold of the tool receipt.
  Session `ExecuteCode` activity uses the same Calling N tools peek window as
  ordinary consecutive tool calls.
- Compose multiselect filters with `Dropdown.MultiSelectItem` and the shared
  searchable filters; follow [multiselect dropdowns](../../docs/agent-guide/ui-conventions.md#multiselect-dropdowns)
  for checkbox, row, Only, keyboard, and touch behavior.
- Keep added external chats (WhatsApp today) in External at `/external/chat/:chatId` with their own queries (`features/external-chat`); sharing controls viewing and the viewer's own provider membership controls sending. Never route them through channel context or services.
- All API/network calls live in service-clients.
- Open projects through `openProject` (`features/projects/open-project.ts`): it
  retargets an already-open project split to the section or comment in place.
  Opening the legacy `initiative-view` component route beside an open project
  mounts a redirect shim that stays on "Loading project".
- Bound Discussion comment readiness waits to ten seconds; recover from initial layout interruptions until the message is visible, and release the target on user input (including scrollbar pointer-down), timeout, or successful arrival.
- Keep early DOCX opens loading while exports return processing (409); retry only
  that response, with a bounded wait. See the Word editor walkthrough in
  `docs/agent-guide/documents.md` at the repository root.
- Add Google Meet account hints only to join actions using the displayed calendar's
  connected email; keep stored and copied conference links unchanged. See the
  [calendar walkthrough](../../docs/agent-guide/calendar.md).
- Mark loaded calendar and agent-session row notifications through the
  notification source (`markRowNotificationsSeenOnOpen`) so read dots update
  immediately and failed writes roll back; calendar grid selections also mark
  the canonical event read, excluding team projections.
- Route explicit meeting-page exits using the server's `callEnded` result: ended
  calls open their record; ongoing channel and scheduled calls return to the
  channel and Calendar. Leaving from a channel's Call tab stays in the channel. Preserve the session ID and send the server leave before media
  teardown; once the last participant drops, the server ends the call first.
- Diagnose browser call media with `call.media.*` spans and the `meeting.setup.id`
  on `meeting.join`; keep provider messages, device labels/IDs, and call-link
  tokens out of telemetry. See [call diagnostics](../../docs/agent-guide/calls.md#browser-call-diagnostics).
- Diagnose the GraphQL mutation queue with `graphql.mutation_queue.*` spans and logs keyed by `mutation_queue.item_id`; route queue telemetry through `mutation-queue-telemetry.ts`, which dedupes per item and failure class and turns repeats into the periodic summary. Never add per-attempt `console.*` lines or record variables, draft content, or emails.
- Keep desktop Gmail and Outlook inbox consent in the system browser with a
  `macro:///inbox-link-callback` return; webview origins are not desktop callbacks.
- Keep send reservations, leases, and cancellation in the email journal; the general GraphQL queue handles draft autosaves only.
- Always persist composer sends in account-scoped IndexedDB and dispatch through the fetch-only email client, without a feature flag; cache health and unrelated mutation queues must not gate delivery. See `docs/architecture/email.md` for state and rollout invariants.
- Retry cache bootstrap on reconnect/foreground or draft Retry only when storage was proven untouched; retain the same scope and block draft sync until the replacement queue is readable.
- Touch email replies and forwards use the full-screen composer with the shared new-email header actions; preserve thread state underneath and flush local edits before closing.
- Include unsynced email working copies in Drafts and mobile name search even
  before a GraphQL save, and warm sending accounts alongside backfill. Preserve
  inbox, alias, and facet scope.
- Draft autosaves preserve active email thread messages; evict inactive legacy
  caches on save and the active cache on thread exit. Revalidate GraphQL thread
  pages only when a save cannot patch the message list (missing snapshot or a
  move between inboxes).
- Keep email card resize motion on its content wrapper so message and inline
  reply transitions preserve the card's focus target and return to natural height.
- Task composer submissions retain an account/context-scoped local copy until
  the create response confirms success; never clear newer composer input from a
  late callback or automatically retry an uncertain create. Keep recovery copies
  through restarts and remove them on explicit logout. See the Tasks walkthrough.
- Shared server-state queries and mutations live in `src/lib/queries`; keep
  feature-specific query orchestration with its owning feature.
- Refresh the channel list's bounded unread edge when opening a conversation,
  including an empty unread result after a read on another device.
- Keep channel rail and title menus on `CHANNEL_ACTION_VIEW_CONTEXT`, including
  the shared desktop `Open in new split` action and its mobile/capacity guards.
- Route supported move, trash, restore, permanent-delete, duplicate, and share-policy
  writes through `queries/storage/entity-mutations` when GraphQL Soup is enabled;
  never retry failed GraphQL writes through REST. Preserve non-owner history removal
  and version-specific markdown forks on their existing paths. Confirmed restores
  clear earlier deletion markers without clearing a newer delete's intent.
- Preserve loaded block content on initial access confirmation when its loader
  supplies no permissions; reload only on a later confirmed permission change.
  Apply shared access in place only after a successful permissionless load.
  Request state can report an owner as edit, so compare a loaded level with
  the confirmed one through `matchesConfirmedAccess`.
- Grouped Soup's `graphql/create-grouped-soup-live-query.ts` owns initial and
  continuation pages plus their local predicate projection. Group readers only
  delegate paging; pass the parent's live `groupedPaging` accessor from every
  caller, including Tasks and project-task lists. Do not introduce independent
  continuation owners. Rebuild refreshed continuation chains before replacing
  loaded rows; retain them on refresh failure and discard them on scope changes.
  Keep server
  membership snapshots separate from normalized field/link updates; restored
  properties do not prove prior membership. Supply complete prior multi-value
  memberships when adjusting counts: a row loaded in one bin may already be an
  unloaded member of another.
- Reconcile authoritative Mail first pages in the shared Soup projection adapter,
  not a UI exclusion list: invalidate contradicted facts within the supported
  page range without deleting normalized threads or treating backfill gaps as
  deletions. The OPFS revisit/reload regression is
  `bunx playwright test --config src/lib/graphql-cache/worker/browser-test/playwright.config.ts mail-reconciliation --project chromium`.
  For transient row flicker, run
  `bunx playwright test --config src/lib/queries/soup/graphql/browser-test/playwright.config.ts`:
  it uses the real Soup source and exchange, holds local/network completion,
  and asserts every observed row-ID state on revisits and an OPFS reload.
  It also verifies that cold empty Mail tabs stay loading until HTTP settles.
  It also runs in `just test-cache-wasm-browser`.
- Reactive GraphQL reads use `createLiveQuery` for a document and
  `useSoupAstItemsQuery` (backed by `createSoupLiveQuery`) for Soup lists; see
  [choosing a reactive read](docs/graphql-normalized-cache-plan.md#choosing-a-reactive-read).
- Reconcile cached Mail pages with same-query server membership; missing local
  previews are unknown, not proof that a fetched email left the inbox. Keep
  local pagination cursors independent of retained server rows. Preserve live
  flags alongside fallback previews; retained rows and legacy hosts still need
  mutation revalidation. Merge continuation pages through the indexed cursor.
  Never restore explicitly invalidated membership from an older view's snapshot.
- Render user-visible text in new UI, and every menu and navigation label,
  with `t()` from `@app/lib/i18n`, adding only the English to
  `src/lib/i18n/locales/en/`. The periodic `update-translations` skill fills
  in the other languages. See the [i18n rule](../../.agents/rules/web/i18n.md).
  The resolved interface language is reported to PostHog as the person
  property `interface_language` when the account language loads.
- When adding or changing a feature flag, follow the `feature-flags` skill.
- Gate routine template actions, pages, dialogs, and message cards on `enable-routine-sharing`; keep ordinary routines usable while it is off.
- When adding or changing a view's feature tour, follow the `add-tour` skill.

## Rules

Conventions for this app live in `.agents/rules/web/` and load when you touch
matching files: data fetching, Solid reactivity, architecture, UI, UI primitives,
the startup bundle, Lexical nodes, and translated menu labels.

### Good Reference
- https://github.com/solidjs-community/solid-primitives
- https://github.com/kobaltedev/kobalte
- `src/features/entity`
- `src/features/channel`
- `src/features/block-md`
- `src/features/next-soup`

### Bad Examples
- `src/features/block-channel`
- `src/features/block-pdf`

## PDF markup

Keep the signature canvas backing bitmap aligned with its CSS size and device
pixel ratio; keep dialog centering separate from animated transforms. Verify the
[signature walkthrough](../../docs/agent-guide/documents.md#pdf-signatures) after
changing this editor.

## Notes
- Don't shy away from pulling good examples into context. In the case of solid-primtiives/kobalte try reading documentation, or just temp clone into /tmp to reference

## iOS release signing

Follow [`docs/ios-releases.md`](docs/ios-releases.md) for App Store signing and
provisioning, including both extensions. The release script temporarily selects
manual export when a distribution certificate path is supplied.

## Native notification navigation

Android incoming calls use an opaque full-screen call screen, with the standard
Calls notification as the fallback when full-screen access is unavailable.
Keep notification Answer intents pointed directly at the call activity and scoped
to the offered call; active calls retain the drawer and PiP controls. See
`docs/development/android.md#native-calling` at the repository root.
Native call tracing retains the browser telemetry gate and exporter for cold
calls; propagate W3C context through push payloads, notification intents and
ring-status requests, and keep caller names, tokens and URLs out of spans.

Read iOS's durable pending tap before mounting the router, then choose its
destination only after the authenticated account matches `recipientId`. Keep
the native receipt pending until the destination route is applied; release the
resume cover for auth/retry UI without consuming the receipt. Use the existing
pending-notification intent for bootstrap and live taps so newer taps supersede
older work. Older native builds and pushes retain authenticated notification
lookup. The local bridge and native release requirement are documented in
[`docs/ios-releases.md`](docs/ios-releases.md).

Bound the pre-router bridge handoff to 1.5 seconds and release the native cover
on failure or timeout without consuming the pending tap. Late responses must
use normal account-checked navigation, never reset the mounted router's hash.
`notification.launch` records whether startup continued ready, failed, or timed out.

Bound the native cover to eight seconds for each received durable tap, including
warm resumes and stalled route acknowledgments. Release without consuming the
intent on timeout; duplicate delivery must not extend the deadline, and a newer
tap gets its own deadline. Convert fallible notification lookups and navigation
promises into error results so failure cleanup acknowledges the tap and shows
the existing error toast. Keep the startup cover fallback in the same owner,
and let it defer to a pending tap's deadline. The deadline requires responsive
JavaScript and IPC; it cannot recover a frozen WebContent process.

The frontend cover deadline has a backend-free phone browser regression:
`bunx playwright test --config src/lib/tauri/browser-test/playwright.config.ts`.
It uses the real navigation intent and push API with simulated native IPC;
UIKit presentation still requires an iOS device or simulator.

Generate APNs validators with `scripts/generate-api-schema.ts`; its compact
`generated/push.ts` entry avoids importing every notification-service schema
on the startup path. Carry known channel root IDs in push navigation (a null
`threadId` means the message itself is the root), prefetch the target window
alongside channel metadata, and keep the shared Macro loading indicator visible
until that target can be positioned.

## macOS notification activation

Carry the notification ID through native delivery and the buffered `navigate`
bridge, so clicks survive app restarts and wait for the split layout to be ready.
Install and retain the UserNotifications delegate before the native event loop
starts. Clicking restores and focuses the main window; receipt and dismissal do
not navigate. Preserve iOS and Android `createPushApi` tap navigation when changing
desktop delivery, including buffered launch taps before device registration.
Send the sender and conversation as their own fields so macOS can show a
communication notification (avatar, sender, conversation); keep new native
arguments optional for OTA compatibility. Releases need the Developer ID
provisioning profile for the communication entitlement; see
`tauri/src-tauri/README.md`. This requires a native macOS release; see the
[notification walkthrough](../../docs/agent-guide/notifications.md).

## Desktop page zoom

The desktop app binds `Ctrl/Cmd` with `+`, `-`, and `0` itself in
`src/lib/tauri/zoom.ts`; nothing underneath provides them. Wry's
`zoomHotkeysEnabled` is Windows-only and Tauri's default menu has no zoom items.
The hotkeys call the webview's `setZoom`, which needs
`core:webview:allow-set-webview-zoom` in `tauri/src-tauri/capabilities/desktop.json`,
so a build without that permission fails the call at runtime. That permission
lives in a `desktop`-named capability rather than `default.json` because the iOS
and Android native gates hash every file under `tauri/` whose path doesn't name a
platform: editing `default.json` would demand a store release for a command that
only exists on desktop. The saved factor is
re-applied on launch because the webview always starts at 100%. `RootFrame`, not
`GlobalHotkeys`, registers them, so zoom also works on pages without app chrome.

## Desktop file drops

Keep `app.windows[].dragDropEnabled` false in `tauri/src-tauri/tauri.macos.conf.json`.
Markdown editors and attachment inputs use browser events through `fileFolderDrop`
and `fileDrop`; Tauri's native handler intercepts Finder drops before those handlers
receive them. This config change requires a rebuilt macOS app; a frontend bundle
update alone does not apply it.

Tauri replaces arrays when merging platform configuration. Keep the other macOS
window settings aligned with `tauri/src-tauri/tauri.conf.json` when changing the
shared window. Verify with the [Finder-drop walkthrough](../../docs/agent-guide/documents.md#desktop-file-drops).

## Subscription offers

Use `useTrialEligibilityQuery` for trial copy and checkout terms in Billing,
paywall, and onboarding. Never infer first-subscription eligibility from Free
access or legacy `hasTrialed`; show trial copy only for confirmed eligibility,
and keep Pro checkout disabled while eligibility is unknown. Refresh the offer
on focus/reconnect; route existing subscriptions to billing management. Keep
known management access through refetch failures, but hide unconfirmed trials.
Reset rejected checkout offers before refetching eligibility.

## Desktop release builds: generated WASM

Keep `nix/tauri-desktop.nix` in sync with generated WASM dependencies: desktop
releases run Vite directly and do not call `just build-tauri` or `build-wasm`.
Build and copy the agent-fold JavaScript glue and WASM before Vite runs, and
check that both appear in the output. Without them, Vite leaves the worker's
relative imports unchanged and Tauri can serve HTML for the missing module.

## macOS desktop runtime: Chromium (CEF)
`tauri/desktop-cef` builds the shipped macOS app with Chromium in its own Cargo
workspace. The macOS release DMG builds this workspace; iOS, Android, Linux,
and Windows still build `tauri/src-tauri` on the system webview. See
`tauri/desktop-cef/AGENTS.md` before changing Tauri
dependencies or the app's served origin.

## iOS gotcha: Web Workers must be lazy
On iOS WKWebView, eagerly constructing an ES module Web Worker (`new Worker(url, { type: 'module' })`) whose script is served via the `tauri://` custom URL scheme **deadlocks the WebContent process**. The worker thread parks in WebKit's sync module loader waiting for an IPC response that never wakes it; JS execution silently stops after that point.

Vite serves all workers as ES modules in dev mode regardless of `worker.format` config (that setting only applies to `vite build`), so you can't fix this at the bundler level for dev.

**Rule:** never call `new Worker(...)` (directly or via `?worker` import) at module-load time in code that runs on iOS. Worker construction must happen on first use. For singletons backed by a worker, use a lazy proxy:
```ts
export const svc = new Proxy({} as Service, {
  get: (_, p, r) => Reflect.get(Service.getInstance(), p, r),
});
```
The `import Worker from './w?worker'` import itself is harmless — only `new Worker()` triggers the deadlock.

**Symptom signature:** app loads HTML and runs initial JS, then JS silently stops. Safari Web Inspector attaches but shows nothing.

**How to diagnose this class of freeze:**

1. **Reproduce on the iOS Simulator, not a physical device.** `cargo tauri ios dev "iPhone 15"` (replace with whatever sim you have booted). The Simulator's logs flow through your Mac's unified logging, so you can stream them with `log stream` instead of fighting `idevicesyslog` / Apple's developer-tunnel requirements.

2. **Stream the app's logs in one terminal:**
   ```sh
   /usr/bin/log stream --predicate 'process == "macro"' --info --debug --style compact
   ```
   Use the full `/usr/bin/log` path — zsh shadows `log` as a builtin and silently misroutes the call. Leave this running across rebuilds; the filter is by process name so it survives app relaunches.

3. **Find the last meaningful event before silence.** Tail the log file and skip the noise:
   ```sh
   tail -200 <logfile> | grep -vE 'tauri:// request|tauri_protocol.rs|^\s*\\134'
   ```
   If you've added a `tracing::info!` to log every `tauri://` request in the protocol handler, look for the **last** such request — that's the file the WebView was loading when it froze.

4. **Confirm the WebContent process isn't spinning.** Get its PID from any `[com.apple.WebKit:...] [...PID=N...]` line in the logs, then:
   ```sh
   ps -o pid,pcpu,comm -p <pid>
   ```
   `0.0%` CPU + still-alive process = parked, not infinite-looping. That distinguishes a deadlock (waiting on IPC/lock) from a hot loop (something busy).

5. **Sample the WebContent process to see where threads are stuck:**
   ```sh
   sample <webcontent_pid> 3 -file /tmp/sample.txt
   ```
   Then look for threads named `WebCore: Worker`. If their stacks show:
   ```
   WorkerOrWorkletScriptController::loadModuleSynchronously
     → WorkerDedicatedRunLoop::runInMode
       → Condition::waitUntilUnchecked  ← parked here
   ```
   that's the worker module-load deadlock. The main thread will typically be in `mach_msg2_trap` (idle in run loop) with some `IPC::Connection::enqueueIncomingMessage` → `LockAlgorithm::lockSlow` showing lock contention.

6. **Cross-reference the last URL request with the stuck thread.** If the last `tauri://` request was `*-worker.js?worker_file&type=module` and a worker thread is in `loadModuleSynchronously`, you've confirmed which worker is the culprit. Then trace back to where it was constructed (`new Worker(...)` or a `?worker` default export being instantiated) and make that lazy.

Don't get distracted by red herrings the logs will show: `NSKeyedArchiver` main-thread fault, IPC throttling warnings ("N pending incoming messages"), the bundle updater's failed `localhost:3001` request — all are downstream symptoms or unrelated noise.

## iOS gotcha: a device tap fires `mousedown` even after `pointerdown.preventDefault()`
On a physical iPhone, WKWebView still synthesises the compatibility `mousedown`/`mouseup` for a tap whose `pointerdown` was cancelled. The spec, Chrome, and the iOS Simulator all drop those events, so the difference only shows on real hardware. The synthetic `mousedown`'s default moves focus to the tapped element's nearest focusable ancestor — a `<button>` is not mouse-focusable on iOS, so focus lands on whatever container carries a `tabindex`, e.g. the block element a popup is portaled into. A focused contenteditable then fires `focusout`, the software keyboard hides, and anything keyed off editor focus (the md selection popup) closes. The DOM selection survives the blur, so actions that read it (Copy) keep working and mask the bug.

**Rule:** UI that overlays an editor and must not steal its focus (toolbars, popups, paging chevrons) cancels both `pointerdown` and `mousedown`, on the container root rather than per button so dividers and gaps are covered too. See `keepEditorFocus` in `src/features/block-md/component/TouchSelectionToolbar.tsx`.

**Symptom signature:** works in Chrome mobile emulation and in the iOS Simulator, fails every time on a physical iPhone regardless of tap accuracy; the keyboard dismisses on the tap.

**How to diagnose this class of bug:**

1. **Don't reason from finger precision.** A deterministic device-only failure is an event-model difference (compat mouse events, software keyboard), not a near miss.

2. **Add a temporary window-level event trace.** Log `touchstart`, `touchend`, `pointerdown`, `pointerup`, `mousedown`, `mouseup`, `click`, `focusin`, `focusout` and `selectionchange` with `event.target`, `event.defaultPrevented`, `event.relatedTarget` and `document.activeElement`. Register on `window` in the bubble phase so app handlers have already run and `defaultPrevented` is meaningful. Wrap the setter that closes the UI to log a short stack (`new Error().stack`). Prefix every line (e.g. `[md-popup]`) so it can be filtered.

3. **Run it on the device, not the Simulator**, with Safari Web Inspector attached (Develop → the iPhone → the Macro webview), filter the console by the prefix, reproduce, and read the order. A `mousedown` arriving after a `pointerdown` logged with `defaultPrevented: true`, followed by `focusout` whose `relatedTarget` is a container, is this bug.

4. **Strip the instrumentation before committing.**

### Agent session failure indicators

Use the existing status dot in Home and Agents rows with `bg-failure` when the
persisted `turnState` is `failed`; open the session to inspect its error.

### Agent system events

Agent activity labels share `block-agent/ui/TextShimmer.tsx` and the global
`magic-chip-shimmer` style; keep Working and Thinking on the same sweep and phase.

Accept `notification` in both fetched and subscribed GraphQL session log rows.
System notifications live in fold metadata, separate from messages. Review
subjects refresh their existing card; other subjects render quiet timeline rows
through `block-agent/components/session-event-row.tsx`. Match typed event
payloads exhaustively, summarize outcomes without draft content, and keep the
icon, truncated summary, timestamp, and optional subject action on one line on
desktop and mobile.
Keep Responding bound to the notification turn, including rejection and noop.
Harness background-task reports are `task_notification` message parts, rendered
as `ActionLine` rows in the agent reply (`TaskNotificationPart`).
The backend-free desktop/mobile check is
`bunx playwright test --config src/features/block-agent/browser-test/playwright.config.ts`.
The same suite covers stopping and reloading an agent reply inside a mention:
keep incomplete trailing Macro XML hidden in settled agent prose, preserve
completed chips and literal tag examples in Markdown code, and leave user prompts
unchanged.
Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` when using the Nix Chrome binary.

Reuse the responsive import review for Notion, Linear and Jira; scope report
queries and cancellation to the saved draft source. Issue tracker handoffs
call the reviewed workspace tools, and show separate task/project totals.

### Agent backend hosting

Cognition, routines, preview control, and MCP share `agent_harness_service`.
Agent replies can use the existing `m-document-mention` format with
`blockName: "routine"`; routines do not appear in the mention menu.
Direct local hosts use port 8101 with the existing feature prefixes; the
instance proxy retains `/cognition`, `/scheduled-action`, and `/preview`.

## File downloads

Channel videos, linked video previews, and Drive video/image/code/canvas/unknown previews share
`createFileDownload` and `FileDownloadButton`. Keep menu and visible controls
bound to the same controller. Call recording menus and the list-row Download
(`makeDownloadAction`) use the same controller; the list action runs it under
its own root, because choosing a context-menu item disposes the menu's owner.
Download hands off directly to browser downloads
or the native save picker. Show channel Download on hover or keyboard focus,
always on touch, without a footer. Keep system Share inside the touch Download
menu; desktop Share belongs to Macro permissions. Do not add a custom
confirmation sheet. Snapshot file/version before loading, cancel on disposal or
selection change, and preserve original filenames from static-file metadata.
Native Android and iOS use bounded byte exports. Older iOS binaries use Web
Share until the optional file-export bridge ships. If browser activation expires
while preparing a share, retain the bytes and let the same action's next tap
open the system sheet synchronously. Browser success means handoff, not confirmed
disk completion. See the native bridge's `tauri/file_export_plugin/AGENTS.md`.
Keep download confirmations title-only and lightbox Download controls icon-only.

The backend-free browser regression downloads real fixture bytes from channel
cards, the expanded viewer, and the shared Drive/standalone header on desktop,
phone, and tablet:
`bunx playwright test --config src/lib/core/component/FileDownload/browser-test/playwright.config.ts`.
See the [download walkthrough](../../docs/agent-guide/files.md#downloading-files).

## Interface icons
- Task rows, document mention pills, and @mention menu rows use `TaskStatusIcon` with the current status property; use the task subtype completion flag only when a recognized status is unavailable. Mention pills show status only in that leading icon, not again among the trailing task badges. Keep generic navigation and creation icons independent of task state.
- Read [the icon system rules](src/components/icon/system/README.md) before adding or changing interface icons or icon motion. Reuse the original Macro SVG family via individual `@icon/system/...` imports; do not introduce another icon set.
- If a glyph is missing, author original SVG geometry on the 24-unit grid with round caps/joins, restrained detail, `currentColor`, and the documented theme-aware weight. Never trace or import proprietary symbol paths. Match active/bold variants and review 14/16/20/24 px in light and dark mode.
- Interactive glyphs use the shared `installIconMotion` behavior; do not add per-button bounce/spin effects. Keep state indicators static, preserve accessible control names, and honor reduced motion. See the icon README for wrapper and opt-out attributes.

### Creation choices and notifications

- Reuse `CreateMenuItem` for explanatory New menu entries: original icons, a title, and muted wrapping descriptions, preserving the existing `ViewCreateButton` trigger and each action's feature gates.
- Keep transient toasts in their bounded stack and persistent prompts/reminders in separate regions; preserve keyboard dismissal, full mobile descriptions, and remaining-time pause on hover/focus.

### Sidebar tag dragging

Email and Calls sidebar tags can be dragged onto taggable desktop list rows.
Keep existing tags and apply to the selected rows when the drop row is selected.
Use the shared scoped drag helpers and overlayIcon for the tag chip.
The backend-free browser regression is
`bunx playwright test --config src/features/property/tags/browser-test/playwright.config.ts`.
