# Messaging browser verification

This harness runs the complete bundled app with synthetic API and websocket
responses. It exercises ordinary and external channel composition, activity and
unread navigation, pending-to-native row replacement, drafts across navigation,
reload and user changes, denied sends, loading/error states, uncertain-send
acknowledgement, source edit/unsend display, customer Call suppression during
loading/errors and join-call deep links, preserved ordinary calls, and expired
reply draft recovery with a new intent key. It blocks nonlocal traffic and
uses a fresh browser context. It does not verify provider delivery or backend
permissions; the Rust HTTP/database suites cover those service boundaries.

From `apps/web`, inside the repository Nix shell:

```sh
bun ../../node_modules/typescript-native/bin/tsc -p tests/meta-messaging/tsconfig.json
MODE=development bunx vite build -c tests/meta-messaging/vite.config.ts
bunx vite preview -c tests/meta-messaging/vite.config.ts --outDir /tmp/macro-messaging-browser-dist --base /app --port 3041
# In another terminal:
bun build tests/meta-messaging/browser.ts --target=node --packages=external --outfile=node_modules/.meta-messaging-browser/browser.mjs
node node_modules/.meta-messaging-browser/browser.mjs
```

Use `CHROMIUM_PATH` for an installed Chromium binary and `MESSAGING_BROWSER_URL`
for another preview origin. Screenshots are written to
`/tmp/macro-messaging-browser.png`, or `-failure.png` when an assertion fails.
