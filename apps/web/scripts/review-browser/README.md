# Review browser and Internal MCP lab

This lab exercises the production review domain, workspace capture engine,
authenticated Internal MCP router, and production web reader using disposable
checkouts. Storage and session identity are ephemeral; feedback is recorded after
the domain builds its actual session prompt. Queue recovery and permission policy
also have Rust/PostgreSQL tests. This lab does not stand in for a deployed-stack
login/authorization test.

## Start the lab

Use Bun dependencies and a web dev server owned by this worktree on port 3004.
The scripts connect to the shared Chrome CDP endpoint on port 9222, create their
own context, and close only that context. They proxy local Vite requests through
the driver to avoid network emulation from other shared browser contexts.
Set `REVIEW_BROWSER_ENDPOINT` to use a separate CDP browser.

Fetch a disposable public checkout and both immutable PR commits. Fixtures used:

| Source | Base | Head | Changed files |
| --- | --- | --- | --- |
| [TypeScript PR51387](https://github.com/microsoft/TypeScript/pull/51387) | `d83a5e1281379da54221fe39d5c0cb6ef4d1c109` | `da6f0671aecb0ec248866221f448950ff7b91868` | 656 |
| [Rust PR120361](https://github.com/rust-lang/rust/pull/120361) | `f067fd6084d750f3797f54b71771c5dbc149726f` | `ed7fca1f8805b4348b801f23f444e0dda42f7aed` | 180 |

From the repository root, using a migrated local database for compilation:

```sh
nix develop --command cargo run -p agent_harness_service --example review_lab -- \
  /tmp/macro-review-public/typescript d83a5e1281379da54221fe39d5c0cb6ef4d1c109 7117
```

Pass `DATABASE_URL` inside the Nix command if its default DB differs. Use port
7118 for the Rust checkout. The server binds loopback only. The HTTP test routes
use an ephemeral editor identity; the MCP endpoint checks its test bearer token.
Production HTTP adapters still use real entity-access receipts.

Create a local agent MCP configuration:

```json
{"mcpServers":{"macro_internal":{"type":"http","url":"http://localhost:7117/mcp/internal","headers":{"Authorization":"Bearer review-lab-only"}}}}
```

The credential is deliberately confined to this ephemeral loopback test server.

## Use an actual agent

Run a separate CLI session with that MCP config, strict configuration, and tools
limited to Read and `mcp__macro_internal__*`. Prompt it to:

> Review the disposable public PR checkout. Read relevant source files first.
> Publish with `diff`, the exact base SHA, and `worktree: true`. Add an accurate
> summary, a tour with multiple chapters (including a chapter containing multiple
> files), and inline explanations with `diff_annotate`. Obtain two actual code
> citations using `diff_link`, inspect `diff_feedback`, and use returned URLs in
> your response. Do not edit files or run shell commands. Report tool errors.

For example, `claude --print --mcp-config <config> --strict-mcp-config
--setting-sources '' --allowedTools 'Read,mcp__macro_internal__*'
--disallowedTools 'Bash,Write,Edit' --output-format stream-json --verbose` accepts
that prompt on stdin. Save its session ID and JSONL output outside the worktree.

After the agent publishes, run from the repository root:

```sh
node apps/web/scripts/review-browser/large-pr.mjs 7117
```

This checks the tour, windowed file/code lists, a jump to the last source line,
search in unmounted source, a range comment, a lost response after a durable save,
idempotent retry, Back/draft preservation, and desktop/mobile layouts. It writes
`browser-state-7117.json` and screenshots to `/tmp/macro-review-public`.

Get the actual delivered prompt from `GET http://localhost:7117/test/feedback`.
Resume the **same** CLI session with Read, Edit, and Internal MCP tools and an
explicit allowlist for the disposable checkout. Feed that recorded prompt back
with this instruction:

> Process this exact review feedback. Add only a short explanatory comment above
> the selected block, preserving behavior. Refresh with `diff`, get a new
> `diff_link`, and use `diff_reply` in the original thread. Keep it unresolved.

After the agent edits and replies:

```sh
node apps/web/scripts/review-browser/revisions.mjs 7117
```

This verifies immutable historical links, moved ranges, inline Markdown/bare-URL
citations, repeated navigation to the same citation, Resolve/Reopen, responsive wrapped
layout, read-only selection/copy, reload, and mobile. Repeat both scripts on port
7118. A lab restart intentionally discards review history, so rerun publication
and phase one after restarting it.

`node apps/web/scripts/review-browser/mobile.mjs 7118` opens a fresh touch viewport
against the Rust review. It checks the default unified layout, dismissing the
navigation drawer, file selection, deep line links, and preserving the session
draft on Back.

Create a fresh disposable stress checkout with
`node apps/web/scripts/review-browser/setup-stress.mjs`. Start another lab with
the printed directory, base `HEAD`, and port `7119`, then run
`node apps/web/scripts/review-browser/stress.mjs`.

`stress.mjs` uses port 7119 with a disposable comparison containing a 100,000-line
`src/large.ts`, a tab/CJK `src/wide.ts` ending in `HORIZONTAL_TAIL`, `image.png`,
`empty.ts`, deleted `src/deleted.rs`, and `package-lock.json`. It publishes through
the real MCP endpoint, checks folded context, deep search/jumps, mounted
row count, sparse-change statistics, range citations, wrapped glyph bounds,
escaped HTML, and nonstandard file types. It also checks the expanded Full Diff
tree, continuous scrolling across files, and stable source positioning when a
preceding file changes height. The original design
sketch at `/app/debug/agent-review-ui` also contains a self-contained 100k fixture.

`node apps/web/scripts/review-browser/context.mjs` uses the same stress server in
a short viewport. It verifies that the up/down context controls each reveal only
ten lines and keep the adjacent source at the same vertical position.

The checked-in tests contain no hosted credentials or public checkout contents.
Recorded agent transcripts and browser screenshots stay under `/tmp`.

The current reader uses chapter file trees, collapsed by default, and hidden
search. Browser helpers `openFile` expand chapters and walk the virtualized tree;
`openSearch` reveals Find in file and Go to line. Files outside a walkthrough
remain under Other changes. Generated files start hidden behind a visibility chip;
agents can add other hideable groups. Desktop modified files use aligned columns;
new/deleted files use a centered single source. Mobile uses one column. Long lines
wrap. Select code or gutters, then choose Comment from the selection toolbar.
Comments appear below the selected side; an outside click dismisses an empty
composer. **Full Diff** switches the sidebar to the complete repository tree,
including files hidden from the walkthrough, with independent folder disclosure
and scroll state. Its folders start expanded. Both views scroll continuously
across files, loading only nearby bodies and lines; Threads and History retain
the current reading order. There are no filter, layout, refresh, or full-file
controls.
