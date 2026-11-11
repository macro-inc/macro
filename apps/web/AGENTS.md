## Development Commands

- Use `bun` as the package manager and script runner (`bun run build`, `bunx tsc`).
- `bun run test`: run tests 
- `bun run check`: check typescript changes
- Forward `CacheHost.people` through the app's retiring host, resolving the current host on each call even for captured methods; retired reads return unsupported and context writes reject rather than acknowledge discarded publication.
- `CacheHost.people` contracts come from cache-core models: `bun run gen-cache-people-schema --rust` regenerates Rust JSON plus Zod/types; `--check --rust` verifies both. `bun run check` verifies JSON-to-frontend generation, while cache-core tests verify Rust-to-JSON drift. Missing native person commands mean unsupported, never permission to issue an unscoped write.
- `bun run lint`: lint with biome 
- `bun run format`: format changes with biome 
- `bun run knip`: to check for dead code
- Run Linux native cache-plugin tests from the repository root with `nix develop .#tauri-linux --command cargo test --manifest-path apps/web/tauri/Cargo.toml -p graphql_cache_plugin`; the [Tauri platform shell](../../docs/development/running-locally.md) supplies the required desktop libraries.
- Refresh `nix-support/node_modules-hashes.json` for Linux and Darwin when dependency manifests, the lockfile, or dependency patches change.
- `bun run lint:oxlint` (repository root): type-aware oxlint. `typescript/no-floating-promises` is an error with no suppressions and `ignoreVoid: false` (FE-13), enforced in `just check` and CI; start detached work with `fireAndForget` from `@core/util/fireAndForget`, not `void`. Plain `oxlint` without `--type-aware` skips that rule silently. The ast-grep rule `ts-no-expression-void` covers `() => void p()`, which the lint can't see.
- Email rendering is isolated in `packages/email-renderer` at the repository root. Run `just test-email-rendering` for its Node and Chromium suites. Add fixtures under `packages/email-renderer/tests/fixtures`, run `just test-email-rendering-update`, and review changed images. These are renderer tests, not inbox e2e.
- Supported browsers are the `browserslist` in `package.json`. Safari and iOS
  16.4 is the oldest WebKit the app starts on: startup code, including
  `@pierre/diffs`, evaluates regex lookbehind. `vite.base.ts` builds to it,
  and the ast-grep rules `ts-browser-floor-apis` and `tsx-browser-floor-apis`
  ban APIs that turned out to be newer; add one there when it bites, or raise
  the floor.
- The app does not register a service worker. Keep `public/sw.js` as a retirement
  endpoint for existing installations; see the [startup bundle rule](../../.agents/rules/web/startup-bundle.md).
  Loro uses async WASM loading and HTML preloads independently of service workers.
- Web asset publication and cache headers are covered by
  [web-app delivery](../../infra/stacks/web-app/README.md); its publisher tests
  are backend-free, and its Pulumi tests must not run real staging/cloud commands.

## Account-scoped source queries

Shared display names and `useUserNames` participant labels use the same account/session-
scoped QueryClient cache (`queries/auth/user-name-cache.ts`), never a second name map.
Pin only tracked active readers; bound idle names by count/bytes and batch/pending IDs.
Retain pins across synchronous reevaluation and drop closed-reader interests. Keep
old names during transient refresh failures, but clear them on authority changes;
late responses and captured mutations cannot cross account/session or entry generations.
Cancel obsolete transports and bound request lifetime; native participant metadata
must publish fallbacks for pending new-scope names rather than retain old labels.
Debug name seeds require a mounted authenticated scope, not module initialization.
Editable own-profile queries stay separate and session-keyed. Reset cached Macro
bearer tokens on login/account replacement, including pending token responses.

Key channel lists/activity, cached Quick Access channels, email links and inbox
health probes by viewer. Use `queries/auth/account-scope.ts` to fence requests
and cache writes; mutation ownership comes from the execute-time
`MutationFunctionContext.meta`, not a live accessor or mutable observer options.
Login closes this source gate until a fresh auth query succeeds, without clearing
the app shell's retained identity. Legacy unscoped channel lists are not restored.
The settings signature browser suite also exercises real channel/link observers
and the contact context publisher across account switches with delayed responses
(`account-sources.browser.e2e.ts`). `queries/contacts/context-source.ts` reuses
those keyed queries through ownership-tagged selectors; gate missing inputs rather
than publishing an empty snapshot. `context-publisher.ts` caps pending IDs and
write batches at 500, replaces overflowing/uncertain snapshots with a new epoch,
and never writes directory names or membership. `useContactContextPublisher`
shares Soup's leader, rollout and generation lifecycle; do not add another leader.
The bounded directory window accepts external search/policy inputs. Bind continuations
to each input transition, not just equal query strings; returning to an earlier input
must start at page one. Person hydration wakes an initially unavailable offline
window, never an authorization error. Interactive contact suggestions stay local:
partial sync returns partial local results; unavailable or older hosts never fall
back to server or generic text search. Refresh schedules the existing sync lane. Resolve self separately
when 500 explicit selections fill the lookup batch. Prefer current-search DM metadata
over a person's stored command target, then use recent conversations as fallback.
Contact invalidations from messages, native sharing and websocket events call
`requestContactRefresh()` in `queries/contacts/refresh`; the coalesced bounded
runner owns the work. Full-list hooks, query keys and handwritten GET clients
are retired; no compatibility query should be created by an invalidation.
Ranked person
cursors and contact reconciliation use coordinator protocol 17; native menu policy 5
orders exact names, all-word prefixes, then literal contains by recency and identity.
Explicit addresses/IDs never match name aliases; empty property browsing pins self.
Exclude automated recipient addresses before limiting unless explicitly addressed.
Generate separate suggestion/reference policy floors from Rust; reference evidence
stays policy 4. Preserve personal window order through command/DM merging, mentions,
properties and recipient composition. Cursors bind scope/policy/layout and live
membership/context tokens, not previous result IDs or a scoring clock. Contact
changes invalidate pending replies and restart paging; honor short/empty continuations.
Quick Access person lists are per-observer windows, never global item-cache rows.
Forward live queries from commands, mentions and property selectors; resolve CRM
aliases only for the listed rows. In menus (Cmd+K, mentions, mobile name search)
further pages of people and contact matches are listed below the earlier ones, up
to a bound; property pickers keep a replaceable window with explicit paging. A
window key names the page or growing list on screen, never a refresh of it. Reset
virtual focus/scroll only on window replacement, not label updates or refreshes.
Menus hold the row the user moved to by identity (`createSelectionAnchor`) while
results arrive; the highlight resets only when the query or category changes.
The person list keeps its still-matching rows while the next read is pending. Keep explicit participant/team pools scoped and
selected IDs/self independent of suggestion pages. Discussion mentions on documents,
projects and calls delegate to the same bounded directory. In mention configuration,
`users()` returning undefined selects that directory; [] remains an explicit empty
scope, including while channel/CRM rosters load. `transformUsers` applies agent
policy only to the current window or scoped roster, never a full personal pool.
Keep native row timestamps and forwarding through both editor configuration and
`MarkdownShell`; the channel mention browser suite exercises the real composition.
`RecipientSelector.createSource`
constructs a per-picker source from live query/open/self/domain inputs; use
`useContactRecipientSource` or `useCombinedRecipientSource` for personal suggestions
and keep `options` for explicit scoped extras. Closing releases the page and reopening
starts at the first window. Selected chips remain caller-owned; Next options/PageDown
can advance empty windows. Main email To/Cc/Bcc inputs receive the factory through
`EmailComposeContext.createRecipientSource`; scoped hosts opt out explicitly with
`undefined`. Thread extras and personal hits deduplicate by canonical email while
preserving the selected representation. Keep selection/outside dismissal synchronous;
a delayed combobox close must not cancel a new query after refocus. Keep nonmatching
selected custom addresses out of visible suggestions during async search, so Enter
cannot toggle an old chip while a new result window arrives. Pass supplied
names to option/chip avatars instead of duplicating resolved names in the shared name cache. The internal
recipient and email app-browser fixtures cover desktop/touch. Channel invitation
and participant pickers use the same source with explicit roster exclusions; keep
whole-team selection separate. Exclude up to the native IPC budget before ranking,
filter any oversized roster remainder within each replaceable window, and retain
empty continuations. Bind paging to the complete roster's reset key, including
changes beyond that budget. Keep picker portals inside their owning dialog/drawer;
cancel a recipient option's pointerup default so synchronous popup removal cannot
be interpreted as an outside press that dismisses the containing drawer.
Soup's Created by submenus, mobile accordion sections and consolidated chips
use lazy contact sources. Assignee options stay team/agent-scoped and retain selected
outsiders; do not replace an explicit roster with personal-directory suggestions. Resolve closed-chip labels with
`useContactFilterLabels`, never by constructing a browse window or a directory map.
Keep Unassigned outside contact lookups and restore the Owned preset when clearing
its creator refinement. A query-driven combobox takes search edits from native input
events; Kobalte's programmatic resets on option replacement must not clear a pending
query. `internal/browser-test/soup-filters.browser.e2e.ts` covers both surfaces.
CRM Owner chips use `CollectionSelectFilter.createChipSource`, with selected labels
resolved separately; their header menu remains team-only. Keep No owner/Unassigned
out of contact lookups through the shared empty-value adapter. Wait for the virtual
list's initial viewport measurement before focus scrolling; otherwise the pending
correction can snap a user's scroll back to the first selected row.
Calendar guest editors (including event invitations and AI drafts) keep event-owned
addresses/names as scoped extras and use bounded personal property windows.
`PropertyEntitySelector.onUserSelected` carries UI-only chosen metadata separately
from persisted entity-reference payloads. Preserve guest ID/address representations
while comparing eligibility case-insensitively. A complete guest address is an
identity, never another person's display-name alias. Do not re-cap or locally discard
already matched person pages; expose continuation even for an empty window. Keep
Quick Access list factory setup untracked so loading/paging cannot reconstruct its
owner at page one. An in-flight multi-window advance stops when `inputKey` changes.
Universal Input resolves only current person references through `useContactReferences`:
task properties use `anyName`; recipients, guests and search use `preferFullName`.
Keep incomplete/ambiguous evidence unresolved, preserve structured term boundaries,
and never substitute a suggestion window for name proof. Use `recipientTerms` and
`formatRecipientTerms` for recipient string fields so delimiter-bearing model names
retain their boundaries while legacy manual separators remain supported. Explicit
addresses cannot resolve through display-name aliases; channel IDs remain scoped choices.
Picker factories and personal mentions use their own windows. Field-owned choice
snapshots preserve selected labels without becoming inference evidence or reviving
on a later return to the same text. Capture submission identities before async
work and recheck the account before dependent writes. The `task-references` and
`input-references` browser cases cover the real adapters/composers on desktop/phone.
Tasks creator filters also use lazy desktop/mobile contact sources; Assignee keeps
its explicit team/agent roster and selected outsiders. The planner extracts references
without a people catalog, then resolves complete per-label evidence before applying
any constraints. Preserve semantic Me separately from fixed self and resolve saved
summary labels from their own IDs. Inline checklist labels resolve only referenced
task assignees, in lookup-sized batches whose owners disappear with those references;
never populate a personal-directory map or the shared name cache for them.
Onboarding team prefill filters local browse windows to the server-approved domain,
follows bounded continuations until six distinct non-self emails or exhaustion, and retains only
that seed. No approved domain means no contact reads. Scope the source by account,
session and cache generation; preserve the form's first settled seed through refreshes.
Linear import resolves only current CSV assignees, serially in 500-label exact-reference
batches, and uses the shared single-user property picker for manual mapping. Keep
manual Unassigned distinct from no override; incomplete evidence requires retry or
an explicit choice. Reset file-owned mappings on upload/account changes, snapshot
assignments before creation, and use `createTaskForAccount` to fence dispatch and
local publication. Imported-row state may scale with the file, never the directory.
`CacheHost.people.resolveReferences` exposes the core's bounded full-directory
ambiguity evidence. It needs a bound viewer and ready context only for inbox
exclusions; callers must also check directory completeness. Missing reference
support must not disable existing search. The real wrapper/worker/OPFS regression
is `worker/browser-test/people-references.browser.e2e.ts` under `lib/graphql-cache`.
`ContactReferencePage` provides fetch-only server fallback stages with exact/first-name
matching before the limit. Follow empty continuations and keep the existing search
budget; never infer uniqueness from one incomplete suggestion page.
`useContactReferences` resolves only the current inference/import labels, with
per-label complete/ambiguous evidence and separate exact identity lookup. Its
reader keeps one physical read plus one replaceable pending input, samples cache
completeness before scanning, and wakes incomplete reads only on readiness
transitions. Source data is scoped and immediately collected, not a people pool.

Execute browser `macro.people` SQL in the existing local Turso cache, including
offline; authorized synchronization supplies records, not a server query endpoint.
Use actual wasm compiler metadata to distinguish the built-in relation from ordinary
tables named people. `CacheHost.people.readSql` exposes the scoped local capability;
missing native support must not disable other person methods or trigger remote SQL.
Serialize uninterruptible reads with one replaceable pending input. Wake incomplete
queries on the committed contact checkpoint, not only the preceding hydration hint. Filter, aggregate and limit before materializing results; never
enumerate contacts or fall back to remote SQL execution. Validate result metadata and
fence account/session, storage generation, input transitions and disposal. Require
complete synchronization before treating local results as directory-wide evidence;
unsupported/incomplete reads stay explicit failures, not authoritative empty answers.
Only actual people-ID join hints may enter bounded identity reads; email/name/virtual
row keys must not masquerade as IDs. The real compiler/controller/Turso browser
regression is `internal/browser-test/sql-people-joins.browser.e2e.ts`.
Keep last same-owner results on ordinary failures, but clear them on account or
authority changes. Preserve explicit post-disposal refreshes used to finish accepted
database writes only for the original account/session.

## Verifying a change in a real browser

`just test-functional` builds a production-like bundle of its fixtures and runs
Playwright against it, not a dev server: each page otherwise fetches thousands of
modules through the test's own routes, which limits how many tests can run at
once. A fixture that depends on dev-only behavior won't work there. CI sets
`FUNCTIONAL_TEST_WORKERS` and retries a failed test once; locally it defaults to
one worker and no retries.

ID-only user mention rendering, name lookup failure, and composer save/reopen
are covered on desktop/tablet/phone by `user-mentions.browser.e2e.ts` in the
LexicalMarkdown core browser suite (see its README).

During iterative visual tweaks, use focused browser verification; defer full typechecks and CI checks until the batch is ready or the user requests them.

Any user-visible change should be exercised in a browser before you call it fixed — type-check, biome, and vitest all pass on code that still has the interaction bug.

Desktop sidebar and list-header titles, saved-view icon alignment, unclipped
switcher triggers, and scrolling list controls have a backend-free regression:
`bunx playwright test --config src/components/view-shell/browser-test/playwright.config.ts sidebar-title.browser.e2e.ts`.

Search facet chip sizing, text alignment, and filter interactions have a backend-free
regression: `bunx playwright test --config src/features/universal-input/browser-test/playwright.config.ts global-search.browser.e2e.ts --project chromium`.

Agent image attachments preserve external and inline image URLs; only configured
static-file endpoints receive thumbnail sizing. The backend-free regression is
`bunx playwright test --config src/features/block-agent/browser-test/attachments.playwright.config.ts`.

Split dragging and composer reflow have a backend-free browser regression:
`bunx playwright test --config src/lib/core/component/Resize/browser-test/playwright.config.ts`.
It exercises the real resize solver, scroll container, and Lexical layout primitive.

Stacked splits have a backend-free browser regression over the real split
router and tiled layout: splitting keeps the pane mounted, stacked gutters drag
and nudge to the minimum height, and closing hands the column back:
`bunx playwright test --config src/components/app/split-layout/browser-test/playwright.config.ts`.
Keep panes in one keyed list positioned by the layout tree; nesting a
`Resize.Zone` per split remounts a pane whenever its split changes.

Desktop app switches open the requested list in the target split when the
retained detail is claimed by another pane or preview. Keep this check in view
restoration and preserve entity deduplication and native dock stack restoration;
`split-layout/tests/view-restoration.test.tsx` covers Chat and Tasks lists in
either pane, keeping the other pane's detail and history independent.

Database document-reference cells have a backend-free desktop/touch regression:
`bunx playwright test --config src/features/block-database/browser-test/playwright.config.ts references.browser.e2e.ts`.
It uses the real records view with a local source and picker to exercise opening,
replacement, cancellation, keyboard editing, and read-only references. Navigation
adapter tests separately check file types, access failures, and split selection.

Poll cards in messages (the real `DocumentCard` around `FormCardView`) have a
backend-free desktop/phone regression: while loading, the card draws its
header with the question (the card's name, so it wraps as it will) above a body
reserved from `previewData.poll.optionCount`, keeps that height through load,
and never scrolls or clips inside:
`bunx playwright test --config src/lib/core/component/LexicalMarkdown/component/decorator/browser-test/playwright.config.ts poll-card.browser.e2e.ts`.

Pinch zoom on opened image files (Drive details and image splits) has a
backend-free phone and tablet regression:
`bunx playwright test --config src/features/block-image/browser-test/playwright.config.ts`.
Keep the zoomed image laid out at its zoomed size, translating only: WebKit
rasterizes an `<img>` at its layout size, so a `scale()` transform blurs it.

The emoji reaction picker renders only the rows in view (about 1,900 emojis
otherwise); its backend-free regression opens it, scrolls to the last group,
searches, and picks by keyboard:
`bunx playwright test --config src/lib/core/component/Emoji/browser-test/playwright.config.ts`.
Size its glyphs off the row, never off a cell: a cell's width comes from `1fr`
track sizing, which its own contents can push out, so a glyph sized off the cell
feeds that loop and can settle with one emoji filling the picker. The same suite
checks that widening a cell leaves the glyph alone.

The email reminder menu reads typed times through the real natural-time wasm
package; its backend-free desktop/phone regression, at a fixed New York clock,
checks both readings of a guessed hour, saving either, the reasons shown for
unreadable, passed and daylight-saving-skipped times, and the presets:
`bunx playwright test --config src/features/reminders/browser-test/playwright.config.ts`.
Run `just ensure-natural-time-wasm` first.

Focus rows have a backend-free browser regression over the real row and mapping
at wide, one-line, stacked, phone, and tablet widths: one reason per row, no
extra height or lost subject, touch rows of at least 44px, and the importance
meter on every row except on phones, with the direction in its label while
importance moves:
`bunx playwright test --config src/features/email-view/browser-test/playwright.config.ts`.

A channel call's row and its call panel (the real `Channel` over synthetic service
responses) have a backend-free desktop and phone regression: the collapsed row, the
blank slate, composer pinning, quote replies and the outside-message popup:
`bunx playwright test --config src/features/channel/Call/discussion/browser-test/playwright.config.ts`.
On a machine with many network interfaces, run it under `bwrap --dev-bind / / --unshare-net`:
Chromium otherwise aborts module requests with `ERR_NETWORK_CHANGED`.
A call's own chat on a meeting page (the real `CallChat` under only the providers
`Root` gives every page) has a backend-free desktop and phone regression: the
first message sent shows in the panel, and a guest's message renders without
the app's notification state:
`bunx playwright test --config src/features/channel/Call/chat/browser-test/playwright.config.ts`.
A meeting page has none of `AppProviders`; anything rendering app messages there
goes inside `MeetingDiscussionHost`, created by the host's render function.

Discussion link scrolling has a backend-free browser regression:
`bunx playwright test --config src/lib/core/messages/browser-test/playwright.config.ts`.

Phone sheets stacked on each other (Connect email over Settings, Add guests,
RSVP scope and the delete confirmation over event details) have a backend-free
browser regression for backdrop taps that must not press what the scrim covers,
including mixed pointerdown/pointerup dismissal, for taps inside the top
sheet that must still press its own controls, and for swipes whose owner keeps
the sheet open (a discard prompt, a pending confirmation, event details under a
stacked sheet), which must bring it back on screen. It also keeps a persistent
prompt under an open sheet and its picker, above a transient notice, and that
notice on top of the sheet:
`bunx playwright test --config src/components/app/mobile/browser-test/playwright.config.ts`.
The same suite covers where a sheet puts focus as it opens: on itself, leaving
its first row unringed, unless the first tab stop is a text field, the sheet
focused something itself, or it names its own target; Tab then moves into the
rows, which do show the ring.

CRM creation has backend-free desktop/phone coverage for name-only companies,
personal-email contacts, contacts added by name alone, explicit company selection,
and Unicode contact names at the server's character limit:
`bunx playwright test --config src/features/crm/browser-test/creation/playwright.config.ts`.
Nested picker selection must keep its containing drawer open when the option
unmounts during the tap; drawer dismissal checks the original event path.

Composer typeahead menus choosing the side with room for their full list
(`floatWithSelection`'s `fullHeight`), above a composer at the bottom of a
phone screen and below one near the top, and the floating format menu staying
beside a scrolling editor whose selection runs past its visible bottom
(`clipToVisible`), have a backend-free browser regression:
`bunx playwright test --config src/lib/core/component/LexicalMarkdown/directive/browser-test/playwright.config.ts`.

The machine Share menu (teammates, team access, access requests, and the warning
before shutting down a resident) and Settings → Machines' Teammates' machines
section (Request access), and its Pending requests section (one-click Approve
with rows that stay mounted across refetches), have a backend-free
desktop/phone regression:
`bunx playwright test --config src/features/runtime-sharing/browser-test/playwright.config.ts`.
It runs the real queries and service client over a scripted network. The warning
opens under an owner from inside the sheet; one captured outside it closes the
menu on the first tap.

Composer `/` menus list Connections between Skills and Pull requests. Keep native
and hosted providers aligned with `mcp_select::select_connections`, prefer native
credentials per provider, and preserve editor focus on pointer and touch selection.

Undo in a large collaborative Markdown document (Loro undo, mirror, reconcile,
caret mapping) has a backend-free timing regression:
`bunx playwright test --config src/lib/core/component/LexicalMarkdown/collaboration/browser-test/playwright.config.ts`.
Keep reconcile and caret lookups linear in the document: no `getChildren()` or
container scan per node.

Collaborative Markdown editing across several peers has a fast-check fuzzer and
the fixed scenarios it found; see
`src/lib/core/component/LexicalMarkdown/fuzz/README.md` before changing
`CollabProvider`, caret mapping, or Loro undo.

Event details placement has a backend-free browser regression: the desktop
popover stays beside its event when join requests arrive after it opens, and
slides into a short window; the phone drawer shows late requests. The same
suite covers the Add guests and Forward invitation editors (the real
`EventGuests` over a stand-in contact picker) on desktop and phone, and long
guest addresses wrapping in both: `just test-calendar-details-browser`. CI runs
it when calendar details or `src/lib/queries/calendar` change. Its fixture
aliases those query modules to `preview-adapters.tsx`, so a module export or
callback argument the adapters lack leaves every page blank; mirror it there.
Keep the popover's `flip` limited to `left-start`: an end fallback re-places it
above the event whenever a late section changes its height. Keep the guest
editors' `overlap`: without it their height follows the room below the button,
so they never overflow, never flip, and squeeze the chosen people to nothing.

Email invitation cards have a backend-free desktop/phone regression for long
descriptions wrapping inside the card, collapsed and expanded, the guest row
lining up with its icon, and `+N more` keeping a 44px tap target on touch:
`bunx playwright test --config src/features/email-message/browser-test/playwright.config.ts`.
Use `wrap-anywhere` alone on wrapping text: `break-words` is emitted later and
overrides `[overflow-wrap:anywhere]`, which then no longer shrinks min-content.

The desktop app's local runtime setup (find an agent, connect, create the
agent, retry, open a session) has a backend-free browser regression over a
scripted runtime:
`bunx playwright test --config src/features/local-runtime/browser-test/playwright.config.ts`.

Share message image paste, drop, removal during upload, and
upload failure have desktop, phone, and tablet browser coverage:
`bunx playwright test --config src/lib/core/component/ForwardMessageComposer/browser-test/playwright.config.ts`.
Keep the shared uploader from restoring removed attachments or publishing after
the composer is disposed. The Share button and shortcut use the same upload guard.
Keep Share composers free of a paperclip button on desktop and mobile; preserve image paste and file drop.

Non-personal entity rows in typed-name menus (Command-K, mobile name search, @
mentions) rank with `NAME_MATCH_RANKING` in `@core/util/freshSort`: names equal
to the query first, then names starting with it, then other matches, with tight
matches near the start scoring higher. Each menu's recency weights and type
boosts (Cmd+K's channel and DM boosts) order rows within those groups and never
lift a row past a better name match. The one exception: Cmd+K then keeps Macro
users and DMs ahead of CRM contacts across the people positions, whatever their
match. Among equally good name matches Cmd+K lists Macro users and DMs before
other rows. Personal contact rows keep policy-5 source order among equally good
name matches only, so a recent weaker match never takes a better match's slot.
A row whose letters merely appear in order ranks below every row containing the
typed words.
Soup's local search pool (`createSearchState`) stays lazy: it builds only when
local search has text. Measure Quick Access ranking at scale with the
[scale fixture](src/features/command/browser-test/README.md).
Ordinary DM entity matching in Cmd+K and mobile name search treats the first
name as exact, so it reaches a full-name DM; personal contact windows keep their
independent policy-5 tiers. `commaSeparatedChannelMatch` (Cmd+K, mobile name search,
Quick Access, and Soup search including the Chat sidebar) matches channels and
DMs by terms in any order, adding to uFuzzy's in-order matches, because names
are generated from participants and people type them in any order. It also
ranks a conversation whose participants the query names, by name prefixes,
right after exact names. Each participant needs a term of their own, so a group
with more people than the query names stays below it.
Commas separate query terms like spaces in the cache search
(`cache-core/search.rs`, mirrored by `matchesTokenSubsequences`) and in the
server's channel name search; keep the three together.
Name scores are per-row (a fixed 0–100 scale), not normalized against the current result corpus. Rust/browser fixtures in `crates/subsequence_match/src/ranking` keep match quality and recipient tiers aligned; surface weights and boosts remain caller-owned. Command-keyword eligibility keeps its dedicated matcher.
Name groups and match position use the row's label (`getDisplayName`), so search
text can add emails, aliases, or command keywords before or after it. Mention
menus rank loaded entity sources together with `MENTION_RANKING_CONFIG` in
`MentionsMenu/utils/mention-ranking.ts`: name relevance, viewed recency,
brevity, and type boosts. Task projects use the `initiative` bucket; `project`
means a Drive folder. Preserve broader cache/server matches and the existing
People preview/pinning. Group company and contact records under
Contacts & Companies, separate from People; keep contact selection as a CRM link
even for a matching Macro user.
Only Macro users and groups participate in mobile People pinning.
The channel browser suite below also checks project
ranking and insertion on desktop and phone.

Channel composer draft persistence has a backend-free browser regression:
`bunx playwright test --config src/features/channel/Input/browser-test/playwright.config.ts`.
It checks draft blank lines across remounts, that a sent message renders its
lines with the spacing the draft showed, that the one-line composer centers its
buttons on the text line, and pending sends on desktop and phone: clear immediately, restore failed sends, and preserve a new draft typed during delivery.
It also pastes a Macro link and Markdown into a code block, which must keep both as literal text.
It also covers phone attaching: the add drawer opens the file picker within the
tap, and when the iOS app's native photo library fails, a toast's Choose files
button opens it, because WKWebView ignores a file input click made after the
native round trip. Route iOS photo picks through `pickPhotoLibraryMediaOrFiles`.
Its phone formatting regression opens the ribbon from the add drawer in the
production message editor, removes selected strikethrough, and saves; keep
the ribbon horizontally scrollable and preserve editor focus on its controls.

Shared GraphQL query metadata has a backend-free desktop and iPhone WebKit regression:
`bunx playwright test --config src/lib/urql-solid/browser-test/playwright.config.ts`.
Publish data and metadata atomically. Reconcile result data only; replace
operation metadata so shared documents,
cached query text, and operation names remain consistent across query changes.

Block formatting passes a forward copy of the selection to Lexical's
`$setBlocksType` so backward selections include their first paragraph and keep
the editor's actual selection direction. The Markdown core browser suite's
`quotes.browser.e2e.ts` checks Quote through the floating toolbar and after saving.
The same suite checks multi-paragraph plain-text, HTML, and Lexical pastes into
empty quotes and selections within a quote on desktop, tablet, and phone.
Selections across adjacent quotes stay quoted; ranges containing unquoted blocks
retain normal paste behavior.
Keep pasted paragraphs quoted through the shared clipboard insertion command.

A frontend dev server runs against the **dev** backend, so this needs no local stack, Docker, Rust build, or `sudo`:

```sh
cd apps/web && PORT=3003 bun run dev   # any free port in 3000-3009
```

`import.meta.env.MODE === 'development'` resolves the service clients to `https://dev.macro.com` through Vite’s same-origin development proxy. Sign in on the development hostname; existing `.macro.com` cookies are separate. Vite prints `https://<hostname>:<port>/app/`; `https://localhost:<port>/app/` also works. Trust `infra/local/certs/ca.pem` once in the visiting browser (see `infra/local/certs/README.md`). `MACRO_DEV_HTTPS=false` restores HTTP for workflows that require it. Notes:

- On a remote devbox, open `https://<hostname>:<port>/app/` directly. The dev server serves HTTP/2, gzips modules and links source maps instead of inlining them, so a cold load of the ~7k dev modules moves ~13 MB instead of ~100 MB. Trust the CA on the visiting machine: Chrome caches nothing from a site whose certificate warning was clicked through, so every reload re-downloads every module. Tailscale Serve is an alternative that needs no CA: `sudo tailscale serve --bg --https=443 https+insecure://localhost:<port>`, then open `https://<devbox>.<tailnet>.ts.net/app/` and sign in again there (Serve offers HTTPS ports 443, 8443, and 10000). `MACRO_DEV_COMPRESSION=false` and `MACRO_DEV_INLINE_SOURCEMAPS=true` restore Vite's defaults.
- Never assume port 3000 or 3002 is yours. Check with `lsof -nP -iTCP:<port> -sTCP:LISTEN -t` and confirm the owner's worktree via `lsof -p <pid> | awk '$4=="cwd"'`. Take a free port instead of killing another session's server, and reuse one only if its cwd is this worktree.
- The `.cursor/*.sh` scripts and the `run-app` skill are **Cursor Cloud** entry points. On a local machine they prompt for sudo and are the wrong tool. Only backend (Rust) changes need the local stack.

### When the change needs a local backend

`bun run dev` talks to the deployed dev backend, so a change that adds or alters a backend endpoint can't be fully verified that way (the new route 404s against dev). Start the full local stack from the repository root:

```sh
nix develop --command just run_local --instance <name>
```

- Launch it through `nix develop` on Linux: the services are built natively against the dev shell's libraries, and the stack mounts `/nix/store` into their containers.
- `--instance <name>` gives an isolated Compose project, volumes, and a deterministic per-name port window, so it never clashes with another worktree's stack. `just status_local --instance <name>` prints the endpoints without starting anything; `just stop_local --instance <name>` stops it (volumes kept) and `just destroy_local --instance <name>` removes it.
- First bring-up is slow (a build of every service plus the agent-harness sandbox image); later runs reuse the caches. It needs no terminal: without one it runs in the background and returns once ready, and survives your shell dying. `just run_local rebuild --instance <name>` rebuilds changed Rust services in place (`r` while attached); add `--services <name>` (comma-separated compose or binary names) to rebuild and restart only that one, then `stale_services` in `status --json` lists the services left on older code until a `rebuild` with no flag catches them all up. `just run_local status --json --instance <name>` reports its state. See [Run without a terminal](../../docs/development/running-locally.md#run-without-a-terminal).
- No accounts are pre-created: passwordless login registers any email on demand, and the one-time code lands in the instance's Mailpit (endpoint in `just status_local`). `just seed-scenario apply --file seed/scenarios/team-perms.json` seeds multi-user team fixtures with printed login links.
- Full details, Doppler vs no-Doppler modes, and port-conflict debugging: `docs/development/running-locally.md`.
- `just run_local` prepares the wasm packages (`bun run dev:prepare`) while the services build, from a machine-wide cache keyed by each package's sources (`~/.cache/macro-local/wasm-pkgs`); only a package no worktree has built yet compiles, which takes a few minutes. A bare `bun run dev` doesn't use that cache.
- That tab is pointed at **real dev data**. Treat creates, edits, and deletes as real, and discard drafts you open.

### Instrumenting a flash, blank, or remount

A screenshot cannot distinguish a repaint from a remount, and automated browser tabs usually run with `document.visibilityState === 'hidden'`, where `requestAnimationFrame` never fires — do not sample per frame. Tag the nodes you care about and let a `MutationObserver` record every change to a summary string:

```js
window.__inst = { log: [], seq: 0 };
const I = window.__inst;
const tag = (el) => (el.dataset.instId ||= String(++I.seq));
const snap = () => [...document.querySelectorAll('.fc')].map(tag).join(',');
I.last = snap();
new MutationObserver(() => {
  const s = snap();
  if (s !== I.last) {
    I.log.push({ t: Math.round(performance.now()), from: I.last, to: s });
    I.last = s;
  }
}).observe(document.body, { childList: true, subtree: true });
```

Then trigger the interaction and read `window.__inst.log`. `'1,2,3' → '' → '1,2,3'` (the same ids coming back) is a `<Suspense>` detach and re-attach. Fresh ids are a true remount. Nothing at all means the subtree never moved and the cause is elsewhere. Re-running the same interaction a second time is the cheapest way to prove a cold-cache cause: a once-per-session query settles after the first attempt, so the second attempt stays clean.

Remote database selections have a backend-free desktop/phone regression that
measures every row and cell while collaborators move, share a cell, or select a
range, and checks their name labels above the header and under it once
scrolled, and keyboard (Shift+Arrow) ranges whose moving corner stays in
view: `just test-database-browser`. Keep the outline an overlay, never a
border on the cell. Virtual rows are transformed, so each is its own stacking
context: a row carrying labels rises above the header only while its top edge
is in view.

Column renames have a backend-free desktop/phone regression using the real
schema query and mutation adapter with delayed service responses:
`bunx playwright test --config src/features/block-database/browser-test/playwright.config.ts rename.browser.e2e.ts`.
It checks the optimistic name, header identity, and persistence across reload.

## Canvas collaboration

Document sync uses the `sync-via-gateway` PostHog flag in both deployed dev and
production. Off or unknown flag values use direct sync sockets.
Local stacks with the updated DSS can opt in with `VITE_SYNC_VIA_GATEWAY=true`;
`false` forces direct sync. The choice is made when a sync source is created
and stays fixed for its lifetime. PostHog can serve a cached value on reload;
recreate document sessions after the client receives the updated flag to change
transport. This is not an immediate kill switch for open sessions. Finish deploying the updated
DSS before enabling; the dedicated `/sync/ws` socket hosts routing independently
of the connection-gateway notification socket. The PostHog key keeps its historical name.

Saved canvases use the shared Loro runtime; the stored JSON is only the original
migration seed. Keep whole-file simple-save out of scene editing. Canvas
initialization, WAL/snapshot recovery and teardown live in
`features/block-canvas/queries/canvas-session.ts`; presence is ephemeral and
reference bookkeeping is excluded from scene undo. Run the feature tests and
`bunx playwright test --config src/features/block-canvas/browser-test/playwright.config.ts`
for multiplayer changes.

Canvas **Ask Macro**, including the Drive detail header, attaches the current canvas to the existing agent composer
on desktop and mobile. Tool results render through
`lib/core/component/AI/component/tool/Canvas.tsx`; edits arrive through live sync.
The shared plain-text Lexical codec is `packages/lexical-core/canvas-text.ts`.

## Message notification reads

Gate automatic message notification reads on the actual message element
intersecting the visible scroll area, excluding floating chrome and background
tabs. Share visibility observers per thread list, including standalone threads;
never treat virtualized overscan or a visible thread parent as seeing its replies.
The backend-free desktop/phone/tablet regression is
`bunx playwright test --config src/features/notifications/browser-test/playwright.config.ts`.

## Development Patterns

Route database row rename and delete through `renameDatabase` and
`trashDatabase`; use the row grant for rename, delete, and sharing permissions.

Shared diff and Changes views expand files with at most 40 additions + deletions
by default; keep saved per-capture choices and explicit toggles authoritative.
Use `/app/debug/diff-view-ui` to exercise the 40/41-line boundary.

Project grouping in Soup and its live cache projection uses the system Project
property (initiative membership), with an empty key labeled No Project. The
server labels each project group with the initiative name the viewer can read;
headers resolve a name themselves only while a group is still labeled by its
key, and projects sort by name with No Project last. Data a grouped list shows
about its groups (labels, order, membership) is computed on the server and
mirrored by the cache's local grouping projection; never add a side cache in
feature code to cover a remount.
Project identity chips use cache-first reads and the shared `GraphqlUser.initiative`
entity resolver to reuse complete authorized records from project lists or details.
Keep cold row metadata reads non-suspending so virtual scrolling never detaches
its list; permission revalidation remains independent of row mounts. Project
reads retain client-scoped denial state across remounts and immediately reauthorize
previous-viewer cache hits; older requests never clear newer denial decisions.

Resolve server date-group keys through the shared `DATE_GROUP_BUCKETS` metadata
in `lib/queries/soup/grouped/api.ts` for labels and display order; cached Mail
uses the same metadata.

Keep persistent list hotkeys free of mounted-view closures, and clear
virtualizer accessors when their view unmounts.
Keep editor newline handling local; result-opening handlers must yield
Shift+Enter while an editor owns focus instead of adding shared hotkey flags.
A composer renders paragraphs with the spacing its sent message renders with,
so a draft reads as what it will send; drop only the draft's first and last
margins, which the compact single-row layout measures.

- Reuse `src/components/WorkspaceTexture.tsx` for the onboarding and Create
  detail panel grain; pass the surface accent and a unique SVG filter ID.
- Keep shared database card rendering in `features/database`; CRM supplies
  pipeline-authorized positions. Exercise both editor and board fixtures with
  `bunx playwright test --config src/features/crm/browser-test/playwright.config.ts`.

### Pipedream native authorization

Keep native Pipedream consent in the system browser: the desktop navigation
plugin redirects external popups and breaks the embedded iframe's return path.
`pipedream-connect.html` is a separate Vite entry, served at
`/app/pipedream-connect.html`, without a Macro browser login. The Connect token
and one-time state travel only in its URL fragment, which the page removes on
load. When Connect finishes it opens the `macro://` callback itself, keeping
**Return to Macro** as a fallback link; the Tauri navigation bridge consumes it
without changing the active route. Backend registration still verifies account
ownership. Done, logout, and the ten-minute timeout retire pending callbacks.

Connect can close without reporting success (an OAuth provider severs its
consent popup's opener) even though Pipedream created the account. Every close
without success, on web and native, asks `/pipedream/mcp/recover` to register
the user's newest account for that app from the last fifteen minutes.
Desktop Home and Agents new-conversation and active-session composers show the shared **Run agents
on this computer** invitation until this installation is paired or the current
user dismisses it locally. Keep the invitation tied to bundled macrod support,
not to account-wide paired machine count; a user can pair several computers.

### General

- Keep contact removal and restoration beside Copy contact link in both record
  headers; keep company actions on Overview. Reuse the hidden mutations and
  confirm company contact/email-sync effects.

- Keep selection controls on shared `Checkbox`, `ToggleSwitch`, and `RadioGroup`;
  preserve their native input semantics and use root sizing instead of internal
  control/glyph overrides. See the [selection-control contract](../../.agents/rules/web/ui-primitives.md#selection-controls).

- Keep model picker triggers bounded with full-name title tooltips; wrap model names in catalog rows, including effort submenus and touch sheets.

- All Mail previews exclude spam/junk and trash. Keep draft edits from restoring
  an excluded preview or timestamp, including synced Macro drafts; Drafts and
  Sent retain their own canonical membership.
- Spam and Trash use scoped REST pages without shared preview normalization or
  service search; restore through the provider-neutral thread-state mutation.
  Refresh these isolated lists after read-state writes, provider sync events, and
  settled Outlook operations; shared-cache updates cannot reach them. Preserve
  newer selections when a pending folder restore finishes.

Agent split headers show live viewers through `BlockLiveIndicators` with the
resolved session ID; keep the existing `AgentSessionProvider` subscription to
`agent_session` rather than enabling legacy block tracking of placeholder IDs.

- Share URL recognition with `packages/lexical-core/utils/auto-link.ts`; preserve explicit unlink markers when saving and rendering messages. See `packages/lexical-core/README.md` at the repository root.
- Keep ordinary hyperlinks on the theme's link colors (blue by default), including Markdown renderers/editors and calendar descriptions; preserve mention decorators' separate styling.
- Keep add-only email and personal-provider company edits in shared CRM field views, using Tasks
  property primitives and committed-response/session-fenced cache updates. Close
  direct cache-write admission on logout and login replacement, and drain admitted
  durable writes before clearing storage, while starting independent local/server
  sign-out immediately. Retain the exact physical cache owner through cleanup even
  after its public wrapper retires. On login, remove only session-written contact
  records before refetch; recover typed owner/bootstrap failures only through the
  original backend/scope factory. Preserve queued offline edits, report failed
  repair, release email verification's busy state on failure, and retry only local
  completion after a code has been consumed. New address/back/send attempts must
  verify anew. Keep admission closed until cleanup succeeds; serialize login behind every logout wipe;
  `browser-test/archive/contact-edit.browser.e2e.ts` covers desktop and touch flows.
- CRM creation accepts name-only companies and full contact email addresses.
  Company selection is explicit; a matching domain only suggests a company.
  Keep the standalone and pipeline forms consistent (see
  `docs/agent-guide/crm.md` at the repository root).

- Empty human DMs use the shared centered conversations graphic and explain email delivery to nonusers; keep this state out of agent DMs, loading/error states, and populated timelines.
- Keep CRM database discovery row-linked and permission-scoped; use horizontally
  centered actionable list states raised toward the toolbar and shared skeletons,
  with separate search-empty and retry states. Company/contact touch headers use a
  Switch view drawer that honors host collapse and square copy-link islands; keep
  phone breadcrumbs above the switcher and leave the workspace view strip unchanged.
  Open linked items under their Customers source URL; typed record sections append
  only `<id>` and reject redundant typed URLs. Workspace activity and record
  Files/overview notes retain item metadata on their own scoped routes. Keep
  source and record breadcrumbs without section labels or extra preview-title
  separators, retain entity menus and sharing, and return the current record
  breadcrumb to its captured section and history entry.
  Record search fills the row beside filters with header spacing; section creation
  replaces the default floating dock action through FloatRegion. See
  `src/features/crm/README.md` and `docs/agent-guide/crm.md` at the repo root.
  Keep Files scoped to the contact when its optional email is absent; emit an
  email-attachment participant literal only for a present address.
  Put Archive beside Copy link for visible CRM records; put the Archived chip and
  separate compact secondary Restore button in the identity heading for archived records.
  Match record metadata to the 24px property-control scale while reserving separate
  44px touch targets; see the CRM README for the visible-face and hit-area contract.
  Keep explanations on the chip and retain company-only Email sharing controls.
  Use the explicit Visible/Archived filter for People, Companies and company Team;
  reset its admin-only choice on account/team/role/list changes and preserve search.
  Apply confirmed visibility changes to detail, list and normalized search caches;
  fence in-flight pre-write responses and refresh only affected CRM readers.
  Declare CRM membership dependencies from each Soup query's initial filter scope
  on every page so empty late responses are fenced without refreshing excluded types.
  Recover missing dependencies before forwarding durable/imperative revalidations;
  a later observer may share an in-flight request without forwarding its context.
  Preserve company cascade semantics and require company restoration before a person.
  Run desktop/phone controls with `bunx playwright test --config src/features/crm/browser-test/archive/playwright.config.ts`;
  `browser-test/people` and `browser-test/team` additionally cover synthetic query adapters.
- Main Tasks mounts reusable GraphQL saved views; keep embedded Project/CRM task lists unchanged. Read `src/features/tasks-view/AGENTS.md` for filter, draft, navigation, and browser checks.
- Email mounts the same saved views (`kind: "email"`, flag `enable-email-saved-views`); read `src/features/email-view/AGENTS.md` before changing its definition, sidebar section, or mobile picker.
- Enable persisted email/calendar review controls only for the review’s saved acting account; historical reviews fall back to the session owner. Require session edit access on desktop and mobile.
- Email draft reads compare server generations before choosing cached delivery state over a restored working copy; only a definitive first-submission rejection permits local send recovery without server cancellation.
- Compose settings pages with `features/settings/primitives.tsx` so section headings,
  raised composer cards (`SettingsSurface`), row spacing, and control shapes stay
  consistent; never hand-build a flat `bg-ink/*` card. Integrations is the one
  settings page that spans nearly the full width, for its list columns.
- Preserve email signature HTML through import, preview, and source editing;
  mount Quill only for explicit Rich text editing and confirm custom-layout
  conversion. Keep the settings and composer preview on the same sanitized HTML
  renderer. Phone settings show the preview with desktop-only editing. See the
  [signature walkthrough](../../docs/agent-guide/settings.md#email-signatures)
  for browser coverage. Keep signature commit callbacks on the mutation hook
  so account-list remounts cannot leave an already-cleared draft behind. Offer
  Gmail signature import only when the inbox provider is `GMAIL`, regardless of
  its email domain; keep shared signature instructions provider-neutral.
- Keep personal accounts, team imports and agent tool connections together in
  Settings → Integrations: one searchable list row per integration, styled like
  the Drive/Tasks lists, custom MCP servers then connected ones first,
  described by what each does in Macro; preserve `agent-connections` and `team-connections` as aliases for existing links.
- Keep bot setup focused on the token-and-SDK workflow; Agent and Ownership
  controls live under collapsed Advanced settings. See the
  [Bots walkthrough](../../docs/agent-guide/settings.md#bots).
- Label the notification permission toast **Enable notifications** on every
  platform, and keep the desktop and Android Enable actions on the native
  notification provider.
- Keep toast behavior in `@core/component/Toast/Toast`: desktop notices stack, mobile transients replace, and persistent notices use their own regions. Mobile notices omit the close icon and support swiping left or right. Follow the [toast presentation contract](../../.agents/rules/web/design-system.md) for shared surfaces, compact mobile notices, aligned content, and optional close controls.
  Review current toast specimens under **Current app toasts** at `/app/component/ui?ui=toast`; keep the gallery's actions inert, regions isolated, and account details synthetic.
- Keep signed-out Drive document routes on the shared detail viewer without
  mounting private list/sidebar sources; let document access checks decide visibility.
- Gate account-only queries, comment readers, and account WebSockets on confirmed
  authentication; keep public document loading independent of those services
  and distinguish unresolved identity from confirmed sign-out in UI prompts.
- Probe identity on deploy-preview origins even without a local login hint;
  shared HttpOnly dev cookies are not visible to JavaScript or localStorage.
- Leave the login hint (`syncLoginStorage(true)`) before a full-page hosted
  SSO redirect, and as soon as a native sign-in redeems its session code; the
  cookies are HttpOnly or in the native jar, and a load without the hint never
  checks identity, so the user sees sign-in again over a valid session.
- Hold automatic reloads (`holdAutomaticReload`) across anything a reload would
  lose. `createNativeAuthSession` holds them for the sheet: its result reaches
  only the JavaScript that opened it, and leaving the app for a sign-in code
  hides the page, the moment OTA bundles apply. Native sign-in (`useSsoLogin`)
  holds them on until the session code is redeemed and the login hint is down.
  Holds also reach the native updater, whose foreground handler never asks the
  page. See
  [reload diagnostics](tauri/src-tauri/README.md#diagnosing-unexpected-webview-reloads).
- Disable GraphQL cache sessions and clear login hints on confirmed auth 401s,
  even with retained user data; preserve session state on transient failures.
- Bound shared cookie-auth refresh (`core/auth/session-refresh.ts`), including
  proactive socket setup, to 12 seconds and native network availability; let
  each caller cancel its wait independently, and keep refresh timeouts retryable.
  On foregrounding, expire a pending refresh older than that deadline by wall
  clock; suspension can pause its timer.
- Treat a repeated worker-ready frame as a coordinator restart: retire the old
  engine and re-register in place, preserving durable storage and never replaying
  uncertain enqueues. Space failed coordinator registrations with bounded,
  cancelable waits; a missing startup frame is not proof of untouched storage.
  See `docs/graphql-normalized-cache-plan.md`.
- Reject already-routed optimistic enqueues with missing replies as uncertain on
  every owner departure; never forward them through network fallback, because
  their durable queue entries may survive the old engine.
- Dispatch live GraphQL notification callbacks before cache persistence so hidden
  tabs can show browser alerts; keep cache-dependent channel reconciliation
  behind ordered writes and never replay alerts when the cache resumes. Link
  cache queue/apply spans to receipt and mark listener failures without stopping
  the remaining callbacks.
- The Soup GraphQL websocket pings when the app returns to the foreground or
  comes back online, and terminates a socket that does not answer within five
  seconds (close 4499, retried). A phone can wake to a socket that reads open but
  is dead; the reconnect is what tells followers such as agent sessions
  (`subscribeGraphqlSoupReconnected`) to refetch what they missed.
- Drain browser cache engines when their last visible consumer hides, then park
  without retiring clients; queue background work until a visible owner reopens
  storage, retaining accepted mutation settlements even if their caller leaves.
  Publish recovery reset outcomes before parking while retaining the read pause.
  Bound foreground resume reads to one second without killing an owner, stealing
  its lock, replaying writes, or treating intentional parking as a failure.
- Snapshot cache generation subscribers before dispatch and skip removed listeners;
  reactive observers may resubscribe during notification and must not extend it.
- Coalesce broad browser cache-change hints across the coordinator's in-flight
  backlog, not the engine's per-message queue; keep reset fences, mutation
  settlements, and query-specific invalidations immediate.
- Open tabs share one cache engine, so a source that reads on cache changes must
  not read while hidden: use `createVisibleRefresh` to throttle too, or
  `createHiddenDeferral` when its own reads already coalesce. Initial and
  explicit reads still run.
- Report cache operation failures through `createCacheErrorThrottle`: one owner
  loss rejects every queued operation, and each report reaches the console and
  session replay. The next report for that kind carries `cache.suppressed_count`.
- Retry still-current query reads once when engine replacement invalidates their
  snapshot; do not strand urql's in-flight key or revive torn-down or superseded reads.
  Keep network forwarding deduplicated and cache-only reads off the network.
  Fence affected cache rereads against newer published results too; reconcile
  pending edits against the persisted server snapshot instead of replaying an older one.
- Mobile dock customization shares the navigation island’s measured capacity; persist ordering per user with `mobile-dock-order.ts`, preserve gated destinations, and keep Search and More fixed. Reorder handles drag without a hold delay; the rest of each row scrolls.
- Share sidebar and mobile dock unread presence through `components/app/use-navigation-unread.ts`; keep badges reactive to read/done changes, guard all query data with `queryReadyGate` so pending preferences or paused queries cannot suspend the shell, and avoid fetching extra pages for counts.
- Show notification unread dots on favorite rows in Chat, Tasks, Drive, and Reviews; reuse Chat's channel activity and the existing Soup entity hydration plus `getEntityNotifications` elsewhere, without a separate notification query or refresh registry. Never paginate favorites or the global notification feed just for dots.
- Name Home thread rows from their latest scoped notification, including document mentions and reactions; use the thread author only when no notification exists. Document rows whose newest outstanding notification is a comment, and calendar event rows whose newest is a join request, say who did it (`row-notification.ts`).
- Use `ChannelTitleIcon` for conversation breadcrumbs so DMs retain participant or agent avatars and named channels retain their pictures; suppress avatar actions inside breadcrumb buttons.
- Normalize thread-only conversation URLs in `channelsSearch` before Home, Chat, or touch views derive their message target.
- Mobile dock search owns transient category/mode state in `features/command/mobile`; reuse the shared entity source and explicit full-text adapter rather than overlaying the dock query on view tabs or saved facets. See `docs/agent-guide/search.md` at the repository root.
- Include known Macro users in typed All/People name searches without requiring a DM or CRM contact; resolve a matching person against both recent DMs and DMs found by the current search while preserving name/email matching.
- Key mobile name-result history ordering and scroll anchors by the other participant for one-to-one DMs, preserving a person's position when their conversation is created; keep group DMs keyed by channel.
- Keep mobile Search history lightweight: save query/category/mode, account-scoped item anchors, and at most 200 ordering IDs per mode; never save row objects or virtualizer caches. Restore from current sources with at most three additional pages, fall back when an anchor disappears, and stop restoration on user interaction or scope changes. Dock navigation starts a fresh search session; cached rows belong to the source, not history.
- Release per-history-entry state when its router entry is replaced, pruned, or closed; retain only the latest per-view session snapshot and the latest split event outside reachable Back/Forward history.
- Cmd+K, mobile name search, and the desktop Search page find routines by name from the Quick Access `routine` bucket (the scheduled-action list); keep them out of `entityPool`, which Home, Drive, and Tasks searches share, and use `routinePool` for workspace Search only.
- Keep Quick Access cache availability reactive to the GraphQL rollout flag; it can arrive after the provider mounts, and email has no legacy source fallback.
- Browser storage schema 12 enables covering-index search through a fresh versioned cache; native upgrades reset incompatible caches, including queued writes. Preserve the historical unversioned tuple and existing old-queue cleanup safeguards; see `../../crates/client/README.md#streaming-text-search`.
- Contact backfill shares Soup's authenticated tab leadership and account/session ownership. Capture contact admission before each fetch, hydrate with `contactFence`, then verify cached IDs in 500-record keyset windows through the existing exact lookup. Checkpoint v2 completes only after verification; persist cursors after acknowledged writes and generation checks. Never delete from scan omissions or failed/foreign evidence, and never downgrade unsupported fencing. Keep the 15-minute coalescing floor and hourly name refresh. Deploy canonical-ID lookup fixes before client removal checks; see `../../docs/design/disk-backed-contacts.md`.
- Use bounded contact windows and separate exact selection lookup; copy primitive inputs/cursors out of reactive query data and keep history at `gcTime: 0`. Pass resolved `UserIcon.name` to avoid redundant shared-name lookups. `/app/debug/data`, Calendar search, Drive creators and CRM Notes creators exercise this on desktop/phone: `bunx playwright test --config src/lib/core/internal/browser-test/playwright.config.ts`. DM-ranked pickers still need before-limit ranking/exclusions.
- Cmd+K and mobile name search take task projects from the Quick Access `initiative` bucket (typed All queries and the Projects category), searched from the GraphQL cache like other entities. Don't give them a per-query server search: its rows drop out while each new query loads, so projects flash as you type.
- Merge the complete channel list into Quick Access even with the GraphQL cache enabled; preserve newer viewed timestamps and apply the channel boost before the extra DM boost in shared command/mobile name ranking.
- Include all channel metadata in Quick Access item versions; record complete, cached-recent, and merged channel counts plus the last index-build duration on cache-search traces.
- Virtualize mobile name results like desktop Command Menu; local Quick Access sources are unbounded, and mounting them all stalls iOS keyboard focus during layout. Load additional search pages near the scroll end instead of reserving a paging bar.
- Reconcile mobile full-text rows by entity ID so appending a page preserves DOM rows and scroll position; restore item anchors after responsive row measurement and disable browser scroll anchoring so layout changes cannot override restoration.
- Reserve the safe area plus the category row above mobile Search, and only the safe area above Channels; their hidden split headers must not add another blank strip.
- Follow [mobile layout and chrome](../../.agents/rules/web/mobile.md#layout-and-chrome) for full-frame views and record tabs; verify their first controls below the navigation with a nonzero safe area on phones and tablets.
- Keep split chrome portal targets reactive so cached views can mount before their header, and clear a retiring header's targets only while it still owns them.
- Opt views into session restoration with `split-layout/view-restoration` and set `resume: true` on ordinary layout navigation; publish captured state only through the leave guard's `onCommit`, keep explicit links and new splits fresh, and reuse entry-state captors rather than hidden mounted views.
- Let `ViewShell.TopBar` own split close and navigation controls; do not add a second split close button inside Agents headers or their preview `headerLeading`.
- Desktop tabs (`components/app/tab-layout`, macOS + `enable-desktop-tabs`) hold one split layout per tab. Switching parks the active tab's panes (`router.openLayout`/`showLayout`) instead of removing them; the split manager keeps parked splits and `SplitLayout` renders one layer per tab, hiding background layers with `content-visibility` and `inert` without unmounting them. Up to `MAX_PARKED_TABS` stay mounted. The strip renders in the title bar's center slot. Cmd+click becomes a background tab through `openInNewTabMiddleware`, so tab operations must disarm the intent tracker before navigating. Tabs are not draggable. See the tabs section of `docs/agent-guide/navigation.md` at the repository root.
- Show only the Recent conversation feed in mobile Channels, without view tabs or a persisted mobile tab selection; render its rows with Home's touch row (`ChannelCardLayout` and `InboxDivider`) and pin at most six channel favorites above it.
- Mount the mobile search input before focusing it inside the dock tap; keep navigation in that handler so focus does not trigger a second navigation or lose iOS keyboard activation.
- Preserve focused chrome editors during deferred split insertion/removal/content-change autofocus; explicit return-focus commands may still focus the pane. On desktop, content changes claim focus only for Cmd+K navigation or create-menu arrivals, and only if the destination has not already focused a child. Back/forward and ordinary clicks do not autofocus content, except that a click, Enter or Cmd+K that opens a conversation focuses its composer (see [composer focus and Esc](../../docs/agent-guide/channels.md#composer-focus-and-esc)).
- Reconcile global focus when focused DOM subtrees are removed; iOS can omit blur events, otherwise floating creation actions stay hidden after search or editor teardown.
- Mount the floating mobile AI composer only on the Agents view; other views keep their New action or their own reply/comment composer.
- Keep desktop New actions on `ViewCreateButton`: full width below the inner
  sidebar title and compact in list controls; retain each view's creation
  workflow and mobile controls. Use `ListHeader` for the single-row Email, Drive,
  Tasks, and Projects headers: title, filters, view options, New, expandable Search.
  Render project collection titles with `ViewSidebar.Title caret={false}`; keep
  individual project names and touch pickers unchanged. Put sidebar search in
  `ViewSidebar.Header` so its icon precedes collapse and its field opens above New.
- Keep desktop headers on the shared `ListHeader` / `HeaderActionGroup` pattern: view `Tabs` as pills after the title, `sm`/`icon-sm` semantic islands (28px controls) with 8px gaps on the right, fully rounded frames, New then expandable Search; retain `md` sizing for Tabs, New, and Search. Drive and Tasks list-header filter, layout, sort, and grouping islands use `md`/`icon-md` (32px) to match New and Search. Preserve touch layouts. Compose ButtonGroup actions with explicit `ButtonGroup.Button` segments; use `variant="secondary" finish="raised"` on action frames. Standalone Buttons do not inherit group styling. Pick each control by role from the [design system rule](../../.agents/rules/web/design-system.md); see [UI conventions](../../docs/agent-guide/ui-conventions.md#top-bars). Never use recessed/inset backgrounds in headers.
- Keep desktop model and effort controls separate: the model selector opens the catalog and the speedometer opens the runtime's advertised slider stops; retain the mobile effort sheet.
- Passive PR mentions must not retry initial GitHub status failures on remount; preserve confirmed status through refetch errors and keep pending data reads out of their parent Suspense boundary.
- PR description and comment images are remote URL images: rewrite GitHub blob/`raw` links to `raw.githubusercontent.com` and load them through the image proxy so COEP does not block github.com. Load Macro's own static-file URLs and public Klipy GIFs directly with anonymous CORS, including in the image viewer. The proxy authenticates by session cookie, so a proxied `<img>` uses `crossorigin="use-credentials"` and a fetch of it `credentials: 'include'` (`isImageProxyUrl`); `anonymous` drops the cookie cross-origin and the proxy answers 401.
- Download selected GIFs without re-encoding through the shared abortable static-file uploader, and insert an `sfs` image only after success; preserve the caret, discard failed or unaccepted uploads, reject stale completions, and keep failure retry in the picker. Give explicit GIF picker opens precedence over formatting and link menus, and anchor to the editor when the browser selection is missing or has no rendered geometry.
- Keep native booking exit navigation in the route shell, outside page loading boundaries, and use the router so the native hash route stays intact.
- Diagnose native full reloads with `native_webview_started`, `native_diagnostic_recovered`, and the shared `frontend_instance_id`; use `reloadApp(reason)` for frontend reloads and keep breadcrumbs content-free. Treat `previous_document_*` checkpoints as last-observed lifecycle evidence, never a crash verdict; clear them on logout. `previous_document_last_*` comes from the native navigation breadcrumb (route and entity type, never ids). See [frontend checkpoints](docs/native-reload-diagnostics.md) and `tauri/src-tauri/README.md`.
- Pass `$APPLOCALDATA` (Application Support on Apple platforms) as the native HTTP cookie storage directory; the plugin owns the `.cookies` filename. Never use purgeable caches. The location change intentionally requires one new sign-in, without migration. See `tauri/src-tauri/README.md#native-authentication-cookies`.
- Store iOS OTA bundles and markers in `Application Support/<bundle-identifier>/bundle-updates`, excluded from backup; ignore legacy cache contents rather than migrating them. Other platforms keep the updater's existing cache location. See `tauri/src-tauri/README.md#ota-bundle-storage`.
- Inline agent steps reuse the session code-execution query for live SDK operation
  names; completed step snapshots come from the shared fold of the tool receipt.
  Session `ExecuteCode` activity uses the same Calling N tools peek window as
  ordinary consecutive tool calls.
- Compose multiselect filters with `Dropdown.MultiSelectItem` and the shared
  searchable filters; follow [multiselect dropdowns](../../docs/agent-guide/ui-conventions.md#multiselect-dropdowns)
  for checkbox, row, Only, keyboard, and touch behavior.
- Keep added external chats (WhatsApp today) in External at `/external/chat/:chatId` with their own queries (`features/external-chat`); sharing controls viewing and the viewer's own provider membership controls sending. Never route them through channel context or services.
- All API/network calls live in service-clients.
- Preview Home project rows with the shared `ProjectDetail`; preserve its project
  search namespace, comment target, and Home breadcrumb. Touch and explicit split
  activation use the full project route. Open other projects through `openProject` (`features/projects/open-project.ts`): it
  retargets an already-open project split to the section or comment in place.
  Shared open paths (unified list rows) use its `projectHostedContent`, whose
  identity is the project itself, so the router focuses the split already
  showing it. Opening the legacy `initiative-view` component route beside an
  open project mounts a redirect shim that stays on "Loading project".
- A hosted detail pane (a project under Tasks, a call, a PR) registers as its
  host shell, so the split manager's entity reuse cannot see it; the router's
  claims decide who shows it. `openWithSplit` activates the source split before
  a replace, so a visit the router yields to the claiming pane leaves that pane
  active (`tests/claimed-replace.test.ts`).
- Bound Discussion comment readiness waits to ten seconds; recover from initial layout interruptions until the message is visible, and release the target on user input (including scrollbar pointer-down), timeout, or successful arrival.
- Keep early DOCX opens loading while exports return processing (409); retry only
  that response, with a bounded wait. See the Word editor walkthrough in
  `docs/agent-guide/documents.md` at the repository root.
- Add Google Meet account hints only to join actions using the displayed calendar's
  connected email; keep stored and copied conference links unchanged. See the
  [calendar walkthrough](../../docs/agent-guide/calendar.md).
- Share row-open reads through `features/notifications/mark-row-seen.ts` for
  documents/tasks, legacy chats, email, calendar, agents, CRM, PRs, calls, and
  projects; use it for previews, keyboard following, action advance, and split
  opens. Keep email mailbox writes in `queries/email/read-state.ts` with the
  owning inbox, and keep channel/external-message visibility policies separate.
  Ready document/chat/PR/email details mark read on mount for direct links.
  Calendar grid selections and links mark the canonical event, excluding team projections.
- Target modern projects as `initiative` / `INITIATIVE` for entity-wide
  notification writes; reserve `project` / `PROJECT` for legacy Drive folders.
- Route explicit meeting-page exits using the server's `callEnded` result: ended
  calls open their record; ongoing channel and scheduled calls return to the
  channel and Calendar. Leaving from a channel's Call tab stays in the channel. Preserve the session ID and send the server leave before media
  teardown; once the last participant drops, the server ends the call first.
- Keep active phone calls viewport-filling with visible header islands and idle
  controls below the video; Back dismisses without leaving, while setup and
  tablet/desktop chrome stay unchanged.
  See [Calls](../../docs/agent-guide/calls.md).
- Diagnose browser call media with `call.media.*` spans and the `meeting.setup.id`
  on `meeting.join`; keep provider messages, device labels/IDs, and call-link
  tokens out of telemetry. See [call diagnostics](../../docs/agent-guide/calls.md#browser-call-diagnostics).
- Diagnose the GraphQL mutation queue with `graphql.mutation_queue.*` spans and logs keyed by `mutation_queue.item_id`; route queue telemetry through `mutation-queue-telemetry.ts`, which dedupes per item and failure class and turns repeats into the periodic summary. Never add per-attempt `console.*` lines or record variables, draft content, or emails.
- Keep desktop OAuth consent in the system browser with a `macro://` return:
  `macro:///inbox-link-callback` for Gmail and Outlook inboxes,
  `macro:///github-link-callback` for GitHub (consumed by the navigation
  bridge without changing the route). Webview origins are not desktop
  callbacks. Settings → Integrations refetches connection status on window
  `focus`, because returning from the browser does not change page visibility.
- Keep send reservations, leases, and cancellation in the email journal; the general GraphQL queue handles draft autosaves only.
- Always persist composer sends in account-scoped IndexedDB and dispatch through the fetch-only email client, without a feature flag; cache health and unrelated mutation queues must not gate delivery. See `docs/architecture/email.md` for state and rollout invariants.
- Retry cache bootstrap on reconnect/foreground or draft Retry only when storage was proven untouched; retain the same scope and block draft sync until the replacement queue is readable.
- Touch email replies and forwards use the full-screen composer with the shared new-email header actions; preserve thread state underneath and flush local edits before closing.
- Include unsynced email working copies in Drafts and mobile name search even
  before a GraphQL save, and warm sending accounts alongside backfill. Preserve
  inbox, alias, and facet scope.
- Draft autosaves preserve active email thread messages; evict inactive legacy
  caches on save and the active cache on thread exit. Revalidate GraphQL thread
  pages only when a save cannot patch the message list (missing snapshot or a
  move between inboxes).
- Keep email card resize motion on its content wrapper so message and inline
  reply transitions preserve the card's focus target and return to natural height.
- Task composer submissions retain an account/context-scoped local copy until
  the create response confirms success; never clear newer composer input from a
  late callback or automatically retry an uncertain create. Keep recovery copies
  through restarts and remove them on explicit logout. See the Tasks walkthrough.
- Prefill task Source through the originating action's composer preset under
  `enable-task-source-property`; keep the shared composer flag-agnostic and retain
  exact message IDs through property edits. See the Tasks walkthrough.
- Shared server-state queries and mutations live in `src/lib/queries`; keep
  feature-specific query orchestration with its owning feature.
- Keep CRM contacts explicitly included in the auxiliary GraphQL backfill;
  bump its checkpoint version when changing the hydration input contract.
- Refresh the channel list's bounded unread edge when opening a conversation,
  including an empty unread result after a read on another device. Include
  off-page favorites in unread presence without adding them to section counts.
- Decide channel detail access from completed server results; bound confirmations of contradictory cache membership, preserve known unavailable state during retries, and keep unavailable routes registered for notification/reconnect refresh.
- Read folders for picking or moving through `createFolderList`
  (`queries/storage/folder-list`): it matches the Drive sidebar's source, so a
  folder open in Drive, including a team folder, is always in the list. Keep
  move rules in `folder-destinations.ts` so the picker and drop targets agree.
  Create one `createFolderDropTargets` per surface, not per row, so a long
  folder tree shares its folder list and mutation. Rows learn what a drag
  carries from `EntityDragSelectionContext`,
  which `SoupEntityContextMenu` provides; see
  [dragging rows into a folder](../../docs/agent-guide/navigation.md#dragging-rows-into-a-folder).
- Keep channel rail and title menus on `CHANNEL_ACTION_VIEW_CONTEXT`, including
  the shared desktop `Open in new split` action and its mobile/capacity guards.
  Rail splits open at latest before notifications load; only rows that stand
  for a notification (Home, Inbox) wait for it to choose a target.
- Gate the Chat redesign with `enable-chat-sidebar-sections`; wait for its result, restore the tabbed rail when off, and keep mobile unchanged.
  Keep the original rail renderer and label dialogs in `components/rail/`; build the redesigned rail and section dialogs in `components/rail/next/`, with shared controller, context, and row primitives outside `next/`.
  Default desktop Chat to Favorites, Direct messages, the team's channels, custom sections, then All channels; preserve personal section reordering. Keep every joined public/private channel in All channels regardless of custom-section assignments.
  Keep resize and reorder grips keyboard-accessible; reveal bare reorder grips only on header hover or keyboard focus, keep them fixed in the left gutter without shifting section names, and include them within the drag highlight. Allow dragging from the whole heading while preserving normal collapse clicks and excluding action buttons. Preserve personal section heights/order, edge-scroll the sidebar while resizing and compensate resize drags for scrolling, disable stack scroll anchoring only during resizing, and route list navigation through the sectioned renderer's scroll handle. Scroll keyboard targets immediately without animation, keeping two rows of context on either side, clamped to the viewport.
  Cap section heights at measured list content and available pane space; keep each list independently scrollable, hide resize grips for two or fewer items, and default Favorites and DMs to four rows. Let All channels use the sidebar scroll area at full content height while last and not manually resized; cap it when another section follows without discarding its saved height. Use TanStack Virtual for the redesigned section stack, channel rows, and search results; snapshot its index-reconciled rows before keying by identity, and retain focused rows and drag sources.
  Mobile retains the recent feed. Keep New channel and New direct message on their separate existing creation flows, independent of the sidebar flag; size the sidebar's New dropdown to its trigger width.
  Use `--sidebar-gutter` for the outer section, DM, and search containers; shared headings and rows provide their own item padding.
  Indent section rows by 8px; style empty states like saved views with a padded, bordered surface and secondary actions, without the extra row indentation. Keep unsectioned search results unindented.
  Reuse shared collapsible section headers and their hidden-caret behavior without leading section icons; keep Shared beside the name before the caret, replacing its badge with a users icon below 256px of section width. Use short, separate tooltips for names and sharing; apply focus backgrounds across the full header row and omit trailing header padding.
  Space sections with the stack's 2px flex gap, not header padding; wrap each section's header and content in one drop surface, show blocked drops with a not-allowed cursor and borderless explanation, omit rejection overlays while section data is pending, and keep Gantt's shared drag auto-scroll and wheel scrolling available while dragging.
  Animate section reorder with the shared layout animation engine; preserve unanimated measurement wrappers, reduced-motion preferences, and cancellation on scrolling. Show a card preview and subdued source while dragging.
  Name the team-channel section after the current team, falling back to Team channels while its name is unavailable.
  Keep every joined team channel in the team section regardless of custom-section assignments; use the same complete membership for bulk notification actions.
  Keep available channel rows visible during section hydration and refetches; key virtualized rows by stable IDs so data updates cannot interrupt a click. Pass server-returned member IDs to `queries/channel/by-ids`, whose single Soup owner selects cached rows and fetches missing records. Keep entity-ID hydration generic in Soup, with channel identities, batching, and unread refreshes in the channel query layer; append per-section skeletons only while unresolved members load.
  Show lock icons for private conversations and visible per-section options; keep empty sections usable as drop targets without an all-sections management menu.
  Create all section types through New → New section in a wider dialog with Smart in the body and Shared in the footer; explain team visibility and team-only channels in hover/tap-accessible sharing help, show the warning-colored Team channels only hint only while sharing is on, keep collapse on the header and style deletion as destructive. Editing can change sharing only after complete membership eligibility checks; preserve section identity, confirm unsharing, and reconcile both scope caches after success.
  Offer Add channels on manual-section headers and empty states; keep the picker scoped to eligible joined channels, explain scope and assignment moves in concise helper text, and leave smart membership rule-driven.
  Place the smart rule Input below Name contains; show a match count with hover/focus channel preview, and keep preview queries reactive to the selected scope without briefly reporting pending matches as empty.
  Keep per-section sorting and unread filters personal, and filter after membership assignment so hidden rows never leak into another section.
  Default Favorites to Custom order and persist drag reordering through the shared favorites mutation; preserve hidden and non-channel favorite positions, disable dragging under automatic sorts, show an insertion line at the actual destination edge, and keep the original rail unchanged. Retain pointer hit-testing coordinates until the drag sensor finishes so intervening scroll updates cannot discard a valid drop.
  Share the sliders-icon section menu's Sort, Filter, and actions with a header context menu; use trailing `SingleSelectCheck` marks for sorting, keep the Unread only label left and its switch right, and keep the filter submenu open when toggled.
  Compose the section click and right-click menus with `ContextMenuContent`, `MenuItem`, `MenuGroup`, and `MenuSeparator`; do not nest padded `Dropdown.Group` elements inside a context-menu surface.
  Keep all section mute, unmute, and snooze actions personal to the viewer; use the complete current membership, not filtered or hydrated rows, and never apply the change to later additions. Resolve built-in membership through the complete channel list, including custom-section assignments and preserving participant checks; Favorites targets channel favorites only. Use the bulk item-preference endpoints and shared snooze picker, applying confirmed changes to the cache once and preserving successful chunks on partial failure.
  Use checkbox items in Add to section to toggle membership within each scope without changing the other scope.
  Carry team IDs into channel entities and require a matching team for new shared-section assignments; preserve server-authorized membership display while metadata hydrates.
- Route supported move, trash, restore, permanent-delete, duplicate, and share-policy
  writes through `queries/storage/entity-mutations` when GraphQL Soup is enabled;
  never retry failed GraphQL writes through REST. Preserve non-owner history removal
  and version-specific markdown forks on their existing paths. Confirmed restores
  clear earlier deletion markers without clearing a newer delete's intent; key markers and restore confirmations by normalized entity type plus ID, never by bare ID.
- Preserve loaded block content on initial access confirmation when its loader
  supplies no permissions; reload only on a later confirmed permission change.
  Apply shared access in place only after a successful permissionless load.
- Grouped Soup's `graphql/create-grouped-soup-live-query.ts` owns initial and
  continuation pages plus their local predicate projection. Group readers only
  delegate paging; pass the parent's live `groupedPaging` accessor from every
  caller, including Tasks and project-task lists. Do not introduce independent
  continuation owners. Rebuild refreshed continuation chains before replacing
  loaded rows; retain them on refresh failure and discard them on scope changes.
  Keep server
  membership snapshots separate from normalized field/link updates; restored
  properties do not prove prior membership. Supply complete prior multi-value
  memberships when adjusting counts: a row loaded in one bin may already be an
  unloaded member of another.
- Reconcile authoritative Mail first pages in the shared Soup projection adapter,
  not a UI exclusion list: invalidate contradicted facts within the supported
  page range without deleting normalized threads or treating backfill gaps as
  deletions. The OPFS revisit/reload regression is
  `bunx playwright test --config src/lib/graphql-cache/worker/browser-test/playwright.config.ts mail-reconciliation --project chromium`.
  For transient row flicker, run
  `bunx playwright test --config src/lib/queries/soup/graphql/browser-test/playwright.config.ts`:
  it uses the real Soup source and exchange, holds local/network completion,
  and asserts every observed row-ID state on revisits and an OPFS reload.
  It also verifies that cold empty Mail tabs stay loading until HTTP settles.
  It also runs in `just test-cache-wasm-browser`.
- Trace initial Soup loading through pending flow phases; aggregate incremental
  cache activity in `cache-activity-telemetry.ts`. Never start a root span per
  cache revision or choose a root by comparing no-op span identity.
- Reactive GraphQL reads use `createLiveQuery` for a document and
  `useSoupAstItemsQuery` (backed by `createSoupLiveQuery`) for Soup lists; see
  [choosing a reactive read](docs/graphql-normalized-cache-plan.md#choosing-a-reactive-read).
- Reconcile cached Mail pages with same-query server membership; missing local
  previews are unknown, not proof that a fetched email left the inbox. Keep
  local pagination cursors independent of retained server rows. Preserve live
  flags alongside fallback previews; retained rows and legacy hosts still need
  mutation revalidation. Merge continuation pages through the indexed cursor.
  Never restore explicitly invalidated membership from an older view's snapshot.
- Render user-visible text in new UI, and every menu and navigation label,
  with `t()` from `@app/lib/i18n`, adding only the English to
  `src/lib/i18n/locales/en/`. The periodic `update-translations` skill fills
  in the other languages. See the [i18n rule](../../.agents/rules/web/i18n.md).
  The resolved interface language is reported to PostHog as the person
  property `interface_language` when the account language loads.
- When adding or changing a feature flag, follow the `feature-flags` skill.
- Gate routine template actions, pages, dialogs, and message cards on `enable-routine-sharing`; keep ordinary routines usable while it is off.
- When adding or changing a view's feature tour, follow the `add-tour` skill.
- Keep Tasks date ranges on view-owned date-bucket boundaries in `features/tasks-view/core/task-due-date.ts`; send `sort_method=property` with the selected definition and direction, use keyed `date_ranges` grouping, and restart pages when midnight/timezone/resume changes the query key; preserve text-search ordering.
- Render Tasks due dates in an editable list-property column with a calendar icon for set dates and a slashed calendar for no due date; show only the icon on phones and narrow panes, preserve urgency colors for set dates, keep the current date visible in its dropdown, and limit warning urgency to today and tomorrow.
- Revalidate Soup queries whose selected sort/group property or date predicate matches an edited definition; compute loaded date-group movement in TypeScript, then refetch authoritative counts and unloaded rows. Keep property sorts and date filters out of the timestamp-only WASM projection.
- Keep REST grouped Soup item pools and `itemIds` keyed by raw entity IDs, matching Tasks readers and the normalized cache.

- Memory tool results use expandable rows on desktop and mobile; explicit preferences and activity reports remain inspectable after each tool call.

## Rules

- Channel Delete actions use the channel owner or admin/owner of the channel's
  exact team (`channelType === 'team'`); pass the channel's `teamId` to the team
  admin predicate. Keep rail/title menus, mobile long-press, and hotkeys on the
  shared delete action and bulk mutation. Preserve confirmed deletions when
  another item in the bulk deletion fails.

- Pass persistent touch row controls through `ListEntity.touchActions`; hover actions are hidden on touch, and the narrow inbox layout must retain the touch controls.

Conventions for this app live in `.agents/rules/web/` and load when you touch
matching files: data fetching, Solid reactivity, architecture, UI, UI primitives,
the startup bundle, Lexical nodes, and translated menu labels.

### Good Reference
- https://github.com/solidjs-community/solid-primitives
- https://github.com/kobaltedev/kobalte
- `src/features/entity`
- `src/features/channel`
- `src/features/block-md`
- `src/features/next-soup`

### Bad Examples
- `src/features/block-channel`
- `src/features/block-pdf`

## PDF markup

Keep the signature canvas backing bitmap aligned with its CSS size and device
pixel ratio; keep dialog centering separate from animated transforms. Verify the
[signature walkthrough](../../docs/agent-guide/documents.md#pdf-signatures) after
changing this editor.

## Notes
- Don't shy away from pulling good examples into context. In the case of solid-primtiives/kobalte try reading documentation, or just temp clone into /tmp to reference

## iOS release signing

Follow [`docs/ios-releases.md`](docs/ios-releases.md) for App Store signing and
provisioning, including both extensions. The release script temporarily selects
manual export when a distribution certificate path is supplied.

## Native notification navigation

Android incoming calls use an opaque full-screen call screen, with the standard
Calls notification as the fallback when full-screen access is unavailable.
Keep notification Answer intents pointed directly at the call activity and scoped
to the offered call; active calls retain the drawer and PiP controls. See
`docs/development/android.md#native-calling` at the repository root.
Native call tracing retains the browser telemetry gate and exporter for cold
calls; propagate W3C context through push payloads, notification intents and
ring-status requests, and keep caller names, tokens and URLs out of spans.

Read iOS's durable pending tap before mounting the router, then choose its
destination only after the authenticated account matches `recipientId`. Keep
the native receipt pending until the destination route is applied; release the
resume cover for auth/retry UI without consuming the receipt. Use the existing
pending-notification intent for bootstrap and live taps so newer taps supersede
older work. Older native builds and pushes retain authenticated notification
lookup. The local bridge and native release requirement are documented in
[`docs/ios-releases.md`](docs/ios-releases.md).

Cold channel push launches retain Home behind the target channel so the mobile
header Back control and swipe-back have a destination. Keep this launch layout
in `notificationLaunchPath`; warm taps retain their current pane stack.

Bound the pre-router bridge handoff to 1.5 seconds and release the native cover
on failure or timeout without consuming the pending tap. Late responses must
use normal account-checked navigation, never reset the mounted router's hash.
`notification.launch` records whether startup continued ready, failed, or timed out.

Bound the native cover to eight seconds for each received durable tap, including
warm resumes and stalled route acknowledgments. Release without consuming the
intent on timeout; duplicate delivery must not extend the deadline, and a newer
tap gets its own deadline. Convert fallible notification lookups and navigation
promises into error results so failure cleanup acknowledges the tap and shows
the existing error toast. Keep the startup cover fallback in the same owner,
and let it defer to a pending tap's deadline. The deadline requires responsive
JavaScript and IPC; it cannot recover a frozen WebContent process.

The frontend cover deadline has a backend-free phone browser regression:
`bunx playwright test --config src/lib/tauri/browser-test/playwright.config.ts`.
It uses the real navigation intent and push API with simulated native IPC;
UIKit presentation still requires an iOS device or simulator.

Generate APNs validators with `scripts/generate-api-schema.ts`; its compact
`generated/push.ts` entry avoids importing every notification-service schema
on the startup path. Carry known channel root IDs in push navigation (a null
`threadId` means the message itself is the root), prefetch the target window
alongside channel metadata, and keep the shared Macro loading indicator visible
until that target can be positioned.

## macOS notification activation

Carry the notification ID through native delivery and the buffered `navigate`
bridge, so clicks survive app restarts and wait for the split layout to be ready.
Install and retain the UserNotifications delegate before the native event loop
starts. Clicking restores and focuses the main window; receipt and dismissal do
not navigate. Preserve iOS and Android `createPushApi` tap navigation when changing
desktop delivery, including buffered launch taps before device registration.
Send the sender and conversation as their own fields so macOS can show a
communication notification (avatar, sender, conversation); keep new native
arguments optional for OTA compatibility. Releases need the Developer ID
provisioning profile for the communication entitlement; see
`tauri/src-tauri/README.md`. This requires a native macOS release; see the
[notification walkthrough](../../docs/agent-guide/notifications.md).

## Desktop page zoom

The desktop app binds `Ctrl/Cmd` with `+`, `-`, and `0` itself in
`src/lib/tauri/zoom.ts`; nothing underneath provides them. Wry's
`zoomHotkeysEnabled` is Windows-only and Tauri's default menu has no zoom items.
The hotkeys call the webview's `setZoom`, which needs
`core:webview:allow-set-webview-zoom` in `tauri/src-tauri/capabilities/desktop.json`,
so a build without that permission fails the call at runtime. That permission
lives in a `desktop`-named capability rather than `default.json` because the iOS
and Android native gates hash every file under `tauri/` whose path doesn't name a
platform: editing `default.json` would demand a store release for a command that
only exists on desktop. The saved factor is
re-applied on launch because the webview always starts at 100%. `RootFrame`, not
`GlobalHotkeys`, registers them, so zoom also works on pages without app chrome.

## Desktop file drops

Keep `app.windows[].dragDropEnabled` false in `tauri/src-tauri/tauri.macos.conf.json`.
Markdown editors and attachment inputs use browser events through `fileFolderDrop`
and `fileDrop`; Tauri's native handler intercepts Finder drops before those handlers
receive them. This config change requires a rebuilt macOS app; a frontend bundle
update alone does not apply it.

Tauri replaces arrays when merging platform configuration. Keep the other macOS
window settings aligned with `tauri/src-tauri/tauri.conf.json` when changing the
shared window. Verify with the [Finder-drop walkthrough](../../docs/agent-guide/documents.md#desktop-file-drops).

## Subscription offers

Use `useTrialEligibilityQuery` for trial copy and checkout terms in Billing,
paywall, and onboarding. Never infer first-subscription eligibility from Free
access or legacy `hasTrialed`; show trial copy only for confirmed eligibility,
and keep Pro checkout disabled while eligibility is unknown. Refresh the offer
on focus/reconnect; route existing subscriptions to billing management. Keep
known management access through refetch failures, but hide unconfirmed trials.
Reset rejected checkout offers before refetching eligibility.

## Native commands

Over-the-air bundles reach native apps older than the commands they call.
`native-commands.json` lists every Tauri command the web code invokes directly,
through a wrapper such as the cache host's `request`, or by `addPluginListener`.
`src/lib/tauri/native-commands.test.ts` reads the calls with the TypeScript
parser and fails when one is missing from that list, is not registered by the
app (`generate_handler!` or an in-repo plugin's `build.rs`), or names its
command with a value it cannot read: use a string literal, a constant, or a
parameter typed as a union of literals. Commands that published plugins' own
JavaScript packages call are not covered. Before adding a command to the list,
raise `min-native-build.json` to the first build with it, or handle
`Command … not found` in the caller (see the src-tauri README).

## Desktop release builds: generated WASM

Keep `nix/tauri-desktop.nix` in sync with generated WASM dependencies: desktop
releases run Vite directly and do not call `just build-tauri` or `build-wasm`.
A new `build-*-wasm` package under `src/lib/core/` gets an entry in
`coreWasmPackages`, which builds its JavaScript glue and WASM before Vite runs
and checks that both appear in the output. Without them, Vite leaves the
loader's relative imports unchanged and Tauri serves HTML for the missing
module, so that file type fails to open on desktop.

## macOS desktop runtime: Chromium (CEF)
`tauri/desktop-cef` builds the shipped macOS app with Chromium in its own Cargo
workspace. The macOS release DMG builds this workspace; iOS, Android, Linux,
and Windows still build `tauri/src-tauri` on the system webview. See
`tauri/desktop-cef/AGENTS.md` before changing Tauri
dependencies or the app's served origin.

## iOS gotcha: Web Workers must be lazy
On iOS WKWebView, eagerly constructing an ES module Web Worker (`new Worker(url, { type: 'module' })`) whose script is served via the `tauri://` custom URL scheme **deadlocks the WebContent process**. The worker thread parks in WebKit's sync module loader waiting for an IPC response that never wakes it; JS execution silently stops after that point.

Vite serves all workers as ES modules in dev mode regardless of `worker.format` config (that setting only applies to `vite build`), so you can't fix this at the bundler level for dev.

**Rule:** never call `new Worker(...)` (directly or via `?worker` import) at module-load time in code that runs on iOS. Worker construction must happen on first use. For singletons backed by a worker, use a lazy proxy:
```ts
export const svc = new Proxy({} as Service, {
  get: (_, p, r) => Reflect.get(Service.getInstance(), p, r),
});
```
The `import Worker from './w?worker'` import itself is harmless — only `new Worker()` triggers the deadlock.

**Symptom signature:** app loads HTML and runs initial JS, then JS silently stops. Safari Web Inspector attaches but shows nothing.

**How to diagnose this class of freeze:**

1. **Reproduce on the iOS Simulator, not a physical device.** `cargo tauri ios dev "iPhone 15"` (replace with whatever sim you have booted). The Simulator's logs flow through your Mac's unified logging, so you can stream them with `log stream` instead of fighting `idevicesyslog` / Apple's developer-tunnel requirements.

2. **Stream the app's logs in one terminal:**
   ```sh
   /usr/bin/log stream --predicate 'process == "macro"' --info --debug --style compact
   ```
   Use the full `/usr/bin/log` path — zsh shadows `log` as a builtin and silently misroutes the call. Leave this running across rebuilds; the filter is by process name so it survives app relaunches.

3. **Find the last meaningful event before silence.** Tail the log file and skip the noise:
   ```sh
   tail -200 <logfile> | grep -vE 'tauri:// request|tauri_protocol.rs|^\s*\\134'
   ```
   If you've added a `tracing::info!` to log every `tauri://` request in the protocol handler, look for the **last** such request — that's the file the WebView was loading when it froze.

4. **Confirm the WebContent process isn't spinning.** Get its PID from any `[com.apple.WebKit:...] [...PID=N...]` line in the logs, then:
   ```sh
   ps -o pid,pcpu,comm -p <pid>
   ```
   `0.0%` CPU + still-alive process = parked, not infinite-looping. That distinguishes a deadlock (waiting on IPC/lock) from a hot loop (something busy).

5. **Sample the WebContent process to see where threads are stuck:**
   ```sh
   sample <webcontent_pid> 3 -file /tmp/sample.txt
   ```
   Then look for threads named `WebCore: Worker`. If their stacks show:
   ```
   WorkerOrWorkletScriptController::loadModuleSynchronously
     → WorkerDedicatedRunLoop::runInMode
       → Condition::waitUntilUnchecked  ← parked here
   ```
   that's the worker module-load deadlock. The main thread will typically be in `mach_msg2_trap` (idle in run loop) with some `IPC::Connection::enqueueIncomingMessage` → `LockAlgorithm::lockSlow` showing lock contention.

6. **Cross-reference the last URL request with the stuck thread.** If the last `tauri://` request was `*-worker.js?worker_file&type=module` and a worker thread is in `loadModuleSynchronously`, you've confirmed which worker is the culprit. Then trace back to where it was constructed (`new Worker(...)` or a `?worker` default export being instantiated) and make that lazy.

Don't get distracted by red herrings the logs will show: `NSKeyedArchiver` main-thread fault, IPC throttling warnings ("N pending incoming messages"), the bundle updater's failed `localhost:3001` request — all are downstream symptoms or unrelated noise.

## iOS gotcha: a device tap fires `mousedown` even after `pointerdown.preventDefault()`
On a physical iPhone, WKWebView still synthesises the compatibility `mousedown`/`mouseup` for a tap whose `pointerdown` was cancelled. The spec, Chrome, and the iOS Simulator all drop those events, so the difference only shows on real hardware. The synthetic `mousedown`'s default moves focus to the tapped element's nearest focusable ancestor — a `<button>` is not mouse-focusable on iOS, so focus lands on whatever container carries a `tabindex`, e.g. the block element a popup is portaled into. A focused contenteditable then fires `focusout`, the software keyboard hides, and anything keyed off editor focus (the md selection popup) closes. The DOM selection survives the blur, so actions that read it (Copy) keep working and mask the bug.

**Rule:** UI that overlays an editor and must not steal its focus (toolbars, popups, paging chevrons) cancels both `pointerdown` and `mousedown`, on the container root rather than per button so dividers and gaps are covered too. See `keepEditorFocus` in `src/features/block-md/component/TouchSelectionToolbar.tsx`.

**Symptom signature:** works in Chrome mobile emulation and in the iOS Simulator, fails every time on a physical iPhone regardless of tap accuracy; the keyboard dismisses on the tap.

**How to diagnose this class of bug:**

1. **Don't reason from finger precision.** A deterministic device-only failure is an event-model difference (compat mouse events, software keyboard), not a near miss.

2. **Add a temporary window-level event trace.** Log `touchstart`, `touchend`, `pointerdown`, `pointerup`, `mousedown`, `mouseup`, `click`, `focusin`, `focusout` and `selectionchange` with `event.target`, `event.defaultPrevented`, `event.relatedTarget` and `document.activeElement`. Register on `window` in the bubble phase so app handlers have already run and `defaultPrevented` is meaningful. Wrap the setter that closes the UI to log a short stack (`new Error().stack`). Prefix every line (e.g. `[md-popup]`) so it can be filtered.

3. **Run it on the device, not the Simulator**, with Safari Web Inspector attached (Develop → the iPhone → the Macro webview), filter the console by the prefix, reproduce, and read the order. A `mousedown` arriving after a `pointerdown` logged with `defaultPrevented: true`, followed by `focusout` whose `relatedTarget` is a container, is this bug.

4. **Strip the instrumentation before committing.**

### Agent session failure indicators

Use the existing status dot in Home and Agents rows with `bg-failure` when the
persisted `turnState` is `failed`; open the session to inspect its error.

### Agent transcript projection

Key transcript rows by the fold's `FoldedMessage.key` (`<turn>:<author kind>`);
never rebuild it from `turn` and `author`. Apply a load or rebase as one keyed
`reconcile(messages, { key: 'key' })`, without `merge`. A streamed message
reconciles the tail row in place or writes the next index; only an out-of-order
one takes the keyed path. Never `produce` the whole array per append; it makes
initial projection quadratic. Check with the
[session-open runner](src/features/block-agent/browser-test/README.md).

### Agent system events

Agent activity labels share `block-agent/ui/TextShimmer.tsx` and the global
`magic-chip-shimmer` style; keep Working and Thinking on the same sweep and phase.

Accept `notification` in both fetched and subscribed GraphQL session log rows.
System notifications live in fold metadata, separate from messages. Review
subjects refresh their existing card; other subjects render quiet timeline rows
through `block-agent/components/session-event-row.tsx`. Match typed event
payloads exhaustively, summarize outcomes without draft content, and keep the
icon, truncated summary, timestamp, and optional subject action on one line on
desktop and mobile.
Keep Responding bound to the notification turn, including rejection and noop.
Harness background-task reports are `task_notification` message parts, rendered
as `ActionLine` rows in the agent reply (`TaskNotificationPart`).
The backend-free desktop/mobile check is
`bunx playwright test --config src/features/block-agent/browser-test/playwright.config.ts`.
The same suite covers stopping and reloading an agent reply inside a mention:
keep incomplete trailing Macro XML hidden in settled agent prose, preserve
completed chips and literal tag examples in Markdown code, and leave user prompts
unchanged.
Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` when using the Nix Chrome binary.

Reuse the responsive import review for Notion, Linear and Jira; scope report
queries and cancellation to the saved draft source. Issue tracker handoffs
call the reviewed workspace tools, and show separate task/project totals.

### Agent backend hosting

Cognition, routines, preview control, and MCP share `agent_harness_service`.
Agent replies can use the existing `m-document-mention` format with
`blockName: "routine"`; the `@` menu offers routines only to their owner in
channel composers, where picking one shares it as a template.
Direct local hosts use port 8101 with the existing feature prefixes; the
instance proxy retains `/cognition`, `/scheduled-action`, and `/preview`.

## File downloads

Channel videos, linked video previews, and Drive video/image/code/canvas/unknown previews share
`createFileDownload` and `FileDownloadButton`. Keep menu and visible controls
bound to the same controller. Call recording menus and the list-row Download
(`makeDownloadAction`) use the same controller; the list action runs it under
its own root, because choosing a context-menu item disposes the menu's owner.
Download hands off directly to browser downloads
or the native save picker. Show channel Download on hover or keyboard focus,
always on touch, without a footer. Keep system Share inside the touch Download
menu; desktop Share belongs to Macro permissions. Do not add a custom
confirmation sheet. Snapshot file/version before loading, cancel on disposal or
selection change, and preserve original filenames from static-file metadata.
Native Android and iOS use bounded byte exports. Older iOS binaries use Web
Share until the optional file-export bridge ships. If browser activation expires
while preparing a share, retain the bytes and let the same action's next tap
open the system sheet synchronously. Browser success means handoff, not confirmed
disk completion. See the native bridge's `tauri/file_export_plugin/AGENTS.md`.
Keep download confirmations title-only and lightbox Download controls icon-only.
Keep the expanded video first in the dialog's tab order so initial Space presses
control native playback; restore focus to its opener on close.

The backend-free browser regression downloads real fixture bytes from channel
cards, the expanded viewer, and the shared Drive/standalone header on desktop,
phone, and tablet, and checks Space playback on opening and reopening the viewer:
`bunx playwright test --config src/lib/core/component/FileDownload/browser-test/playwright.config.ts`.
See the [download walkthrough](../../docs/agent-guide/files.md#downloading-files).

## Interface icons
- Task rows, property values, document mention pills, and @mention menu rows use `TaskStatusIcon` with the current status property; use the task subtype completion flag only when a recognized status is unavailable. Task lists edit status and priority through leading `TaskPropertyControl` icons before the title, not duplicate columns or trailing pills. Mention pills show status only in that leading icon, not again among the trailing task badges. Keep generic navigation and creation on the custom checked-square task icon, independent of task state.
- Read [the icon system rules](src/components/icon/system/README.md) before adding or changing interface icons. Reuse the original Macro SVG family via individual `@icon/system/...` imports; do not introduce another icon set.
- If a glyph is missing, author original SVG geometry on the 24-unit grid with round caps/joins, restrained detail, `currentColor`, and the documented theme-aware weight. Never trace or import proprietary symbol paths. Match active/bold variants and review 14/16/20/24 px in light and dark mode.
- Interface glyphs never animate on press or hover; do not add shared or per-button bounce, turn, or scale effects. Disclosure carets and loading spinners keep their state-driven motion. Preserve accessible control names.

### Creation choices and notifications

- Reuse `CreateMenuItem` for explanatory New menu entries (`CreateMenuRadioItem` when a create dialog picks a type in a `Dropdown.RadioGroup`): original icons, a title, and muted wrapping descriptions, preserving the existing `ViewCreateButton` trigger and each action's feature gates.
- Keep transient toasts in their bounded stack and persistent prompts/reminders in separate regions; preserve keyboard dismissal, full mobile descriptions, and remaining-time pause on hover/focus. Mobile toasts dismiss by swiping left or right and have no corner close button. Phone prompts stay in their own stack under the modal layer, never on `z-toast-region`, and never hide with a document-wide `:has()` (#8840).
- Notification sounds are off by default and saved per user per device; map each new notification event in `features/notification-sounds/core/categories.ts` and keep system alerts silent when Macro plays its own sound. Quiet hours on the same page silence those sounds and skip desktop alerts on a per-device weekly schedule; incoming calls still ring. See the [notification sounds walkthrough](../../docs/agent-guide/notifications.md#notification-sounds).

### Agent result task lists

Agent result task titles wrap above live metadata; nested horizontal groups
stack below 672px of container width. The backend-free browser regression is
`bunx playwright test --config src/features/dynamic-ui/browser-test/playwright.config.ts`.
It covers desktop and touch layouts, narrow containers inside a wide viewport,
unbroken titles, and keyboard opening.

### Inline property values

Inline property fields stay `readOnly`, never `disabled`, while they save: a
browser moves focus off a disabled field, so a failed save would strand it. Enter
and Escape return focus to the value through `Property.Root`; tabbing or clicking
away leaves focus where the user put it. The backend-free regression is
`bunx playwright test --config src/features/property/editors/inline/browser-test/playwright.config.ts`.

### Assignee people scope

Use only the current team roster and available agents for new Assignee selections.
Keep existing selected outsiders visible and removable, without contact discovery.
Reuse the existing selected-first ordering at opening and keep row positions
stable while selecting. Keep the generic roster hook in `src/lib/queries/team/members.ts`.
Preserve each picker’s existing placeholder, sizing, and row styling.
Preserve filter-only Me/Unassigned choices, company-owner scope, and unrelated
people/contact fields.
Keep the shared filter Assignee picker in `src/features/soup/assignee-picker.tsx`;
import it directly from Tasks and legacy `next-soup` consumers.

### Sidebar tag dragging

Email and Calls sidebar tags can be dragged onto taggable desktop list rows.
Keep existing tags and apply to the selected rows when the drop row is selected.
Use the shared scoped drag helpers and overlayIcon for the tag chip.
The backend-free browser regression is
`bunx playwright test --config src/features/property/tags/browser-test/playwright.config.ts`.

### Senders in email rows

Sender names in Mail rows and collapsed thread messages keep their person card
on hover; clicking the name or anywhere else on the row opens the email.
`HoverCard` keeps the portal's placeholder inside its own `display: contents`
wrapper: opening or closing the card otherwise changes the trigger's siblings,
Solid can then detach and reinsert the trigger, and a press that closes the
card loses its click. Cards opened from a row use `isolateClicks`, because
Solid delivers portaled events through the component tree and a click on the
card would also open the row. On touch, a collapsed message's picture lets the
tap through to the row. The backend-free desktop/phone regression, over rows
with two senders, is
`bunx playwright test --config src/features/entity/browser-test/playwright.config.ts`.

### Enter on a property pill

A document control owns Enter unless a press focused it, including one given
focus back when a mouse dismisses its picker. Tab reaches an editable pill
directly; its hover card keeps a stop only on read-only values. Real focus
heuristics decide this, so jsdom can't cover it. The backend-free browser
regression is
`bunx playwright test --config src/features/property/browser-test/playwright.config.ts`.

Use `features/channel/channel-icon.tsx` for conversation identity in rows,
favorites, and headers: channel pictures or hashtags, human/self-DM avatars,
and bot personas share one renderer; keep surface sizing in the caller.

- Advertise Mail v5 capsules only for the current browser engine or a verified supported installed native build; OTA bundle version alone cannot establish native capability.
- Bound native Mail capability discovery to 1.5 seconds and cache the legacy profile on failure or timeout so stalled IPC cannot block GraphQL transport; record the selected profile and bounded outcome in HTTP and WebSocket setup spans without error text.

### Inline comment drafts

Use `MessageLoadError` for compact discussion/thread failures; missing resources
show an unavailable state without a retry action or composer.

Keep collaborative drafts as cursor-based overlays outside the shared editor tree.
Flush pending text, catch up missing server history before publication, then
publish the mark from an isolated peer with `PeerCommentUpdate`,
and post the message only after acknowledgement. Refused operations never enter
the editor's WAL, so a session without edit access writes nothing to Loro, not
even state its editor derives; only editors remove a deleted comment's mark.
Preserve input on failure. Cancelled publications retry mark
cleanup from the user/document-scoped IndexedDB queue; preserve marks when a
message request's outcome is uncertain. Keep failed cleanup entries queued without
blocking later entries. Overlapping comments must retain each
saved range through cancel, save, and collaboration updates.
Comment controls preserve editor focus on both pointerdown and mousedown.
The backend-free browser regression is
`bunx playwright test --config src/features/block-md/comments/browser-test/playwright.config.ts`.
It exercises selection, press, cancel, retry, and repeated posting in editor and
commenter modes. The collaboration fixture includes concurrent remote edits,
rejected updates, and a server that refuses a commenter's non-comment updates; provider tests cover message metadata arriving on either side
of posting, multi-paragraph anchors, saved ranges, and cancellation during posting.

## Performance

### Tracing

- Instrument loading with the flow API in the `instrumentation` skill; read the
  traces with the [observability guide](../../docs/agent-guide/observability.md#web-performance-traces).
  Tracing observes readiness; never drive app behavior from trace callbacks.
- Keep document load, snapshot and editor phases under the routed view flow and
  pass its span explicitly to sync/AI clients; never store spans by document id
  or end caller-owned spans in collaboration code. Acquire agent sessions in the
  active view span.
- Put flows at the shared owner so every host inherits them: Soup status in
  `SoupViewListContent`; channel tabs in `ChannelTabProvider`, with each host's
  `channel.*.view` inside the panel's Suspense and the routed detail observing
  `detail.view().status` as `channel.detail`; form tabs and panels in
  `FormPageView` (keep its builder/layout session alive across tabs); form
  responding (`view.form-respond`, `form.submit`) keyed on form and preview
  mode; CRM detail in the shared company/contact views keyed by record and
  section; Command-K input through `beginInteraction` and a query-keyed results
  flow with debounce/source `usePending` phases, no manual per-input signals
  (the universal-input browser suite checks the exported traces).
- Cancel the form-submit measurement on teardown but let its in-flight save
  finish; late completion must not scroll or measure another view.
- Runtime resource samples and typing bursts use the `perf` class decision
  (`Telemetry.config.sampled('perf')`) and the shared UI-operation observer: no
  second observer, no per-key frame sampling, no listeners for unsampled users. Typing surfaces come from
  static `data-input-surface` categories on editor/field owners, never caller
  labels.
- Keep record names, addresses, answers and query text out of attributes.

### Entity rows

- Keep `ListEntity` layout fields independently reactive (getters, not a
  dynamic object spread); a spread makes a selection change revisit every
  unrelated layout input. Profile with the
  [entity collection fixture](src/features/entity/browser-test/README.md).
