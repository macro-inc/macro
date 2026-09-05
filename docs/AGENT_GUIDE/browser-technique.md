# chrome-devtools MCP Technique (learned on Macro)

## Snapshot-first loop

- `take_snapshot` after every navigation or pane change; act only on uids from the latest
  snapshot. Uid prefixes bump (`7_x` → `9_x`) whenever the UI re-renders a region (the app
  is SolidJS); stale uids fail loudly — re-snapshot rather than guess.
- Macro snapshots are huge (split panes duplicate the whole doc text; the Activity heatmap
  adds ~400 nodes). Save with `filePath:` and grep the file via Bash instead of dumping the
  snapshot into context. Strip lines matching `Notifications (alt` when reading.
- The snapshot exposes contenteditable content as the element's `value` — use it to verify
  what you typed or what an AI edit produced.

## Interacting

- `fill` only works on real `<input>`/`<textarea>`/`<select>`. All Macro editors and message
  composers are contenteditable: **click to focus, then `type_text`** (optionally
  `submitKey: "Enter"`).
- Token comboboxes (channel invites, participant add): click the combobox, `type_text` the
  value, watch for the `N option(s) available` live-region text, press Enter to commit the
  chip before submitting the form.
- Radio tab strips (Messages/Attachments/Participants, Signal/Noise/All): clicking the radio
  input can fail with "element did not become interactive" — click the adjacent StaticText
  label instead.
- Clicking a menu button once can merely focus it. If the expected menu/form is absent from
  the next snapshot, click again.
- Dialog submits often use `Ctrl+Enter` (task create, background chat send) — `press_key`
  handles combos.

## Waiting

- `navigate_page` can time out at 10s while the SPA actually loaded — follow with `wait_for`
  on expected text instead of retrying navigation.
- `wait_for` matches any text on the page, including placeholders and duplicated doc text —
  choose strings that cannot pre-exist, or don't use it for completion.
- AI completion (edit or chat) has no reliable text signal. Poll inside `evaluate_script`:

  ```js
  async () => { for (let i = 0; i < 60; i++) {
    if (![...document.querySelectorAll('button')]
        .find(b => /Stop generating|^Stop$/.test(b.textContent.trim()))) return true;
    await new Promise(r => setTimeout(r, 1000)); } return false; }
  ```

## Diagnosing failures

- On any error dialog or blank page: `list_console_messages` (types error/warn) plus
  `list_network_requests` (resourceTypes xhr/fetch), then `get_network_request` on the
  suspicious reqid for headers/body. Pairing the console error with the failing request
  localizes the fault in one step.
- `net::ERR_NETWORK_CHANGED` spam means the environment's network flapped: verify the stack
  with curl from the shell, then `navigate_page` reload.
- Full-screen "Something went terribly wrong" dialogs: `Home` recovers navigation-level
  crashes; the LoroDoc crash needs a reload with `ignoreCache: true` (see documents.md).
- Browser restarts invalidate page ids AND (with a fresh profile) the login session; on
  "browser was restarted" notes, `list_pages`, re-select, and expect to re-login.
- Every backend request carries a `traceparent` header and returns `x-request-id` — grab them
  from `get_network_request` for backend correlation (see observability.md).

## Hygiene

- Work in the user-visible tab (no isolated contexts) when a human is watching via VNC.
- Prefer snapshots over screenshots; screenshot only when layout confusion matters.
- `evaluate_script` with `waitForStableDom: false` for read-only checks — it is cheaper and
  cannot deadlock on animating UI.
