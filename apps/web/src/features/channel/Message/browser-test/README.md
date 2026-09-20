# Link preview layout regression

From `apps/web`, run:

```sh
bunx playwright test --config src/features/channel/Message/browser-test/playwright.config.ts
```

Requires installed Google Chrome. Videos and failure traces go to
`/tmp/macro-link-preview-browser`.

The fixture renders the production `Root`, `LinkPreviews`, `useUnfurl` batching and
cache, `ThreadList` virtualizer, CSS and light theme. Only app-session helpers,
external navigation, mutation transport and unfurl transport are replaced. No
hosted messages are created or changed. This is a component integration test,
not a signed-in end-to-end session.

Controlled responses separate metadata loading from image decoding. Assertions
check message height and the following text's position at each stage, continuously
track resize events, detect channel Suspense fallbacks, and retain a draft. Cases
cover desktop/mobile, empty metadata, HTTP failures, image failures, and both
latest/history virtualizer anchors. The unit suite separately injects a Solid
resource to prove that suspension is contained by each card's boundary.
