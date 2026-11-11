# Browser: the agent's own

The computer's Chromium, which the image runs as the `macro-agent-browser` service on the agent's
display (`:1`, the one computer use drives and a call's share shows), with a profile that keeps
what the agent signs in to. DevTools on `127.0.0.1:9223`, loopback only.

| File         | What it holds                                                                                   |
| ------------ | ----------------------------------------------------------------------------------------------- |
| `config.ts`  | The endpoint and the screenshots directory.                                                     |
| `browse.ts`  | The steps over muppet's `Tab`, each a `browser.step` span. Pure.                                |
| `context.ts` | The real port: muppet's `withTab` on the endpoint.                                              |
| `index.ts`   | `openPage`, `readPage`, `clickOn`, `typeInto`, `pasteInto`, `pressKey`, `screenshotPage`.       |

- **Each step connects, works in the newest tab of the default context, and disconnects.** For
  anything the steps don't cover, a script drives the same browser with Playwright's
  `connectOverCDP` (the module's docs).
- **A secret never passes through the agent:** `copySecret` puts it on the display's clipboard,
  `pasteInto` focuses the field and sends Chromium's `paste` editing command, which reads that
  clipboard. Typing a password with `typeInto` is what the docs tell it never to do.
- **Spans** carry the step's kind, the host and the outcome: never page text, typed text,
  selectors, or a path or query, which can carry tokens.
- **On a call, a share shows this browser** (the calls area's `share_screen`): what it is signed
  in to is visible to everyone on the call. Passwords are pasted, never shown.
