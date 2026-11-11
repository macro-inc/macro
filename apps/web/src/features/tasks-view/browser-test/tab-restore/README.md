# Tasks tab restore browser regression

Run from `apps/web`:

```sh
bunx playwright test --config src/features/tasks-view/browser-test/tab-restore/playwright.config.ts
```

Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` when using Nix Chromium. The fixture
builds before serving, with isolated output under `node_modules/.cache`.

The real `TasksViewProvider`, filter controls, saved-view draft, split router,
entry captors, and view-retention hook run over synthetic task data. The fixture
replaces account/directory sources, preview rendering, and unrelated routes, not
tab switching or persistence. Desktop and phone cases cover independent status
filters, matching task results, whole-view resume, and saved-view draft discard.
Screenshots and failure traces stay in the ignored `test-results` directory.
