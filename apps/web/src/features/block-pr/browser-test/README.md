# PR comment rendering browser regression

From `apps/web`, run:

```sh
bunx playwright test --config src/features/block-pr/browser-test/playwright.config.ts
```

Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to use an existing Chromium, and
`PR_COMMENTS_SCREENSHOT_DIR` to save desktop and phone screenshots.
`PR_COMMENTS_TEST_PORT` overrides port 3006; the harness owns its Vite server.

The fixture runs CodeRabbit-shaped comments (`fixtures.ts`) through the
production `buildTimeline` and `GithubMessageView`, with hosted traffic blocked.
It checks that no HTML or marker comments show as text, that `<details>`
sections start collapsed and open on press (nested ones one level at a time),
and that icons drop out of bold labels, inline code stays code, and badge
images in tables read as their alt text.

Screenshots of a real CodeRabbit-reviewed pull request through the same view,
with the previous cleanup and with this plugin (sections collapsed, then all
opened): [before](proof/pr-10682-before.png),
[after](proof/pr-10682-after-collapsed.png),
[after, expanded](proof/pr-10682-after-expanded.png).
