# Standalone public website

This directory owns the Macro public website and its public signup introduction.
It shares the repository with the authenticated application, but has its own
package manifest, Vite entry points, TypeScript aliases, styles, assets, and UI
components. Application UI changes must not alter the website.

Light mode is temporarily disabled site-wide by `WEBSITE_LIGHT_MODE_ENABLED` in
`src/features/setup/sitePalette.ts`. Keep its first-paint copies in `index.html`
and `start.html` in sync. All routes, embedded previews, and `/start` stay dark
regardless of system preferences or `?theme=cream`; Home navigation must not change
the palette. The authenticated app is unaffected. The light styles remain for
future re-enablement.

Use a pale blue selection highlight (#b8d5ff) with dark text (#101820) in both website entry styles. Keep public website text selectable with native browser behavior; restrict `user-select: none` to interactive controls that need it, never the page globally.

The homepage uses one opening section on desktop and phones: a large Macro mark
surrounded by the production welcome graphic's app logos, followed by `MacroHero`'s
current H1, supporting H2, Sign Up button, and backing/security badges. Reuse
`ContextScene` unchanged on desktop and phones, including its radial rings,
Macro bubble, and varied logo sizes. Render the concentric rings at 75% opacity and keep the two major rings only slightly stronger. Add a very faint, wide oval peach, rose, and warm-gold accent wash around the outer bubbles and reuse onboarding’s `WorkspaceTexture` at subdued dot/grain opacity. Give the logo bubbles a nearly transparent glass surface with background blur, a faint gradient edge at 40% of the earlier rim strength, and no bevel or cast shadow; use solid surfaces for reduced transparency. On desktop, scale the graphic to 110%, add 20px above it and 10px below it, and reserve the scaled height in the layout. Keep its orbit tiles centered on their
positions and the graphic within the reading column. Onboarding retains its
existing feature diagrams. The hero stays readable without motion and does not
morph into another section. Follow it with the connected sidebar breakdown,
product chapters, testimonial, blog, and closing CTA. Mount shared UI styles
scoped to `.macro-homepage` for direct loads and client-side navigation. Do not
insert a separate welcome screen, feature diagram section, GitHub proof section,
embedded workspace carousel, or Home tutorial video into this sequence. Keep the
homepage aura at 25% of the shared gradient and the grain at 1.2% opacity.
Preserve centered slab headings, small Inter descriptions, and thin rules beside
each product chapter description.
The first-paint scripts and `sitePalette.ts` must apply the same palette policy
before and after hydration.

The neutral light homepage uses a pale secondary action, a sidebar matching the page background, and explicit navigation ink for search text; do not inherit the legacy dark input colors.

Public actions share the raised white pill, one-pixel glass rim, and subtle
pointer highlight from #9993. In light mode, keep the lift and rim at 75% of that original treatment, including the header button. The homepage and feature hero buttons use
`site-nav-start`; keep these pills 140px wide and 40px tall to match the desktop Sign Up button, with matching type and icon sizing. Do not add a separate homepage button skin. Keep the current full-height documentation sidebar. Keep the homepage header transparent so the shared `PageVignette` fades scrolling content at the viewport edges without a solid header band. Keep the desktop transition from the hero to the feature diagram free of an extra Explore cue.

Use `HomepageClosing` for a static bottom Sign Up button on the homepage, product, benefits, pricing, blog, and Wall of Love pages. Article layouts use `SitePageClosing` for the same treatment. Keep the header signup fixed in place; never animate it into the footer. Do not add bottom signup sections to security, legal, reference docs, account deletion, jobs, partners, or download pages. On phones, make the bottom signup button fill the content width up to 420px, with a 60px minimum height and 20px label. Keep signup and interactive demo flows separate. Keep miscellaneous links under “More stuff,” including separate Jobs and Partners links and a single Legal link to `/legal`. Keep billing guidance in Pricing, redirect the retired Billing & Plans page there, and leave the keyboard shortcut reference in the app rather than the website. The Legal page lists the existing policy and account-deletion URLs; preserve those URLs and their text. Omit Workspace basics from the sidebar; retain Home, Unified Memory, and Properties guides in search and contextual links from setup and product guides. Keep agent setup guides under Agents.

Lazy-load the lower `HomepageSections` chunk inside its own Suspense boundary so the hero stays visible while the section code loads and prerendering retains the full page. Link its static CSS dependencies in the prerendered homepage head so the product graphics are sized correctly before JavaScript loads; verify this with scripts held back in `scripts/verifyHomepage.ts`.

Keep legal pages (`/terms`, `/privacy`, `/dpa`, `/partners/terms`, and `/delete-account`) on the shared `RouteLegal.css` layout: centered slab titles and dates, a 640px reading column, Inter body copy, and spaced section rules. Preserve legal wording, clause numbering, and DPA table navigation when changing presentation.

Add 40px above the hero graphic on phones 390–699px wide; preserve the smaller-phone top spacing.
Keep the homepage H1 on two lines on narrow phones, reducing it to 32px at 375px and scaling down further below that width.
Use the same hero markup below 700px, with 24px side gutters, the responsive
welcome constellation, and 13px supporting copy. Keep the 144 × 48px
signup action and allow the backing/security badges to wrap. `MacroHero` keeps
the headline “The unified workspace for your company” and current supporting
copy. The introduction scrolls naturally rather than filling a viewport.
Use quiet text links labeled “Learn about [feature] →” below homepage demos, matching the small Inter section descriptions: 370 weight, 14px desktop / 13px phone, 1.65 line height, and placeholder ink. Scale arrows to the text. Use no boxed buttons or separate “Learn more” heading. Preserve 44px touch targets and direct product-page destinations.
Keep homepage product sections, their messages and graphics, and the following testimonial, blog, and closing sections centered in a fluid 680px column matching the feature pages.
Label the homepage CRM graphic “Deal pipeline” and show its illustrative filter, view, sort/group, visibility, New, and search pills at the upper right, using the Tasks artwork’s subdued pill treatment.
Style the homepage CRM panel like the email card; show two enlarged pipeline columns on desktop and pan with the moving card, retaining the narrower phone camera.
Omit the audit-log timeline and its caption from the homepage Documents and tasks chapter; keep the collaborative document preview and feature links. Match that document card to the email composer’s neutral glass surface and thin rim, without an extra colored wash. Use the homepage chat’s blue tint and regular weight for its person and date mention pills.
Keep the signup-to-sidebar connection matched to the sidebar callout color (16% ink) with a thinner 0.5px stroke and fully undrawn at the top of the page; draw it only as the visitor scrolls, with a static revealed line after scrolling under reduced motion. Center the backing/security badges in the signup-to-sidebar gap; show them at 40% opacity initially and fade them to full opacity once scrolling brings them into view. Under reduced motion, reveal them without a transition. Keep the Sales footer badges visible. Keep the full backing and certification captions on phones at 8px. Move desktop callouts inward to shorten their horizontal connector span by about 20%. On phones, shift the sidebar graphic 60px left, move its callout labels another 16px left to lengthen the pointers, shorten the agent caption to “Cursor, Claude, ChatGPT”, and use a straight vertical connector with a diamond endpoint matching the sidebar pointers. Keep that gap about 234px on a tall desktop and 206px on phones, with no extra hero-bottom or sidebar-top padding.
The hero never intercepts scrolling. `HomepageSections` reuses the deployed
Email and chat, Documents and tasks, Agent teammates, Sheets and databases, and
Hands-free CRM chapters. Preserve their original copy and demonstrations instead of
replacing them with separate feature cards or a sales letter. The shared
website sidebar handles navigation; do not add a separate homepage index.
Demonstrations load near the viewport through `DeferredDemo`. Reduced motion
shows finished, readable content, and examples never send live messages.
Hide the homepage Downloads and Links resources rail below 1440px instead of
moving it below the closing security section; retain the desktop rail and compact bottom spacing.

Model-picker search fields use a borderless input with a subtle rounded focus ring around the complete search row, including the icon. Keep this styling local to the frozen marketing picker.

Use Inter Variable at no more than 500 weight in website graphics and interactive demos: 500 for titles, tabs, and emphasis; 400 for table rows and body text. Preserve lighter existing text weights. Keep these graphic styles scoped away from page headings and the authenticated app.

Keep the homepage email, document, and CRM cards’ outer rim and shadow effects 35% softer than their previous treatment, without fading their contents.

Use `demo-glass.css` for live graphic panels over gradients: 64% charcoal, a 16px backdrop blur, and a faint edge highlight. Let nested workspace canvases stay transparent and sidebars use a faint tint so they cannot cover the glass. Keep text fully opaque, nested popovers and overlaid mobile navigation solid, and the treatment quieter than Wall of Love cards. Reduced-transparency preferences use a solid panel. Apply this to feature-page and homepage graphics, not the authenticated app or video pixels.

Marketing demos use `DemoInteractionBoundary`: wheel and touch gestures scroll
the surrounding page until the visitor clicks or enters with the keyboard. The
preview contents stay mounted but inert, preventing internal scroll capture and
automatic focus jumps. The first click activates the demo without triggering an
underlying action. Keep this gate invisible, with an accessible keyboard entry
but no activation badge or extra visible button. Escape (after closing any native menu), clicking outside, or
moving keyboard focus outside returns to preview mode and preserves demo state.
Nested previews share one boundary; the standalone `/demo` route uses
`DemoInteractionScope` and remains immediately interactive. Apply this shared
boundary to new marketing demos rather than adding custom wheel handlers.

## Ownership and dependency boundary

`/wall-of-love` sits directly below Home in the sidebar with a heart icon. It
mixes support and X quotes in one responsive wall ordered by editorial priority, using first
names for support conversations, or “Customer” when no first name is supplied.
Prioritize social proof, product credibility, and specific customer outcomes; mix
strong new quotes near the top. Keep one strongest quote per person and no more
than one anonymous card. Keep ranked DOM order while packing variable-height cards with a ResizeObserver. Keep the shared signup closing directly below the wall, without a thank-you paragraph or divider and with compact spacing above the button. On three-column layouts, let the final left and right cards extend slightly below the middle card without moving quotes or inserting signup into the grid. Enlarge the user count and security badges only on this page. Cards use a faint gradient rim flush with the outer edge, with minimal shadow depth and
circular Contacts-inspired badges with muted translucent rose, slate, and sage
tints and a single fine edge, without a raised bevel. Customer badges pair the first-name initial
with a fictional second initial; never derive it from surnames or contact details.
Left-align the light title and introductory H1 to the full testimonial grid width,
without a top emblem. Match feature-page hero typography: 40px/320 slab title
(responsive below 700px), and 17.5px/370 muted Inter intro with 1.65 line height.
Keep cards translucent over a
page-wide rose-and-violet aura with subtle grain. Fade both decorative layers
at every edge so their bounds never form a visible seam.
Keep quoted wording in `core/customer-love.ts`; exclude private source links, lookup metadata, employer combinations, colleague identities, and distinctive personal context. Trim
conversational greetings and direct shout-outs, and mark noncontiguous excerpts.
Omit identifying details from the source data; never ship them in HTML, attributes, or JavaScript.
Do not turn mixed feedback into unqualified praise. Public social quotes link to
their original posts and use borderless profile photos and verified like/bookmark
counts, with the verification date retained as snapshot provenance. Label known
partner affiliations and translated excerpts in the source note. Register this page
in the router, preload map, site search, and prerender list.

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

Hero descriptions fill their available width up to the shared maximum rather
than shrink-wrapping their text, so Safari does not wrap a planned desktop line
before the explicit line break. Phone copy remains free to wrap.

Email is the visual reference for product pages. Tasks, Channels, Documents,
Agents, Calls, and Reviews use `ProductPage` on top of `FeaturePage`: centered
Slab heroes, a 920px outer feature measure with 24px inset, left-aligned
feature copy, practical FAQs, and the shared
shared product closing CTA. The Email and CRM compositions remain independent.
Focused `ProductDemo` subgraphics also share Email's cool glow, fine dotted
texture, and bottom fade. The fade sits below the content so editors and
reply controls remain readable.

Product copy should name a real mechanism and explain what it enables: CRDT
sync, direct agent edits, indexed email search, bidirectional references, or
channel-based sharing. Verify claims against the implementation. Avoid vague
“context,” “move work forward,” and “all in one place” headlines, demo narration
as feature prose, and unqualified superiority claims. Explain technical terms
once in plain language; keep demo disclosures in relevant FAQs. Omit small explanatory captions below
product demos, including changing walkthrough narration inside their footer
controls; retain useful keyboard shortcuts and controls.
Write it the way the founder talks to another founder: plain words, “we,” the
competitor by name when the comparison is specific, and why we built it.
Feature and benefit introductions use two paragraphs from `product-introductions.ts` immediately
below the hero tutorial and above the feature sections, using the H2 section body
typography: explain what we wanted from existing tools, then
the one or two concrete benefits of Macro. Keep comparisons specific, distinguish
product goals from shipped integrations, and preserve the founder's emphasis on
agents in Chat, prioritization in Mail, writing and collaboration in Docs, and the
unified event system in Routines.
Include all five benefit overviews and Save money; place the Save money note below its hero, before the calculator, since that page has no video.
Use a subtle increase in text brightness for emphasis in these introductions;
keep the surrounding 370 font weight rather than rendering bold text.
Use 33px type and -0.5px letter spacing for body slab headings on every non-homepage
route, including features, benefits, documentation, and articles. Keep hero H1s,
sans-serif headings, embedded app graphics, and `/` unchanged. Allow long body
headings to wrap at that size instead of shrinking them. The shared rule lives in
`src/styles/body-headings.css`.

Demos are faithful to the signed-in app: its labels, layout, icons, and
hover-only controls (the message toolbar appears on hover, as in the app).
Interface icons are explicitly frozen from app revision
`9aa2c2a8740a330289373121b93c786640b0d97e` in
`src/assets/app-icons/system` (plus `share.svg`). Use that original Macro family
for navigation, feature diagrams, demo controls, entity links, task status and
priority glyphs; retain third-party brand logos and authored animated illustrations.
Import only individual used assets through `@icon/system`, keeping the website
independent of app runtime code. `src/styles/site-icons.css` mirrors the app's
regular/bold weights in light and dark themes; preserve `data-macro-icon` and
`currentColor`, and never apply the old 256-unit stroke overrides. Composer send
actions use the app's bold arrow. See the icon snapshot README when refreshing.

Don't invent chrome such as step chips or explanatory labels inside a mock, and
don't show features the app doesn't have. Operating pointers use `DemoCursor`
and `primitives/createDemoPointer`: a standard 20px dark mouse arrow with a stable hotspot,
restrained click feedback, and element-relative positioning. Keep its last
position when a target disappears; changing content or opening a menu must not
remount the pointer. Use actor labels only when they explain who is editing,
and use the caret variant for collaborator text insertion. Background agent
updates do not need a simulated mouse. Size
each `ProductDemo` to its scene with `height`/`mobileHeight` so a window is
never mostly empty, and seed enough content that the first frame already
reads as a real workspace.

Product stories live in their feature's `components/*/*Stories.tsx` files.
They reuse frozen product presentation and local workspace data. Call records
and GitHub review details port the smallest presentation needed from the app;
they do not initialize calls, run checks, post GitHub comments, or merge code.
`createProductWalkthrough` and `createEmailWalkthrough` share the same clock:
start when the configured portion is visible, preserve the remaining step delay
while offscreen or hidden, and show a useful static result for reduced motion.
`observeDemoTakeover` pauses the current scene when the visitor enters or edits it.
Preserve edits while the demo is visible or a control inside it has focus.
`DemoInteractionBoundary` may recreate an interacted demo after 30 seconds fully
offscreen and unfocused; returning sooner cancels the reset. Hidden tabs do not
run that timer. Use its `render` factory so scene state, timers, and cursors are
recreated together. Standalone `/demo` visits keep manual control. Page scrolling
alone does not enter a demo. The default start threshold is half the frame;
scenes targeting a composer can require that input area to be fully visible.
Repeatable feature stories use `loop` with a 6–10 second result hold (the short
keyboard and folder tours use 5.5 seconds). Reset content, menus, selections,
outputs, and scroll positions together before the next sequence. Never animate
completed work backward. Hide the operating pointer during the result hold;
retain it between actions within a sequence. Live-call previews and static
workspace heroes remain available for exploration without automatic resets.
Use `demoTypingActions` for new human-authored input: reveal one character at a
time with short word and punctuation pauses, then hold briefly before sending.
Schedule typing on the scene's shared clock so offscreen pauses, takeover, and
resets apply to every character. Preserve existing conversation history and
loaded records; incoming messages and values copied by a control are not human
typing. Keep agent-generated content distinct from human input.
Express scene steps as ordered actions with reading time before each action.
Every automated mouse action must show the shared pointer before changing the
UI, including account connection, inbox selection, Share, and Send. On phones,
open the actual inbox menu before selecting its controls. Keep the pointer above
local menu surfaces; keyboard shortcuts and background agent updates do not
simulate mouse input.
Approach a real control, click, show its menu, approach an option, select it, and
hold the result. Share the local controls and save handlers with manual input;
prevent menu autofocus during playback only. The task-creation scene is the
reference for this sequence. Interaction tests cover
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
the authenticated `/app/*` routes. In standalone dev and preview servers,
GET/HEAD navigation to `/app` or `/app/*` redirects to the same path and query
on `VITE_APP_BASE_URL` (default `https://macro.com`), where signup and the real
app run. Set it to the separate `apps/web` origin for local signup testing. This prevents Vite's
website fallback from rendering an empty shell for app links. Production routing
is unchanged; run `apps/web` separately when testing local signup changes.

`/download` is headed “Download Macro Alpha”, says “Available for macOS and
Linux”, and has one download button.
Desktop Linux browsers receive the x86_64 AppImage; other browsers default to
the Apple silicon DMG, with the selected platform named in the button.
It searches recent stable GitHub releases for each installer, skipping CLI-only
releases and unfinished platform uploads.
Verified direct installer URLs remain usable while loading and if the API fails;
update these fallbacks in `desktopDownloads.ts` when retiring older installers.
The separate “All releases” link opens GitHub, with the selected installer's
release version displayed beneath it.
The page hides the header's Sign Up action, has no web-app download option,
and has no header/footer navigation entry.
Check the installer link, keyboard navigation, and desktop/mobile layouts.

Before the first prerender build, install Chromium with
`bunx playwright install chromium --only-shell` (add `--with-deps` on Linux CI).
Run `git lfs pull` when migrated video files have not been fetched. The build
writes the public artifact to `apps/marketing/dist/`, verifies the standalone
boundary, prerenders public pages, and finishes with the SEO migration gate.
Keep the desktop homepage introduction compact, with a 44–53px headline and a 52px Sign Up button below the welcome constellation. Describe task automation through agent assignments and linked pull-request status updates, without claiming that users never create tasks manually.

The homepage uses Solid SSR and hydration through the same App router as feature pages. Prerender it with the website entry template so its styles load before hydration; reserve the signup template for `/start`. Keep SiteHeader mounted in RootLayout when navigating to or from `/`; sidebar Home links must use client-side routing. Desktop sidebar space and visibility must be present before hydration, without waiting for the mobile menu state. `/start` retains its separate signup entry. Both Vite builds compile Tailwind so
prerendered demos include their UI utilities before the client bundle loads.
Build verification checks sample workspace controls, icons, avatars, and layout
with the client bundle blocked on desktop and mobile, including cream URLs that
must remain dark while light mode is disabled.
It also checks that the homepage's first-painted heading retains its DOM node and
geometry, then exercises navigation, product links, static hero artwork, workflow previews, and phone
signup routing. The standalone sample workspace and product demos are checked
separately.

Architecture regression tests create real temporary source graphs, CSS files,
assets, and package symlinks. They verify that valid website references pass
and app imports, type-only leaks, inherited dependencies, external CSS scans,
missing assets, and compiled app artifacts fail. After changes, also run the
repository's `just check` and verify user-visible behavior in a browser.

## SEO and deployment

`/delete-account` is a public, prerendered account-deletion help page. It offers an email request path without requiring sign-in or an app
installation, plus instructions for the in-app deletion flow. Keep its data and
retention descriptions aligned with the deletion services and the Privacy Policy.
The seven-day cleanup window is a target after verification, not a guarantee;
shared-content and legal/backup retention exceptions are described separately.
Verify the email link, direct navigation, and readability on desktop and mobile.

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

`vite preview` uses the same directory-index mapping for extensionless public
URLs as the production CDN. `/crm` must serve `dist/crm/index.html`, never the
homepage hydration entry. Unknown preview routes return 404. The build smoke
check verifies phone touch entry and exit for every product demo, in addition
to homepage hydration, first-paint colors, and live theme changes in its shell
and native previews.

## Feature-page pattern

`FeaturePageSection` in `src/features/marketing/components/FeaturePage.tsx`
provides the lower demo chapters on Tasks, Email, Chat, Docs, Calls, CRM, Agents,
and GitHub. Follow the original Linear-inspired chapter layout: full-width
rules between sections, generous top and bottom spacing, a large slab heading
beside a full explanatory paragraph, the existing native demo, and descriptive feature cards. Give every heading two explicit lines using its title
tuple. Keep both lines short enough to fit at phone widths without shrinking
the type or clipping words.

Use only the feature cards needed for the specific demo, each with a concrete
action label, a required short summary, and an adjacent arrow. All eight
subpages use the same soft card layout; vary the content and count with the
workflow rather than repeating generic benefits.
Keep cards at the three-column width with equal gaps, centering rows with one
or two cards. Wrap at narrow widths without stretching the final row; stack
full-width cards on phones. Allow height to grow when text needs more room.

`SiteHeader` keeps the integrated documentation sidebar open on desktop, with a search icon aligned with the navigation icons. Phones use a click-operated menu button. Home remains available inside the sidebar. See
Integrated documentation below for content ownership and navigation behavior.

The product entry preloads the requested lazy route and its CSS before replacing
prerendered HTML, avoiding a header-only flash on first load. Run this preload
inside the asynchronous startup function, never with a module-level await:
the bundler can place route dependencies in the entry chunk, which must finish
evaluating before those routes can load.

Person and agent mentions use `--marketing-mention` with a soft tint in both
palettes, including static demo conversations and editable demo tokens. The
light document graphic uses that accent for resolved mentions instead of the
neutral website control accent. Comment anchors use the product’s yellow wash
and underline; the sample date-check comment anchors to the launch date, leaving
the checklist heading unmarked.

Feature chapters pair the working demo with a related conversation, rather than
adding feature-card guides or explanatory drawers.

Feature-page hero labels pair the matching app icon with “MACRO [PRODUCT]”
(e.g. “MACRO CRM”), without a slash or the Macro logo. The label links home.
Feature-page hero titles are short strings. Let them wrap naturally and balance
across up to three lines on phones; do not shrink them to force one line or add a
muted second line. Feature-page desktop hero titles are 40px at weight 320 in
dark mode. Feature, homepage, and blog hero titles use a 34–40px
responsive scale on phones, keeping the title visibly larger than body copy.

Feature chapters use the homepage's single-column layout on every screen: a
640px reading column above an 800px demo. Match production typography through
`product-feature-section.css` and `body-headings.css`: 33px slab headings with
-0.5px tracking at weight 320 in dark mode
plus the existing cream weight adjustment, and 17.5px Inter body copy at regular
weight 370 with normal tracking and #a8a8a8 in dark mode. Write feature-section headings
as short, concrete actions people can take, using the product's actual capabilities.
Let longer headings wrap at 33px on desktop and phones instead of shrinking them
to fit one line. Phones keep 17.5px body copy and inset page gutters. Full-width
section rules use 5.4% ink, with 20px more space below each rule than above.
Feature subpages use `FeatureDemoArt` for an upright workspace card with the homepage email composer's quiet surface and edge. Put avatar-backed conversation bubbles, contextual mentions, and agent tool activity outside the workspace, with clear vertical separation. Do not rotate cards, overlap windows, or wrap the conversation in a second panel. Collaborative docs retain their live conversations. The email-sharing feature graphic uses a single-panel sequence. Only add external illustrative messages when they explain context not already shown in the working UI.
Keep feature-demo channel and reply composers single-line. Disable native textarea resizing across website demos; composer layout controls their height. Preserve the default header height and add 12px of horizontal spacing before its conversation tabs. Draw the thread spine once; clip overlapping vertical strokes from reply branches. During each pending response, show the channel-style “Macro is thinking” avatar row with animated dots, and clear it when the response arrives or the visitor takes over.
Keep feature-demo property, tag, pull-request, and progress badges on the same translucent glass surface. Reserve the pull-request badge’s footprint while hidden and keep the status badge width stable so animation never resizes the card.
Feature app windows omit redundant introductory message bubbles and default to `FeatureDemoArt.glassFrame` for a 12px glass surround with an onboarding-style dotted, grainy accent wash outside the working UI. Keep the glass-framed gradient at 70% intensity and extend the backdrop 108px vertically and 120px horizontally beyond its container. Give the inner card a 64% charcoal fill and 16px backdrop blur, keeping it more opaque than the outer surround; use a solid fill when reduced transparency is requested.
Keep diagrams and external conversations unframed, and set `glassFrame: false` for the homepage document dissolve or mixed email-sharing composition. Calendar, booking, forms, benefit cards, and guide graphics reuse the glass material with solid reduced-transparency fallbacks.
The Docs version-control chapter reuses `TimelineArtworkBand` from the homepage history graphic, with the same animated playhead and reduced-motion fallback.
The Docs mentions chapter uses `HomepageCollaborativeDoc` with `showHistory={false}` to show the homepage typing and mention-picker animation in a single card, without the split email or conversation bubble.
The first Docs chapter uses `DocumentProjectDemo` with `teamEditing`: Julia and Jacob type into the same paragraph with named live carets and an inline formatting change. Preserve character-by-character edits rather than revealing complete lines. Keep the interaction boundary so visitors can take over without the animation overwriting their edits. Its window is shorter than the brief, so `doc-story-page-fade` dissolves it into the page with the homepage document's mask instead of cutting the discussion off at a hard bottom edge; keep the title, tags, and edited paragraph above the fade, and keep the scroll room that lets a visitor bring the discussion and composer up to the readable part.
The Docs backlinks chapter uses `DocumentReferencesDemo` with References expanded from the start. Show the sender, channel, timestamp, and message excerpt; clicking the reference opens its conversation. Keep the panel beside the document on desktop and use the full-width panel on phones.
`FeatureDemoBackdrop` is shared with the homepage and reuses onboarding's
`WorkspaceTexture` for dots and grain. Use overlapping, offset elliptical gradients with soft early falloff for a cloudy wash, rather than a centered circular spotlight. Remove the exported artboard radial fills so they do not restore a circular halo. Keep textures behind
UI; never tint or blur the text. On phones, reduce the spacing, not the UI's text size. Keep message bubbles outside the working card so they never cover its controls.
Product heroes use inline tutorial videos where available. Agent connection
options stack in the same reading column.
FAQ disclosures align with the same 640px prose and comparison reading measure.
Use “Questions about Macro [product]” for every product FAQ title, matching the
page’s product name (Mail, Chat, Docs, Tasks, Calls, CRM, Agents, or for GitHub).
Put FAQ questions directly below that title without an introduction or second
heading. Order questions by setup and compatibility, core capabilities, sharing
and permissions, practical limitations, then pricing. Lead each answer with the
answer, keep useful detail in the relevant question, and link to the specific
Macro product, setup guide, migration page, privacy policy, or pricing page.
Verify permissions and availability against current app guides before making
claims; distinguish pipeline fields from company properties, and channel-call
team sharing from standalone meeting access.
Website UI utilities and the frozen dark palette are scoped to `.feature-page`,
preserving the surrounding public-page styles.

Shared `ChannelComposer` sizing follows the app's compact-width measurement,
not a character cutoff. Measure an inert copy, update the live height only when
it changes, and ignore height-only resize notifications. Keep textarea and rich
mention inputs on that same sizing path.

`HomepageMention` is a clickable link, without a descriptive hover popup.
Email draft citations open the existing document and call viewers beside the
agent (or in place on phones), keeping the draft mounted. The sample PDF link
opens the Documents page in a new tab until a real sample PDF is supplied.
Existing sample documents can open directly through `/demo?document=<id>`;
the generated rollout-plan link uses the `rollout` fixture.

The email page reuses `HomepageEmailCompose` and frozen presentation from
`EmailInboxSelector`, `EmailSidebar`, `SearchBar`, entity email rows, `MessageCard`,
the share form, and channel composer. Keep headings and descriptions unchanged
in demo-only passes. These demos use local fixtures, with no live account, email,
sharing, or agent requests.

`email-demo-story.ts` supplies 31 emails for the retained inbox fixture and multi-account story,
with Macro, Gmail, and Outlook sample addresses. `EmailAccountsDemo` adds two
sample accounts, one per connection click. It stays in All inboxes, focuses an
individual account, then returns to the combined list. Do not click All inboxes
while it is already selected. Google authorization is deliberately omitted from this local demonstration;
the requested Outlook address is illustrative, not an implemented Outlook connector. Account, Signal/Noise, tag, and search filters
remain interactive. Keyboard triage uses 14 messages and demonstrates selection,
reading, returning, and archiving in that order.

`createEmailWalkthrough` starts each finite story only when enough of its frame
is visible. Pause offscreen, in hidden tabs, and when entering a demo or using its
controls. Reduced motion shows the usable final state. Do not add replay buttons,
animated cursors, explanatory captions, or decorative backgrounds.

Sharing shows the customer email and channel as two app splits on desktop, then
adds the linked email and a later reply. Wait two seconds after Austin’s
email reply before showing Julia’s channel response. Reduced motion shows both
immediately. Below 800px, show one pane at a time;
opening the email reference and going back preserves the channel conversation.
Keep message objects stable across walkthrough steps; only newly appended messages
should mount and animate, preserving existing bubbles, controls, and composer state.
The agent story shows the request, its call/document context, and the editable
draft in the actual chat order. Rich sample links use the existing composer’s
optional `bodyContent`; ordinary drafts keep their current behavior.
Use one neutral surface, fixed-height frames, scoped vertical scrolling, and short
opacity transitions. Test both palettes and mobile account selection, plus local
sharing, draft edits, keyboard scope, reduced motion, and timer cleanup.

`/crm` follows the same reading width, left-aligned slab headings, glass edges,
and the shared product closing animation. Its hero uses the CRM tutorial video.
The sections below demonstrate message-driven
record updates using the shared company UI, company enrichment, an editable customer record, company
mentions in documents and chat, and an agent preparing a follow-up.
`CrmCaptureDemo` turns the completed @Claude name into the native inline user
mention while the rest of the request types, without a dropdown. Preserve that
mention node until sending or resetting, and stop typing on visitor input.
`CrmRecordDemo` tours Emails, Calls, Files, and Tasks before returning to the
company discussion. It shares the follow-up fixtures so the evidence matches.
Keep the record populated with readable emails, documents, and tasks across
multiple statuses. Task rows use the native ListChecks entity icon; status
symbols belong in the group headings. Open the selected source by its own ID.
The final section defers `CrmFollowupDemo` until it approaches the viewport:
its automatic walkthrough stays in the agent chat, showing source reads before
presenting an editable email and concrete next steps. Use the real record tabs; do not invent Chat or PR
tabs on the company. Linked items reuse the existing source viewers, and returning
to the agent preserves draft edits. In the compact email source row, align the
sender, envelope, unread dot, and time on the first line; keep the subject and
truncated snippet together beneath it at desktop and phone widths.
Company-call and task rows accept optional
open handlers so this story can navigate locally without changing other records.
The sample PR is merged but its production check remains open; the draft must not
promise availability. Keep the evidence, reply, and next steps consistent in
`crm-followup-data.ts`. Source links open one full-width viewer only on request, on desktop and phones;
returning restores the chat. Do not automatically open a second workspace.
Playback stops on interaction and shows the result immediately for reduced motion.
`createCrmDemoWorkspace` supplies the same fictional accounts throughout the page.
The archived CRM hero fixture uses `CrmPipelineScene` and `CrmHeroSidebar`
for board/table switching, record search, and local pipeline playback. It is not
mounted on `/crm`; compact landing scenes and lower-section demos retain their
own state and animation lifecycle.
`CompanyPipelineEntry` follows `crm/components/pipeline-entry-cards` and appears
between the company header and Discussion. Pipeline edits remain separate from
company properties. The CRM update example types and sends through the company
Discussion composer, shows Claude acknowledging the request, updates Stage and
Owner, then posts the completion reply. Agent actions do not use a simulated
mouse. Render agent mentions such as `@Claude` and `@Cursor` as person mentions,
never document links or sparkle chips. The follow-up example holds its source
summary, email draft, and next steps separately so the draft is readable before
scrolling. Narrow email panes preserve the sender name; message details expose
the recipient information.
Verify board/table switching, moving a deal, editing its
pipeline entry from a record, and the mobile Back control. Keep these demos local
and check the record interactions at both desktop and mobile widths.

FAQ answers and the always-visible comparison are rendered in the initial HTML.
The CRM comparison appears above the FAQ, using the shared product table styling.
Retain FAQ class markers so prerendering emits matching FAQPage structured data.

## Tutorial videos

Product heroes put **Watch demo** beside Get started (`ProductHero`'s
`tutorial`, and the Email hero); the Agents page's Bring your own agent
section also has one for MacroD. It opens `TutorialVideoDialog`: the app's
Block tutorial, paused behind the app's play pill (play disc, presenter, "Watch
demo · m:ss") until the visitor presses it. Escape and the backdrop close it,
and focus returns to the button. Titles and lengths in
`core/tutorial-videos.ts` copy the app's `tutorials` messages; change both
together.

The videos and posters live once, in `public/video/tutorials/` (mp4s through
Git LFS), and deploy to `macro.com/video/tutorials/`. docs.macro.com embeds
them from there, including Blocks without a page here (Home, Drive, Calendar,
Scheduling, Spreadsheets, Databases, Canvas). Replacing a video keeps its
name; the deploy's `--size-only` sync skips a same-size file, and CloudFront
caches videos for a day.

## Paid-social landing page

`/tour` (`features/marketing/views/SalesPage.tsx`) is the Instagram ad landing
page. It is prerendered, `noindex`, out of the sitemap, and not linked from the
navigation. It has four parts, top to bottom: the original welcome hero markup
(`WelcomeStep` with `ContextScene`), the expanded `FeatureConstellation`, a
savings calculator, and a closing "Pick a time" button.

`core/sales-savings.ts` reduces the pricing calculator to one plan tier for all
tools and reads prices from `core/savings-calculator.ts`; update prices there,
not on the page. "Book a demo" and "Pick a time" are demo links: they open the
Macro team booking link in `DemoBookingDialog`, which reports a booking made
there to Meta. Verify at phone width: no horizontal scroll, calculator steppers
and toggles, and that the dialog opens.

## Blog presentation

`/posts` lists every article as one icon-and-title row. There are no category or
search controls; old `?tag=` links still reach the complete list. Article URLs,
metadata, and the chronological ordering stay unchanged.

`posts-shell.css`, `posts-index.css`, and `post-reading.css` keep the blog aligned
with product pages: 640px reading columns inside an 800px visual column, with
container-sized graphics instead of viewport breakouts; use the feature-page 32px
mobile outer gutter and 8px prose inset. Use 40px Roboto Slab Variable titles and
33px section headings with -0.5px tracking at weight 320 (plus the cream adjustment), and 17.5px regular
Inter copy in `#a8a8a8` in dark mode. Article heroes omit the All posts breadcrumb and use the feature hero’s 40px/1.06 slab title and 17.5px/1.65 balanced subtitle. On phones, titles use the feature hero’s responsive 34–40px scale; section headings stay 33px.
Comparison posts put their lead YouTube video below the title and subtitle, using `postMeta.heroVideo` in a responsive 16:9 frame up to 1000px wide. Move that video and its caption out of the article body; retain other distinct videos. Posts without a lead video keep their cover graphic.
Keep code blocks and tables within the reading column, with horizontal scrolling
when necessary. Comparison FAQs use `PostFaqItem` with native
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

`/demo?embedded=true` supplies the homepage’s embedded workspace.
`HomepageSections` mounts the connected sidebar breakdown, product chapters,
and closing sections. The homepage does not mount the embedded
workspace carousel; `/demo` remains available separately.

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

Style the six product comparison tables as part of the document: a compact
category heading, plain text column headers, 14px type, and thin horizontal
row rules. Use semantic tables with column and row headers. Keep backgrounds
transparent, without striping, a rounded frame, vertical rules, or brand logos.
Keep checks for verifiable capabilities and horizontal dashes labeled Partial for partial support.
Give partial cells a concise accessible description explaining the difference.
Keep pricing disclaimers off the tables and show only legend symbols used in
that table. Lead with concrete workflow and setup differences, retain useful
shared capabilities and competitor strengths, and remove generic filler or
repetitive rows. A partial mark must identify a real scope, setup, or platform difference;
never downgrade a competitor based on an unmeasured quality or speed claim.
For Gmail, distinguish shortcut navigation from a searchable command menu.
Credit all three email clients for managing multiple accounts; do not equate
that with a single combined feed while Superhuman’s sources conflict. For
Notion, credit task databases, sprints, and CRM templates while distinguishing
them from dedicated task and CRM tools. Paid features
and supported integrations count unless a row explicitly says built-in. A check
indicates availability, not equivalent depth. Keep dated source notes with the
comparison data and recheck claims before changing cells.

`core/feature-comparisons.ts` owns the fact-checked availability rows and maintainer
source URLs. `FeatureComparisons` renders one always-visible table above each FAQ, with a category heading and no subtitle or dropdown:
Superhuman/Gmail on Email; Notion on Docs; Linear/Jira on Tasks; Slack on Chat;
Google Meet/Granola on Calls. CRM uses the same visible layout and legend, with
Salesforce, HubSpot, and Attio. Omit generic records/email-history rows and end
with the native workspace distinction;
sales reporting is checked for those CRMs and partial for Macro’s agent summaries.
Connected collaboration tools receive partial credit alongside Macro’s native workspace.
Credit Macro’s Granola connection for reading captured notes, not for native
recording of other meeting apps or every feature of the connected product. ClickUp
stays in the migration overview. The migration overview uses the same framed
`FeatureComparisons` renderer with plain, unlinked headers and row labels. Its
verified rows and source URLs live in `core/migration-comparisons.ts`; CRM
templates and Salesforce-backed Slack CRM receive explained partial marks.
The wide overview remains horizontally scrollable on all viewport sizes. Keep
cells to checks, crosses, or explained partial marks and label built-in tools
explicitly. Detailed articles remain discoverable through navigation rather than
comparison-table labels. Source URLs are not shown in the UI. Icon-only comparison tables are not exported as prose
FAQ answers. Verify table columns, keyboard focus, scrolling, and existing
functional FAQs after moving or adding a comparison.

Keep comparison tables within the 640px prose reading measure and aligned with
the feature copy on phones. Allow labels to wrap; keep any horizontal overflow
inside the keyboard-focusable table region. Use neutral check marks and text;
white on dark pages and dark ink on cream pages. Comparison accent tokens
are scoped to product tables so legacy migration tables retain their styling.


## Agents page and shared agent sample

`/agents` shows three fictional workflows based on observed product use:
- A channel mention consolidates customer support, testing notes, and existing
  work into an editable client file upload brief.
- A personal agent progressively checks the calendar, reads the email and call,
  then presents its findings and creates the brief. Visitors can inspect those
  sources. Reduced motion shows the finished brief; interaction stops playback.
- Macro produces a folder-upload mockup from the client brief. Julia asks to
  preserve nested folders; Macro clarifies the design before Jacob asks Cursor
  to build it. Cursor returns one completed PR card, and Julia checks
  the preview. The sequence stops on interaction and completes without motion
  when reduced motion is enabled. The attachment uses FolderComposerMockup,
  a static copy
  of the app’s FolderComposer/EntityComposer presentation, not a hand-drawn SVG.
  The agent identity in that follow-up is a user mention, without a sparkle icon.

`AgentWorkflowStories.tsx` owns these scenes and `workflowData.ts` their local
records. The former `DummyWorkspace` hero with `agentShowcase` remains available
through `/demo?scene=agents`, but is not mounted above the Agents page sections.
Plain `/demo` keeps its usual starting view. Existing Northwind samples remain
available in the general workspace.

All scenes start in one pane. Record buttons open native document, email, task,
channel, or calendar viewers. Back and Escape return to the conversation and
restore focus. Edited documents persist when reopened. Agent-authored prose uses no inline bold emphasis. Generated files are inline document
mentions, opening the existing editor; do not replace them with custom summary
cards or source strips. The Tools for agents section continues the shared story: Julia mentions the agent in the document’s own discussion. The agent replies
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

Browser checks: follow the section demos’ sources and brief, edit and reopen the brief,
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
Check section source panes after resizing, including around 895px browser width.


BYOA presents macrod and external MCP as two
connection paths, stacked in one reading column on desktop and phones. Both setup links
remain visible. MCP commands reuse `AgentMcpSetup` inside an optional disclosure
without a fixed-height demo window. Verify each client expands and copies its
command. The closing FAQ answers model, access, review, and background-work questions.

## Docs page walkthrough

`/documents` introduces collaborative writing with its tutorial video, followed
by agent editing, linked sources, and organization demos. The former
`DocumentProjectDemo teamEditing` hero remains an unmounted local fixture, not a
live CRDT session or a latency benchmark. Keep the section demos editable.
The FAQ explains offline editing and simultaneous edits in plain language. All examples use a page-owned Website brief,
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
copies or nested docs. Keep competitor comparisons in the comparison table;
the FAQ leads with writing, importing, collaboration, and sharing in Macro.

Verify folder and tag navigation, search, source open/close with Escape and focus
restoration, edits surviving navigation, local sharing, tool inspection,
offscreen pause, and reduced motion. Compare desktop and mobile without a fade
covering the editor, apart from the first chapter's dissolve. Tests: `DocumentStories.test.tsx`. The checkmark comparison covers document capabilities. Notion uploads live in
page blocks or database properties; imports can convert supported files to pages.
Both tools support file uploads and Markdown import/export. The comparison makes
the folder and cross-workspace differences explicit without claiming file formats
are unsupported or comparing plan-specific upload limits.

## Calls page walkthrough

Three sections follow the tutorial video: start a call, act on decisions, and
find past calls. Recording playback and clickable transcripts remain in the
saved-record section demos.
Participant tiles are equal-sized in the marketing call grid, including You.
The start-call story replays on returning to view until the visitor interacts;
it never loops while visible or replays for reduced motion. The sequence briefly holds
the chat, then an unnamed pointer moves to Call and clicks. Connecting and
participants follow, completing in about eight and a half seconds. Interaction cancels the
staged transition and hides the pointer. The saved-call walkthrough also uses the
same pointer for hanging up, opening the record, and selecting a transcript line;
it rests between those actions. Agent follow-up updates do not simulate a mouse.

`/calls` follows a simple Thursday training handoff across a live call, saved record,
and agent-assisted task update. Calls-only fixtures live in `calls/call-fixtures.ts`
and `calls/call-project.ts`; shared workspace data stays unchanged. The former
In the call / After the call hero is an unmounted fixture. The follow-up and
saved-record walkthroughs hold their result for nine seconds before replaying;
visitor interaction stops them until the shared offscreen reset. Participants are illustrative; playback is
local and has no call audio or network effects.

Call demo scenes use camera-off participants and call controls, with no screen-share
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
The former native Tasks/Projects hero is no longer mounted on `/tasks`. Its
`TasksWorkspace*`, `tasksWorkspaceData.ts`, and `createTasksWorkspace.ts` files
remain available as local fixtures; the current hero uses the Tasks tutorial.
Source navigation shares task state; Close and Escape return to the task and
restore focus. The channel agent creates proposal and pricing tasks, then reassigns the proposal
only after the illustrated request. Both responses are threaded replies to
Jacob. The first request types into the channel composer. The follow-up is a
plain-text reply in that same thread, without another @Macro mention. Playback
waits 1.4 seconds before each agent reply and holds the first result for 2.2
seconds before the follow-up. It starts when the main composer is fully visible.
Composer handles and explicit reply state drive playback; no synthetic input or
Reply/Cancel button clicks are used. Keep composer geometry stable during typing, with rounded corners on touch and desktop and a 12px inset from the task demo frame. Visitor input stops typing and preserves the draft.
The message-to-task walkthrough first scrolls its request into view. Its persistent
pointer opens the task composer, selects High from the real priority menu, creates
the task, opens its linked brief, and returns through the inline task mention.
Do not mark a freshly created task complete just to finish the animation.
Use `DocMention`, `TaskMention inline`, and the editable `WorkspaceDocuments` viewer here;
generic boxed entity buttons do not match mentions inside a document.
Menu presentation and saves are shared with the interactive controls; only
automatic menu opens suppress focus.
The context demo types and inserts the Customer brief, Proposal request email,
and #sales references using three mention-menu selections. The picker opens
above the typed mention, clamped to the editor width to stay inside the demo.
Mark these owned editors with `data-demo-mentions="off"` so the global demo
mention menu cannot open a second picker or intercept Enter. Keep inline icons
and underline offsets proportional to the editor font, as in DocumentMention.
Hold all three completed references
without a parked pointer, then reset all three together for the next loop.
Visitor input stops playback until the shared offscreen reset;
reduced motion shows the result. Inline task mentions open their linked documents, emails, and conversations. PR playback updates status, never the task’s checklist. Focused task-detail
frames grow to fit the discussion and composer above the decorative fade; verify
no inner scrolling or horizontal clipping at desktop and phone widths. The full
workspace list keeps its normal scrolling. Jacob’s quote links to his Linear article.

Verify task edits, source navigation, owner/status menus, inline source links and
return navigation, the agent’s reassignment, and comparison FAQs on desktop and mobile.
Comparisons live in individual FAQ answers for Jira, Linear, Notion, and ClickUp;
keep them specific to workflows. Notion supports task databases, subtasks, and
dependencies. Do not describe it as lacking granular tasks or imply that all
Macro Tasks complete automatically. Keep migration, pricing, and comparison links.

## Chat page

`/channels` leads with opening referenced work, then channel-based access, agents,
and a combined catch-up section. Keep docs, tasks, and email references inline
in messages. Chat fixtures include original, scrollable history. The opening
walkthrough starts full-width, scrolls back, then moves and clicks the shared
cursor to open a doc and an email in the split. Manual input stops it.
The document stays mounted when email opens in a third split. The former hero’s
`chatSplits` variant is retained as an unmounted fixture. Wide section layouts divide the
available content width equally among all open panes; widths below 240px per
pane switch to one active pane. Each pane keeps its own selection and edits.
Smaller frames show one active pane at a time;
Back to channel retains open items, while Close removes only that pane. Email
uses the full workspace email view and an original two-message thread. Share types and selects #launch in the document Share UI, sends a short message,
shows the channel's access grant, then opens the delivered file from the channel.
Autoplay and manual sharing use the same form actions. Reset both the grant and
the delivered message between untouched loops; public-link access stays separate. The agent story
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
and coding-agent session. The former side-by-side PR/Changes hero is no longer
mounted. Channel playback begins unsplit, opens the inline PR, then opens Changes; interaction
stops playback. Narrow panes show the active view, and Back/Escape return to the
channel without discarding its conversation. The task demo links the PR before
moving to In Review, illustrates a confirmed merge, and updates Completed without
changing checklist items. Inbox playback holds the opened request for 8.5 seconds
before resetting its pending/read state; marking an item done stops the loop.
Keep Julia’s coding request and Cursor’s single completed result under the
original bug thread. Show the report and reproduction before the PR arrives.
Do not add a separate acknowledgment or duplicate prose reply from Cursor; the
completed agent card retains its session and PR link.

GitHub presentation follows `block-pr/PrDetail` and `features/changes` at
`e2bd582d5f991896bbc69921ee2447def7360636`. Diffs are frozen Pierre renderer output,
regenerated by `bun scripts/generate-github-diff.ts`. No GitHub service is called;
merging and all edits are local. Verify file selection, split/expanded changes,
merge cancel/confirm, task source links, reduced motion, manual takeover, and
390px/768px/desktop layouts. Keep captions and repeated explanatory paragraphs
off this page. Source fixtures are isolated from the Tasks and Agents pages.


`WorkspaceDesktopDemo` retains its `heroFrame` option for archived examples:
a 1200px maximum outer width, graphite Monterey background, and responsive
canvas scaling. Current feature-page heroes mount tutorial videos instead.

Lower product demos use the standard 872px feature window, including Chat,
Docs, and GitHub. The earlier GitHub desktop-surround prototype is no longer
mounted. Chat and Docs retain equal-width source panes; when a pane would be
narrower than 240px, they use the existing single-pane navigation. Verify opening
and closing sources at desktop and phone widths, without remounting the original
conversation or document. Display names use first names. All product pages use
`HomepageClosing` for the static bottom Sign Up CTA and the shared feature heading styles.

Chat sidebar demo: `workspace/ChatSidebar.tsx` retains the earlier
All/Recent/Threads layout with local fixtures, shared Tabs and ViewSidebar
controls, 32px section headers, and a 4px header-to-list gap. It is not the current
app's sidebar parity target: `channels-view/components/rail/ExpandedChannelsRail.tsx`
uses Favorites, Team channels, and custom sections in one scrolling list, with a
sticky collapsible DM panel and no view tabs. Verify the demo's search, section
collapse, thread navigation, and opening a mentioned source after switching
channels. Message text uses the app's 15px/24px reading size; dark surface and edge
tokens are frozen from `apps/web/src/index.css`.

Keep Merge/Merged and Open session actions in the shared agent chip at the same
24px height and pill radius, with touch resizing disabled for both.

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

In the retained email demo, Austin uses the fictional address `austin@example.com` and
Julia’s Cc address is `julia@macro.com`. Spreadsheet and pipeline contacts use
their company’s domain; fictional companies use reserved `.example` domains.

The document animation renders saved scheduling links as calendar mentions with a short label, matching Macro’s booking link presentation.

### Retained spreadsheet and CRM demo components

The company and person cells in `HomepageSpreadsheet` use the editor’s mention
presentation. They open a local company record or its Team section through
`SpreadsheetRecordPreview`, leaving the sheet selection and edits in place.
Closing restores focus to the mention. Editing a linked cell into plain text
removes its reference; undo restores it. Check mouse and keyboard opening,
Escape/close, and phone-width record tabs.

The Drive page is `DriveStories`: eight sections that all read one small set of files from `driveFiles.ts`, so a file keeps its name, kind, source, and tags from graphic to graphic. `DriveFileRows` is the shared file list, with entity icons coloured as the app colours them. Sharing reuses `DocumentSharingDemo`, the agent section uses the agent session replica, and the record section opens the CRM record on its Files tab. Paper graphics on the Drive and Spreadsheets pages sit in the section's glass frame (`demo={{ tone, glassFrame: true }}` with `backdrop={false}` on the graphic) so they get the same dot-matrix and glow as the product demos.

The Mail feature page's sharing, drafting, and routine sections use the app's own replicas, not drawn diagrams. Sharing is `EmailSharingDemo` (the email block, its Share form, and the channel it posts to), also used by the inbox sandbox. Drafting is `EmailDraftStory`, the homepage's conversation and composer; both read their messages from `emailDraftMessages`. `EmailRoutineDemo` shows a routine's effects in order: the email arrives in the inbox, Macro posts it to a channel, and a push notification drops in. Reduced motion shows each finished result immediately.

The retained `HomepageCrm` illustration has no playback footer or Pause/Replay controls;
it still pauses offscreen and when a visitor enters the demo.

Its drag hides its source card while preserving its slot. The drag
copy and pointer sit beside the panning canvas and use viewport-space transforms;
use a box shadow rather than a moving drop-shadow filter to avoid ghosted trails.

Its artboard fixes its card, header, and row dimensions in pixels to
match its animation coordinates before applying the viewport scale. Its shared
card surfaces are display-only: no hover transitions or cursor transform easing.
Pickup and drop must preserve the card’s screen-space bounds on phones too.

### Product copy

Use [Jacob’s product notes](https://macro.com/app/drive/md/019ef55a-ea39-7fef-9014-da8e4b25c845)
and [CRM notes](https://macro.com/app/drive/md/019f852e-c8b0-7fe1-a228-11be3161b321)
as wording sources for the homepage and feature pages. Check Jacob-authored
messages for cadence, excluding pasted agent output and automated summaries.
Prefer concrete actions and examples over generic claims about context or
productivity. Use excerpts from the notes, shortening and correcting dictation
errors where needed; do not invent slogans, founder motivations, quotes, or
connecting marketing copy. Keep each
feature paragraph to one or two sentences. Retain essential setup, access, and
plan details from the guides in the FAQ. Keep claims consistent with current
behavior; the notes are not authority to promise competitor superiority or
unsupported features. Preserve the typography and live demos when editing copy.


## Integrated documentation

Desktop navigation stays persistently open with a search icon aligned with the navigation icons; phones retain the menu button. The documentation sidebar is shared across the
website. Keep it flush with the left edge and full height, with a vertical
separator and an independently scrolling guide list, rather than a floating card.
Lead the navigation with a Home row using the app’s house icon, then the graphic-led feature pages.
Use `target="_self"` on Home to load the standalone homepage, bypassing the app router’s signup redirect. Group Email, Tasks, Chat, Docs, Calls, CRM, Agents, Databases, Calendar, and Coding under Top features, in that order. Coding links to `/github`; keep the route and guide unchanged. Follow with Main benefits (Save money, Graph DB, Autotagging, Permissions, Event system, and Omnisearch), with an icon on each link, then More features for Drive, Sheets, Forms, Canvas, Snippets, Booking links, Routines, and Skills. Use the Macro @ icon for Graph DB, the graph icon for Permissions, and the Macro tag, lightning, and magnifying-glass icons for Autotagging, Event system, and Omnisearch. Match Omnisearch to the sidebar search field. Keep these short labels local to navigation; retain the existing guide titles and URLs. Keep all groups expanded. Show each product once:
remove its matching guide from the default navigation, including Folders under
Drive and Reviews under GitHub. Keep the written guides in each feature page’s expandable reference section; direct legacy URLs redirect to that feature, and search opens its reference section. Keep the remaining reference under muted section
labels, with all links visible rather than chevron dropdowns. Use matching 20px outer gutters on both sides of the website sidebar; keep search and row backgrounds inset from the separator. Match the app’s inner ViewSidebar with 8px row insets on both sides (including headings), 32px desktop rows,
square rows with no filled selection background, regular 14px labels, and 20px icon slots with 16px glyphs. Use the app navigation’s `chats-circle` icon for Chat in both the sidebar and product hero, not the single-channel hash icon.
Match the sidebar background to the page in every theme, with a subtle 1px separator at 7% navigation ink. Dim inactive sidebar labels and icons to 60% navigation ink against the sidebar background, and group headings to 70%; keep selected and hovered links at full navigation ink. Keep the desktop sidebar permanently open at a fixed 241px width, with no collapse or resize controls. Keep mobile navigation full-width. Hide the sidebar scrollbar while preserving scrolling; keep the search field pinned at the top. Use the app’s 16px search icon in the same 20px slot and 8px inset as navigation icons; align the search text with row labels. Use “Search pages ⌘F” on Mac and “Search pages Ctrl+F” elsewhere in a faded 14px placeholder matching the navigation label size. Keep the desktop search field and header actions 40px tall, starting 20px from the viewport top; wide pages with an outline stack Book a demo beneath Sign Up. Keep the pinned search field 40px tall with a faint flat border;
use 44px rows and a 48px search field on phones. Keep consistent link alignment and use the default arrow cursor on sidebar links. Search feature pages, setup guides, comparisons, customer stories, and useful website pages by title and content, using the app Settings search pattern: icon, title, and muted location. Rank title matches first and tolerate minor title typos. Merge each feature guide into its feature result. Exclude changelogs, the retired Tool Reference, engineering posts, legal pages, and company pages; show at most eight results. Command/Control+K and Command/Control+F open and focus search; arrow keys navigate results and Enter opens one. Escape clears a query first, then closes the mobile drawer; the clear button returns focus to the input. Load the search index only when search is focused or typed into. Build the index in `scripts/site-search.ts` and `scripts/documentation.ts`; register new informational routes there.
Keep /docs/switch-to-macro focused on bulk importers and MCP migration paths, titled “Switching guide”. Its Switch to Macro sidebar group links to that guide with a setup icon and the Linear, Notion, Superhuman, Slack, and ClickUp comparison posts labelled “Versus [product]” with their monochrome brand icons. Use /download for Get the app and permanently redirect retired guides to their consolidated destination.
Keep Changelog as one sidebar link; monthly archives remain accessible from its page, outside search.
Keep the outdated Tool Reference unpublished and redirect its former URLs to MCP Setup.
Keep concise FAQs on feature pages and put the full written setup, shortcut, and limitation reference in the expandable Setup and reference section below. Do not replace interactive demos
with documentation screenshots. Desktop navigation remains open and pushes the content aside. Phones keep the article visible and use a full-screen drawer on demand; Escape closes it and restores focus. The mobile toggle folds its three bars into a close mark while the drawer is open and never shows the Macro logo; it keeps a 54px touch target, shows its highlight only on hover-capable pointers and keyboard focus, and sits in a 68px bar matching the drawer background, with the search field 8px below. Use the foreground color for the mark (white in dark mode). Reduced-motion mode skips drawer transitions.

`src/features/documentation` owns the reading page, MDX components, and sidebar. Start guide headers with the title and description, without a Documentation eyebrow.
Use the matching app block icons beside feature links, block guides, and their
search results; keep them 16px, monochrome, and decorative for screen readers.
Its typography matches the blog and feature pages: 40px/320 slab titles,
33px section headings with -0.5px tracking, 17.5px/370 Inter body copy, and `#a8a8a8` dark-mode body color.
Keep the 640px reading column and scale titles to 28px on phones; preserve smaller
reference tables, code, and navigation labels.
`scripts/documentation.ts` compiles the canonical content in `apps/docs` through
MDX and Solid, rewriting links to their canonical page or feature reference section and media into `/docs-assets`.
It loads each guide separately, emits media once, and uses the existing
`docs.json` navigation. The prerender build includes reference content in the owning feature page HTML. Only standalone guides enter the sitemap; embedded guide sources do not get duplicate pages. Keep comparison and reference tables within the reading width.

Run `bun run test` for navigation/link tests, `bun run type-check`, and the full
website build before shipping docs changes. See `apps/docs/README.md` for content
editing and the separately authorized old-domain redirect cutover.

The build also runs `scripts/verify-docs-redirects.ts` against the permanent
records in `apps/docs/docs.json`, the captured old-host sitemap, every current
guide, Markdown export, and media file. Preserve the published URL baseline
when adding redirects. `--origin=<static-preview-origin>` additionally checks
HTTP responses. `seo/page-redirects.json` is the single map for retired website routes: local servers and CloudFront return 308 responses preserving queries and fragments, with static fallback pages for other hosts. Deploy the website stack with the site to activate edge records. The guides retain scoped styles for previews restored from the
live docs; these do not change the visual feature pages.

### Product comparison links

Keep feature videos free of below-video competitor strips and comparison links. Comparison articles remain accessible through the sidebar.

### Product tutorial videos

Size feature-hero descriptions from the headline width, about 10px narrower, and balance wrapping within that cap so the last line stays substantial, with no isolated words. Keep desktop descriptions to two balanced lines by tightening the copy without changing its meaning or voice; preserve readable font sizes and allow natural wrapping on phones. Avoid per-page fixed measures and forced line breaks. Keep the second desktop line shorter than the first; verify rendered line widths in the browser and tighten copy when needed.

Feature-page heroes embed the app's Block tutorials through
`TutorialVideoEmbed`, with its play disc, presenter portrait, byline, and duration.
Videos load on play, never autoplay, and replace the old interactive hero mockups. Keep long demo labels inside the player on phones: allow wrapping and hide the portrait and divider below 400px.
Use consistent bottom-left app-window framing for every video placeholder, with
an original layered landscape in `TutorialWallpaper`: distinct colors and ridge
shapes for each feature, in the style of the soft Monterey landscape. `*-preview.jpg` files are overview frames from each tutorial;
the shared CSS crops their 1700×918 app window at (110, 132) from the 1920×1080
frame. Extract at 3.8s, except Drive at 3.4s and Chat/Calls/Agents at 5.6s.
The Spreadsheets and Databases previews normalize the opening zoomed window to that same frame before display. Their app-window crops at 3.8s are `(320, 164, 1600, 864)` and `(0, 114, 1864, 966)`, respectively, resized to 1700×918 and placed at (110, 132).
The decorative preview disappears on play; the original video and native poster
remain unchanged. Keep the player borderless, with 44px squircle corners
(28px on phones) and matching clipping during playback. Browsers without
`corner-shape` support retain rounded corners.
`ProductHero` keys the player by tutorial ID so switching tutorials resets playback
and the presenter pill before the next video starts.
Spreadsheets, Databases, and Canvas use their tutorials in the feature hero. The MacroD tutorial sits in the Agents page’s “Your agent, inside Macro” section.
Company graph, AI tagging, Automatic permissions, Workspace events, and Unified search use `BenefitVideoPoster` (`preview: 'benefit'`): floating product diagrams on black with a soft neutral glow, faint dot texture, and precise callouts. Keep color in the small product accents rather than a surrounding frame. Keep benefit page backgrounds black, with only a faint, localized neutral glow behind diagrams (4% at the hero glow center). Keep the play control below the focal artwork, with a separate control lane on narrow screens. The decorative poster disappears when playback starts. Routines, Skills, and Forms use the shared app-window preview and their own feature wallpaper. Extract Routines at 8s, and Skills and Forms at 3.8s, using the same 1920×1080 frame and window crop as the other features.
Pages without an app tutorial keep a text hero until a video is available. Keep the titles and durations in `core/tutorial-videos.ts`
in sync with the app; the Docs tutorial is the 1:15 version focused on @mentions.
Videos and posters live in `public/video/tutorials/`; merged docs embed the same
public assets. The docs compiler resolves tutorial videos and posters on the current
origin, so previews use their own version rather than an older production video.
Keep the interactive graphics within the feature sections below these videos.

Show tutorial previews at full brightness without a dimming overlay.
Keep tutorial previews and presenter controls theme-aware on feature pages and
in the merged guides. Dark previews use the original video frames; light previews
use the existing local UI fixtures. Recreate the light assets with
`bun scripts/capture-light-tutorial-previews.mjs https://localhost:5191` while Vite
is running. The generated `*-preview-light.jpg` files are already cropped to the
app window. Do not invert screenshots or portraits. Keep the per-feature
wallpaper and original playback in both themes. The documentation compiler routes
known tutorial embeds through this player; external videos stay native.

Check Paper annotations, avatar initials, and status colors against the light
surfaces. Use the shared light-mode panel, floating-card, and popover shadows in
`cream-preview.css`: give primary windows a visible base and never stack a dark glass drop shadow underneath. Nested
panes stay flat; Paper annotation pills use their lighter floating-shadow token. Frozen code diffs contain both syntax palettes: set their shadow host's
`color-scheme` to match the page. Verify new graphics on desktop and phone in both
palettes, including the guides and articles that reuse them.


Keep the Tasks hero and section copy grounded in the existing Macro vs. Linear
article and task documentation: explain source links, assignments, views, and
GitHub status updates rather than adding generic task-management claims. Let the
hero description wrap at readable text sizes on phones. Give the desktop Tasks hero a 600px text track so its description uses two lines. Keep the Tasks hero
centered like the other feature heroes, including its label and actions.
Use the shared feature-video width for Tasks, with a soft shared gradient
and grain behind the player.

Main benefits use `BenefitPage` on their existing `/docs/...` URLs. Keep these
as centered marketing overviews with action-oriented sections and annotated,
translucent HTML illustrations. `benefit-pages.ts` owns the overview copy;
`BenefitGraphic` owns the static illustrations. The final Unified search section uses `AgentParallelSearchStory` in the shared agent session: start all five search tool calls together, reveal results before the answer, and let visitors expand results and inspect their sources. Keep its existing `search-history` anchor and the short outline label “Parallel search.” Reduced motion shows the completed answer immediately. Keep the original MDX in the expandable
Setup and reference guide, including its existing deep links. Explain concrete
workflows using the founder's supplied language. Describe channel access as a
channel grant, and label event-driven agent actions as configured routines.
Vary Company graph visuals by what they explain: use the shared channel/PR demo, Rahul's annotated email Source-property art, the native document References panel, and a task notebook with navigable task mentions and incoming references. Avoid repeating generic paired cards and arrow diagrams across the page. Keep product controls recognizable and mobile labels legible.
Use the depicted block's existing `TutorialWallpaper` palette for benefit-example icons, card gradients, and the surrounding glow. Mixed examples retain each block's own color; agent actions use the Agents palette, not the benefit page's accent. Keep tag colors independent of block colors.

The Tasks page uses `TaskPaperGraphic` directly within its creation, workspace,
and view sections: Rahul’s annotated task-row, properties, and view-control
artboards from [Paper](https://app.paper.design/file/01M6PXVGNX4GQCRSB96243VCJ1/p-1-0).
Keep their exported geometry and theme tokens in `components/tasks/paper`, with
separate phone artboards for rows and properties. Use transparent artboards over
a half-strength shared cloudy glow, with visible
but restrained grain. Give highlighted rows translucent glass fills and fine
inset edges. Do not use solid panels or a separate gallery/tab switcher.
Scale these illustrations to the full feature-section width, beyond the reading
column, keeping annotation positions and reserved height proportional. These are
illustrations, not functioning task controls.

Allow feature headings to wrap within the available content width on phones and
beside the tablet sidebar. Check 320px, 390px, and 768px viewports, including
comparison tables, mobile navigation, and touch playback, before release.

Email, Chat, and Databases use the same treatment through `PaperFeatureGraphic`
and the exports in `components/paper`. Keep each illustration in its matching
feature section, alternating with the existing 3D scenes. Email shows account
selection and email-to-task; Chat shows the create menu and an agent conversation;
Databases opens with a compact, background-free Notion importer preview based on
the app's `NativeImportPane`, using local selected-page fixtures and the real
selection, copy-only notice, security note, and Import action. It also shows a
query returning a chart. Preserve the 800px
section width around the 640px reading column. Use transparent artboards, the
Tasks glow/grain strength, and the site background token for edge fades in both
themes. On phones, keep controls and callout anchors together in the compact
layouts; database fields use Rahul's separate phone artboard. These are static
illustrations, not functioning product controls.
Keep the database column/record illustration background-free on desktop and mobile: omit the grid, rulers, backdrop, and opaque edge fades; use a transparency mask for its cropped table edge.
Size custom Paper scenes through `height` and `mobileHeight` instead of leaving empty artboard space. The email auto-tag scene highlights one inbox row against faded neighboring rows, with pill callouts above and below on desktop and below the tags on mobile.
Keep the Chat agent illustration focused on the conversation: use the app’s
circular Macro-logo avatar, sender-line Agent and Open Session chips, and plain
reply text; omit the unrelated call toolbar and boxed completion card.

### Additional workspace feature pages

`WorkspaceFeaturePage` serves `/spreadsheets`, `/databases`, `/canvas`, `/snippets`,
`/calendar`, `/booking-links`, `/drive`, `/routines`, and `/skills`.
Keep short overview copy and essential FAQ details in `core/workspace-features.ts`;
canonical instructions stay in `apps/docs/product`. Spreadsheets reuse the homepage animation; Databases alternates Paper art with
its homepage animation. The other pages pair a product example with a
related conversation over the shared grain and gradient. Register new routes in
App, its preload map, and the prerender list/module map.
Center result cards within the illustration beneath floating conversation bubbles.

`CalendarStories` gives Calendar three static illustrations for multiple Google and Microsoft accounts, finding shared free time in a channel, and reviewing agent-written invitations. Use the homepage’s `HomepageConversation` bubbles outside the settings and event cards. Match the app’s Team sharing choices (Busy blocks, Event details, Nothing) and selected calendars that count as busy.

`BookingLinkStories` gives booking links separate guest-booking, team-availability,
and agent-approval examples below its tutorial video. Keep these illustrations
non-interactive and base their copy on `apps/docs/product/booking-links.mdx`.

Do not add illustrated shortcut rows below feature-page heroes. Keep the main
product demos and the section illustrations; the sidebar provides feature navigation.

Keep the email-to-task illustration focused on the source email, create-task action, and resulting linked task rather than the full toolbar and property form.

The email page’s `#auto-tags` section illustrates agent routines tagging incoming email; reuse the shared `EmailTags` pills and keep the copy explicit that a routine performs the tagging.

Hide native scrollbars in the multi-account and keyboard email demos while retaining scrolling in their sidebar, inbox, thread, and composer panes.

The homepage email story uses `HomepageEmailCompose` with its default one-shot shimmer and word-by-word generation. Keep the composer visible from the start; do not add a separate looping paragraph-reveal sequence.

Keep supplemental feature guide links inside the FAQ reading column, before the privacy footer, using the shared reading-link style.

Give workspace feature pages two or three concise, source-backed sections beyond the opening demo. Cover distinct everyday uses and material limits in plain language; keep procedural detail in the linked guide, and do not add decorative mockups just to fill the page.

Blog product illustrations use `routes/posts/PostProductGraphic.tsx`, which lazy-loads the same local UI scenes as feature pages. Keep article typography scoped outside `.post-product-ui`, preserve the reading and art widths, and update captions to match the scene. Keep historical evidence as attributed text rather than depicting it as current product behavior.

Projects are part of Tasks: `/projects` and the former Projects guide redirect to `/tasks`. Project setup, sharing, and agent assignment are in the Tasks reference.

Page backgrounds use `page-aura.css` for static, diffuse gradients and fine grain throughout the full content height. Render the shared gradient layer at 65% opacity to keep it subdued. Feature pages reuse their tutorial wallpaper palette; benefit pages use neutral gray auras; the homepage and other editorial pages use the home video's blue palette. Keep the video wallpaper vivid, with its wave shapes confined to the video. Fade every backdrop edge, keep it non-interactive and behind the content, and avoid layering a second backdrop over the Wall of love or a nested feature page.

Feature hero videos render with `TutorialVideoEmbed`, using the shared player dimensions and spacing.

`/replace-apps` is the first Main benefits link. It shares feature hero typography, combines app selection with the existing pricing `SavingsCalculator`. Keep its route registered for preload, prerender, and site search.

Use `ProductCopy` in feature section headings and descriptions to render explicit product names as linked icon-and-name mentions. Every mention's `href` must be a prerendered route (benefit pages live under `/docs/product/`): the build's link check in `scripts/verify-seo.ts` fails the deploy on a broken internal link, and pull request CI does not run it, so run `bun run build` after adding one. Display only the icon and short product name (Mail, Tasks, etc.), omitting the Macro prefix. Keep them contextual: only the products a section links to, with no pills in hero copy or decorative examples. Agents appears on nearly every page, so mention it in one section per page, the one about agents. Keep each section heading to one line on desktop; a pill's icon adds about a character's width. A product must be listed in `ProductMention.tsx` to render as a mention. Link to the product page, preserve readable mobile wrapping, and use the actual product icon. Render mentions as underlined inline links with no border, padding, or resting background; show a subtly rounded background only on hover, fading over 160ms and respecting reduced motion.

Pricing uses `ProductPage` and `ProductHero`, open Free/Pro/Max plan rows, an expandable semantic comparison table, the shared savings calculator, and `FeaturePageFaq`. Keep pricing FAQ typography identical to feature FAQs; do not reintroduce slab FAQ headings or separate pricing disclosure styles. Use `HomepageClosing` inside the feature-page wrapper.

On `/replace-apps`, combine the replacement logos and savings calculator into one selectable app grid, separated from the hero by a thin rule. Use an 80px rounded icon surface, a plus badge, a 1px green selected border, a 22px selected check badge, and 11px app labels at weight 350. Use the higher listed comparison plan without a dropdown, and group Google apps into one Google Workspace entry. Show only the app name under each icon; keep plan prices and inputs out of the grid. Keep the apps in one horizontally scrolling row with a styled range control and arrow buttons; retain touch and keyboard scrolling. Calculate estimated annual savings automatically in a right-aligned ledger below, with per-seat cost, seats and annual total, Macro cost, and a double-underlined savings total. Keep all four ledger rows equal in height and the seat picker borderless. Count bundled Microsoft apps as one subscription; automatic supplementary rates live in `replacement-app-costs.ts`. Keep the standard calculator on `/pricing`.


### Forms feature page

`/forms` appears under More features and uses `ProductFormsPage` with the shared hero, presenter video player, linked product names, glass illustrations, and footer. Its 49-second tutorial comes from `macro-inc/meta-ads` PR #62, through the web-optimized assets in `macro-inc/macro` PR #10113. Keep form responses mapped to database rows, booking after accepted submission, and sharing limited to invited people, channels, or anyone with the link. The canonical setup guide is `apps/docs/product/forms.mdx`, embedded on the feature page.

Feature, benefits, and documentation pages share `PageOutline`: the reading column is balanced between site navigation and a quiet section outline on wide screens. Use short topic labels from `page-outline-labels.ts` for feature and benefit sections, keyed to their heading IDs, and label question sections “FAQ”. Keep full headings in the page content. At narrower widths the outline is hidden so the content keeps its space. Sidebar groups use continuous subtle vertical guide lines, with a bright straight active marker and no rounded selection background, matching docs.macro.com. Match the right outline to the left sidebar: inactive links at 60% ink, its heading at 70%, and active or hovered links at full ink. Style “On this page” like the left group headings: 12px type, 1.6 line-height, weight 370, and an 8px gap below. The right outline uses 14px labels, 16px link indentation, and 32px horizontal padding inside a 241px column matching the left sidebar. On wide feature, benefit, and documentation pages, stack Sign Up above Book a demo in a 177px column aligned with the outline; retain the compact horizontal actions on smaller screens.

The homepage uses the same wide-screen right rail and stacked signup/demo actions as feature pages. `HomepageResources` has two matching groups: Downloads for iOS, Mac, and Android, followed by Links for GitHub, X / Twitter, LinkedIn, YouTube, and Instagram. Separate the groups by 24px. Display Links as a horizontal row of social icons with accessible names and hover titles, without a star count. Keep Blog and Documentation out of this resource rail. Keep mobile downloads aligned with the native app's store URLs; resolve the Mac installer through `desktopDownloads.ts`, retaining a verified direct fallback when GitHub is unavailable. Below 1440px the resources follow the homepage content.

Use full first and last names for people in channel mockups. Rotate stories across Peter Chinman, Wolf Mermelstein, Eric Hayes, Rahul Batra, and Austin Barron as well as the existing cast. Use the shared `homepagePeople` profile photos; Rahul has an initials avatar because his Macro profile has no photo. Keep Valentina out of demo fixtures.

The Agents teamwork walkthrough uses a compact 600px frame and finishes on the completed Cursor session card. Keep that card visible at the bottom of the conversation, including with reduced motion; do not loop back to the initial design request.

Keep the server-rendered homepage headline visible on phones before JavaScript loads. Desktop and mobile retain the shared heading and its layout through hydration, with a working signup link. Verify both paths in `scripts/verifyHomepage.ts`. Retain the Chromium and WebKit checks, including pre-hydration logo sizing and typography. Before releasing homepage changes, also run `bunx playwright install webkit` and `bun -e 'import { webkit } from "@playwright/test"; import { verifyHomepage } from "./scripts/verifyHomepage"; await verifyHomepage(`${process.cwd()}/dist`, webkit)'` from this directory.

The homepage coding-agent result uses the email preview’s glass card and fade-in, with small regular-weight Merge/Open session labels. Omit the repeated requester attribution and quoted instruction above that result card.
