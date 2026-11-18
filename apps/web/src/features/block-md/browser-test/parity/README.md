# Paired editor parity

Run from an independent checkout with its own dependencies and caches. Keep a
live preview's node_modules untouched. Use one enabled local preview and one
flag-off static frontend proxying the same local backend, with separate synthetic
documents owned by the test account. Never use a personal browser profile.

```sh
EDITOR_PARITY_ON_URL=https://on.localhost:24009/app/ \
EDITOR_PARITY_OFF_URL=https://off.localhost:39770/app/ \
EDITOR_PARITY_ON_DOCUMENT_ID=<synthetic-document> \
EDITOR_PARITY_OFF_DOCUMENT_ID=<synthetic-document> \
EDITOR_PARITY_AUTH=/absolute/path/to/private-storage-state.json \
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/absolute/path/to/chromium \
bunx playwright test --config src/features/block-md/browser-test/parity/playwright.config.ts
```

For a machine-specific local hostname, set `EDITOR_PARITY_LOCAL_HOST`; Chromium
maps it to loopback. Authentication storage must include both origins with the
same appearance preferences. Different persisted accents are real screenshot
differences, so align the fixture preferences rather than masking pixels.

The 34 scenarios cover empty state, title, tags/properties, block and inline
shortcuts, slash/mention/snippet menus, links, text/Markdown/HTML/file/image paste,
list indentation, checklists, tables, code, comments, dragging, undo/redo, reload
and independent-context collaboration. Both engines receive the same real UI
interactions. Missing configuration fails instead of silently skipping.

Artifacts include structured DOM, diagnostic accessibility snapshot and raw Chromium AX tree, zero-tolerance screenshot,
Markdown from the real Copy as markdown action, computed styles and browser
traces. Each paired case uses the live OFF result as its runtime baseline.
`.runtime-baselines` is disposable evidence, never an approved screenshot update.
Use Playwright's `--output` to preserve each run in a separate artifact directory.

The raw DOM comparator retains every attribute, style, node and text value.
Attribute and CSS declaration order is canonicalized because ordering does not
change DOM semantics. There is currently no approved engine-internal allowlist.
Missing decorator/accessory containers remain failures. Any proposed exception
needs its exact scope, reason and caller/selector/test/extension evidence in the
parity report before it is applied.

This checkpoint does not complete the parity gate: exact saved-JSON comparison
awaits the production facade's root lookup and saved-state cold API. Native
menus, comment publication and shortcuts are also under integration; failures
must remain visible. Do not interpret test collection or an isolated passing
comparison as preview acceptance.

Every case writes a content-addressed `parity-case.json` sidecar. The current
engine is explicitly native and cannot satisfy the production compatibility gate.
Saved JSON and full accessibility comparisons stay blocked; the test fails even
when the available comparisons match. No `toJSON`/`serializedState` substitution
counts as saved-state evidence. Standard Playwright JSON output goes to
`EDITOR_PARITY_JSON_REPORT` or `parity-results.json`; keep reports outside source.
