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
public feature and blog routes, and `/start`; `/onboarding-preview.html` remains
a development review entry. It does not host the authenticated `/app/*` routes.

Before the first prerender build, install Chromium with
`bunx playwright install chromium --only-shell` (add `--with-deps` on Linux CI).
Run `git lfs pull` when migrated video files have not been fetched. The build
writes the public artifact to `apps/web/dist-site/`, verifies the standalone
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

Publish `apps/web/dist-site/` at the public origin, resolving extensionless
public paths to `<path>/index.html`. Preserve the existing authenticated
`/app/*` application, Ghost resources, and OIDC routing at the edge. The existing
app deployment does not automatically publish `dist-site`; the public artifact
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
the caption select highlights without reloading the frame. There is no autoplay.
The workspace is always interactive. Clicking or typing inside it keeps the fade,
headline, controls, and layout intact. Sidebar navigation updates the active
highlight without overriding the visitor’s navigation. The icon labels, orange
indicator, chevrons, and benefit copy follow the live-site carousel. Verify direct
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
