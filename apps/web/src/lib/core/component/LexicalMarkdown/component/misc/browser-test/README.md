# Heading folds browser regression

From `apps/web`, run:

```sh
bunx playwright test --config src/lib/core/component/LexicalMarkdown/component/misc/browser-test/playwright.config.ts
```

Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to use an installed Chrome, and
`HEADING_FOLDS_TEST_PORT` to move the harness's Vite server off port 3006.
On a machine out of inotify instances (Vite fails with `EMFILE`), add
`CHOKIDAR_USEPOLLING=1`.

The fixture mounts a Lexical editor in the document editor's layout (a
positioned container around a full-width root, in a 24px gutter) with the real
heading-folds plugin and `HeadingFoldControls`. On desktop, tablet touch, and
phone touch it checks that the chevron sits in the gutter and on screen (a
36px touch target reaching at most 6px over the text), shows on hover or always
on touch, folds nested sections, restores folds after a reload, and that
Mod+Enter and Enter after a folded heading behave. No network is used.
