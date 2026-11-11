# Browser: the agent's own

Chromium on the computer's display (`DISPLAY`, the one computer use drives), with a profile in
`state/private/browser/profile` that keeps what the agent signs in to. DevTools on
`127.0.0.1:9336`, loopback only.

| File         | What it holds                                                                     |
| ------------ | --------------------------------------------------------------------------------- |
| `config.ts`  | The port, the program and the paths.                                              |
| `browse.ts`  | The steps over a `Tab` port, each a `browser.step` span. Pure.                    |
| `context.ts` | The real ports: starting Chromium detached, and a Playwright page as a `Tab`.     |
| `index.ts`   | `openPage`, `readPage`, `clickOn`, `typeInto`, `pasteInto`, `pressKey`, `screenshotPage`. |

- **Started on first use, by whichever process needs it**, detached, so it outlives a script's
  process; a running one is found by its port. It gets the child baseline only, never this
  process's credentials.
- **Each step connects, works in the newest tab of the default context, and disconnects.** For
  anything the steps don't cover, a script drives the same browser with Playwright's
  `connectOverCDP` (the module's docs).
- **A secret never passes through the agent:** `copySecret` puts it on the display's clipboard,
  `pasteInto` focuses the field and sends Chromium's `paste` editing command, which reads that
  clipboard. Typing a password with `typeInto` is what the docs tell it never to do.
- **Spans** carry the step's kind, the host and the outcome: never page text, typed text,
  selectors, or a path or query, which can carry tokens.
- **Not the share browser.** This one is signed in; the screen area's is never signed in, and a
  share on a call opens a clean context there. "Share my browser" means sharing the URL.
