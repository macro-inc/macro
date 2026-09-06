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

## Simplicity pass — September 6, 2026

The compatibility work above was committed as `f240ea771` before this pass began.
That exact source is the new comparison baseline, served at port 24831 alongside
the worktree at 24710 against the same local backend and Chrome session. This
comparison evaluates the subsequent simplification; it does not replace the
earlier comparison against the original email implementation.

The pass separates recipient interaction, deferred focus, attachment persistence
and scheduling from the compose controllers. The reply envelope owns repeated
sender/recipient/subject presentation. Thread draft reconciliation, contact
aggregation, reply placement, read actions and completion/undo wiring have their
own modules. Each boundary takes the values or capabilities it actually uses.
The [architecture document](EMAIL_FEATURE_ARCHITECTURE.md#responsibilities-within-a-feature)
explains why send/reset/undo and guarded autosave remain coordinated.

The reply controller decreased from 1,414 to 1,133 lines and its view from 960 to
548; standalone compose decreased from 830 to 707. These counts describe the
remaining coordinators, not code deletion: the extracted modules own the moved
behavior. The substantive changes are shared schedule/upload implementations,
one recipient input implementation, narrower view contracts, and independently
testable lifetimes. No dependency was added.

Eleven additional tests cover concurrent attachment upload completion and retry,
attachment removal, recipient drag/drop and outside interaction, focus guard
release and disposal, and cached-draft reply placement across thread changes.
The resulting 138 app email tests pass. The existing 67 renderer Node tests and
31 Chromium tests also pass, including the unchanged visual snapshots. The full
frontend check (6,106 files), feature ast-grep rules and whitespace check pass.
All five QC review roles pass. Review caught and removed an accidental standalone
Send-disabled-during-autosave binding before final browser verification.

The tested cleanup improvement cancels deferred focus and removes the forward
focus guard when its composer is disposed. Reply autosave keeps its prior guarded
flush-on-disposal behavior. The installed Solid event-listener primitive supplies
listener cleanup; the installed debounce's cancel-on-cleanup behavior is not used
as a substitute for draft persistence.

Chrome verification against `f240ea771` includes real local draft save, navigation
and reload, plus saved-draft drawer close/reopen in touch mode. The original local
draft was restored after each round trip. Standalone compose produces identical
To/Cc/Bcc, formatted draft, send and retry payloads; simulated delivery failures
retain the same editor content and feedback. Product sends and command mutations
were intercepted.

Four additional mounted-app comparisons cover reply and forward on desktop and
mobile. They check forward focus in To, deliberate focus transfer into the
editor, Cc/Bcc edits, one mounted editor, desktop recipient collapse/reopen, and
serialized draft content. All four states and payloads match with no page errors.
Three screenshots are pixel-identical; desktop reply differs by 27 pixels within
the attachment icon, with no visible layout change. The seed account's reconnect
toast is dismissed before opening the drawer: dismissing it afterward closes the
drawer through the baseline's outside-click behavior.

Mounted sender Block/Signal/Noise and read/unread/done/not-done commands produce
identical email request sequences and payloads with no page errors. These checks
exercise the extracted production read/completion adapters as well as their
feature consumers.

All eleven navigation states match, including active focus after allowing the
deep-link route to settle. The initial 150 ms deep-link capture caught a transient
body-versus-container focus difference; the settled comparison matches.

The full-app rendering run compares 30 pairs across both themes, including the
calendar cases, newsletter, GitHub, quote/plaintext/Markdown and CSS fixtures,
plus narrow/wide tables. All computed measurements, media settings and image
dimensions match, with no page errors. Twenty-one screenshot pairs are identical
and seven differ by 2–6 border pixels. Two calendar pairs initially had different
card backgrounds; one also included the reconnect toast over the card. Their
hover state was not recorded in that run, so those images alone did not establish
visual parity. A controlled repeat of all four calendar/theme combinations moves
the pointer outside the card, asserts no hover or selection, and dismisses the
toast. Three repeated pairs are pixel-identical; the fourth differs by six border
pixels. Their measured backgrounds, overlays and content styles match. No source
change was needed for those repeats.

Early standalone and baseline fixture probes encountered initial-load timeouts.
The completed probes allow 60 seconds for initial app loading; these comparisons
verify the loaded behavior and are not startup-performance benchmarks.

Local artifacts for this pass are under `/tmp/email-simplicity-reply-envelope`,
`/tmp/email-simplicity-render-verified`, `/tmp/email-simplicity-render-hover`,
`/tmp/email-simplicity-navigation`,
`/tmp/email-simplicity-compose-results.json`,
`/tmp/email-simplicity-compose-extended-results.json`, and
`/tmp/email-simplicity-thread-action-done-compare.json`. As in the previous audit,
they record local seed data and intercepted operations; they do not establish
provider delivery or native-device parity.

## Expanded local Chrome audit

The subsequent [local verification report](EMAIL_LOCAL_VERIFICATION.md) maps the
feature inventory to a reproducible seeded Chrome recording. It expands the
earlier intercepted checks with real local attachment bytes, schedules and Undo,
delegated inboxes, pasted uploads, AI tool edits and notification completion. Its
evidence categories and provider/device limits are explicit; use its run metadata
for the exact source and outcomes rather than treating this historical report's
counts as current.
