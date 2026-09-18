# Native offline E2E (Linux)

Automates the **real desktop Tauri application** using WebdriverIO →
`tauri-driver` → WebKitWebDriver. No Chromium, mock IPC, WASM cache substitute,
or production test hooks.

## Run

From the repository root:

```sh
nix develop .#tauri-e2e
bun install --frozen-lockfile
\cd apps/web
bun run native:e2e:build       # pinned driver, required WASM assets, native binary
bun run native:e2e:smoke       # verify environment/backfill/native transport
bun run native:e2e            # includes the offline filter regression
```

First build downloads/compiles Rust dependencies. Subsequent builds are incremental.
Rebuild after native code or `tauri.e2e.conf.json` changes; frontend changes are
served directly by Vite. The build temporarily sets the existing ignored
`.macro-tauri-env` marker to development and restores it on exit. Do not run a
normal Tauri build concurrently with this preparation step.

The binary, driver and build caches live under `apps/web/tauri/target/e2e/`.
The helper WASM builds respect an explicit `CARGO_TARGET_DIR`; otherwise their
build cache is isolated there too. No database, migrations, credentials, dev
account, Docker, sudo, or local backend stack is required.

### Expected result

Both suites must pass. The full suite checks native Soup predicate evaluation via
`graphql_cache_entity_filter`, including filter combinations never fetched online.
Neither IPC nor cache results are replaced. Establish a passing smoke run first
when diagnosing an environment/startup failure.

## What is real and what is a fixture?

Real: app navigation and filter controls, service clients/native HTTP, urql,
`useSoupBackfills`/checkpointing, GraphQL normalization, Tauri IPC, and the
file-backed native Turso cache.

Fixtures replace the **remote services**, not the client cache. `fixtures/server.ts`
serves the normal `/dss/items/soup/graphql` path, executes the app's generated
queries against `static_assets/schema.graphql`, and returns three pages of Mail
metadata. Projection capsules reuse the existing Rust-encoded fixtures.
Unrelated app-chrome reads return explicit empty resources. Unexpected requests,
unknown cursors and GraphQL validation errors are recorded and fail the smoke
suite; nothing forwards to hosted services. This does not test the Rust HTTP
server's authorization, SQL, or Gmail synchronization.

The six threads are IDs ending in 4, 6, 8, 9, 10, and 12:

| View | Expected IDs |
| --- | --- |
| Initial online Signal | 6, 12 |
| Offline Noise | 4, 8, 10 |
| Offline All | 4, 6, 8, 9, 10, 12 |

Only the initial Signal view may receive an online Mail response. The other rows
arrive via metadata backfill. Tests wait for the real three-page completion
checkpoint, then read the six normalized records through native IPC before
changing filters. Tab changes use the app's public numeric hotkeys (2 / 7) and
verify `aria-current` before checking results. Assertions compare exact row
identities, not just counts.

## Exhaustive filter-selection matrix

```sh
bun run native:e2e:matrix
```

This uses the new Email, Tasks and Channels views and the current Files view.
It generates requests with their **production query builders**, including the
real Files presets/type refinements and GraphQL translation. Grouping is pinned
to `none` and sorting to `UPDATED_AT DESC`; neither selector is covered yet.

The Cartesian product includes every static option and every subset of the
bounded fixture domains (two people, two tags and two linked inboxes, including
both All inboxes and an explicit empty inbox selection). Registry assertions
fail when a UI gains an option/facet that has not been added to the matrix.
The corpus has 75 entities and fits within one initial page: this suite does
not claim coverage of non-Mail offline pagination or every possible real-world
user/tag/file value.

After all five real backfill lanes finish, the fixture API and WebSockets are
closed. The browser-side runner calls the real Tauri cache host in bounded
read-only batches and asserts exact matching IDs against fixture truth. No
query-specific network baselines are supplied. Mail attachment selections also
run the production client predicates against records selected from the native
cache. Only identical native requests within a batch are shared (attachment
chips intentionally do not change the server AST); every selection is asserted.

Progress and failing inputs are saved to `filter-matrix.json`; the first request
is also saved before native evaluation. Exact per-view count assertions guard
against silently omitted selections: Email 20,160; Tasks 98,304; Files 69,632;
Channels 3. The exhaustive suite has a 90-minute watchdog (individual native
command timeouts are unchanged), rather than the smoke suite's four minutes.
To isolate a failure, use `bun run native:e2e:matrix --matrix-view=tasks`
(or `email`, `files`, `channels`). A focused run is not a full-matrix pass.
The test build keeps the development UI protocol but optimizes the Turso VM.
`filter-corpus.ts` owns fixture facts; `filter-capsules.json` is generated by the
canonical Rust capsule encoder, not a hand-built wire format. After changing
fixture document IDs or server-only facts, regenerate inside Nix:

```sh
bun run native:e2e:generate-fixtures
```

### Shared Files creator regression

```sh
bun run native:e2e:matrix --matrix-view=files-shared-creators
```

This focused 96-selection run reuses the full matrix's Files request builder,
including `applyDocumentTabScope`, the same request-time scope used online.
It checks every fixture creator/tag subset with no type filter, PDF, and PDF +
Code, on Shared and on All as a positive control for owned records. Shared + Me
must be empty; Me + another creator must return only non-owned matches; no
creator selection must return all matching Shared files. No Files query is
prefetched online, and no server membership baseline is supplied to native IPC.

The companion `document-tab-scope.test.ts` tests actual query-store edits,
clearing/restoring creator filters, and REST/flat/grouped GraphQL request parity.
The focused native run does not claim full Files matrix or grouped-offline coverage.

## Offline model and isolation

`run.sh` creates unprivileged user/network/PID/mount namespaces with **only
loopback**, a private D-Bus session and Xvfb display, and a disposable HOME/XDG
profile. The binary has a separate `com.macro.app.e2e` identifier and `macro-e2e`
deep-link scheme, with automatic OTA updates compiled out. No real user cache,
cookies, desktop registration or host network configuration is changed.

Vite and the fixture API have different listeners. Going offline closes the API
listener, in-flight HTTP connections and open WebSockets. The test verifies that
native `platformFetch` can reach it before disconnect and fails afterward, while
native cache reads still work. All external routes are absent for the entire run,
so native HTTP/WebSocket clients cannot bypass browser-only interception.

Vite/WebDriver remain reachable to load lazy frontend chunks and drive controls.
This models **API transport loss**, not an offline packaged-app cold launch.
Linux has no iOS `NWPathMonitor`: the test does not fake `navigator.onLine` or
native reachability notifications. The matrix covers filter evaluation, while
the smoke scenario drives the real Mail tabs. Clicking every dropdown sequence,
packaged-app restart, non-Mail offline pagination, sorting/grouping and iOS
reachability remain separate follow-up scenarios.

## Diagnostics and checks

Every run writes `apps/web/test-results/native/<timestamp>/`:

- `requests.json`: method/path, GraphQL operation/variables, fixture errors (no auth headers).
- `checkpoints.json`: persisted backfill progress.
- `webview.png` / `webview.html`: final UI, plus per-scenario captures on failure.
- `vite*.log` / `tauri*.log`: frontend server, native driver and application output.

```sh
bun run native:e2e:fixtures   # fast schema/pagination/disconnect fixture tests
bun run native:e2e:check      # standalone harness TypeScript check
```

- Missing WebKitWebDriver/Xvfb: enter `.#tauri-e2e`, not the default shell.
- `unshare: Operation not permitted`: the host/CI runner must permit unprivileged
  user namespaces. Fail closed; do not remove isolation or run against hosted data.
- Startup timeout: inspect Vite/native logs and request errors first. Never reset
  the developer's cache to troubleshoot; every run already starts clean.
- Exit/interrupt tears down owned processes and removes the temporary profile.
  A four-minute watchdog bounds wedged WebDriver requests and shutdown. Artifacts
  are retained; fixed ports are safe inside the private network namespace.

## Future iOS driver

Keep fixture API data and expected filter cases independent of Linux process
management. `driver.ts` contains WebDriver webview interactions; `runner.ts` and
`run.sh` own Linux launch/isolation. An iOS runner can reuse the fixtures and
assertions with Appium/XCUITest in the app's webview context, but needs its own
simulator installation/profile lifecycle, reachable fixture origin, and native
network-loss control. This change does not install or claim iOS support.
