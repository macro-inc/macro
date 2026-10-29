# Channel composer draft browser regression

From `apps/web`, run:

```sh
bunx playwright test --config src/features/channel/Input/browser-test/playwright.config.ts
```

Install Playwright Chromium first, or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`
to an existing Chromium/Chrome executable. `CHANNEL_DRAFT_TEST_PORT` overrides
port 3006; the harness owns and stops its Vite server.

The fixture mounts the production `ChannelInput` over the app shell's providers
and blocks hosted API traffic, so it needs no backend. It types a draft with a
blank line, unmounts the composer and mounts it again over the persisted draft,
which is the round trip through internal markdown that used to drop every blank
line.

The send regression checks desktop and phone: a pending send clears the editor,
a rejected send restores its draft, and a rejection preserves a newer draft
typed while delivery was pending. The fixture controls completion locally.

The code-paste regression types three backticks to open a code block in the
production composer and pastes a Macro link, then Markdown. Both land as literal
code text: the link used to become a mention the code block dropped, and the
Markdown used to lose its syntax.
