# Channel preview browser regression

From `apps/web`, run:

```sh
bunx playwright test --config src/lib/core/component/LexicalMarkdown/component/core/browser-test/playwright.config.ts
```

Install Playwright Chromium first, or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`
to an existing Chromium/Chrome executable. `MARKDOWN_PREVIEW_TEST_PORT` overrides
port 3005; the harness owns and stops its Vite server.

The fixture mounts the production wide/narrow channel row content and Home card
layouts over synthetic data. It blocks hosted API traffic. Desktop, tablet touch,
and phone touch checks verify the browser's native accessibility tree, pointer
activation of the owning row, Tab navigation, and interactive conversation links
and mentions. DOM-derived ARIA snapshots do not model `inert`, so accessibility
assertions use Chromium's native CDP tree. This is component integration coverage,
not authenticated app navigation or a VoiceOver session.

Screenshots from the verified fixture: [desktop](proof/desktop.png) and
[phone](proof/mobile.png).

## Message links

`links.browser.e2e.ts` mounts the production Markdown parser, renderer, composer,
and link menu over the original App Store message. It checks pointer/keyboard
navigation, encoded URLs, Markdown punctuation, literal code, and Remove link →
save → reopen on desktop, tablet touch, and phone touch. Network requests outside
the local fixture are intercepted. Run just this case by adding
`links.browser.e2e.ts` to the command above.

Screenshots: [desktop](proof/autolinks-desktop.png) and
[phone](proof/autolinks-mobile.png).
