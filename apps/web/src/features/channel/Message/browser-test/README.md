# Link preview layout regression

From `apps/web`, run:

```sh
bunx playwright test --config src/features/channel/Message/browser-test/playwright.config.ts
```

Requires installed Google Chrome. Videos and failure traces go to
`/tmp/macro-link-preview-browser`.

The fixture renders the production `Root`, `LinkPreviews`, `useUnfurl` batching and
cache, `ThreadList` virtualizer, CSS and light theme. Only app-session helpers,
external navigation, the mutation adapter and unfurl transport are replaced.
The mutation adapter uses real TanStack mutation lifecycles with controlled HTTP
responses; the production mutation integration remains covered by unit/API tests. No
hosted messages are created or changed. This is a component integration test,
not a signed-in end-to-end session.

Controlled responses separate metadata loading from image decoding. Assertions
check message height and the following text's position at each stage, continuously
track resize events, detect channel Suspense fallbacks, and retain a draft. Cases
cover desktop/mobile, empty metadata, HTTP failures, image failures, and both
latest/history virtualizer anchors, URL extraction and the three-card cap,
sender/deleted-message gates, persisted preferences, warm-cache remounts,
successful removal across reload, and concurrent failure rollback in both orders. The unit suite separately injects a Solid
resource to prove that suspension is contained by each card's boundary.

## Real local app and backend

With an isolated local stack running, use its proxy URL:

```sh
PREVIEW_LOCAL_APP_URL=http://localhost:31009 bunx playwright test --config src/features/channel/Message/browser-test/live.playwright.config.ts
```

This test refuses non-local URLs. It creates a disposable local user and private
channel, completes onboarding, and uses the real channel API, UI and mutation
hooks. Only metadata/image responses and deliberate failed PATCH requests are
controlled. It checks draft survival, concurrent rollback, saved suppression
without optimistic local storage, code preservation, the edit marker, reload,
and sending a new message from the composer. Video goes to
`/tmp/rich-link-preview-live`.
