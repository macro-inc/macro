# Onboarding and getting started

The public homepage opens at Welcome. Native scrolling reveals a separate
unification section before the funding / open-source / security proof row. As it
enters the viewport, scroll position moves the hero's app logos into Macro's
feature constellation. The traveling logos dim early and disappear before the
final feature icons finish fading in, avoiding overlapping marks. The headline crossfades to “Replace 11+ apps with a single
system” and the grainy rainbow halos appear behind the nodes. The paused animation
timeline follows scroll position in both directions: stopping holds the frame and
scrolling back reverses it. Nothing pins content, intercepts scroll input, moves
focus, or changes onboarding progress. Reduced motion shows the completed
composition immediately; resize and unmount clean up moving copies and restore
the hero. Directly below unification, a fine vertical line draws down between two nodes,
then reveals a centered founder quote in small Inter text. Its opacity and stroke
follow native scroll position; reduced motion shows the entire connection and
quote immediately. At desktop widths, the welcome hero, unification section,
quote, and proof row use a 125% scale through layout dimensions (not browser zoom
or transforms). The compact proof row shares the quote’s 600px maximum width;
both return to 480px on smaller screens. Below the proof row, a single column follows a Q3 launch: a local-only app email
composer, document creation, agents correcting Friday to Thursday, an interactive
version-control scrubber, and a task for the team invite handoff. Short exchanges
between Jacob, Julia, Gabriel, and Teo use the app's message bubbles and Avatar
component with local photos from the original site. Photos sit beside the bottom
of their bubble, with the sender's name above the bubble; Jacob's messages mirror
this layout on the right. Hover or keyboard-focus a
person to see their profile card; reaction chips toggle locally. Jacob's photo
also appears in the email sender, and history versions identify their authors.
Inline document, task, email, and channel mentions use the app's entity icons and
hover cards. Hover or focus a mention for its local preview; clicking follows a
native anchor to the related demo. The document uses the production MarkdownShell:
Julia and Gabriel select and edit separate lines concurrently, with colored named
carets and presence avatars. These are local example edits, not connected users.
Playback pauses offscreen or in a hidden tab, supports Pause/Play/Replay, and shows
the completed document for reduced motion. Clicking or focusing the editor stops
the example edits and lets the visitor type without being overwritten. No document
or collaboration session is created on the server.
Messages and graphics gently fade and slide in once when visible, using an
IntersectionObserver. There is no scroll interception or pinning; scrolling back
keeps revealed messages visible. Reduced motion immediately reveals everything,
and observers/listeners are removed on unmount. The composer supports editing,
Cc/Bcc, formatting, attachments, and simulated sending; it never sends email or
creates a server draft. The history slider (also keyboard accessible) updates the
preview and timeline. The task example continues directly on the page with no
channel window around it. Julia reports the invite issue, Teo uses the production
ChatInput / ComposerSurface and MarkdownShell with a local “Send as task” mode,
and the request becomes a sent bubble with an inline task. Creation plays once
after the composer enters view; focusing or editing it pauses the demo. “Edit task
request” reopens the composer, and Enter or Send updates the local task. Turning
“Send as task” off posts a local message instead. Nothing is sent or saved remotely.
Cursor and Claude appear as named participants with their existing app icons:
Cursor traces the redirect, Claude flags the new-account edge case, and Cursor
returns a proposed fix. Native scrolling reveals each exchange; it is never
intercepted or pinned. The task progresses to 2/3 when the review enters view.
The change preview expands, and “Mark verified” completes the task as Teo and
reveals the team’s final replies. Checkbox changes also work locally. Manual
interaction prevents later scroll reveals from overwriting the visitor’s changes.
Reduced motion shows the created task and all exchanges immediately, leaving
human verification interactive. The standalone Tasks feature page retains its
existing lifecycle graphic and phase controls.
`/start` resumes saved setup progress; visiting the
homepage does not reset that progress.

New accounts enter `/onboarding` (also rendered from login). The opening is a
question-led story: Welcome (Why?) → Feature overview (How?) → Tools (Can I trust it?) →
Security (Create my team) → Team → Email → Appearance → Building → Summary → Plan. Optional setup steps offer Skip
for now. The founders film and view videos are marked Coming soon.

Scrolling remains native and never advances a slide. Welcome and Feature overview
use small inline Why? / How? controls to play their transitions.

The first four slides share measured 1.4-second transitions. The welcome logos move into an open feature constellation and crossfade into
Macro's Email, Chat, Docs, Tasks, CRM, Agents, and Calls icons. Labels sit beneath
the monochrome icons, styled to match the welcome discs; the headline sits below the graphic. How? continues to the
Tools grid. Tools dissolve into the security slide, which stays until the user
chooses Create my team. There is no timed security interlude. Reduced-motion users switch
slides immediately. Controls stay inert during movement, then focus moves to the
heading; navigation, resize, and unmount clean up animations. OAuth restores go
straight to Tools. Old saved Privacy steps resume at Security. The preview has
quarter-speed and tenth-speed replays.

The trust screen leads directly to team creation. The product walkthrough,
carousel, and introduction are no longer steps in this journey. Saved authenticated
Explore/Introduction steps resume at Team. The public preview shows a local team-name
and teammate-email draft (saved across navigation); it does not create a team or send
invitations. Continue or Skip proceeds to Appearance. Existing public step 4 resumes
at Team, and old Introduction step 5 maps to Team without clearing tool preferences.

Story and setup forward buttons share the raised, rounded treatment and sit 100px above the
viewport bottom, with visible action text alongside the arrow. Team and checkout
labels keep their explicit action names and disabled states. Trailing space lets
content scroll clear of the floating control.

Email uses the existing Google OAuth flow. The current step and the destination
are kept through redirects. Free accounts can link two inboxes; paid accounts can
link more. The searchable Tools grid uses the enabled native connectors or the
Pipedream catalog, according to the account's feature flag. A green border and filled check indicate a completed connection. Click a checked
tool again to disconnect it; pending changes disable the tile, and failures leave
the connection intact with an error message. Search narrows the list; Show more tools
reveals additional catalog entries. Saved older `connect-*` steps resume at Tools.

Team setup supports existing membership and pending invitations. For a new team,
Invite my team is checked by default. Review the named recipients before submitting:
Create team & invite N creates the team and sends real emails. Setup allows at most
four distinct teammates, excluding the current user. Remove suggestions individually
or turn off Invite my team to create without invitations. An invitation failure after
team creation reports the partial result and directs the user to Team settings.
Do not send invitations to real recipients merely to test the flow.

Appearance immediately persists Light, Dark, or System. Building and Summary retain
the existing import behavior; reduced-motion users skip the scripted building animation.
The Plan step retains free completion, paid checkout, and invitation offers.

List views expose an Explore button with a replayable three-step tour. Connection
suggestions open Email or Connected settings. Tasks also exposes Import from Linear,
which opens the existing CSV importer. The × hides suggestions for that user and view
on this browser; the tour remains available. Videos are placeholders, not playable media.

For visual review without connecting accounts or sending invitations, the dev server
serves `/onboarding-preview.html`. It uses the production presentation components,
with local-only sample tool states. It does not exercise OAuth, checkout, or delivery.

## Unified public website

The same local dev origin now serves the public journey at `/start` (also `/`)
and feature pages at `/email`, `/tasks`, `/channels`, `/documents`, `/calls`,
`/crm`, `/agents`, and `/github`. The top-left hamburger morphs into the Macro mark
on hover or keyboard focus. Click it to open grouped Features, Resources, and
Explore links (Home, Pricing, Partners, Book demo); Escape returns focus to the trigger,
and clicking or focusing outside closes it. Resources contains Videos,
Documentation, Migration guide, and Blog. The compact top-right white Open app
button has the standard subtle glass border and opens `/app`, which handles
existing sessions and sign-in. Book demo opens the booking page from Explore.

Get started in page actions and the feature dock restores the saved public journey,
or `/app/onboarding` when the tab
has an authenticated onboarding progress record. Public tool toggles are preview
preferences; they do not run OAuth. Account setup remains in the authenticated app.

Resume check: choose and unchoose public tools, type a search, browse Tasks and
Pricing through the header, then use Get started. The tool step, selection, and
search must survive both navigation and refresh. Actual setup's team-name and
invite drafts are scoped by account in session storage. Do not submit real invites
while testing navigation. The 20px floating feature dock links the feature pages;
it is not shown in the setup journey.

The public `/channels` and `/tasks` pages use their original feature-page layouts,
with product demonstrations, feature cards, comparisons, and FAQs. Content is capped
at 1000px, with Roboto Slab headings at weight 315 and color accents on a black
background. Task lifecycle examples can be paused or explored by stage. Video demos
open on interaction, and FAQ questions expand their answers. Get started returns to
the saved setup journey through page actions or the shared bottom dock.
