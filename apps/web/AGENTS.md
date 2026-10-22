## Development Commands
- Use `bun` as the package manager and script runner (`bun run build`, `bunx tsc`).
- `bun run test`: run tests 
- `bun run check`: check typescript changes 
- `bun run lint`: lint with biome 
- `bun run format`: format changes with biome 
- `bun run knip`: to check for dead code
- `bun run lint:oxlint` (repository root): type-aware oxlint. `typescript/no-floating-promises` is an error with no suppressions and `ignoreVoid: false` (FE-13), enforced in `just check` and CI; start detached work with `fireAndForget` from `@core/util/fireAndForget`, not `void`. Plain `oxlint` without `--type-aware` skips that rule silently. The ast-grep rule `ts-no-expression-void` covers `() => void p()`, which the lint can't see.
- Email rendering is isolated in `packages/email-renderer` at the repository root. Run `just test-email-rendering` for its Node and Chromium suites. Add fixtures under `packages/email-renderer/tests/fixtures`, run `just test-email-rendering-update`, and review changed images. These are renderer tests, not inbox e2e.
- The app does not register a service worker. Keep `public/sw.js` as a retirement
  endpoint for existing installations; see the [startup bundle rule](../../.agents/rules/web/startup-bundle.md).
  Loro uses async WASM loading and HTML preloads independently of service workers.
- Web asset publication and cache headers are covered by
  [web-app delivery](../../infra/stacks/web-app/README.md); its publisher tests
  are backend-free, and its Pulumi tests must not run real staging/cloud commands.

## Verifying a change in a real browser

Any user-visible change should be exercised in a browser before you call it fixed — type-check, biome, and vitest all pass on code that still has the interaction bug.

Split dragging and composer reflow have a backend-free browser regression:
`bunx playwright test --config src/lib/core/component/Resize/browser-test/playwright.config.ts`.
It exercises the real resize solver, scroll container, and Lexical layout primitive.

Discussion link scrolling has a backend-free browser regression:
`bunx playwright test --config src/lib/core/messages/browser-test/playwright.config.ts`.

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

## Development Patterns

- Reuse `src/components/WorkspaceTexture.tsx` for the onboarding and Create
  detail panel grain; pass the surface accent and a unique SVG filter ID.

### Pipedream native authorization

Keep native Pipedream consent in the system browser: the desktop navigation
plugin redirects external popups and breaks the embedded iframe's return path.
`pipedream-connect.html` is a separate Vite entry, served at
`/app/pipedream-connect.html`, without a Macro browser login. The Connect token
and one-time state travel only in its URL fragment, which the page removes on
load. Its **Return to Macro** link is consumed by the Tauri navigation bridge
without changing the active route. Backend registration still verifies account
ownership. Cancel, logout, and the ten-minute timeout retire pending callbacks.

### General

- Empty human DMs use the shared centered conversations graphic and explain email delivery to nonusers; keep this state out of agent DMs, loading/error states, and populated timelines.
- Email draft reads compare server generations before choosing cached delivery state over a restored working copy; only a definitive first-submission rejection permits local send recovery without server cancellation.
- Compose settings pages with `features/settings/primitives.tsx` so section headings,
  raised composer cards, row spacing, and control shapes stay consistent; keep
  Integrations on the shared page width and side padding.
- Keep personal accounts and agent tool connections together in Settings → Integrations;
  preserve `agent-connections` as an alias for existing links.
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
- Disable GraphQL cache sessions and clear login hints on confirmed auth 401s,
  even with retained user data; preserve session state on transient failures.
- Treat a repeated worker-ready frame as a coordinator restart: retire the old
  engine and re-register in place, preserving durable storage and never replaying
  uncertain enqueues. See `docs/graphql-normalized-cache-plan.md`.
- Mobile dock customization shares the navigation island’s measured capacity; persist ordering per user with `mobile-dock-order.ts`, preserve gated destinations, and keep Search and More fixed. Reorder handles drag without a hold delay; the rest of each row scrolls.
- Share sidebar and mobile dock unread presence through `components/app/use-navigation-unread.ts`; keep badges reactive to read/done changes, guard all query data with `queryReadyGate` so pending preferences or paused queries cannot suspend the shell, and avoid fetching extra pages for counts.
- Mobile dock search owns transient category/mode state in `features/command/mobile`; reuse the shared entity source and explicit full-text adapter rather than overlaying the dock query on view tabs or saved facets. See `docs/agent-guide/search.md` at the repository root.
- Include known Macro users in typed All/People name searches without requiring a DM or CRM contact; resolve a matching person to their existing one-to-one DM while preserving name/email matching.
- Key mobile name-result history ordering and scroll anchors by the other participant for one-to-one DMs, preserving a person's position when their conversation is created; keep group DMs keyed by channel.
- Keep mobile Search history lightweight: save query/category/mode, account-scoped item anchors, and at most 200 ordering IDs per mode; never save row objects or virtualizer caches. Restore from current sources with at most three additional pages, fall back when an anchor disappears, and stop restoration on user interaction or scope changes. Dock navigation starts a fresh search session; cached rows belong to the source, not history.
- Release saved entry state when its router entry is replaced, pruned, or closed; retain only the latest split event so obsolete payloads cannot keep result lists alive. Preserve snapshots for entries still reachable through Back/Forward.
- Keep Quick Access cache availability reactive to the GraphQL rollout flag; it can arrive after the provider mounts, and email has no legacy source fallback.
- Virtualize mobile name results like desktop Command Menu; local Quick Access sources are unbounded, and mounting them all stalls iOS keyboard focus during layout. Load additional search pages near the scroll end instead of reserving a paging bar.
- Reconcile mobile full-text rows by entity ID so appending a page preserves DOM rows and scroll position; restore item anchors after responsive row measurement and disable browser scroll anchoring so layout changes cannot override restoration.
- Reserve the safe area plus the category row above mobile Search, and only the safe area above Channels; their hidden split headers must not add another blank strip.
- Follow [mobile layout and chrome](../../.agents/rules/web/mobile.md#layout-and-chrome) for full-frame views and record tabs; verify their first controls below the navigation with a nonzero safe area on phones and tablets.
- Keep split chrome portal targets reactive so cached views can mount before their header, and clear a retiring header's targets only while it still owns them.
- Let `ViewShell.TopBar` own split close and navigation controls; do not add a second split close button inside Agents headers or their preview `headerLeading`.
- Show only the Recent conversation feed in mobile Channels, without view tabs or a persisted mobile tab selection.
- Mount the mobile search input before focusing it inside the dock tap; keep navigation in that handler so focus does not trigger a second navigation or lose iOS keyboard activation.
- Preserve focused chrome editors during deferred split insertion/removal autofocus; explicit return-focus commands may still focus the pane.
- Reconcile global focus when focused DOM subtrees are removed; iOS can omit blur events, otherwise floating creation actions stay hidden after search or editor teardown.
- Mount the floating mobile AI composer only on the Agents view; other views keep their New action or their own reply/comment composer.
- Keep desktop model and effort controls separate: the model selector opens the catalog and the speedometer opens the runtime's advertised slider stops; retain the mobile effort sheet.
- Passive PR mentions must not retry initial GitHub status failures on remount; preserve confirmed status through refetch errors and keep pending data reads out of their parent Suspense boundary.
- Keep native booking exit navigation in the route shell, outside page loading boundaries, and use the router so the native hash route stays intact.
- Diagnose native full reloads with `native_webview_started`, `native_diagnostic_recovered`, and the shared `frontend_instance_id`; use `reloadApp(reason)` for frontend reloads and keep breadcrumbs content-free. Treat `previous_document_*` checkpoints as last-observed lifecycle evidence, never a crash verdict; clear them on logout. See [frontend checkpoints](docs/native-reload-diagnostics.md) and `tauri/src-tauri/README.md`.
- Inline agent steps reuse the session code-execution query for live SDK operation
  names; completed step snapshots come from the shared fold of the tool receipt.
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
- Mark loaded calendar row notifications through the notification source so read
  dots update immediately and failed writes roll back; grid selections also mark
  the canonical event read, excluding team projections.
- Route explicit call exits using the server's `callEnded` result: ended calls
  open their record; ongoing channel and scheduled calls return to the channel
  and Calendar. Preserve the session ID before disconnecting.
- Diagnose browser call media with `call.media.*` spans and the `meeting.setup.id`
  on `meeting.join`; keep provider messages, device labels/IDs, and call-link
  tokens out of telemetry. See [call diagnostics](../../docs/agent-guide/calls.md#browser-call-diagnostics).
- Keep desktop Gmail and Outlook inbox consent in the system browser with a
  `macro:///inbox-link-callback` return; webview origins are not desktop callbacks.
- Keep send reservations, leases, and cancellation in the email journal; the general GraphQL queue handles draft autosaves only.
- Always persist composer sends in account-scoped IndexedDB and dispatch through the fetch-only email client, without a feature flag; cache health and unrelated mutation queues must not gate delivery. See `docs/architecture/email.md` for state and rollout invariants.
- Retry cache bootstrap on reconnect/foreground or draft Retry only when storage was proven untouched; retain the same scope and block draft sync until the replacement queue is readable.
- Touch email replies and forwards use the full-screen composer with the shared new-email header actions; preserve thread state underneath and flush local edits before closing.
- Draft autosaves preserve active email thread messages; evict inactive legacy
  caches on save and the active cache on thread exit. Revalidate GraphQL thread
  pages only when a save cannot patch the message list (missing snapshot or a
  move between inboxes).
- Keep email card resize motion on its content wrapper so message and inline
  reply transitions preserve the card's focus target and return to natural height.
- Shared server-state queries and mutations live in `src/lib/queries`; keep
  feature-specific query orchestration with its owning feature.
- Refresh the channel list's bounded unread edge when opening a conversation,
  including an empty unread result after a read on another device.
- Route supported move, trash, restore, permanent-delete, duplicate, and share-policy
  writes through `queries/storage/entity-mutations` when GraphQL Soup is enabled;
  never retry failed GraphQL writes through REST. Preserve non-owner history removal
  and version-specific markdown forks on their existing paths. Confirmed restores
  clear earlier deletion markers without clearing a newer delete's intent.
- Preserve loaded block content on initial access confirmation when its loader
  supplies no permissions; reload only on a later confirmed permission change.
  Apply shared access in place only after a successful permissionless load.
- Grouped Soup's `graphql/create-grouped-soup-live-query.ts` owns initial and
  continuation pages plus their local predicate projection. Group readers only
  delegate paging; pass the parent's live `groupedPaging` accessor from every
  caller, including Tasks and project-task lists. Do not introduce independent
  continuation owners. Keep server
  membership snapshots separate from normalized field/link updates; restored
  properties do not prove prior membership. Supply complete prior multi-value
  memberships when adjusting counts: a row loaded in one bin may already be an
  unloaded member of another.
- Reactive GraphQL reads use `createLiveQuery` for a document and
  `useSoupAstItemsQuery` (backed by `createSoupLiveQuery`) for Soup lists; see
  [choosing a reactive read](docs/graphql-normalized-cache-plan.md#choosing-a-reactive-read).
- When adding or changing a feature flag, follow the `feature-flags` skill.
- When adding or changing a view's feature tour, follow the `add-tour` skill.

## Rules

Conventions for this app live in `.agents/rules/web/` and load when you touch
matching files: data fetching, Solid reactivity, architecture, UI, UI primitives,
the startup bundle, and Lexical nodes.

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

### Agent system events

Accept `notification` in both fetched and subscribed GraphQL session log rows.
System notifications live in fold metadata, separate from messages. Review
subjects refresh their existing card; other subjects render quiet timeline rows
through `block-agent/components/session-event-row.tsx`. Match typed event
payloads exhaustively, summarize outcomes without draft content, and keep the
icon, truncated summary, timestamp, and optional subject action on one line on
desktop and mobile.
Keep Responding bound to the notification turn, including rejection and noop.
The backend-free desktop/mobile check is
`bunx playwright test --config src/features/block-agent/browser-test/playwright.config.ts`.
Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` when using the Nix Chrome binary.

### Agent backend hosting

Cognition, routines, preview control, and MCP share `agent_harness_service`.
Direct local hosts use port 8101 with the existing feature prefixes; the
instance proxy retains `/cognition`, `/scheduled-action`, and `/preview`.
