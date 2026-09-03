## Development Commands
- Use `bun` as the package manager and script runner (`bun run build`, `bunx tsc`).
- `bun run test`: run tests 
- `bun run check`: check typescript changes 
- `bun run lint`: lint with biome 
- `bun run format`: format changes with biome 
- `bun run knip`: to check for dead code
- Email rendering snapshots (Playwright HTML fixtures, not inbox e2e) live in `src/lib/core/email/tests`. Run `just test-email-rendering`. Add a fixture under `fixtures/` then `just test-email-rendering-update`.

## Verifying a change in a real browser

Any user-visible change should be exercised in a browser before you call it fixed — type-check, biome, and vitest all pass on code that still has the interaction bug.

A frontend dev server runs against the **dev** backend, so this needs no local stack, Docker, Rust build, or `sudo`:

```sh
cd apps/web && PORT=3003 bun run dev   # any free port in 3000-3009
```

`import.meta.env.MODE === 'development'` resolves the service clients to `https://dev.macro.com` and the browser's existing dev cookies authenticate, so `http://localhost:<port>/app` loads the real workspace. Notes:

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
- Full details, Doppler vs no-Doppler modes, and port-conflict debugging: `docs/RUNNING_LOCALLY.md`.
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

### General
- All API/network calls live in service-clients.
- Shared server-state queries and mutations live in `src/lib/queries`; keep
  feature-specific query orchestration with its owning feature.
- When adding or changing a feature flag, follow the `define-feature-flag` skill.

### SolidJs
- Avoid createEffect. Legitimate uses: syncing with external/imperative systems (DOM APIs, third-party libs). If you're using it to derive state or trigger updates, use a derived signal or wrap the setter instead.
- Prefer wrapping the setter over `createEffect(() => { if (signal()) sideEffect() })`. When setting focus/selection should also clear another stop, blur a control, or scroll, put that work in the setter (or a named helper the setter calls) so the action is explicit at the call site — not a distant effect watching the signal.
- Use createMemo only when you need referential stability or the derivation is expensive. Cheap derivations (() => a() + b()) don't need it regardless of subscriber count.
- Before rolling your own reactive utility, check solid-primitives first.
- Never read a solid-query `query.data` unguarded from a component body or an eager `createMemo`. `data` is a resource read: while the query is pending it suspends the caller's nearest `<Suspense>`, which detaches and re-attaches that whole subtree — a blank flash, lost scroll position, remounted editors. Gate the read on status (`query.isSuccess ? query.data : fallback`, or check `isPending`/`isLoading` first); every other field is a plain store read and is safe. Remember `createMemo` runs immediately, so a guard inside a `<Show>`/`<Match>` further down does not save you. This has blanked the calendar grid twice — see `focusTarget` in `src/features/block-calendar/CalendarBlockAdapter.tsx` and `useSystemSkillsQuery`.

## UI / Components
- Prefer composition over configurability. Follow slot-based patterns (see src/features/channel, src/features/entity, or Kobalte).
- Keep reusable components small, atomic, and decoupled from queries/complex state. Push data-fetching and mutations up to use-case-specific composed components.
- Context should be scoped to a component subtree — Message.Content consuming a MessageContext is fine because the ownership boundary is clear.
- Composed primitives must not depend on use-case-specific context — a RecipientsSelector should never require an EmailComposeContext.

## Styling
- Use semantic color tokens, not raw Tailwind color classes.
- Do not add cursor-pointer to clickable elements.
- Prefer styling in the component (Tailwind classes on the markup) so styling lives next to structure. Reserve `@utility` in `index.css` for styles that are widely shared across many components — not one-off or two-component layouts.

## TS
- For exhaustive switch statements use `match` from `ts-pattern`.

### Misc
- If you create a Lexical Node or make breaking changes to a Lexical Node, you must increment the lexical version counter (in src/lib/core/component/LexicalMarkdown/version.ts) along with a brief note about changes.
- Avoid `blockSignals`, `blockEffects`, `blockMemos` etc...

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

## Notes
- Don't shy away from pulling good examples into context. In the case of solid-primtiives/kobalte try reading documentation, or just temp clone into /tmp to reference

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
