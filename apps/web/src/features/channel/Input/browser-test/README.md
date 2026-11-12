# Channel composer browser regressions

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

The line-break regression sends a draft into the renderer channel messages use
and compares the message's rendered line spacing with the draft's. The composer
used to flatten its paragraphs, so lines the draft showed together were spaced
out on send.

The send regression checks desktop and phone: a pending send clears the editor,
a rejected send restores its draft, and a rejection preserves a newer draft
typed while delivery was pending. The fixture controls completion locally.

The formatting regression mounts the production message editor on 320px and
390px touch screens. It selects part of a draft before opening the add drawer,
opens the ribbon, removes strikethrough only from that selection, hides the
ribbon, and saves the edit. It also checks that tapping ribbon padding keeps
editor focus and the selection, and that the last control stays reachable
without widening the composer.

The code-paste regression types three backticks to open a code block in the
production composer and pastes a Macro link, then Markdown. Both land as literal
code text: the link used to become a mention the code block dropped, and the
Markdown used to lose its syntax.

The CRM mention regression uses the real menu and contact query with controlled
pages. It selects a CRM contact whose email also belongs to a Macro user,
verifies the stored contact link, and pages CRM results on desktop and phone.

Thread privacy is determined by the mentioned agent's settings on the server.
The composer has no visibility controls or saved audience choice. Exercise
agent mentions, inherited ephemeral-thread replies, and shared-thread forks
against the isolated full stack with two users; see
`docs/agent-guide/channels.md` at the repository root.

The attach regression taps the add drawer's Attach files on a phone. A phone
browser opens the file picker within the tap. With the iOS app's Tauri bridge
stubbed and its photo library picker failing, the composer opens no picker by
itself, since WKWebView ignores a file input click once the native round trip
has outlived the tap. It shows a toast whose Choose files button opens the
picker instead. On desktop, the add menu's Attach files narrows the picker to
the channel's file types in a browser and leaves it unfiltered in the desktop
app (Tauri bridge stubbed as macOS), where a filtered picker attached nothing.

The mention-ranking fixture also mounts document discussion composers over a
bounded virtual 100k contact source. Desktop/phone cases verify lazy activation,
replaceable pages and scroll reset, a late-directory match, insertion, and an
explicit empty scope that offers agents without falling back to the directory.
Each scenario uses its own draft persistence key. The real configured editor,
MarkdownShell, mention hook and menu run together; this catches dropped window
transforms that isolated source tests cannot. Channel/CRM scope and agent rollout
behavior also have unit coverage.
