# Agent reviews in Macro

Agent reviews are a dedicated, session-owned reading surface. **Review changes**
and the agent's citations open it in the current pane; **Back to session** restores
the mounted conversation and draft. The production integration uses Macro's
permissions, storage, Internal MCP, session queue, and realtime notifications.

## Reader

```text
┌─────────────────────────────────────────────────────────────────────┐
│ ← Back to session   Review title / repository              +180 −56 │
├─────────────────────┬───────────────────────────────────────────────┤
│ Walkthrough Threads │ Chapter title                         2/4  ← →│
│ History   Collapse  │                                               │
│ Overview            │                                               │
│ ▾ 1 Intent          │                                               │
│   ▾ src/core        │ Explanation                                   │
│       model.rs      ├──────────────── drag to resize ───────────────┤
│ Generated · Tests   │ path/to/file.rs                            ⌕  │
│ ▾ 2 Implementation  │ aligned code          │ syntax / changed tokens│
│   ▾ src/ui          │                       │                        │
│       reader.tsx    │                       │                        │
│ ▾ Other changes     ├───────────────────────┴────────────────────────┤
│                     │ Comment / agent reply              Resolve   │
└─────────────────────┴───────────────────────────────────────────────┘
```

- Full Diff shows every changed file in a compact repository tree, including
  generated and hidden groups. It has separate folder and sidebar scroll state
  from Walkthrough, and opens the same code reader without chapter explanations.
  Its folders start expanded. Both reading modes scroll continuously across
  files, with a shared scroll element and nested file/line virtualization. Nearby
  bodies use the existing query cache; changing the active file by scrolling
  does not issue another navigation or reset the viewport. Walkthrough orders
  files by chapter, deduplicates shared paths, and appends other visible changes.
- Walkthrough chapters show their explanations inline above compact file trees,
  collapsed by default. Scrolling into another section expands its tree; manual
  collapse lasts until the reader leaves that section and returns. The whole
  header toggles the tree; collapsing preserves the code viewport. File rows use
  shared change-status letters and green/red bars with exact totals on hover.
  Files outside the tour remain under Other changes. Navigation is virtualized,
  including large directories. A review without a tour shows all files under Changes.
- Modified files use two aligned columns on wide panes, with AST token highlights
  and hatched empty cells. New/deleted files use one centered source without full
  green/red paint. Narrow panes use one column. Lines wrap with measured 18px
  minimum row heights. Syntax colors survive changed-line backgrounds.
- `/` or the search icon reveals Find in file and Go to line. Search includes
  unmounted/folded source. Code rows and inline discussions are virtualized;
  unchanged context expands from either edge independently, preserving the visible
  code position. The count reveals the whole gap. Citations reveal their ranges.
- Walkthrough explanations initially fit their content, up to 160px. They have a
  bounded draggable divider, keyboard resizing, and double-click reset to the
  content size. Resizing leaves code scroll unchanged.
- Agent-defined file groups can start hidden and be revealed with visibility
  chips. Generated files default to hidden, tests to visible unless the agent
  chooses otherwise. Hidden bodies remain reachable by citation. Binary,
  submodule, empty, and over-budget files stay listed.
- Drag over code or gutters to select a region; Shift-click extends a selection.
  Clicking code also selects a line. The range highlights during drag; a compact
  Ask agent chip floats beside the selected lines, using the shared floating
  element directive and session reply-chip styling. Escape clears the selection.
  Ask agent opens the composer below
  the selected side.
  Comments use the shared ComposerSurface and SendButton. Clicking outside an
  empty composer dismisses it; nonempty drafts remain. Cmd/Ctrl+Enter sends.
  Viewers can select code and follow citations; editors can comment, reply, and resolve/reopen.
- Live reading follows newer revisions automatically, pausing during comment
  drafts and resuming afterward. History and citations stay pinned. Switching
  revisions keeps the reader mounted and disables writes while retained code is
  loading. Background capture and `r` preserve the viewport without an Updating
  label or refresh button. Historical links keep the original source, walkthrough,
  annotations, and file groups.
- The shared fullscreen Dialog covers app navigation, retains both editors, and
  manages focus. File cards, change counts, path typography, and discussion threads
  reuse the shared diff UI. Mobile uses a navigation drawer and safe-area padding.
  The conversation's composer stays mounted, hidden and inert during
  review. Back restores the conversation and draft.
- Browser-local notes from the previous changes panel are recoverable as drafts
  with their original locations attached; they are never silently sent.

## Internal MCP

The existing authenticated `macro_internal` server exposes five tools. The token
fixes session, owner, and workspace; tool arguments cannot choose another user,
session, or server filesystem path.

| Tool | Purpose |
| --- | --- |
| `diff` | Capture/publish the session workspace or linked PR; optionally set title, summary, tour, and annotations. Returns a review ID, revision, and canonical URL. |
| `diff_link` | Validate a file/side/line range and persist its citation. |
| `diff_annotate` | Update the tour, inline explanations, file groups, and component map against an expected revision. |
| `diff_reply` | Append an idempotent agent reply to an existing thread. |
| `diff_feedback` | Read bounded, paginated human feedback, original excerpts, and links. |

Server instructions tell agents to publish meaningful changes, use returned links
when discussing code, add tours, refresh after edits, and reply in the originating
thread. URLs must come from tools. Agents retain their normal file-reading tools
for exploring code before authoring explanations.

Canonical links use `/app/agent/:sessionId` with typed `s0.review.open`, `id`,
`revision`, `target`, and `thread` search keys. The session host intercepts its own
citations without opening another split. Explicit navigation has a generation so
clicking the same citation again still returns to its code after local navigation.

## Capture and diffd reuse

The MIT-licensed [diffd implementation at 91a5e3e](https://github.com/404Wolf/diffd/tree/91a5e3e7719d717c2cd1b6238e146023e8afb1df)
was inspected and exercised locally. `diffd-core` is vendored at that commit in
`vendor/diffd-core`, with its MIT license and update notes. SQL is registered beside
the other languages in its shared grammar/highlighting pipeline; the runtime has
no SQL-specific adapter. Macro
reuses full source pairs, aligned rows, UTF-16 syntax/novelty runs, tree-sitter
symbols, and the escaped static line-rendering approach. Adapted Git and Difftastic
adapters retain MIT notices. Macro owns the reader composition and conversation
model rather than running diffd's standalone SQLite/web server inside the app.

`agent_review_runtime` captures read-only Git comparisons where the workspace
exists. Macrod receives a separate review command; managed containers expose an
internal sidecar capture endpoint. PR fallback fetches complete files using the
linked repository's installation authorization and pinned base/head commits.
Branch comparisons resolve a merge base; explicit commits and HEAD compare directly.
The first base remains pinned across later edits/commits unless explicitly changed.

Difftastic 0.71.0 provides structural alignment. Macrod release archives bundle a
platform-native `difft` beside the daemon; the runtime checks that sibling first.
Managed/service images install the same pinned engine. Unsupported files, very
large files, or exhausted structural budgets use bounded line alignment and are
labeled **Text diff**. Syntax and symbol extraction remain available independently.

Resource limits are explicit:

- 10,000 changed files; 8 MiB per source file and 64 MiB total source capture.
- 250,000 combined lines per file and 1,000,000 per capture. Conservative expanded
  memory budgets omit excess bodies before building row/token vectors.
- Four build workers, two seconds per structural subprocess, twelve seconds for
  starting structural work, and 100 ms line-alignment deadlines. Unchanged file
  results are reused; retained cache storage is bounded to approximately 128 MiB.
- 256 KiB runtime frames and 256 MiB assembled captures. Large cross-replica
  payloads use temporary S3 objects, not Redis messages or ACP transcript events.
- One fenced capture lease per session, released on cancellation and also expiring
  durably. An offline daemon is detected by the absence of a capture-owner claim
  within three seconds, preserving the PR fallback's time budget.

## Durable state and feedback

`agent_review` owns authorization, immutable publication, anchor relocation,
comment idempotency, feedback policy, and canonical links. HTTP accepts typed
View/Edit receipts; MCP accepts the authenticated session identity. PostgreSQL
adapters implement compare-and-swap publication and durable outboxes; immutable
file bodies live under review-owned S3 keys. Session deletion schedules cleanup.

A human comment and its delivery record save atomically. Retries use the same
message/action UUID even when the client loses the successful response. Delivery
rechecks edit access and submits a prompt to the existing session queue, including
author, thread ID, original source excerpt, and a tool-created URL. The outbox
survives restarts until a correlated ACP terminal response or durable user
cancellation exists. Queue removal and cancellation acknowledgement are atomic.
Agents reply through `diff_reply`; humans decide when a thread is resolved.

Anchors retain their immutable original revision/location/excerpt and separately
track their current location. Exact, unique text can follow movement and renames.
Ambiguous or removed text becomes **Outdated** with a link to original context.
Historical tour/annotation content belongs to its revision. Readers fetch one
immutable file at a time while metadata/discussion invalidates through existing
session updates and bounded polling. Agent-session update events refresh review
metadata immediately, with 10-second polling as a fallback; the continuous reader
retains the active file and scroll position across both paths.

The domain validates file-group patterns and resolves them against the requested
revision. File groups use the existing revision aggregate; permission checks
remain unchanged.

The frontend's feature-owned live sources isolate query/cache mechanics from
reader state. `AgentReviewProvider` composes session authority and typed routing;
`createReview` owns navigation and comment workflows; presentational components
receive resolved values and callbacks.

## Validation and reproduction

See [the browser lab](../apps/web/scripts/review-browser/README.md) for disposable
public checkouts, actual agent prompts and Internal MCP, and repeatable browser
scripts. The lab uses the production domain, capture engine, MCP server, and reader,
with ephemeral storage/identity and a recording feedback sink. It complements
PostgreSQL and session-queue tests; it is not a deployed-stack authentication test.

Tested large sources include TypeScript PR51387 (656 changed files, a 46,393-line
checker) and Rust PR120361 (180 changed files). Browser tests cover tours, both
navigation windows, deep search/jumps, ranges, uncertain-response retries, draft
preservation, revisions, moved threads, reply citations, repeated citations,
resolution, viewer links, and mobile layouts. Test outputs and screenshots are
local artifacts rather than committed public source checkouts.

The 100,000-line stress fixture is exercised with folded context, three
sparse edits, deep searches, range citations, tab/CJK lines, escaped HTML, and
binary/empty/deleted/generated files. A local Chromium run reached its final line
in 242 ms while mounting 18 rows; this is a lab observation, not a latency promise.
Linux musl daemon packaging and the managed sidecar build were exercised with
Difftastic 0.71.0. The packaged sidecar also captured the stress checkout through
its HTTP endpoint and used structural alignment for its smaller source file.

Affected Rust suites, frontend tests/type checking, Clippy, and `just check` pass.
The legacy TypeScript worker's changed protocol files type-check and its tests
pass. Its whole-service type check still reports existing SDK API mismatches in
unchanged callers (`agents`, user arguments, webhook namespace, and `agent-proxy`).

This implementation provides source-based symbols, not language-server hover,
diagnostics, or cross-repository references. Search is within the selected file;
the chapter trees expose all changed paths. Staging, reverting, merging, persistent per-user
viewed state, and unread review badges are separate features.
