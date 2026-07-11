## Development Commands
- `bun run test`: run tests 
- `bun run check`: check typescript changes 
- `bun run lint`: lint with biome 
- `bun run format`: format changes with biome 
- `bun run knip`: to check for dead code

## Development Patterns

### General
- All API/network calls live in service-clients.
- All queries & mutations are defined in the queries package.

### SolidJs
- Avoid createEffect. Legitimate uses: syncing with external/imperative systems (DOM APIs, third-party libs). If you're using it to derive state or trigger updates, use a derived signal or wrap the setter instead.
- Use createMemo only when you need referential stability or the derivation is expensive. Cheap derivations (() => a() + b()) don't need it regardless of subscriber count.
- Before rolling your own reactive utility, check solid-primitives first.

## UI / Components
- Prefer composition over configurability. Follow slot-based patterns (see packages/channel, packages/entity, or Kobalte).
- Keep reusable components small, atomic, and decoupled from queries/complex state. Push data-fetching and mutations up to use-case-specific composed components.
- Context should be scoped to a component subtree — Message.Content consuming a MessageContext is fine because the ownership boundary is clear.
- Composed primitives must not depend on use-case-specific context — a RecipientsSelector should never require an EmailComposeContext.

## Styling
- Use semantic color tokens, not raw Tailwind color classes.
- Do not add cursor-pointer to clickable elements.

## TS
- For exhaustive switch statements use `match` from `ts-pattern`.

### Misc
- If you create a Lexical Node or make breaking changes to a Lexical Node, you must increment the lexical version counter (in packages/core/component/LexicalMarkdown/version.ts) along with a brief note about changes.
- Avoid `blockSignals`, `blockEffects`, `blockMemos` etc...

### Good Reference
- https://github.com/solidjs-community/solid-primitives
- https://github.com/kobaltedev/kobalte
- `packages/entity`
- `packages/channel`
- `packages/block-md`
- `packages/app/component/next-soup`

### Bad Examples
- `packages/block-channel`
- `packages/block-pdf`

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
