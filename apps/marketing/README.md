# Standalone public website

This directory owns the Macro public website and its public signup introduction.
It shares the repository with the authenticated application, but has its own
package manifest, Vite entry points, TypeScript aliases, styles, assets, and UI
components. Application UI changes must not alter the website.

## Ownership and dependency boundary

- `src/features/marketing/`: homepage, feature demonstrations, navigation, and
  website interactions.
- `src/features/setup/`: public signup introduction and local preview selections.
  Account creation and authenticated onboarding continue in `/app`.
- `src/ui/`: frozen website versions of the small UI primitives used by demos.
- `src/app/`: public feature, pricing, legal, and blog pages retained from the
  original website. Despite the historical directory name, these are website
  files, not the authenticated application. The `@app/*` alias points here.
- `src/assets/`, `src/styles/`, and `public/`: website-owned illustrations, icons,
  fonts, videos, styling, and other static files.
- `scripts/`: public build, prerendering, SEO, and architecture checks.

Email is the visual reference for product pages. Tasks, Channels, Documents,
Agents, Calls, and Reviews use `ProductPage` on top of `FeaturePage`: centered
Slab heroes, a 920px outer feature measure with 24px inset, left-aligned
feature copy, small illustrated navigation, practical FAQs, and the shared
homepage closing CTA. The Email and CRM compositions remain independent.
Focused `ProductDemo` subgraphics also share Email's cool glow, fine dotted
texture, and bottom fade. The fade sits below the content so editors and
reply controls remain readable.

Product copy should name a real mechanism and explain what it enables: CRDT
sync, direct agent edits, indexed email search, bidirectional references, or
channel-based sharing. Verify claims against the implementation. Avoid vague
“context,” “move work forward,” and “all in one place” headlines, demo narration
as feature prose, and unqualified superiority claims. Explain technical terms
once in plain language; keep demo disclosures in captions and relevant FAQs.
Write it the way the founder talks to another founder: plain words, “we,” the
competitor by name when the comparison is specific, and why we built it.

Demos are faithful to the signed-in app: its labels, layout, icons, and
hover-only controls (the message toolbar appears on hover, as in the app).
Don't invent chrome such as step chips or explanatory labels inside a mock, and
don't show features the app doesn't have. Every animated cursor is
`DemoCursor`, the homepage CRM pipeline's pointer and name tag: label it
“Claude” when an agent acts and with the person's first name otherwise. Size
each `ProductDemo` to its scene with `height`/`mobileHeight` so a window is
never mostly empty, and seed enough content that the first frame already
reads as a real workspace.

Product stories live in their feature's `components/*/*Stories.tsx` files.
They reuse frozen product presentation and local workspace data. Call records
and GitHub review details port the smallest presentation needed from the app;
they do not initialize calls, run checks, post GitHub comments, or merge code.
`createProductWalkthrough` runs once while visible, pauses when the document is
hidden, shows the completed result for reduced motion, and permanently gives
control to the visitor after pointer or keyboard input. Interaction tests cover
that handoff, source links, thread replies, access selection, Sent drafts,
transcript selection, and review filters. All changes stay local.

Use website-owned files or third-party packages declared in this directory's
`package.json`. Do not import `apps/web/src`, repository `packages`, app aliases
such as `@core` or `@queries`, or `@macro-inc/*` workspace packages. Copy the
minimal presentation component and its necessary assets here before using it.
Avoid copying app providers, authentication state, service clients, or generated
editor bundles. Demos use local fixtures and website-owned state.

The standalone gate checks every source file, including unreachable and
type-only imports, static dynamic imports, glob imports, TypeScript aliases,
CSS imports and content scans, static asset references, and escaping symlinks.
It rejects the old `public/live-editor` compiled app payload. Declaring a
workspace dependency or importing a third-party package absent from the
website manifest also fails the gate. Runtime-generated asset names still require
browser verification. The Vite boundary plugin additionally rejects app and
workspace modules in the resolved production build.

Normal navigation and explicit public endpoints are allowed: links to `/app`,
Google sign-in, and the unauthenticated mobile email handoff do not load app UI.
Public integration selections are preview preferences, not OAuth connections.
Local preview data must not be presented as server-backed account state.
The preview proceeds from integration selection directly to workspace setup;
Back from workspace setup returns to integrations.

The homepage document and version timeline share a single playhead. Verify that
dragging the blue handle restores earlier and later edits, remains paused after
release, and supports arrow keys/Home/End. Repeat with reduced motion, which
starts finished but permits manual scrubbing. Below 768px the existing compact
layout continues to hide the timeline.

## Develop and validate

From this directory:

```sh
bun run dev
bun run check:standalone
bun run type-check
bun run test
bun run build
```

Install workspace dependencies from the repository root first. The public dev
server runs independently of the authenticated app. It serves the homepage,
public feature and blog routes, `/download`, and `/start`;
`/onboarding-preview.html` remains a development review entry. It does not host
the authenticated `/app/*` routes.

`/download` says “Available for macOS and Linux” and has one download button.
Desktop Linux browsers receive the x86_64 AppImage; other browsers default to
the Apple silicon DMG, with the selected platform named in the button.
It searches recent stable GitHub releases for each installer, skipping CLI-only
releases and unfinished platform uploads.
Verified direct installer URLs remain usable while loading and if the API fails;
update these fallbacks in `desktopDownloads.ts` when retiring older installers.
The separate “All releases” link opens GitHub, with the selected installer's
release version displayed beneath it.
The page hides the header's Open app action, has no web-app download option,
and has no header/footer navigation entry.
Check the installer link, keyboard navigation, and desktop/mobile layouts.

Before the first prerender build, install Chromium with
`bunx playwright install chromium --only-shell` (add `--with-deps` on Linux CI).
Run `git lfs pull` when migrated video files have not been fetched. The build
writes the public artifact to `apps/marketing/dist/`, verifies the standalone
boundary, prerenders public pages, and finishes with the SEO migration gate.
The homepage uses Solid SSR and hydration. Build verification checks that its
first-painted heading retains its DOM node and geometry on desktop and mobile,
and exercises navigation and the deferred email demo.

Architecture regression tests create real temporary source graphs, CSS files,
assets, and package symlinks. They verify that valid website references pass
and app imports, type-only leaks, inherited dependencies, external CSS scans,
missing assets, and compiled app artifacts fail. After changes, also run the
repository's `just check` and verify user-visible behavior in a browser.

## SEO and deployment

See [the migration audit and cutover checklist](seo/MIGRATION.md). The committed
`seo/migration-baseline.json` records the indexable URLs and schema types on
macro.com. Keep the baseline when adding pages; do not remove a URL from it to
silence a regression.

`bun run check:seo` verifies the built metadata, schema, sitemap, internal links,
signup noindex, and initial JavaScript budget. The deployment probe is
`bun scripts/verify-seo-live.ts https://candidate-host`.
`VITE_APP_BASE_URL` sets the expected canonical origin (default `macro.com`).

Publish `apps/marketing/dist/` at the public origin, resolving extensionless
public paths to `<path>/index.html`. Preserve the existing authenticated
`/app/*` application, Ghost resources, and OIDC routing at the edge. The existing
app deployment does not automatically publish `apps/marketing/dist/`; the public artifact
needs its own deployment step. Website development and builds do not require
changes to application routes, components, or providers.

## Feature-page pattern

`/email` establishes the public feature-page pattern in
`src/features/marketing/components/FeaturePage.tsx`: homepage slab headings and
rules, Inter body copy, and the onboarding security section’s reading measure
and FAQ disclosures. Website UI utilities and the frozen dark palette are
scoped to `.feature-page`, preserving the surrounding public-page styles.

The email page reuses `HomepageEmailCompose`. Its other local demos freeze the
presentation of the application’s `EmailSidebar`, `SearchBar`, entity email row
layouts, `MessageCard`, share form, channel composer, and linked email cards. They
use website assets and local fixtures; they do not import those app modules.
To verify the page: filter accounts, search and open an inbox thread, move an
update to Noise and undo, share the example into the launch channel, and open
its linked thread. The composer, sharing, and edits stay local. No demo sends
mail or changes a workspace. Playback pauses offscreen and when the page is
hidden; reduced-motion mode shows the completed share. The animations run once
without playback controls. Test opening a shared email, plus typing and sending
a local channel message.

The email sharing walkthrough measures its controls to position an animated mouse
pointer. Manual pointer or keyboard interaction stops it. Email, channel, and
new-reply views share a fixed-height viewport with internal scrolling, so the
section below stays in place.

The four feature links have inline SVG illustrations. Full app frames use a
raised rim and a bottom mask into the page background; keep interactive controls
above the faded tail. `HomepageEmailCompose` uses the frozen app composer chrome
on the email page while retaining the existing homepage appearance.

`/crm` follows the same reading width, left-aligned slab headings, glass edges,
and homepage closing animation. `WorkspaceDesktopDemo` supplies the shared Mac
window and desktop background for both email and CRM. CRM demonstrates message-driven
record updates using the shared company UI, company enrichment, an editable customer record, company
mentions in documents and chat, and an agent updating the pipeline. Keep these demos local and check the record interactions
at both desktop and mobile widths.

FAQ answers and the collapsed comparison are rendered in the initial HTML.
The comparison uses a native `details` disclosure for both people and crawlers.
Retain FAQ class markers so prerendering emits matching FAQPage structured data.

## Paid-social landing page

`/tour` (`features/marketing/views/SalesPage.tsx`) is the Instagram ad landing
page. It is prerendered, `noindex`, out of the sitemap, and not linked from the
navigation. It has four parts, top to bottom: the homepage hero markup
(`WelcomeStep` with `ContextScene`), the expanded `FeatureConstellation`, a
savings calculator, and an inline cal.com booker for the Macro demo call.

`core/sales-savings.ts` reduces the pricing calculator to one plan tier for all
tools and reads prices from `core/savings-calculator.ts`; update prices there,
not on the page. "Book a demo" buttons scroll to the booker, which loads
`embed.js` only as the visitor approaches it and appends Meta attribution to
the booking. Verify at phone width: no horizontal scroll, calculator steppers
and toggles, and that the booker loads.

## Blog presentation

`/posts` lists every article as one icon-and-title row. There are no category or
search controls; old `?tag=` links still reach the complete list. Article URLs,
metadata, and the chronological ordering stay unchanged.

`posts-shell.css`, `posts-index.css`, and `post-reading.css` keep the blog aligned
with the homepage: slab titles, monochrome accents, and the onboarding security
section’s Inter reading measure. Comparison FAQs use `PostFaqItem` with native
`details` disclosures; retain its FAQ class markers for prerendered FAQPage data.
Check the index and article layouts at desktop and mobile widths, verify the
full title remains accessible for truncated rows, and exercise FAQ toggles.


## Interactive sample workspace

The Home and channel composers use atomic local mention tokens. Their presentation
is frozen from `UserMention`, `DocumentMention`, and `MentionsMenu`: short blue user
pills, colored entity icons, underlined reference names, and grouped menu rows.
Verify typing `@`, keyboard and mouse selection, category drilldown, multiple
references, paste, and sending a local channel message. References retain their
formatting after sending; pasted HTML is treated as plain text.

On desktop (800px and wider), the homepage embeds `/demo?embedded=true` at
`#interactive-demo` in a 1200px-max
noisy gradient stage using the feature bubbles’ violet, teal, green, and amber
palette. As the page scrolls, the bubbles converge and fade into the expanding
stage, followed by the workspace. Reduced motion shows the finished state.
Interacting with the frame settles the entrance permanently for that mount.
Embedded mode hides the demo banner; the normal `/demo` route keeps it. Verify
navigation and the mobile sidebar inside the frame, forward/backward scrolling,
and interaction during the reveal. The desktop iframe renders at 85% scale inside
the same frame. The iframe uses native lazy loading.

A benefit carousel fades the live preview into slab-serif headlines. The first
highlight opens an email inside Home’s mixed activity feed; subsequent highlights
show Chat, Docs, CRM, Tasks, and Agents. Arrows, dots, left/right keys, and swiping
the caption select highlights without reloading the frame. Horizontal drags
capture the pointer; vertical gestures keep scrolling the page. There is no autoplay.
The workspace is always interactive. Clicking or typing inside it keeps the fade,
headline, controls, and layout intact. Sidebar navigation updates the active
highlight without overriding the visitor’s navigation. Slab headlines sit directly
below the blue indicator and chevrons, without small category headers. Verify direct
interaction, slide navigation, and reduced motion when changing this section.
Below the carousel, the original open-source section shows GitHub stars, a16z
backing, and ISO/SOC 2/CASA badges. A continuous grainy gradient funnels into the
GitHub mark on scroll, then drains away. Verify the flow in both scroll directions
and after resizing. Reduced motion skips the flow
and shows the finished GitHub treatment.
Below 800px, the homepage keeps the original sequence: feature bubbles, the full
open-source section, then a curved connector into the abbreviated sidebar diagram.
The embedded demo, carousel, liquid transition, and demo launch button do not mount
on mobile. Resize across 800px to verify both compositions and animation cleanup.
The desktop sidebar graphic remains behind `SHOW_SIDEBAR_BREAKDOWN = false` in
`HomepageSections.tsx`.

When that flag is enabled, the Interactive demo button below the sidebar graphic opens `/demo`
in a 90vw × 90dvh modal. The iframe mounts only after activation. Check the
animated 150px connector, traffic-light and top-right close controls, focus
return, and Escape inside the iframe (an inner menu should consume Escape first).
Reduced-motion preferences disable hover transitions and modal animation, and
show the connector fully drawn.

`/demo` provides a session-only workspace with Home, tasks, email, channels, DMs,
documents, a Customers board/list, Calendar, and a scripted agent. It is prerendered for direct links and marked `noindex`;
it is excluded from the sitemap. `/tasks` embeds the same workspace components.

`features/marketing/core/dummy-workspace.ts` owns the sample dataset and
`primitives/createDummyWorkspace.ts` owns local commands. Each mounted workspace
has its own state. Reset restores the fixtures and cancels pending scripted work.
No messages, emails, edits, or invitations reach app services. Refresh discards
changes. Agent replies are scripted, and microphone/file actions in the chat
composer are disabled. Text editors use native editable surfaces with the frozen
app presentation rather than the app's networked editor runtime.

The rail, notebook layout, property pills, property icons, email message cards,
and composer chrome are copied or adapted from the app into this package. Their
source components are recorded alongside the copies. Keep these imports local;
run `bun run check:standalone` when changing them. The frozen composer layout CSS
is unlayered so the injected website reset cannot remove its internal padding.

Browser checks: edit a task's title, status, owner, and checklist; comment and
reopen it; create a task from a channel message; share an email or document into
a channel and open the linked item; reply to email and check Sent; create a new
email; edit a document; search across views; reset. Check the composer with short,
multiline, and wrapped text at desktop and mobile widths. Sending clears and
shrinks it, and Shift+Enter adds a line.

Email rows use the app’s small outlined badges, with seeded tags and Favorites.
Filter with the email sidebar tags or Unread only, and edit an email’s tags in
its details panel. Check that tags survive reopening the email and that filters
combine with account selection and search. Reset restores the seeded inbox.

Documents and tasks have colored tags using the app's tag palette. Use the plus
beside the tags to select or remove demo tags; the body and details panel stay in
sync. Verify that tag changes survive navigating away and reopening the item
within the same session. Refresh or Reset restores the sample tags.

The sample uses the live app's 256px view sidebar, open channel message rows,
centered Home/agent composer, and collapsible detail panels. Customers and Calendar
use fictional company/contact/event fixtures in `core/workspace-fixtures.ts`;
never replace them with private content from reference screenshots.

Additional browser checks: change a company stage and verify its board column;
search/filter the board; edit a calendar event, switch Week/Day and navigate dates;
toggle personal events; reply in a channel/DM; toggle the task/document/company
details panel. A fresh agent conversation shows the centered input. Native
inputs and selects replace networked app editors and property providers.

### Demo visual parity checks

The sample workspace uses the app's frozen `Tabs` for sidebar choices and
`TabsInset` for conversation tabs. Do not substitute one for the other. Marketing
button/input/link defaults must exclude `.dummy-workspace` descendants: they
otherwise override the app's typography. Check computed styles in the signed-in
app and `/demo` at the same viewport before changing presentation.

Verified desktop reference dimensions: sidebar tabs 32px high; inset tab track
30px with 24px labels and 12px text; composer actions 33.75px with 20.625px icons;
task rows 44px with 12px/15px property text and 6px 8px property padding.
Attachment selection in the sample composer keeps filenames only in the local
message; file contents are never uploaded. AI responses remain scripted.

The Home/Agents model picker freezes the production `ModelCatalogPicker` and
catalog helpers under `workspace/frozen/model-picker`. Preserve its searchable
menu, provider icons, selected checkmark, and top-end placement. Its portal
stays inside the website scope; the sample catalog does not call model services.
Verify filtering, selection, and Escape dismissal when changing the picker.

Home item navigation preserves the Home rail/sidebar and opens the selected
task, document, email, or channel in its main pane. The Home breadcrumb returns
to its overview; explicit rail navigation changes sections. Test cross-linked
items as well as Home sidebar items.

Channel replies are grouped under their root with the app's curved reply rail,
inline expansion, and a separate thread composer. Verify that replying to a
thread does not append a new root or post to another channel. Email uses a fixed
breadcrumb/action bar and replies inside the last message card. Expand the
recipient summary to edit To/Cc/Bcc; Enter adds a line and Cmd/Ctrl+Enter sends
to local Sent. Scheduling adds a local Scheduled item without displaying it as
sent in the thread. Discard removes only the unsent local composer.

The rail's New (+) button and `C` open the centered create palette. The palette
uses local supported creation actions, not the signed-in app's providers.
Search filters options; Up/Down changes selection and Enter creates. `/` toggles
search mode, revealing direct creation keys. Escape or clicking outside dismisses
it. `C` is ignored while editing text or while a dialog is open. Section-specific
New task/New email buttons retain their direct creation actions. The dialog portal
mounts inside the workspace so the scoped UI styles and theme remain available.

## Migration page

`/migrate` explains what to bring over, how connected agents find relevant work,
and how to review the imported result and bring the team over. `MigrationPaths`
owns source-specific instructions; `MigrationPathSelector` owns responsive
selection and keyboard focus. Individual comparisons belong at the end of
product FAQs. The compact all-tools overview stays visible on migration.

The Notion page importer copies supported page content into native docs and
excludes databases. Linear imports stage issue metadata and create native tasks;
the CSV route has a preview and assignee mapping. Pipedream supplies connected
app tools to agents. Connecting, importing a copy, and ongoing Gmail sync are
different behaviors; do not promise a complete workspace clone or ongoing sync
for imported Notion pages and Linear tasks. Check implementation before changing
these claims. Verify paths, dropdown dismissal, keyboard navigation, practical
FAQs, and the overview's horizontal scrolling.

## Product comparisons

`core/feature-comparisons.ts` owns the fact-checked boolean rows and maintainer
source URLs. `FeatureComparisons` renders one always-visible table above each FAQ, without a heading or dropdown:
Superhuman/Gmail on Email; Notion on Docs; Linear/Jira on Tasks; Slack on Chat. ClickUp
stays in the migration overview. Overview links scroll to the matching product
comparison; verify both initial-load and client-side navigation hashes. Keep
cells to Yes/No and labels precise about
built-in tools. Retain detailed article links when an article exists. Source URLs
are not shown in the UI. Icon-only comparison tables are not exported as prose
FAQ answers. Verify table columns, keyboard focus, scrolling, and existing
functional FAQs after moving or adding a comparison.


## Agents page and shared agent sample

`/agents` shows three fictional workflows based on observed product use:
- A channel mention consolidates customer support, testing notes, and existing
  work into an editable client file upload brief.
- A personal agent progressively checks the calendar, reads the email and call,
  then presents its findings and creates the brief. Visitors can inspect those
  sources. Reduced motion shows the finished brief; interaction stops playback.
- Macro produces a mockup from the client brief; the person then says only
  “@Cursor, build this.” The attachment uses FolderComposerMockup, a static copy
  of the app’s FolderComposer/EntityComposer presentation, not a hand-drawn SVG.
  The agent identity in that follow-up is a user mention, without a sparkle icon.

`AgentWorkflowStories.tsx` owns these scenes and `workflowData.ts` their local
records. The hero uses `DummyWorkspace` with `agentShowcase`; its open-workspace
link uses `/demo?scene=agents` to show the same conversation and records. Plain
`/demo` keeps its usual starting view. Existing Northwind samples remain available
in the general workspace but are no longer the Agents page’s story.

All scenes start in one pane. Record buttons open native document, email, task,
channel, or calendar viewers. Back and Escape return to the conversation and
restore focus. Edited documents persist when reopened. Agent-authored prose uses no inline bold emphasis. Generated files are inline document
mentions, opening the existing editor; do not replace them with custom summary
cards or source strips. The fourth navigation item, Tools to act, continues the hero: Julia mentions the agent in the document’s own discussion. The agent replies
to Julia, types three test checks into the existing editor with a named remote
caret, then confirms the edit in that thread. The cursor follows the insertion
point while the discussion is kept in view on every update. Scroll anchoring is
disabled in these two scenes; extra scroll room keeps output above the site’s
viewport fade. Pointer, keyboard, or wheel input stops playback.
The compact document keeps the edits and discussion visible together. Input
stops the update and preserves the visitor’s edits. Channel scenes reuse WorkspaceChannel, including its tabs,
thread layout, composer, and message controls. Scene input
stops autoplay; reduced motion shows the complete collaboration immediately.
The approval message precedes the coding result. The PR stays open for review;
no real agents, messages, repositories, or services are invoked.

Browser checks: follow the hero’s sources and brief, edit and reopen the brief,
inspect both meeting sources and the calendar, then open the mockup, coding
session, and PR. Test keyboard return, composer input, sidebar navigation,
phone widths, and the standalone demo link. Keep source and output records in
agreement; never use private customer records or internal screenshots as assets.

Presentation and behavior were reviewed against app commit `9d06e08e`. The source
map lives in `scripts/agent-ui-sources.json`. After fetching a new app reference,
run `./marketing check:agent-ui` from the repository root (or pass a Git ref).
This reads Git objects, so it works in sparse checkouts. Changed or missing source
fails the check and identifies the demo to review. It does not assert pixel parity
or that the app commit has shipped. Review changed source and desktop/mobile
screens before updating individual baseline hashes. No app modules are imported
into the website at runtime.

Agent conversation rows follow AgentSessionRow: 32px normally, 48px minimum with
code metadata, a timestamp on the right, and an empty leading status slot for
completed/read sessions. The transcript's turns must not flex-shrink; overflow
scrolls above the composer. At less than 720px of available app-view width, the
sidebar collapses. Measure the embedded container, not the browser viewport.
Check the hero around 895px browser width and source panes after resizing.


The Agents hero keeps a 1000×640 desktop canvas at browser widths of 700px and
above, scaled proportionally inside its frame. Its sidebar must remain visible
at 768px and 895px; the canvas must not trigger a narrow app layout. Phones use
the responsive workspace and navigation drawer. Verify menu anchoring as well as
sidebar visibility after resizing. BYOA presents macrod and external MCP as two
connection paths, side by side on desktop and stacked on phones. Both setup links
remain visible. MCP commands reuse `AgentMcpSetup` inside an optional disclosure
without a fixed-height demo window. Verify each client expands and copies its
command. The closing FAQ answers model, access, review, and background-work questions.

## Docs page walkthrough

`/documents` introduces collaborative writing, then agent edits, source splits,
and folders and tags. Offline editing and CRDT merging are explained in the FAQ. All examples use a page-owned Website brief,
Pricing changes email, Update pricing page task, and #website conversation.
`DocumentOrganizationDemo` adapts the app folder list and tag-filtered search:
one folder location, several tags, and one persistent document when reopened.
The source demo uses the same wide frame as Chat and opens email and task panes
beside the persistent editor. Each source closes independently. Narrow screens
show the active pane and return through the remaining panes on close. References link back to #website.
An unboxed prompt and progressive tool calls lead into the shared editor. Search
results stay mounted and can be opened. Agent and human insertions overlap within
one paragraph; manual interaction freezes playback before input. Tool calls finish
before the pricing rewrite starts and compact on completion. The prompt has no
entrance movement, and the transcript plus final paragraph reserve their layout
space while edits run. Completion folds the tools and their reserved space away
with the same transition; text and headings inside the doc retain their positions.

Verified against `block-project/component/Block.tsx`,
`property/tags/tagNavigation.ts`, `block-md/component/MarkdownDocument.tsx`, and
`crates/projects/src/inbound/toolset/move_to_project.rs` at e2bd582d.
Folders and tags are separate organization mechanisms, not multiple physical
copies or nested docs. Notion supports subpages, backlinks, and database views;
the FAQ compares the organization model without claiming it lacks flexibility.

Verify folder and tag navigation, search, source open/close with Escape and focus
restoration, edits surviving navigation, local sharing, tool inspection,
offscreen pause, and reduced motion. Compare desktop and mobile without a fade
covering the editor. Tests: `DocumentStories.test.tsx`. The checkmark comparison covers document capabilities. Notion uploads live in
page blocks or database properties; imports can convert supported files to pages.
Both tools support file uploads and Markdown import/export. The comparison makes
the folder and cross-workspace differences explicit without claiming file formats
are unsupported or comparing plan-specific upload limits.

## Calls page walkthrough

Three sections follow the navigation: start a call, act on decisions, and find
past calls. Recording playback and clickable transcripts stay in the hero’s
After the call view and the records opened from call history. Calls omits the hero CTA; the header and closing CTA remain.
Participant tiles are equal-sized in the marketing call grid, including You.
The start-call story replays on returning to view until the visitor interacts;
it never loops while visible or replays for reduced motion. The sequence briefly holds
the chat, then an unnamed pointer moves to Call and clicks. Connecting and
participants follow, completing in about eight and a half seconds. Interaction cancels the
staged transition and hides the pointer. Other Calls demos have no animated cursor.

`/calls` follows a simple Thursday training handoff across a live call, saved record,
and agent-assisted task update. Calls-only fixtures live in `calls/call-fixtures.ts`
and `calls/call-project.ts`; shared workspace data stays unchanged. The hero's
In the call / After the call controls sit outside the product frame. The hero
stays in the call until the visitor switches scenes or leaves. Other walkthroughs
run once while visible and stop permanently on visitor interaction. Participants are illustrative; playback is
local and has no call audio or network effects.

The hero shows camera-off participants and call controls, with no screen-share
scene. Never stretch profile photos into video feeds or animate them as
speakers. The marketing call controls omit team sharing and disable camera and
background and screen-sharing settings that need real media. Call history stops on its list;
opening a record is a visitor action.

The follow-up changes training ownership from Teo to Julia and adds three
unchecked next steps. Replies reuse the agent answer renderer with named call
and task mentions, subtle name underlines, call timestamps, and task properties.
Tool rows use plain Read call transcript text and bordered ItemPreview chips;
the group collapses when the run finishes. It starts and finishes in one pane, including with reduced
motion. Only clicking a linked call or task opens a detail pane. Phones show
one pane at a time. Close and Escape return focus and preserve task edits. Arbitrary messages stay
local and do not trigger the scripted task update. Check call controls, channel
tabs, transcript seeking, source links, task ownership/checklists, and FAQs on
desktop, tablet, and phones. Confirm all controls stay above the visual fade.

Copy distinguishes automatic recording/transcription and agent access from
requested task/document edits. Team sharing for channel calls is separate from
channel membership; standalone calls do not automatically enter team memory.
Guests can join instant or scheduled meetings through a link without an account.
Guest participation does not grant access to the channel or saved recording. Keep plan details in the FAQ; the Calls hero and demos have
no pricing footnote or explanatory captions.

## Tasks page walkthrough

`/tasks` follows a customer proposal: draft the scope and delivery timeline,
then review pricing. Examples use substantive work without fictional customer
backstory. The context section opens a task with native inline mentions of its
Customer brief, Proposal request email, and sales conversation. Sources open beside
the task on wide frames and replace it on phones; Close and Escape restore focus
and preserve task and linked-document edits. Renaming the brief also updates its
inline mention. The checklist-conversion section is no longer on the page. Tasks-only fixtures
live in `components/tasks/taskProject.ts`; each demo has independent local state.
The hero uses the native Tasks and Projects presentation in `TasksWorkspace*`,
with three project records and twelve tasks seeded by `tasksWorkspaceData.ts`.
`createTasksWorkspace.ts` owns local navigation, project membership, filters, and
per-project layout settings. The sidebar has Task views, My projects, and Tags;
project detail has Overview and Tasks tabs, with native breadcrumbs back from tasks.
The toolbar has separate layout/sort/group/filter menus. Project task search expands
from its icon and clears on Escape; Add existing tasks is an anchored selector.
New tasks inherit their current project. Edits and project moves remain visible
across the main list, project lists, and board. `WorkspaceDesktopDemo` opts this
hero into the Tasks presentation; other feature demos keep their own fixtures.
Keep the frozen presentation aligned with `apps/web/src/features/tasks-view`,
`features/projects`, and `components/view-shell`, without importing application
providers or service clients into the website.
Source navigation shares task state; Close and Escape return to the task and
restore focus. The channel agent creates proposal and pricing tasks, then reassigns the proposal
only after the illustrated request. Both responses are threaded replies to
Jacob. The first request types into the channel composer. The follow-up is a
plain-text reply in that same thread, without another @Macro mention. Playback
waits 1.4 seconds before each agent reply and holds the first result for 2.2
seconds before the follow-up. It starts when the main composer is fully visible.
Composer handles and explicit reply state drive playback; no synthetic input or
Reply/Cancel button clicks are used. Keep composer geometry stable during typing. Visitor input stops typing and preserves the draft.
The context demo types its final sharing instruction, opens the mention picker
at @, selects #sales, and stops with the link inserted. It starts only when the
line is visible; the picker opens above the line to stay inside the demo.
Visitor input stops playback permanently;
reduced motion shows the result. Inline task mentions open their linked documents, emails, and conversations. PR playback updates status, never the task’s checklist. Focused task-detail
frames grow to fit the discussion and composer above the decorative fade; verify
no inner scrolling or horizontal clipping at desktop and phone widths. The full
workspace list keeps its normal scrolling. Jacob’s quote links to his Linear article.

Verify task edits, source navigation, owner/status menus, inline source links and
return navigation, the agent’s reassignment, and comparison FAQs on desktop and mobile.
Comparisons live in individual FAQ answers for Jira, Linear, Notion, and ClickUp;
keep them specific to workflows. Notion supports task databases, subtasks, and
dependencies. Do not describe it as lacking granular tasks or imply that all
Macro tasks complete automatically. Keep migration, pricing, and comparison links.

## Chat page

`/channels` leads with opening referenced work, then channel-based access, agents,
and a combined catch-up section. Keep docs, tasks, and email references inline
in messages. Chat fixtures include original, scrollable history. The opening
walkthrough starts full-width, scrolls back, then moves and clicks the shared
cursor to open a doc and an email in the split. Manual input stops it.
The document stays mounted when email opens in a third split. The hero uses the
same split surface through its opt-in `chatSplits` prop, retaining native sidebar
navigation and the page-owned channel/DM fixtures. Wide layouts divide the
available content width equally among all open panes; widths below 240px per
pane switch to one active pane. Each pane keeps its own selection and edits.
Smaller frames show one active pane at a time;
Back to channel retains open items, while Close removes only that pane. Email
uses the full workspace email view and an original two-message thread. Share uses the document Share UI and
shows the channel's grant, separately from public-link access. The agent story
continues from Macro creating Julia’s task to Julia mentioning Cursor and Cursor
investigating in the same thread with one response. Keep Julia as owner while work starts.
The final catch-up demo focuses on inline replies in a full-width channel,
without the Home sidebar or inbox shortcuts. Three original conversations show
visible reply previews. Threads expand when the visitor selects more replies;
there is no automatic scroll or expansion. The initial scroll position starts at the first conversation, while the
composer and remaining history stay available. Verify thread expansion, a reply
staying in its original thread, reactions, keyboard dismissal, and mobile wrapping. Keep examples
short and conversational; omit under-demo captions. All interactions are local.

## GitHub page walkthrough

`/github` follows one mobile sign-in fix through its channel, task, pull request,
and coding-agent session. The hero opens the PR beside its Changes pane. Channel
playback begins unsplit, opens the inline PR, then opens Changes; interaction
stops playback. Narrow panes show the active view, and Back/Escape return to the
channel without discarding its conversation. The task demo links the PR before
moving to In Review, illustrates a confirmed merge, and updates Completed without
changing checklist items. Inbox playback holds the opened request until the
visitor marks it done. Cursor contributes one result with a session and PR link.

GitHub presentation follows `block-pr/PrDetail` and `features/changes` at
`e2bd582d5f991896bbc69921ee2447def7360636`. Diffs are frozen Pierre renderer output,
regenerated by `bun scripts/generate-github-diff.ts`. No GitHub service is called;
merging and all edits are local. Verify file selection, split/expanded changes,
merge cancel/confirm, task source links, reduced motion, manual takeover, and
390px/768px/desktop layouts. Keep captions and repeated explanatory paragraphs
off this page. Source fixtures are isolated from the Tasks and Agents pages.


Product heroes opt into `WorkspaceDesktopDemo`'s `heroFrame`: a 1200px maximum
outer width, graphite Monterey background, 50px desktop inset, and 640px content
height. Mobile heroes use 16px insets and 580px content height. The shared frame
preserves each demo's own state and the Tasks/Agents desktop canvas scaling.

Lower product demos use the standard 872px feature window, including Chat,
Docs, and GitHub. The earlier GitHub desktop-surround prototype is no longer
mounted. Chat and Docs retain equal-width source panes; when a pane would be
narrower than 240px, they use the existing single-pane navigation. Verify opening
and closing sources at desktop and phone widths, without remounting the original
conversation or document. Display names use first names. All product pages use
`HomepageClosing` for the bottom Open app CTA and the shared feature heading styles.

Chat sidebar parity: `workspace/ChatSidebar.tsx` adapts the app's
`channels-view/components/rail/ExpandedChannelsRail.tsx` with local fixtures.
It uses the shared Tabs and ViewSidebar controls, 32px section headers and a 4px
header-to-list gap. Channels and DMs scroll independently. Verify search,
section collapse, Threads navigation, and opening a mentioned source after
switching channels. Message text uses the app's 15px/24px reading size; dark
surface and edge tokens are frozen from `apps/web/src/index.css`.

Cursor replies in the Agents, Channels, and GitHub walkthroughs share
`DemoAgentChip`, adapted from the current `MagicChipView` in the app. It uses
the settled 88px rounded session card, Open session action, and an output/PR
row. Cursor mentions are participant mentions (`@Cursor`), not agent-session
links. The surrounding conversations use local fictional fixtures; verify
the session link and returning to the same conversation after playback.

The third Calls section uses `CallTeamMemoryDemo`: Julia's channel call starts
with Share with team enabled, ends into Gabriel's missed-call list, opens the
summary, then seeks the recording to Julia's decision at 1:02. Gabriel is not
an attendee. Turning sharing off leaves his list empty. Manual input pauses
automation; reduced motion opens the saved summary. Verify the checkbox,
recording navigation, transcript seeking, and phone layout. CRM linking remains
on the CRM page; this scene demonstrates channel-call team sharing only.
