# Table border controls

This focused cohort mounts the actual Source table UI and its native required
hosts. The native branch uses the real overlay installer, local Macro session,
SessionPort, generation-qualified table facts and existing table actions. Its
table input is raw JSON captured through Source's Save state control.

From `apps/web`, with the matched five-file native package in this checkout:

```sh
NODE_OPTIONS=--max-old-space-size=16384 GOMAXPROCS=2 \
  TABLE_SOURCE_INPUTS=/tmp/table-source-inputs \
  bunx playwright test --config src/lib/core/component/LexicalMarkdown/editing/table-hover-browser-test/playwright.config.ts

NODE_OPTIONS=--max-old-space-size=16384 GOMAXPROCS=2 TABLE_ENGINE=native \
  bunx playwright test --config src/lib/core/component/LexicalMarkdown/editing/table-hover-browser-test/playwright.config.ts
```

The six shared controls cover row insertion and its typing caret, column
insertion, hovered row/column/table deletion, and read-only retirement/remount.
Source additionally captures its table input. Both arms click the button's
exposed edge with a real hit test and no forced click. Native resize and touch
bars remain separate; the slash menu owns its table picker. This does not
establish resize-strip center hit parity, the older complete table cohort,
history grouping, transport durability, other engines, or installed-app parity.
The original standalone and collaborative history evidence remains separate.

`TABLE_OVERLAYS_PORT`, `TABLE_TEST_REPORT` and `TABLE_TEST_OUTPUT` isolate runs.
`TABLE_SKIP_BUILD=true` serves exactly `TABLE_OVERLAYS_DIST` with a fresh static
server. The shared browser hook checks every served script/WASM byte against
that directory and fetches its actual compiled Lexical/code-core maps. It
records raw state and rejects external HTTP/WebSocket attempts. It uses settled
initial imports and awaited DOM assertions, not asynchronous browser predicates.

The Source header replacement unit control exercises the actual shared delete
button after Lexical replaces a cell's DOM. The native DOM-detach control
isolates the captured model-key contract; it is not a native header producer or
remote/remount rendering proof. Removed/wrong-type targets are rejected by the
real native action, while mismatched generation and retired/UI-disabled hosts
cannot submit. A normal SetState is not assumed to rotate model generation.

Future table-facts query failures retire only the table group and report the
original cause. Actual-model unit controls cover opaque errors, throwing
cleanup, callback reentry/failure, listener remount and sibling typing survival.
Cold insert/delete dispatch spans attach to the view's parent span; no trace is
created per pointer movement. A dispatch span does not assert queued completion.
