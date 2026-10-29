# Collaborative markdown editor fuzzer

Several people type into one document at once, each in a separate browser page,
through the real editor: `registerMarkdownEditing`'s plugins, `CollabProvider`,
the sync engine, the Loro mirror, and reconcile. Only the menus and drop
overlays are left out (they need the whole app's providers). The sync service
is played by the Playwright process (`relay.ts`): every update and awareness
message goes through it, in FIFO order per peer with random latency, and a peer
can go offline and come back.

Each person types only at the end of their own region (the blocks after their
`Peer X:` marker), so `model.ts` predicts that region exactly from the
keystrokes: typing, Enter, Shift+Enter, Backspace, markdown shortcuts
(`# `, `## `, `### `, `> `, `- `, `1. `, and ```` ``` ```` then Enter). After
every keystroke the caret must be at the end of the model's current block.
After everything is delivered:

- every copy of the document, and the server's, are the same Loro state;
- every region matches its model, on every peer;
- the editor's internal markdown equals the markdown of its Loro document and
  of the server's (`toMarkdownText` in lexical-service);
- internal markdown survives an import and export unchanged;
- the editor state and its Loro document hold the same JSON;
- tree invariants hold (ids present and unique, lists hold list items) and no
  `console.error`.

Run it from `apps/web`, with the fixture's server on 3017:

```sh
bunx vite --config src/lib/core/component/LexicalMarkdown/fuzz/vite.config.ts
FUZZ_RUNS=10 FUZZ_PEERS=3 FUZZ_STEPS=80 bunx playwright test \
  --config src/lib/core/component/LexicalMarkdown/fuzz/playwright.config.ts
```

`FUZZ_SEED` picks the first seed (one per run after it), `FUZZ_LATENCY_MS` the
maximum delivery delay. Every run writes `reports/fuzz-<seed>.json` with its
findings and each peer's actions; `FUZZ_SCRIPT=<report>` replays those actions
(or any `{ "logs": { "A": [...], "B": [...] } }`) instead of generating them.
Delivery timing still varies between replays, so replay a failure a few times.
`FUZZ_DEBUG=1` prints the pages' console. `FUZZ_CONTINUE=1` keeps a person
typing after a caret finding (the model is off from then on, but console errors
and convergence still count).

`FUZZ_UNDO=1` adds two phases after typing: everyone presses Ctrl+Z until all
their edits are gone (`FUZZ_UNDO=sequential`: one person at a time), and the
document must be back to the markers; then everyone redoes, and every region
must match its model again. Findings carry the phase they came from.

`regressions.browser.e2e.ts` keeps the bugs the fuzzer found as fixed
scenarios; run it with the same configuration and `regressions` as the test
filter.

Known findings, which show up in most runs:


- `markdown-round-trip`: internal markdown drops empty paragraphs on import
  (`PRESERVE_LINES` writes them as a space line, and Lexical's importer then
  removes the paragraph as empty), and code blocks lose leading and trailing
  blank lines.
- `editor-vs-server-markdown`: with two or more empty paragraphs in a row the
  client's export (its `\n\n\n \n\n\n` fix, which misses overlapping runs) and
  lexical-service's (no fix) differ.
- `lexical-cascade-guard`: Lexical's cascade counter only resets on a commit
  that finds its queue empty, and a no-op update never commits; the markdown
  shortcut listener queues one per typed character, so about 100 characters
  typed in a row trip the guard, which drops the queued updates.
- Undo phase: with collaborators, undoing everything can leave a character or
  an empty paragraph from early on; after redo, a node's id differs between
  each editor and the Loro document (the document's copy can lose its `$`).

Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` when the bundled browser can't run
(NixOS). If Chromium aborts requests with `ERR_NETWORK_CHANGED` (containers
restarting on the host), run Playwright inside `unshare -rn` with a socat
bridge from the namespace's 127.0.0.1:3017 to the host's.
