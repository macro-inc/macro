# Native iOS app that cannot drift

Status: proposal. Nothing is built. A headless prototype of the renderer bridge
was run outside the repository; its results are under
[Prototype](#prototype).

Goal: ship a native iOS app (UIKit/SwiftUI views, native scrolling, gestures and
navigation) that has every feature the web app has, on the day the web app gets
it, without a second team rewriting screens in Swift.

## Why a Swift app drifts

Today iOS is the web app in a Tauri WKWebView. It stays current because web
bundles ship over the air (`tauri/macro_bundle_updater_plugin`), and only native
code waits for the App Store (`apps/web/docs/ios-releases.md`).

A hand-written Swift app breaks both halves of that:

1. **Two authors.** Every screen exists in TSX and again in Swift. Whichever one
   a change forgets is now wrong, and nothing fails when it is.
2. **Two cadences.** Swift and Rust compiled into the binary ship through App
   Review. Logic that lives there trails the web by days, and by months for
   users who don't update.

Drift is structural, not a discipline problem. The fix is to have one author and
keep the fast cadence, and make Swift do only what must be native.

## The idea

**Swift draws; it doesn't decide.**

Each feature is authored once, in its existing `views/mobile/<name>.tsx`, against
a small vocabulary of native primitives (`stack`, `text`, `list`, `row`,
`button`, `sheet`, …). On the web those primitives render DOM. On iOS the same
bundle runs headless in JavaScriptCore, and Solid's universal renderer
(`solid-js/universal`) turns it into a stream of tree operations that Swift
applies to real UIKit/SwiftUI views. The Rust engine is the on-device data plane
underneath both.

Solid is what makes this cheap. A signal change updates exactly the host node
that reads it, so the bridge carries one small op per change, with no virtual
DOM diff on either side.

```text
 Over the air (same bundle as web) ─────────────────────────────────────────────
   features/<f>/core, queries, primitives        (unchanged, shared with web)
   features/<f>/views/mobile/*.tsx               (written against primitives)
   @macro-inc/machine state machines             (unchanged)
        │  Solid universal renderer
        ▼
   op stream: create · insert · remove · prop · text   ▲ events by handler id
 ──────────────────────────────────────────────────────┼────── bridge (JSContext)
 App Store binary                                      │
   Swift renderer   primitive catalog → UIKit/SwiftUI ─┘
   Swift shell      lifecycle, push, CallKit, extensions, WebIsland, NativeIsland
   Rust engine      cache-core + cache-turso (C ABI into JS, UniFFI into Swift)
```

## Alternatives considered

| Approach | One author | Over the air | Native feel | Offline | Cost |
| --- | --- | --- | --- | --- | --- |
| Hand-written SwiftUI on the web's API | No | No | Yes | Partial | Rewrite every screen, forever |
| Rust view models, SwiftUI views (Crux style) | Logic only | No | Yes | Yes | Port all feature logic to Rust; web must adopt it too |
| Transpile TSX to SwiftUI | Nominally | No | Mostly | Yes | Lossy for arbitrary JS; output still waits for review |
| Server-driven UI | Yes | Yes | Yes | No | Breaks the local-first cache; adds latency |
| Keep the Tauri webview | Yes | Yes | No | Yes | What we have |
| **Headless TSX → native renderer** | **Yes** | **Yes** | **Yes** | **Yes** | Primitive catalog + shell, then migrate screens |

Moving feature logic into Rust looks attractive because the engine already runs
on device, but it trades the drift problem for a cadence problem: every logic
change becomes an App Store release. Keep Rust for what changes rarely and must
be fast (cache, storage, sync); keep features in the bundle.

## The pieces

### 1. Primitive vocabulary: the only contract

About thirty host elements, defined once as Rust types the way
`crates/dynamic_ui` defines agent views, with TypeScript generated through specta
and Swift generated alongside it. The Swift renderer `switch`es exhaustively over
the generated enum, so adding a primitive fails the Swift build until the
renderer handles it.

| Group | Primitives |
| --- | --- |
| Layout | `stack`, `scroll`, `spacer`, `divider`, `safeArea` |
| Content | `text`, `richText`, `image`, `icon`, `avatar`, `badge` |
| Input | `button`, `textField`, `toggle`, `menu`, `datePicker` |
| Collections | `list` (UICollectionView, diffable data source), `row`, `swipeActions`, `refresh` |
| Navigation | `navigationStack`, `screen`, `sheet`, `tabs`, `toolbar` |
| Escape hatches | `webIsland`, `nativeIsland(name)` |

Rules:

- Props are data. Functions become handler ids on the JS side; Swift sends
  events back by id.
- Accessibility (labels, traits, actions) is a prop on every primitive, so
  VoiceOver comes from UIKit, not from emulation.
- Design tokens (colors, type scale, spacing, radii) are generated from the web
  theme into a Swift asset catalog. No hand-copied colors.
- Every primitive, prop and renderer capability (a new list behavior, a new
  gesture) records the native build that introduced it, in the same Rust
  definitions. Because props are typed, the bundle build can list every
  primitive and prop the mobile views use from the TypeScript program, and it
  raises `min-native-build.json` to the highest build any of them needs. The
  existing iOS release gate then covers renderer changes with no new process.

### 2. One mobile view, two outputs

Primitives also have plain DOM implementations, so a `views/mobile/*.tsx` file
renders in mobile web and in the current Tauri app unchanged. Desktop views are
untouched. Features keep the layered structure in
[frontend features](../architecture/frontend-features.md), but `core/`,
`queries/` and `primitives/` are not headless-ready yet: about 190 files there
use `window` or `document`, mostly focus and visibility listeners and custom
events. Phase 0 replaces those with a small host interface (app foreground,
visibility, app events), backed by `window` and `document` on the web and by
`UIApplication` notifications on iOS. A lint then keeps new browser globals out
of those layers.

### 3. Headless JavaScript on iOS

- **Runtime.** `JSContext` from the system JavaScriptCore framework: no binary
  cost, and Apple permits downloaded scripts run by JavaScriptCore or WebKit as
  long as they don't change the app's primary purpose. The OTA bundle already
  relies on this. In-process JavaScriptCore has no JIT on iOS; measure cold
  start and a large list update on an older device before Phase 1, with Hermes
  bytecode as the fallback runtime.
- **Delivery.** The existing bundle updater and `MIN_NATIVE_BUILD` gate deliver
  the bundle. The native app ships one more bundle entry point (headless) next
  to the web one.
- **Ops.** Batched per microtask and applied on the main thread in one
  `CATransaction`. Scrolling, animation and gestures never wait on JS; `list`
  asks JS only for cell subtrees as they come on screen.
- **Text input.** Native owns the text buffer and reports changes; JS never
  writes the value back during composition. This avoids the cursor jumps and
  broken IME that echoing produces.
- **Tracing.** Per the observability rule, the bridge is a hop: ops carry the
  trace context captured at the action (`Telemetry.captureContext`), and Swift
  opens an apply span under it, so one trace runs from tap through render to
  native commit.

### 4. Rust engine as the data plane

- `cache-core` and `cache-turso` already build for iOS inside
  `graphql_cache_plugin`. Today JS reaches them through Tauri IPC (the
  `graphql_cache_*` commands in `native-commands.json`), serializing every call.
  In the native app the same functions are bound straight into the `JSContext`
  through a C ABI, with no IPC hop.
- UniFFI bindings expose the engine to Swift-only code: widgets, the
  notification service extension, the share extension, App Intents and
  CallKit. Extensions have tight memory limits and can't host a JS runtime;
  they read the same Turso file through an app group, offline. This is where
  running Rust on device pays off directly in Swift.
- Feature logic and `@macro-inc/machine` state machines stay in TypeScript.

### 5. Escape hatches

- **`webIsland`** renders a route in a WKWebView loaded with the same bundle.
  Every route not yet native uses it, so iOS never lacks a feature. Editors
  (Lexical, Loro collaboration, canvas, spreadsheet) start as islands and may
  stay there.
- **`nativeIsland(name)`** is a bespoke Swift view registered as a primitive
  (call UI, camera, a custom canvas). It is versioned and gated like any other
  primitive.

## What keeps it current

1. **One author per screen**: `views/mobile/<name>.tsx`, shared with mobile web.
2. **Generated contract**: primitives in Rust, TS and Swift generated; CI fails
   on stale output (as `Check Specta Types` does today) and Swift fails to
   compile on an unhandled primitive.
3. **Automatic native floor**: primitives, props and capabilities used by a bundle raise
   `min-native-build.json`; older binaries are asked to update instead of
   receiving a bundle they can't render.
4. **Route coverage manifest**: every mobile route is `native` or `webIsland`.
   New routes default to `webIsland`, so a web feature appears on iOS the day it
   ships and becomes native when its mobile view uses primitives.
5. **Tests without a simulator**: mount a mobile view on the headless renderer
   in Vitest and snapshot the primitive tree. On macOS CI, Swift replays
   recorded op streams and snapshots the rendered views.

## Migration

| Phase | Ships | Exit check |
| --- | --- | --- |
| 0 | Swift shell, `JSContext`, Rust engine bound into JS; host interface replacing browser globals in feature logic; the whole app as one `webIsland` | Parity with today's Tauri app on TestFlight |
| 1 | Primitive catalog v1 with DOM implementations; list-heavy surfaces first (inbox, channel list, tasks) | Scroll and cold-start budgets met on an older device |
| 2 | Native navigation, tabs, sheets and menus | No web chrome visible outside islands |
| 3 | Widget and notification service extension on UniFFI | Offline reads from the shared Turso file |

The Tauri iOS target keeps shipping until Phase 0 reaches parity. The op stream
is platform-neutral, so Android can later get a Compose renderer for the same
bundle.

## Prototype

A Solid universal renderer was run headless under Bun (whose engine is
JavaScriptCore, with JIT) with a task list written in TSX against `stack`,
`text`, `list`, `row` and `button`. The host config records each mutation as an
op and replaces function props with handler ids:

| Action | Ops sent to native |
| --- | --- |
| Mount | 30 |
| Tap a row (header counter changes) | 1: `{"op":"text","id":8,"value":"1"}` |
| Add a task | 8: the new row's subtree and one insert |

## Risks and open questions

- **Interpreter speed.** No JIT in-process; the Phase 0 measurement decides
  between JavaScriptCore and Hermes.
- **Bridge timing.** Anything that must answer within a frame (gesture-driven
  layout, keyboard avoidance) belongs in a primitive, not in JS.
- **Two primitive implementations** (DOM and Swift) can disagree on behavior.
  Keep them thin, and drive both from the same snapshot fixtures.
- **App Review.** Bundles may change features but not the app's primary
  purpose, the same constraint the OTA bundle has today.
- **Editors** stay web islands; a native rich-text editor is a separate project.
