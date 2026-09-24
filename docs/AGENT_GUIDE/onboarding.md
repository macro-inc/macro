# Onboarding and getting started

The public homepage opens at Welcome. A centered “Get Started” link below the
hero copy uses the same destination and white pill as the header's Open app,
without the arrow icon. “Explore” and a bouncing down-arrow sit near the bottom
of the hero; the accessible label is “Explore features” and it scrolls the page.
The hint fades out on the first downward scroll and stays dismissed when returning
to the top. It stops animating and leaves the tab order immediately on dismissal.
Verify that both controls fit above the fold and remain separate on mobile and
short laptop screens. Reduced motion stops the bounce and hides the hint without
a fade.
Native scrolling reveals a separate
unification section before the funding / open-source / security proof row. As it
enters the viewport, scroll position moves the hero's app logos into Macro's
feature constellation. The traveling logos fade to 18% opacity in the first fifth of their travel
and disappear before the
final feature icons finish fading in, avoiding overlapping marks. The headline crossfades to “Replace 27+ apps with a single
system” and the grainy rainbow halos appear behind the nodes. The paused animation
timeline keeps matched hero and feature bubbles on the same moving path,
revealing their icons near arrival. Incoming bubbles stay faint until the last
fifth of their travel. Extra features unfold from the Macro bubble
and labels appear last. The full composition settles by the time the section
reaches the upper fifth of the viewport. Verify this on desktop and mobile,
including fast scrolling and reversal: no feature should still be unfolding
when the section is fully in view. Geometry is measured together before writes;
travel uses transform and opacity without animated blur, and completed keyframes
stop receiving time updates. The dev-only Preview controls offer Replay hero → features
at the selected Motion speed (including ⅒×). The timeline follows scroll position in both directions: stopping holds the frame and
scrolling back reverses it. Traveling icons render behind the headings and
subtext in both transitions. Nothing pins content, intercepts scroll input, moves
focus, or changes onboarding progress. Reduced motion shows the completed
composition immediately; resize and unmount clean up moving copies and restore
the hero. A third section shows a large GitHub mark, live repository stars,
“Fully open source. Yours to build on.”, the August GitHub Trending milestone,
and the existing a16z and security badges. The second section’s feature icons
travel into the GitHub mark on a paused timeline controlled by native scroll;
scrolling back reverses the transition and reduced motion skips it. If GitHub is unavailable, the source
link remains usable without a fabricated count. The founder quote and old proof
strip are replaced. A steadily visible vertical line draws downward with native scroll position
to the top of the sidebar. It does not fade; reduced motion completes the
line immediately. The sidebar has no separate visible heading or split rule.
The annotated Home sidebar brings docs, email, messages, tasks, calendar, CRM,
and external agents into one list.
Thin angular pointer lines connect the surrounding labels to rail icons and recent
items. The preview matches the live app's compact 32px rows, with a fine glass rim, soft cast shadow, and perspective. The plus opens the shared create menu with links to local
interactive examples; Search highlights matching example items as you type.
Escape closes search and returns focus to its button. Neither control creates
server content.
Full Demo is temporarily hidden behind `FULL_DEMO_ENABLED` in
`HomepageSidebar.tsx`. The public homepage shows only Breakdown: no mode toggle,
no expanded panel, and no mounting of the interactive workspace. Keep the demo
code for a later polish pass. The GitHub-to-sidebar line remains visible.
When that flag is re-enabled, at widths of 1000px and above,
“Breakdown / Full Demo” switches between the
annotated sidebar (the default) and a centered sample workspace. The toggle sits
below the graphic, with its active pill evenly inset. The vertical line from the
GitHub section stays visible in both modes. Expansion takes
about one second: labels fade first, pointer lines retract toward the sidebar,
then the main panel unfolds to its right. The panel's contents retain their final
width while the outer window expands; no text scales or reflows during the motion.
Collapsing reverses the sequence. Reduced motion switches immediately. Verify
both directions, rapid toggling, and resizing an expanded demo to a phone width;
the toggle and main panel disappear on narrow screens and Breakdown is restored.
In Full Demo, rail and list items switch local views: #launch uses the real
channel message UI and Markdown composer, Docs uses the editable Markdown editor,
Tasks uses the shared task table, status icons, and local completion controls;
Agents uses the shared roster rows and opens Macro and Cursor sample sessions
with expandable tool activity and local scripted replies. Email and Sheets reuse
the production composer and spreadsheet editor with fixture data. Calendar uses the production seven-day grid with dummy events and week navigation.
CRM uses the shared Kanban columns and cards. The demo uses ViewSidebar and
ViewShell header components with a 256px navigation column. Calendar omits that
column, matching the app. All right-hand detail panels stay closed; unavailable
actions are disabled.
Search filters
the sample workspace and Escape returns focus to Search. Changes and drafts remain
in memory when switching views or collapsing the demo; reloading resets them.
Verify sending a channel message, editing a doc, toggling a task, inspecting tool
output, and asking a sample agent a follow-up. These controls never send messages,
save documents, execute tools, or call a model outside the local demo.
Hovering or keyboard-focusing a label highlights its destination; clicking follows
a native anchor to the corresponding homepage example. On narrow screens the sidebar extends halfway beyond the right edge, with all
seven labels on the left and pointer lines to the corresponding rail icons. The
line above starts at the viewport center, then curves toward the offset sidebar.
The reveal respects reduced motion and never
captures scrolling. A single column starts with a local-only post-demo email
composer, then follows a Q3 launch through shared docs and linked tasks, version
history, a coding agent fixing a deploy,
and a spreadsheet of customers to reach after launch. Each feature starts with a centered slab heading and muted Inter
subtext between split horizontal rules, above its messages and graphic. The sections
are Email and chat, Documents and tasks, Agents and pull requests, Sheets and databases,
and Sales and marketing. There is no standalone Agents as teammates section. The coding-agent section
puts the existing PR link in Teo’s source message. Cursor acknowledges the work,
then an indented reply uses the app’s `MagicChipView`, with the same dark surface
and glass rim as the speech bubbles. The chip opens a sample session dialog using
the production agent message renderer: thoughts, tool calls, terminal output,
and code diffs expand locally. Its PR link opens a second tab using `PrDocument`.
The reply header includes an inset Merge button beside the PR link. It only marks
the sample PR as merged locally, including in the PR dialog; reloading resets it.
There is no standalone PR card. All content is fictional fixture data with no
authenticated queries. Verify the chip with mouse and keyboard, thought/tool
expansion, the PR tab, closing and focus return, and unclipped phone layouts. These local
previews never run an agent or create a GitHub branch or pull request. The sidebar’s
External agents link lands at `#coding-agents`. Version history belongs inside Docs & Tasks;
there are no standalone Version control or @linked tasks sections. Sidebar task
links land on the document demo, message links on Email and chat, and agent links on Agents and pull requests;
explanations belong to the example below them, not the previous example. Short exchanges
between Jacob, Julia, Gabriel, and Teo use the app's message bubbles and Avatar
component with local photos from the original site. Photos sit beside the bottom
of their bubble, with the sender's name above the bubble; Jacob's messages mirror
this layout on the right. Hover or keyboard-focus a
person to see their profile card; reaction chips toggle locally. Jacob's photo
also appears in the email sender. Jacob asks Claude for a follow-up using the
“Demo Call Sep 14th” calendar mention. The email card shimmers for one second,
then quickly streams a sales follow-up with inline PDF and rollout-document
mentions; Julia is already cc’d. Generation pauses offscreen or in a hidden tab,
and reduced motion shows the completed draft immediately. The mentions animate
into place without opening a mentions menu. Editing is enabled after generation.
The email placeholder and composer reserve the same 560px height on desktop and
720px below 768px. Desktop edits scroll inside the body while the toolbar stays
visible. On mobile, both the body and editor allow visible overflow and the card
can grow for longer edits; swiping over the email scrolls the page. Verify that
the generated draft fits without cropping or resizing the card, mobile swipes
never scroll an inner email container, and desktop long edits and Bcc keep the
card's height stable.
Inline document, PDF, task, email, calendar, channel, spreadsheet, and call mentions use the app's entity icons and
hover cards. Hover or focus a mention for its local preview; clicking follows a
native anchor to the related demo. Valentina’s CRM request references the “Sales sync” call with the same phone-call icon used by real call mentions. The document is the same animation as the documents page: the launch plan types
itself, and @ opens a search that resolves into a person, a task, a date, an email,
and a channel. Playback runs only while the graphic is on screen and shows the
finished document for reduced motion. No document is created on the server.
The Documents and tasks section retains Julia’s typing animation, including the
linked launch-checklist task and its owner/status metadata inside the document.
The animated version-history band sits
directly beneath it with a short Inter caption. `#tasks` and `#version-control`
remain valid anchors within `#documents`. Verify the timeline on desktop and
mobile, its reduced-motion state, and both sidebar task links after the merge.
Message bubbles pop in once from the sender’s corner, a short scale with a slight settle. Graphics gently fade and slide in once when visible, using an
IntersectionObserver. There is no scroll interception or pinning; scrolling back
keeps revealed messages visible. Reduced motion immediately reveals everything,
and observers/listeners are removed on unmount. The composer supports editing,
Cc/Bcc, formatting, attachments, and simulated sending; it never sends email or
creates a server draft. The standalone task lifecycle conversation is not mounted
on the homepage. After the coding-agent example, Gabriel asks for the people to
reach out to. Claude checks PostHog and compiles the top customers into the production
spreadsheet editor, which stays in the browser. A handwritten “Try it” note and
curved arrow below the sheet invite visitors to edit the grid. Cell edits and export
stay local; no spreadsheet is saved on the server. The standalone Tasks feature page retains its
existing lifecycle graphic and phase controls.
`/start` opens the shared signup introduction; visiting the homepage does not reset
authenticated setup progress.

The second onboarding slide asks “Which features do you want to try first?”
and offers all 15 workspace features as independent toggle buttons. Its glow,
selected rings, labels, and checkmarks use the accent chosen on Welcome.
The bubbles share the homepage’s translucent glass surfaces, with the accent glow
visible through both selected and unselected bubbles. The color picker’s soft grain
and accent-dot texture continues behind the bubbles at half strength. Click
again to deselect; there is no selection counter. Starting interests
persist in session storage through Back and Google redirects. “Continue” advances
to Security, including with no selections; selecting features does not connect
accounts or restrict access to the other features. Mobile uses a four-column grid.
Continue emits `onboarding_v4_features_selected` to PostHog with `features`
(the final label array), `feature_count`, and `source` (`public_onboarding` or
`app_onboarding`). It also records empty selections, but not individual toggles.
Returning and submitting again records the updated choice; use unique people or
their latest submission when measuring interest. Local development uses the existing
analytics opt-out. Verify captures with mocked analytics instead of sending QA data.
Verify keyboard multi-selection, back navigation, accent persistence, and reduced
motion. The entrance animation composes with the bubbles’ centering transform,
so they keep their final positions when the handoff finishes or is interrupted.
On the feature-to-security handoff, moving bubble copies retain their measured
width and height plus their rendered styles, including accent rings and checkmarks.
Replay slowly on desktop and mobile: circles must stay circular after leaving
the feature layout, and selection styling must not jump.

New web signups follow Welcome → Features → Security → Work email → Personal email → Tools → one
connection step per selected integration → Team → Plan. Why, Appearance, Guidance,
Building, and Summary are no longer stops. Returning users can sign in at
`/app/login`; native apps retain their existing sign-in options.

The onboarding header contains only a back arrow linking to the homepage at `/`.
The marketing menu, Book demo, and Open app buttons remain on the landing page.
In local development, Open app starts `/onboarding-preview.html` regardless of
session state. Production uses `/app`, whose session check opens the workspace
for authenticated users and Welcome for unauthenticated users.
Security has no inner Back control; later in-flow Back controls return to the
previous onboarding step. The public sign-in link sits below “Already have an
account?” on its own line, with 8px of padding above the link.

Security shows three proof columns with one label each: linked GitHub source,
a16z funding, and the ISO/SOC/CASA marks. Labels match the muted account-footer
text. One short Inter paragraph below explains data
protection and control over connections; there is no visible slab headline.
Continue moves the proof items downward as they fade, then reveals the Google
screen's retention, security, and ownership items in their destination positions.
Text and actions crossfade during the same handoff. Motion uses only opacity and
transform, lasts about 1.1 seconds, and settles immediately on resize. Reduced-motion
users advance immediately. Both screens use the same elevated button finish.
Verify interruption, restored interaction, and heading focus after the handoff.

Security and the Google connection screens have an optional “Read more” cue,
30px above the bottom of the opening section. Native scrolling or the cue reveals
left-aligned prose and four expandable FAQs below the fold. Security covers
encryption, operational access, independent assessments, model-provider retention,
and links to the open-source code and policies. Google covers permissions,
email-agent approval, password handling, and disconnecting versus data deletion.
The main action remains in the opening section; “Back to setup” returns to it.
Verify keyboard FAQ controls, mobile spacing, reduced-motion scrolling, and
security-to-Google scroll reset. Scrolling during the handoff settles its animation.

Work and personal email are separate, simple screens, each with one Google button.
Work is required; personal offers Skip for now. The heading includes email and
calendar. A single Inter paragraph explains why access is needed and that Macro agents
ask for approval before sending email. Three matching trust columns below the
Google action cover provider retention, audited security, and data ownership.
Sign-in remains on Welcome and Security; the connection screen has no extra
social-proof or legal footer. The public
work button starts real Google SSO and creates the Macro identity from the chosen
account. Its one-use handoff returns to the work-email screen. Work is complete only
when a healthy owned inbox matches the sign-in email: delegated, personal, missing,
or expired inboxes cannot bypass it. Personal unlocks afterward and uses the existing
add-inbox flow, so it cannot switch the Macro identity. Test declined permissions,
a wrong account, reconnect, cancellation, and full-page callbacks using intercepted
OAuth. Do not grant real permissions merely to verify UI.

The explanation covers sending and receiving email and connecting Calendar;
Google presents the exact permission scopes during consent. It does not promise
read-only email, Drive access, or that Calendar is included in every deployment.
Google handles password and consent. Storage is a resume
convenience, never evidence of authorization. Permission failures stay incomplete.

Tools search says “Search integrations and MCPs” with a muted search icon. Toggling
a tile selects a step without connecting or disconnecting anything. Selected items
get a green check and individual connection steps in selection order; click a
selected tile again to deselect it. The results occupy a fixed-height scroll area,
so loading, searching, pagination, and empty results never move Continue. Rows are
virtualized (four columns on desktop, three on mobile), and nearing the bottom
fetches the next catalog page automatically; there is no Show more button. Search
returns to the top without clearing selections. Verify scrolling past 100 entries,
keyboard selection, and retrying a failed page without losing loaded connectors. Continue
also works with no selections; there is no separate "Set up integrations later" button.
Linear, Slack (development only), Notion, and GitHub come first and are labeled
Native for their bespoke import/repository flows. The other bundled presets and
directory entries are labeled MCP. The directory's Slack variant is deduplicated
against native Slack and respects its visibility rules. Google Sheets, Google
Calendar, Gmail, and Microsoft Outlook
(including their auth/calendar variants) are excluded from onboarding and old
saved selections. Google Drive remains available. These rules do not filter Settings.
Selection and the active step survive OAuth and reload, scoped by account. A removed
saved connector returns to Tools. Back preserves selection and toggles preserve search.

Linear, Notion, and Slack use the existing flag-aware connection and canonical
import pipeline, with progress and retry on their dedicated pages. These imports
bring relevant recent items rather than an entire workspace: Notion databases and
Slack message history are not imported. GitHub uses account OAuth followed by its
GitHub App repository-selection link. Other catalog items use Settings’ Pipedream
authorization. A native credential row without authentication is not connected;
disabled connections need re-enabling. Every integration is skippable, and imports
continue in the background.

Team is the final onboarding step, after integrations and the plan decision. Its
single-line “Built for teams.” heading, Workspace name field,
and elevated white CTA match the other slides. The public preview reaches the same
form after Tools, using sample recipients for a fresh draft; it saves a local draft
and never creates a team or sends invites. The preview disclaimer is hidden so the
layout matches production.
Back returns to Tools and preserves that draft. Authenticated setup retains
membership, pending invites, domain suggestions, and per-account drafts.
Review named recipients: Create team & invite N sends real emails. Remove
each suggestion with its × to create without inviting. There is no invite checkbox
or Continue on my own button. Create team works with no recipients. Suggested
same-domain contacts are prefilled once; removed recipients stay removed on reload.
Older drafts with invitations disabled keep their recipients excluded. Partial invitation
failures retain the existing recovery path. Do not send real invitations for QA.
Plan retains paid checkout, invite offers, and the original deep link across
redirects. Free, Decide later, and confirmed payment all continue to Team; choosing
a plan does not complete setup. The decision survives a reload of Team. Creating,
joining, or confirming an existing team completes setup and
opens the original destination. Verify free and paid completion, back navigation,
reloads, invitation errors, mobile forms, and transitions without sending real invites.

Scrolling stays native. Forward buttons are inline so long forms cannot be covered
by a fixed action. Opening transitions respect reduced motion; steps reset inner
scroll and focus the heading. Homepage animation stays separate from setup.

The top-left arrow returns to the previous onboarding step in both preview and
authenticated setup. Only the first step links back to the homepage. Verify
backward navigation from tools through personal email, work email, and security.

The first onboarding slide introduces workspace creation with a compact accent preview,
six keyboard-accessible color swatches, and background texture fixed at 50%. Choices
are saved locally under `macro-workspace-intro-appearance` and restored on reload.
They customize this introduction preview; they do not change a saved account theme.
Accent selections crossfade in 220ms and play the icon’s radial color burst; the selected
swatch updates immediately. The intro uses the same crossfade timing and staggered 28px assurance-row reveal as
the security-to-Google handoff. Its app icon exits downward while the incoming proof
row enters downward from above. The outer flow snapshots the full slide, including
Sign in, before changing shell layout; the inner story stage must not start another
handoff. Verify no initial jump, no duplicate overlays, and consistent motion direction.
Reduced-motion preferences skip the animation.
The logo expands its three strokes on hover while the tile stays the same size. Clicking it
(or pressing Enter/Space) emits a brief radial color-and-noise burst. Reduced motion
keeps the tile still and suppresses the burst. Verify repeated clicks and navigation
during the animation, as well as color selection, fixed texture, reload persistence, and Get started
transitioning to the security slide. The homepage continues to use its constellation hero.

`/onboarding-preview.html` uses the same public signup introduction as the real
web entry. In local development, its work button previews the optional personal
email screen; Connect personal email and Skip for now both preview the tool
selector. These preview actions do not authorize accounts. The tool selector uses the same searchable, paginated Pipedream catalog as
Settings. Its API requires a signed-in session; unauthenticated previews show a
sign-in link alongside the bundled presets. Native connectors stay first even
while the directory is loading or unavailable, and directory duplicates are hidden.
Production still starts actual Google
authorization, then resumes the authenticated personal-email and tools sequence.
Verify account-step fades and reduced motion, and use intercepted OAuth/query
fixtures to test real connections without creating accounts or starting checkout.

## Unified public website

The homepage hero uses a subtle bouncing down arrow labeled Scroll to explore.
Clicking or keyboard-activating it scrolls down the page without changing setup
steps. The arrow pauses offscreen and stays still with reduced motion.

The same local dev origin now serves the public journey at `/start` (also `/`)
and feature pages at `/email`, `/tasks`, `/channels`, `/documents`, `/calls`,
`/crm`, `/agents`, and `/github`. The top-left hamburger morphs into the Macro mark
on hover or keyboard focus. Click it to open grouped Features, Resources, and
Explore links (Home, Pricing, Partners, Startups, Book demo); Escape returns focus to the trigger,
and clicking or focusing outside closes it. On mobile, the menu fills the viewport
with an opaque background, single-column links, and an X close control. The page
behind it stays still, the menu scrolls independently, and Tab stays within the
menu until it closes. Desktop keeps the compact dropdown. Resources contains Videos,
Documentation, Migration guide, and Blog. The compact top-right white Open app
button has the standard subtle glass border and opens `/app`, which handles
existing sessions and sign-in. Open app and Book demo have a subtle radial
highlight that follows the pointer, including when Open app is enlarged in the
footer. Keyboard focus centers the highlight; touch does not track it.
Book demo opens the booking page from Explore.

Get started in page actions opens the public signup journey, or `/app/onboarding`
when the tab has authenticated setup progress. After work authorization, the app
owns integration connections, team actions, and completion. Account-scoped drafts
and selections survive provider redirects. The floating feature dock is hidden
in setup.

The public `/channels` and `/tasks` pages use their original feature-page layouts,
with product demonstrations, feature cards, comparisons, and FAQs. Content is capped
at 1000px, with Roboto Slab headings at weight 315 and color accents on a black
background. Task lifecycle examples can be paused or explored by stage. Video demos
open on interaction, and FAQ questions expand their answers. Get started returns to
the saved setup journey through page actions or the shared bottom dock.

The homepage constellation uses translucent gradients and the glass rim instead
of live backdrop blur, including its moving copies. Scroll forward and backward
through the GitHub handoff: all 16 bubbles should converge behind the text,
restore on reverse scroll, and keep the same surface at rest and in motion.
Reduced motion skips the handoff. Completed timelines stop updating until the
scroll returns to their range; resize rebuilds the measured paths.

At the end of the homepage, the existing Open app link moves from the header
to the centered closing space and grows to 3× over the last portion of native
scroll. A divider and padded closing section separate it from the spreadsheet.
Verify the button stays in the header while reading the sheet, then curves down
the right margin before moving inward and growing. It fades during travel.
Narrow screens delay travel until the sheet clears the header and cap the scale
to fit. Scrolling back restores its header
position. Reduced motion switches positions only at the end. The link still goes
to /app; there is no duplicate closing CTA. Only fast downward wheel/trackpad
input at the final landing is briefly braked; slow scrolling and earlier content
stay native. Reverse input, pointer/touch interaction, keyboard navigation, and
reduced motion immediately release the brake. Native touch flings and scrollbar
jumps keep their scrolling, while the button eases into place using transform
and opacity transitions. Verify a fast fling, a slow approach, and reversal.


### Public build and crawler verification

The production homepage includes prerendered HTML before JavaScript runs. In a
fresh browser context (including OS light mode), the landing stays dark without
changing the visitor's saved app theme. The menu's links exist in HTML while
closed. Demo code preloads sequentially during idle time after page load, while
editors only mount within 1400px of the viewport. Verify that code downloads
without scrolling but editors remain unmounted at the hero. Save-Data and 2G
skip background preloading. Scrolling to Email, Docs and Spreadsheets should
replace quiet placeholders with interactive demos without loading text, and the
footer CTA should still reach its destination.

For a production preview, run `bun run build:site` after installing Playwright
Chromium. Test once with JavaScript disabled: the headline, feature copy and
links must remain in the HTML and readable. With JavaScript enabled there must
be only one homepage (the snapshot is replaced, not appended). The `/start` flow
must hand work authorization to the app and resume at Work email. See `apps/web/marketing/seo/MIGRATION.md`
for the route/metadata gate and the separate CDN cutover checks.

### Homepage task demo

The homepage embeds the same `TasksLifecycle` component used by `/tasks`,
including its animated cursor, four stage controls, and play/pause control.
Verify that scrolling into the graphic starts playback, scrolling away pauses
it, and each stage can be selected. Reduced motion begins on a still frame.
The surrounding conversation shows Cursor implementing, Claude reviewing, and
Teo verifying the invite fix. There is no task-creation form or account mutation
on the homepage, and the animation never captures native scrolling.

### Homepage CRM demo

The public homepage's `#crm` section follows Shared spreadsheets. Valentina asks
Claude to update the pipeline from calls. A cursor labeled Claude drags Northwind
from Qualified to Proposal, then Lumen from Proposal to Closed won. The columns
and cards share the app's CRM presentation components; all data is local demo
state, and no CRM mutations or account requests run.

The walkthrough starts when visible, pauses offscreen, and holds on the updated
board when finished. Use **Pause/Play CRM walkthrough** or **Replay CRM walkthrough**
to inspect it. Reduced motion shows the completed board without cursor movement.
On narrow screens the board camera follows the dragged card. Native page scroll
is preserved.

The homepage closes with Alex Rampell and Panat testimonials: slab names, smaller Inter roles, then larger Inter quotes, followed by
the original site’s featured blog posts as compact, single-line icon-and-title links,
without excerpts or large artwork. The blog carousel supports native horizontal
scrolling, keyboard focus, and Previous/Next controls; View all goes to `/posts`.
Post links use normal document navigation. The final Open app animation begins
after the blog section. Carousel controls respect reduced motion.
