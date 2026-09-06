# Email refactor compatibility audit

This records the September 6, 2026 audit of the email feature and renderer
extractions. The purpose is to preserve existing behavior while changing ownership
and dependencies. A cleaner architecture does not justify incidental changes to
email content, recipients, navigation, or requests.

## Baseline and method

| Version | Source |
| --- | --- |
| Before both email refactors | `5a3d970fb` — the architecture documentation commit, before email code moved |
| Feature extraction | `2b987feb1` |
| Renderer extraction | `b07d69a2c` |
| After | `b07d69a2c` plus the compatibility fixes accompanying this document |

The baseline app was exported to `/tmp/email-parity-before` and served on port
24830. The current app uses port 24710. Both use the same local backend and seeded
account. The baseline has its own Vite optimizer cache. Its only Vite configuration
adjustment allows fonts to load from the shared dependency directory; its app
source is the baseline commit. Comparing a captured parser alone would miss Solid
attachment timing, app presentation policy, composer wiring, and keyboard scopes.

The local stack and its shared Chrome were started with:

```sh
nix develop --command just run_local --instance email-feature-eval \
  --port-base 24700 --no-doppler --with-chrome --no-build
```

`--with-chrome` is the actual flag in this repository. The shared Chrome exposes
CDP on port 9222 and its display on port 6080. Comparison probes create their own
browser contexts. Both versions receive the same viewport, theme, account state,
and fixture body. Rendering probes substitute only the thread GET response in the
browser, then exercise the real app rendering path. Action probes intercept writes
and compare request payloads. The draft persistence probe writes only to the local
seed draft and restores its original content afterward. No email is delivered.

## Feature inventory

Paths in this table are relative to `apps/web/src/features`. “Browser” means the
behavior was exercised against both running versions. “Unit” means targeted tests
exercise the extracted logic. “Source review” is weaker evidence and is labeled
explicitly. The inventory separates independent behaviors so one successful
thread load cannot stand in for all thread or composer functionality.

| Behavior before refactor | Previous owner in `block-email` | Current owner | Evidence and remaining limits |
| --- | --- | --- | --- |
| Load, retry, title and read marker | `Block.tsx` | Block plus `EmailBlockAdapter.tsx` | Browser loads; source review of load/error gate |
| Chronological messages and draft association | `EmailContext` query selector | `email-thread/core/thread-messages.ts`, thread source | Unit tests for reversed transport, drafts and nonmutation; browser thread order |
| Cached, pending, failed and changed thread identity | `EmailContext` | Thread source and `thread-snapshot.ts` | Unit tests for pending resource reads, retained snapshots and wrong identity |
| Notifications and draft-cache cleanup | `EmailContext` | Thread production entry and shared queries | Source review; no fresh live notification integration test |
| Draft precedence and local discard | `EmailContext` | Thread state | Unit tests for stale/missing/newer drafts and discarded drafts |
| Selection, expansion, hover and scroll ownership | Context and scroll state | Thread state | Unit tests for independent instances; browser navigation sequence below |
| Hidden middle messages and unread stops | `MessageList`, scroll helper | Thread message list, navigation and window helpers | Browser reveal/selection; unit stop and geometry tests |
| Paging and prepend geometry | Scroll helper | Thread source and scroll-to-message | Unit tests; source review of target/no-progress/identity/disposal termination; multi-page server integration not exercised |
| Deep links to hidden messages | Context and `Email` | Block location adapter and thread navigation | Browser target revealed, selected and expanded |
| Keyboard movement, expansion and collapse | `Email`, email hotkeys | Thread navigation plus block registration | Browser ArrowUp/Down, Enter and Escape |
| Block sender, Signal and Noise | `EmailContext` actions | Thread action adapter and chronological sender selector | Browser command requests match the original sender despite reversed transport |
| Read/unread and done/undone | Context actions | Thread action adapter | Browser `U`, `Shift+U`, `E`, `Shift+E` requests match |
| Undo triage, notification restoration and next-item selection | Context actions | Thread action adapter and host callbacks | Source review; full notification/soup integration not exercised |
| Header, details, compact snippet and card expansion | Message container/card/top bar | `email-message` views/components | Browser details, snippets, full card screenshots and expansion |
| HTML selection, signatures, quoted history and missing replyless data | Parser and body | Renderer core plus message controls | Node selection tests, browser quote reveal, full-app quoted fixture |
| Personal colors, links and calendar response backgrounds | Body and color helpers | Message policy plus renderer browser | Delayed-host browser tests and light/dark full-app comparisons |
| Newsletter CSS, fonts, margins and table fitting | Body and containment helpers | Renderer core/browser | Full-app computed style, dimensions and image comparisons; narrow/wide tables |
| Plaintext and Macro Markdown | Message body | Message view with existing Markdown renderer | Full-app comparisons; unit tests prevent hidden HTML resource work |
| Inline/CID/native images and resource lifetime | Body/image adapter | Message rendering adapter and renderer lifetime contract | Unit and Chromium adapter replacement, abort, cleanup and late-result tests; native runtime not exercised |
| HTML links and image-map areas | Body/parser | Resource policy and browser renderer | Node/browser URL, target and resource tests; mailto integration remains in app adapter |
| Attachment presentation and opening | Container/attachment pill | Message views and attachment action adapter | Browser click verifies original MIME routing with mocked document responses |
| Reply/reply-all/forward placement | Message container and reply actions | Thread views and primitives | Source review and reply-session tests; desktop/mobile saved reply checks |
| Stable reply editor identity | `EmailInput` | Thread email input view | Unit tests keep same-message editor and remount on changed target |
| Mobile drawer and reopen | Mobile reply components | Thread mobile view and compose host | Touch-browser drawer opens, closes and reopens saved content within viewport |
| To/Cc/Bcc, inbox choice and mentions | Form/conversion/input | Compose core and primitives | Recipient and secondary-inbox unit tests; mounted compose request comparison; account-switch/recipient-drag device flows not covered |
| Debounced drafts and quoted body round trips | Base input/compose/body helper | Compose primitives | Real local draft persistence across navigation; outgoing quote/forward tests |
| Immediate send, schedule and unschedule | Input/compose | Compose controllers and services | Unit race/failure tests; browser request checks use interception, not provider delivery |
| Undo-send recovery across composers | Global undo variables | Identity-keyed undo store/controller | Unit tests for draft/reply isolation, stale owners and bounded recovery; provider undo not exercised |
| Upload, remove and forward attachments | Base input/attachment helpers | Compose controllers/services | Source review and conversion tests; multipart upload/download integration not exercised |
| Signatures, watermark, rich editor and pasted uploads | Base input/editor/settings | Compose views and injected capabilities | Source review, signature fixtures and editor tests; subscription/from-switch/paste matrix not exercised |
| Standalone compose and launcher | Compose host | Compose production entry | Browser route, recipients, subject, body and saved draft request |
| Mailto and AI compose | App hosts | App hosts using compose entry/contracts | Existing parser tests and source review; no fresh AI-generated compose integration |

## Regressions found and corrected

These were real compatibility defects found during review, not intentional
consequences of feature isolation:

| Trigger | Defect | Correction and regression coverage |
| --- | --- | --- |
| Solid constructs an email host before inserting it | Color preparation measured a detached tree, leaving blue links, unreadable calendar text and a light response banner | Prepare colors after connection, once per content generation; test delayed insertion and paused animation frames |
| HTML with extreme nesting | Recursive traversal/serialization could overflow | Iterative traversal and bounded nesting, retaining readable descendants; Node depth test |
| Collapsed renderer with contained HTML | Ancestor text clamp did not reach inside the shadow containment boundary | Apply the clamp inside the renderer; test line count, expansion and unchanged resources |
| Relative or protocol-relative image/link URLs, CID links | New policy silently removed previously usable URLs | Preserve relative/CID navigation and normalize protocol-relative URLs to HTTPS; Node and browser tests |
| Image map `<area href>` | Link destination was dropped | Preserve safe area destinations and apply safe link target/rel; browser test |
| One malformed declaration in a stylesheet | Entire unrelated newsletter stylesheet could be lost | Recover at declaration/rule boundaries; test hidden preheaders and valid text formatting |
| CSS variables and fallbacks | Valid color/layout declarations were removed or variable names/cascade changed | Preserve native custom-property semantics in the default reader; test inherited values, fallbacks, selectors and container queries |
| Nested/head/body color-scheme rules | Filtering exceeded the original top-level head-only rule | Restore the old filtering scope; Node and browser head/nested/body tests |
| Quoting or forwarding an email with dark CSS | Shared sanitization applied reader-only theme filtering to outgoing HTML | Keep display filtering separate; outgoing reply/forward tests preserve safe CSS |
| Supported CSS groups and image-set backgrounds | Layer/scope/namespace styling and valid backgrounds disappeared | Preserve supported groups and image-set under normal allow policy; actual browser styling/resource tests |
| Empty trailing stylesheet after line breaks | Trimming stopped too early, retaining excess blank space | Empty styles no longer stop trimming; Node and full-app case |
| Non-ASCII whitespace in a class name | Ordinary text could be mistaken for a signature and removed | Use HTML's ASCII class-token delimiters; Node and full-app case |
| Plaintext containing Markdown | The extraction changed existing rendered Markdown to literal punctuation | Restore the app's original fallback; full-app comparison and no-hidden-renderer tests |
| Backend returns newest messages first from different senders | Block/Signal/Noise targeted a later participant instead of the original sender | Select from the same chronological sequence as before; unit test and browser request comparison |
| Quoted authored document links and editor metadata | Shared sanitization removed the metadata required to reconstruct rich mentions | Preserve inert metadata in outgoing sanitization while keeping reader stripping; reply/forward and sanitizer regression tests |
| Duplicate MIME entries such as `text/plain` | Attachment lookup switched from the original last mapping to the first | Restore last-entry selection; mounted attachment click routes to the same block type |

The optional `images.remote: 'block'` package policy deliberately rejects `var()`
declarations and image-set, including dynamically expanded strings that could
initiate loads. This is not the app's default policy. Its tests verify no remote
requests for the blocked cases; the normal allow policy preserves sender cascade
semantics. The browser layer still depends on inherited CSS, fonts and browser
behavior; only preparation is deterministic from explicit inputs.

## Recorded browser comparisons

Rendering covers personal announcements, Google Calendar invitations and accepted
responses, styled newsletters, GitHub notifications, wide tables, quoted messages,
plaintext Markdown, Macro Markdown, malformed CSS with variable fallback, empty
styles, class-token edge cases, head/nested/body theme rules and custom-property
selectors/container queries. Each case runs in light and dark mode. Wide tables
also run at a narrow viewport. Measurements include text, color, background, font,
font size, line height, display, dimensions and link destinations. Screenshots
capture the complete mounted message card after fonts load.

The final serial run completed **30 before/after pairs (60 captures)**. All text,
computed style and dimension measurements match, and all card image dimensions
match. Fourteen pairs are pixel-identical; the other sixteen differ by 2–12 pixels
at border edges. There are no content-layout differences or page errors in that
run. Every capture asserts and records the actual `prefers-color-scheme` and
screen media settings.

Two exploratory runs required investigation rather than acceptance: one hit a
`useSearchContext` provider error while source files were being edited; another
captured a baseline theme case whose colors did not reflect its requested dark
media setting. The provider error did not recur in the final stable run. The
theme case matched in isolated repeats, including light-to-dark transitions; its
original capture's cause was not established. The final run serializes shared
Chrome use and asserts actual media state to make that comparison reviewable.

The navigation probe compares these eleven states in order: initial hidden middle;
first message expanded; hidden chip selected; chip revealed; second message
expanded; next message selected; previous message selected; selected message
collapsed; header details open; quote expanded; deep-linked middle message open.
The pointer stays outside the thread during keyboard assertions because hovered
messages intentionally affect the old and new navigation behavior.

Draft checks save through the real local backend, navigate to another thread,
return, and verify restored content in both versions. A separate touch context
opens, closes and reopens the saved draft drawer. Standalone compose compares
serialized drafts, To/Cc/Bcc, bold HTML/Markdown, send and retry requests. A
synthetic send failure on desktop produces the same error feedback and retains the editor,
subject and recipients, with retry enabled in both versions. The quote metadata
comparison invokes actual app preparation modules in the browser; rich mention
reimport is verified with Lexical in unit tests, rather than a mounted reply click
flow. Encoded `data-html` remains excluded to prevent an editor import from
bypassing HTML scrubbing. Command checks exercise actual mounted
hotkeys/menus and compare intercepted payloads, not just helper return values.

Local audit artifacts are under `/tmp/email-parity-render-verified` (including
`results.json`, `comparison.json` and both screenshots for each pair),
`/tmp/email-parity-navigation`, `/tmp/email-parity-compose-results.json`,
`/tmp/email-parity-compose-extended-results.json`,
`/tmp/email-parity-quoted-mention-results.json`,
`/tmp/email-thread-action-done-compare.json`, and
`/tmp/email-attachment-open-compare.json`. These temporary artifacts document this
run; the regression tests below are the durable automated checks. They contain
synthetic/local seed data and must not be replaced with unredacted production mail.

## Repeatable automated checks

The final code passes 67 renderer Node tests, 31 Chromium tests and 127 app email
tests. Package type checking and lint, the full frontend check (6,092 files),
feature ast-grep rules and whitespace checks also pass. All five QC roles—code,
simplicity, consistency, robustness and scope—reviewed the fixes with no remaining
findings.

From `packages/email-renderer`, in the Nix shell:

```sh
bun run test
bun run test:browser
bun run type-check
bun run lint
```

From `apps/web`:

```sh
bun run test src/features/email
bun run check
```

The root recipe `just test-email-rendering` runs the Node and Chromium suites.
Fixtures and browser assertions live in `packages/email-renderer/tests`; parser
tests live alongside core. App tests live with the three email features. Boundary
tests enforce the core/browser and feature/block separation. Feature ast-grep
rules provide an additional architectural check.

Passing these tests is evidence for the listed cases, not a proof that arbitrary
email HTML or every provider/device flow is equivalent. Native iOS/Tauri,
provider delivery, real attachment transport, live notifications and the other
explicitly marked integration paths still need their respective environments.
Future structural changes should preserve this inventory, compare the baseline
and proposed version in the same environment, and add a regression test for each
confirmed failure before claiming it is fixed.
