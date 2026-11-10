# Customers (CRM)

## Customers (CRM) — `/app/companies`

On desktop, the local sidebar uses the same navigation primitives as Email and Tasks.
Its **New** menu creates a **Company**, a **Contact**, or a **Pipeline** (Pipeline
only when pipelines are enabled). The new-pipeline dialog's type menu
(**Companies**, **Contacts**, **Generic**) shows the same icon, title and
one-line description rows, with a check on the selected type. The
**Records** section lists **Companies**, **People**, **Sales Tasks**, **Sales Email**,
**Sales Notes**, and **Sales Calls**, in that order; Pipelines, Sequences and
Lists follow. Record-detail tabs keep their unprefixed names.
There are no built-in company views or Board/List layout. Companies and People
are plain soup lists with the shared pagination. Existing personal/team saved
views stay in the toolbar's Views menu.
The Companies list starts with the Customers `TutorialRow` (from `features/video-tutorials`) once that video is in its catalog; it sits outside the virtualized rows.

Opening a company or contact row in Companies or People clears its blue unread
dot, including desktop preview activation, keyboard opening, and phone navigation.
The read is saved in the background; a failed request restores the dot so opening
it again can retry. Marking read does not mark the notification done.

**Rollout:** Sales Tasks, Sales Email, Sales Notes and Sales Calls require PostHog `enable-crm-activity`
(off by default; local override: `VITE_ENABLE_CRM_ACTIVITY=true`). CRM also uses
this flag to decide whether to supply its task-composer preset, and with
`enable-crm` to show the Customer / Contact pill when creating any task. With it off, only Companies and People
appear in Records, activity queries do not run, and activity deep links return to
Companies after flags finish loading. Global task creation uses the standard
composer; record-level New task still associates the new task with that record.
With it on, the activity and contextual composer behavior below applies.
Task creation opens immediately from the focused pane's registered preset,
without fetching record details. Contact company prefills use already-loaded
details. If CRM's flag is still loading, CRM supplies no preset. Later flag,
focus or record changes do not reset an open composer; reopen to use the new
context. If an embedded record shows a loading error, global task creation still
targets the selected record until you close its details.

The selected Customers list is stored on the pane as `sN.crm.tab`. People uses
`people`, activity tabs use `tasks`, `email`, `notes`, or `calls`, a list uses
`list:<uuid>`, and hidden companies use `hidden`. Companies is the default and
omits the key. A pipeline has its own path, `/app/companies/pipeline/<uuid>`;
older `sN.crm.tab=pipeline:<uuid>` URLs and shared `crmView` links that show a
pipeline redirect there. Choosing Companies, People, an activity tab, a pipeline,
or a list updates the URL, and browser Back and Forward restore it.
Ordinary sidebar and Go To navigation also resumes Customers' last location and
captured entry state within the current account session, including an open
pipeline or record. Direct links and new-split actions keep their requested
destination; reload and account changes clear the remembered location.

The activity tabs show CRM-linked content, not the whole app: Sales Tasks and
Sales Calls require a Companies or Contacts reference; Sales Notes are linked Markdown
documents (excluding tasks, snippets, and skills); Sales Email is your own mailbox's
threads with CRM company domains or contact addresses. Lists page as you scroll.
Empty CRM scope never falls back to all content. Activity loads directly with a
server-resolved scope; it does not fetch every company and contact first. Hidden
companies and contacts stay excluded even for admins. A loading failure offers
**Try again**. Sales Tasks has **New task**, which opens the task composer. Choose a CRM
association with its **Customer / Contact** pill when creating a task from this feed.
Opening Task through the global Create menu while Customers is focused uses the
same preset. With an embedded company or contact detail open, global Create
prefills the current breadcrumb record; a contact also includes its company.
Closing the detail returns global Create to the unassociated CRM preset.

Empty collection and record lists fill the available height with a horizontally
centered illustration, guidance, and a relevant creation action, raised toward
the toolbar rather than vertically centered. Search-empty states use a
different illustration and **Clear search**, not a creation prompt. Initial list
failures offer **Try again**; failed continuation pages retain existing rows.
Loading uses list skeletons while search and header actions remain available.
On desktop, each workspace activity view keeps its title, **New**, and expandable
**Search** in one header row, including when empty or loading. Command-F expands
and focuses Search; Escape clears and closes it. Phone activity views keep the
search field and creation action below the CRM navigation tabs. Record-detail
tabs retain their own section toolbar.

Activity rows show stored Companies and Contacts reference pills in the shared
Soup row. Click a pill to open its record; Shift-click opens a new split without
opening the parent item. The first two references appear inline; **+N** opens
the remainder. Email matches still determine feed membership, but an address
or domain match without a stored property does not add a display pill. The row
uses shared property previews rather than a separate association lookup.
Verify these interactions at desktop and phone widths.
Sales Tasks use the normal Tasks filters (status, priority, assignee, creator,
and tags), sorting and grouping, with list/board/Gantt layouts when enabled. Touch
uses the normal list and filter drawer. The default is open tasks grouped by date.
Sales Email exposes the normal read/done, attachment, calendar and tag filters. Sales
Notes has creator/tag filters and Sales Calls has audience/tag filters. All three support
last-updated/created/viewed sorting, newest/oldest direction, and date/none grouping.
Sales Email defaults to last-update date groups; Sales Notes and Sales Calls start ungrouped. Date
headings use the selected sort field and viewer-local time. Filter controls share one
desktop header; touch puts filters, sorting and grouping in a drawer beside search.
Each activity keeps its own settings, independent of the normal app views.
Clear filters removes only refinements, never the fixed CRM restriction. Verify
switching away and back preserves the filter, sorting and grouping choices, that
changing a filter starts a fresh query, and that local-only attachment/audience
filters continue through pages with no visible rows. Stored association pills remain
inline, and record-detail controls remain unchanged.

Verify activity loading with a CRM containing thousands of companies and
contacts, not only an empty fixture. Opening a tab must settle without repeated
requests; switching tabs must preserve filtering and scrolling must load older
matching items. A frontend preview still needs the Soup/email SQL optimizations
deployed on its backend to verify large-scope request performance.

Record-level **New task** also prefills the current record.
**Add property** can reveal Status or another supported property.

Companies lists every visible company, grouped by Stage by default, with Owner,
Revenue and Last Interaction columns. A Stage column is off by default; turn it
on, or hide Owner or Revenue, under **Display options**. Its single-row desktop
header matches Tasks: title, filter group, view-options group (sort, group,
display options, and saved views), then the shared **New** menu and expandable
Search. New has the same options as the sidebar.

People lists contacts across every team the viewer belongs to, from
the same Soup query with only CRM contacts opted in (`crmf`). The server collapses
duplicate full email addresses (case-insensitive) to one contact; contacts
without an email never collapse. Hidden contacts
and contacts under hidden companies are excluded by default. Columns are Person (name and
email), Company and Last contacted (sortable). `Search people` matches name or
email on the server after a short typing pause, so results include contacts not
yet scrolled into view. The desktop header has the title, shared **New** menu,
and expandable Search; choose **Contact** from New. On touch, **New contact**
is unchanged. The **Visible / Archived** filter selects one view on People,
Companies and company Team. Archived is available to admins/owners; People recovery
is scoped to their current team. Search and sorting stay in place when switching.
Archived rows carry a chip. Open a record and choose **Restore** beside its identity
chip; the row leaves Archived and returns to ordinary lists and Cmd-K. People under
an archived company require that company to be restored first. There is no permanent
explanatory banner or recovery UI inside Cmd-K.

Verify company domain validation by creating a company with an allowed business
domain, then adding a contact whose email matches it. Personal email provider
domains must still be rejected as company domains.

Desktop `Search companies` and `Search people` start as outlined icon buttons
and expand into the shared Email/Tasks search bar. Command-F expands and focuses
the field; Close or Escape clears the query and returns to the icon.

On touch devices, CRM uses the same scrollable pill tabs as Tasks in the top
header: Companies, People, Sales Tasks, Sales Email, Sales Notes, Sales Calls, available pipelines, and
enabled lists. Swipe the
strip horizontally to reach every destination; the selected tab stays visible.
The tabs remain available inside pipelines, with no hamburger button. Company
filters lead the strip when available. On mobile, pipelines omit their title
and sharing row and use an edge-to-edge table, below the top safe area and above
the bottom dock. The compact **Pipeline actions** button in the table toolbar
opens rename, **Export CSV**, **Import CSV** (editors) and sharing controls;
only owners see **Trash pipeline**, which requires confirmation. Sharing opens the existing share dialog. Companies uses
the full-frame list with the global **+ Company** action above the dock. People keeps its search and **New contact** below the tab
strip. The embedded detail stack stays out of the mobile flow, so selecting a
row navigates in place.

Verify touch spacing with a nonzero top safe area (for example 47px): the CRM
tab strip clears the status bar, while standalone company/contact Overview and
Team, Emails, Files, Tasks, and Calls clear both the status bar and floating
record navigation. Switch tabs and check the first title/search control is
visible and tappable. Scroll to the end to check content clears the dock. Repeat
at tablet width; desktop retains its usual spacing. An embedded record header
consumes the top inset once, so its content must not add it again.

The account-free browser layout regression is
`bunx playwright test --config src/features/crm/browser-test/playwright.config.ts mobile-insets.browser.e2e.ts`
from `apps/web`. It mounts the production layout components with local content
at phone, tablet, and desktop sizes; authenticated route and native-device
checks remain separate.

On desktop, clicking a company or a person in the list (or pressing Enter on a
focused row) opens its details inside the CRM workspace, keeping the left
navigation visible. Each record has its own URL: `/app/companies/company/<uuid>`
or `/app/companies/contact/<uuid>`, keeping the list's `sN.crm.tab`, and
`/app/companies/pipeline/<uuid>/company/<uuid>` (or `/contact/<uuid>`) for a
record opened from a pipeline. A record tab other than Overview adds its name,
as in `/app/companies/company/<uuid>/team`. Browser Back returns to the list
with the same filters and list scroll position, and Forward reopens the record.
The top breadcrumb reads `<Companies, People, list or pipeline> > <record>`;
click the first segment to return the same way. Selecting another sidebar entry
shows that list in place of the details; selecting the record's own list returns
to it. Shift-click still opens the record in a separate split, also inside
Customers. On desktop, every other way to a company or contact opens it inside
Customers too: `/app/company/<uuid>` and `/app/contact/<uuid>` links (which
**Copy link** still copies), `@` mentions, search and Command-K results,
favorites, and CRM discussion notifications. A contact opens under People, so its
breadcrumb returns to People. A split already showing that record is brought
forward instead. Touch devices keep the standalone record pages; a Customers
record URL redirects there unless it opens a linked item inside Customers.
Each record opened from the details appends a breadcrumb and a history entry: a
contact from a company's Team tab gives `Companies > <company> > <contact>`, and
a person's **Go to company** action gives `People > <contact> > <company>`. Opening a record
already in the trail (such as the contact's own company from `Companies >
<company> > <contact>`) returns to it instead of adding a duplicate. Back and
Forward restore the trail; a reloaded or shared record URL shows only `<list> >
<record>`. The CRM sidebar stays visible throughout.
Contact properties use Tasks-style pills in the header and **Record details**.
**Add email** appears only when the address is absent. Save adds the address;
Cancel or Escape discards the draft, and invalid input stays open. Populated
addresses are read-only: no replacement, clearing or additional email identity.

Only contacts with a known personal-provider email can link or switch company.
Their company pill opens the Tasks singleton picker; on touch, select a company
then **Done**. Cancel keeps the original relation. There is no unlink action.
Company-email and email-less contacts keep a read-only company value. The separate
**Go to company** action opens an existing company, including for read-only
contacts; Shift-click opens a separate split on desktop.

Pending controls prevent duplicate saves; rejected edits retain their draft for
retry. The server enforces add-only email and personal-provider eligibility.
Another contact with the address in the same team rejects the change without
merging; restricted matches return generic feedback. Foreign-team destinations
and new links to archived companies are rejected.

Edits preserve contact ID, team, discussions, references, interaction dates and
archive state. Restore a visible child through its archived company before
moving it. Personal-email sync reuses a unique existing contact, preserving its
chosen company through sent/received refreshes and source cleanup. Ambiguous
matches are left unchanged. CRM settings and domain admission still apply.
Existing email replacement and alias/history redesign are outside this version.

Company and contact headers group `Copy link` separately from the side-panel toggle.
Desktop section tabs collapse to icons in narrow panes; each icon keeps a tooltip.
On phones and tablets, the current section appears as a labeled header island
with a caret. When the host collapses it, the section icon and caret keep its
accessible label. Embedded phone headers put the switcher below the breadcrumb
and actions so the record name and navigation retain space. Tap the switcher to
open the shared **Switch view** bottom drawer: every available section
has an icon and label, with a check beside the current section. Choosing a section
closes the drawer and updates the header label; Escape, backdrop tap, and drag
also dismiss it. Focus returns to the section trigger. Contacts do not show Team.
The workspace's scrollable mobile view strip is unchanged. Copy-link islands are 40px square on touch with
a 24px icon. Verify both record types, section changes, dismissal, copy feedback,
and header fit at phone and tablet widths.

To archive a person or company, choose **Archive** immediately beside **Copy link**
in the top toolbar. Confirming archives the record for the team while retaining its
history; Cancel changes nothing. While saving, duplicate actions and dismissal are
blocked. A rejected save retains the prior state and an actionable retry. Only team
admins/owners can archive or restore; other members see a disabled action.

An archived record has a single **Archived** chip and a compact secondary **Restore**
button beside its name on desktop, grouped beneath it on phones. Its toolbar keeps
Copy link and Details. Hover or focus the chip for the explanation; tap on phones.
Escape dismisses it. Restore is a separate focus target. Verify 320px and 390px phone
widths, aligned 24px visible controls and metadata, and separate 44px touch targets.
Tap above and below the painted Archived, Restore and company controls to verify
their expanded targets, then check focus after confirmation or cancellation.

Company archive archives all its people and turns off team email sync. Restoring the
company requires an explicit confirmation: every person is restored, including those
archived individually, while email syncing stays off. Re-enable **Sync Emails** under
**Email sharing** separately. A person whose company is archived offers **Open company**
so that restoration happens there first. Unfiled people restore directly. Company row
**Archive / Restore** actions also confirm the cascade. Record details and References
appear first in both information panels; company Properties, Lists and Email sharing
follow. Neither panel has a duplicate visibility control.

Verify successful changes update open People, Companies, Team and ordinary Cmd-K;
late responses must not reintroduce archived rows or hide restored rows with an
old empty page. Returning to a cached company
must show confirmed embedded contacts. Failed reads after a successful save must not
claim the save failed. Run the actual-control desktop/phone fixture with
`bunx playwright test --config src/features/crm/browser-test/archive/playwright.config.ts`.

The archived-People discovery check is
`bunx playwright test --config src/features/crm/browser-test/people/playwright.config.ts`
from `apps/web`. It covers desktop/phone discovery, server-side search and cursor
paging, query errors, unfiled records, hidden-parent behavior, rejected writes,
member filter injection, and account/team/list transitions with synthetic data.

The backend-free browser check is
`bunx playwright test --config src/features/crm/browser-test/playwright.config.ts visibility.browser.e2e.ts`
from `apps/web`. It exercises cancellation, pending/error handling, restoration,
permissions, and changing records with an open confirmation on desktop, phone,
and tablet.

Their information panel starts closed and opens as a floating bubble at every
width, without shrinking the record content. Click outside the bubble or use
the toggle to dismiss it; the open state is not restored on a later visit.
It copies the record's direct URL and shows a confirmation toast; this is also
available in the embedded company and contact breadcrumb header.

The Team, Emails, Files, Tasks, and Calls views share a compact
toolbar. On desktop, search stays on the left with existing filters and creation
actions on the right. On touch, search has 16px of space below the header and
fills the row beside the filter button, or the whole row without filters.
Email importance and inbox choices open in the shared filter drawer.
Section creation actions appear at the bottom right above the navigation dock,
replacing the default app-wide action: Add contact, New email, New note, New task,
or New call. Add contact is available once the company is loaded and visible,
including companies without a domain; contact emails may use any valid domain.
Email-sync gates, recipients, and task associations still apply. With company email
sync off, New email stays visible but disabled; New company must not replace it.
Keyboard focus and
higher-priority composers suppress the floating action; leaving the section
restores the default action. Search remains visible for empty lists.
Verify filter changes, section changes, disabled creation, and bottom-row clearance
on phone and tablet; desktop creation controls must stay in the toolbar.
Team rows show a profile photo when available, otherwise a
letter avatar at the same 16px size as channel list icons. Team uses the same Soup
row component as Emails, Files, and Calls: the avatar, name, and email are inline,
the last-contacted timestamp sits at the right, and the side gutters and row
spacing match. There is no column-heading row.
Emails, Files, and Calls search the loaded row titles and supporting text and
continue loading pages when the current pages have no match.
Emails, Files, Calls, and References rows open their items without selection
checkboxes, including on touch devices.

A company is laid out like a project. On desktop, its split header or embedded
breadcrumb header shows rounded view tabs for `Overview`, `Team`, `Emails`,
`Files`, `Tasks`, and `Calls`, collapsing to icons when narrow.
Touch headers use the section drawer described above. Overview shows the name, pills
for each domain and `Last interacted`, the generated description, a
**Pipelines** section and the Discussion. Pipelines stacks one full-width card
per row of a pipeline you can open that references the record. A card's header
strip names the pipeline (a lock marks a private one); below it, the row's first
four fields sit side by side, label over value (two per row on a narrow card),
and the rest wait behind `Show N more` in the card's footer. Expanded, text
values wrap to their full length instead of truncating, the footer's
`Show less` stays pinned to the bottom of the view while the card runs past it,
and collapsing scrolls the card back into view. Cells edit like the pipeline
table's when you can edit that pipeline. Inside Customers, the header's
`Open <pipeline>` button opens it. The `Pipelines` caret header collapses and expands the cards, like the Discussion
header; both start expanded on each visit. The
section is absent when the record is in no pipeline.
Team lists the contacts with `Add contact`. Emails keeps the
`Signal`/`All` and `Team`/`Me` toggles; `Team` shows teammates' threads even to
a viewer with no connected mailbox. Files, Tasks, and Calls list items
*associated* with the company: its `Companies` property names the company, its
`Contacts` property names one of the company's contacts, or it @mentions (or a
message attaches) the company or one of those contacts. Contacts beyond the Team
tab's first page count, hidden contacts count only for team admins and owners,
and an item matching several ways appears once. Files lists non-task documents
plus attachments of emails with the company's domains. Tasks is the Tasks list
with that scope, grouping, and Load more; `Search tasks` matches task names
within the scope (not content). Its `New task` composer pre-fills the company.
Calls includes calls linked automatically from their participants and calls
whose thread mentions the company. The side panel keeps Properties and Sharing,
and adds **References**: associated items of any type (documents, tasks,
channel messages, email threads and calls with the property, events, chats,
projects, and companies or contacts whose properties or Discussion name the
company) as compact icon-and-name rows, paged as it scrolls. A channel message
row opens its thread; a reply surfaces as its thread's row. A document
Discussion message makes its document the item. Initiatives and database rows
are not listed.
When a record list fails to refresh (for example, the record became
inaccessible), it replaces its rows with `Couldn't load this list.` and
`Try again` reloads it; a failed later page keeps the rows and shows `Couldn't
load more.`
A contact has the same layout with `Overview`, `Emails`, `Files`, `Tasks`, and
`Calls`: Overview pills show the email, the company (opens it) and `Last
interacted`, followed by the contact's Pipelines cards. Its Files, Tasks, Calls,
and References show items associated with the contact itself (its `Contacts`
property or an @mention of it), not everything associated with its company;
Files also includes attachments of emails with its address. Contacts without an
email still list their associated non-task files; they send no email-attachment
participant filter. Verify both an empty list and linked files on desktop and phone.
Tasks created from a
contact also reference its company. The side panel contains References, with no
empty Sharing section.

In workspace activity and a company or contact's embedded sections, clicking a
Task, Email, Note, or Call opens its authorized detail inside Customers.
The CRM sidebar stays in place and the breadcrumb shows the source view, record
trail (when present), and selected item, without section labels such as Tasks or
Files or an extra separator before preview titles. The current record breadcrumb
returns to the captured section and entry state. The item URL is nested under
`/app/companies` or `/app/companies/pipeline/<uuid>`. Typed record sections use
`/<record-type>/<record-id>/<tasks-emails-or-calls>/<item-id>`, without
repeating the item type or a task's `md/task` suffix. Redundant typed URLs for
these sections do not resolve. Workspace activity retains
`/<item-type>/<item-id>` and document metadata. Record Files and overview notes
retain document metadata on routes restricted to those sections.
Back and Forward restore the item and source; selecting the source breadcrumb or
closing the item returns to the source list or record with its entry state.
Reload keeps the selected item's URL. Shift-click uses the existing separate
split behavior; modified row clicks keep the existing split behavior. On touch,
the existing header and breadcrumb conventions apply without a new navigation UI.
Verify that tasks display their status and properties, not the Drive editor.

Links to the retired Databases views still resolve: a record's `/databases`
section opens the record, `/databases/<id>` and `/app/companies/database/<id>`
open the database itself, and a saved `databases` tab opens Companies.

Mentioning a company or contact with `@` in a document or task records it as a
reference of that record (removing the chip removes it) without sharing the
document, inviting anyone, or notifying the contact; channel and Discussion
messages record their CRM mentions when sent or edited. Open record lists
refresh after a CRM mention or a `Companies`/`Contacts` property changes. To
verify, mention a contact in a document, then check the contact's and its
company's References and Files without reloading; remove the chip and confirm it
drops out.

Company and contact pages have a **Discussion** section built from the same
message conversation as a document's Discussion: threaded replies, reactions,
attachments, and edit/delete from the message menu. `@` suggests the team's
members and agents. A message's copied link is the record URL
`/app/company/<uuid>?comment_id=<message>` (or `/app/contact/…`); opening it, or
a CRM discussion notification, scrolls to and highlights that message. On
desktop the record opens in Customers with the message in the pane search
`sN.crm-record.commentId`, which the next record or list you open drops.
Deleting a thread's first comment deletes the thread.

Company selection actions **Set owner** and **Set revenue** remain available
while team deal-stage definitions are loading. **Set stage** waits for the active
team definition rather than opening an editor with system defaults. Check both
the entity actions menu and command menu with stage requests delayed; cancel the
editors without changing hosted data.

`Collapse CRM sidebar` persists across visits; `Expand CRM sidebar` restores it.
At narrow widths, `Show CRM navigation` opens the same navigation in a menu
without **Close** or `Collapse CRM sidebar`; picking a destination or clicking
outside closes it.
While the sidebar is collapsed or shown as a menu, the split's **Close** sits
before either toggle, including on a pipeline, and stays hidden when the split
cannot close.
The sidebar's Records and Lists sections can also collapse independently.

**Pipelines** in the CRM sidebar hold company or contact entries, or free-form
rows in a generic pipeline, in the shared records editor. They have their own identity, ownership and sharing; their
storage does not appear as a separate database in navigation.
**New pipeline** is available as soon as the user belongs to a team; email
contribution consent is not required. Verify this with a newly created team
as well as an existing team.
Choose **New pipeline**, enter a name in the dialog's first row, pick
**Companies** (the default), **Contacts**, or **Generic** from the record-type pill, and tick
**Share with my team** to share it (unticked keeps it private). **Create
pipeline** or Command-Enter submits. Creating opens the pipeline's
editable table. Team members can edit shared pipelines; the creator owns them.
Anyone who can edit a pipeline can share it from the standard **Share** dialog.
Pick people or channels and an access level, and the message carries the pipeline.
The **People** list changes or removes their access. A teammate who receives a private
pipeline sees it in their Customers sidebar. Only the owner sees **Team access**:
choose **Edit** to share with the team or **None** to make the pipeline private.
Viewers see only **Copy Link**. **Copy Link** copies the pipeline's
`/app/companies/pipeline/<uuid>` URL, which opens it for anyone who has access;
pasted into an editor it becomes a pipeline mention (see
[CRM pipeline mentions](documents.md#crm-pipeline-mentions)). On mobile, team
access is in the **Team** tab.

A **Generic** pipeline needs no company or contact. It starts like a new database,
with one optional **Name** text column and no Stage, Owner or Revenue. Name is an
ordinary column, so it can be renamed, retyped or deleted; add any columns and
views from there. **Add entry** starts a row in place, with no record
form or stage requirements. **Import CSV** is not offered; **Export CSV** is.

In a company or contact pipeline, the first column is a required company/contact reference. Clicking a filled
reference, or pressing Enter on it, opens that company or contact; on desktop it
opens in place with the pipeline name in its breadcrumb (choose it to return),
and on mobile in its own view. The same applies to the reference shown as a
board card's or record panel's title. To change which record a row references,
focus the cell and press F2 or start typing; an empty reference cell opens the
picker on click. The same company or contact can occur in multiple rows in a
pipeline and can also belong to other pipelines. Each row has its own field
values; **Duplicate** copies a row into a new entry referencing the same company or contact. The reference column
can be renamed but cannot be removed or changed to another type. Stage, Owner,
and Revenue are independent pipeline fields; editing them does not modify the
company's CRM fields. Use **Add column** or a column header's menu to customize
columns. Pipeline Stage options initially copy the team's current deal stages. Open
pipelines refresh other editors' changes periodically; a local edit refreshes
immediately after saving.
A pipeline page uses the database page's styling with one table and no table
tabs. Its header shows the name, edited in place by editors, a **Pipeline
actions** menu (**Rename** and **Import CSV** for editors, **Export CSV** for
anyone who can open it, **Trash pipeline** for the owner) and **Share**. The
toolbar below has **All records**, the pipeline's stored views and **New view**
(Table, Board, or Timeline), plus Group by (boards), Filter and Sort, then **Add deal**
(company pipelines) or **Add contact** (contact pipelines) for editors. It opens
a dialog titled **Add deal** (or **Add contact**) with the pipeline's name in a
chip beside it and Close. Below the header, each field has its label stacked
above a full-width bordered box: **Company** (or the contact column) first, with
a **Find or add a company…** (or contact) search, then every pipeline field with
the table's own cell editors (unset ones read **Empty**). The body scrolls while
the footer stays pinned with **Cancel** (Esc) and **Add deal**. Select
fields can create a new option. Choosing **Add company “…”** creates the company
with the row: a searched domain fills the domain and the name. **Add contact “…”**
works the same way. A new company may omit its domain. A new contact accepts a
full email address and an explicit company choice, including a name-only company.
An email-domain match offers **Use suggested company**; accept it or select a
different company before submitting. Editing the email keeps that explicit choice.
Focusing the suggestion reveals its full name; Enter accepts it without submitting
the form, and closes the tooltip without a browser error.
**Add deal** stays disabled until a record is chosen, and Command-Enter submits.
Use **Stage requirements** in the toolbar to choose a single-select stage field,
a stage, and the fields required to enter it. Save one stage at a time; unchecking
all fields removes that rule. Renaming a field or stage keeps the rule. Deleting
one removes its corresponding requirements. Remove requirements before changing
a referenced field's type or deleting options from a required field. Existing
deals stay in place when a rule is added;
entering that stage or editing its required fields validates the final values.

The Add deal form marks the selected stage's required fields **Required** and
names missing fields on submit. Empty text and empty selections are missing;
zero and an unchecked checkbox are valid values. The record and field edits stay
in the form after a refusal. An open form follows stage renames by identity; if
its selected stage is deleted, it asks for another value while keeping other edits.
Deleted fields leave the draft submission. Board moves, timeline group moves, table edits, agent tools and CSV imports
use the same server rule; a rejected operation batch saves none of its edits.
Verify by requiring Revenue for Negotiation, trying a move with no Revenue,
filling Revenue, then retrying; also rename the field/stage and repeat. Check the
form on desktop and mobile, including correction after a rejected submit.

The form makes one row with every value set. A board lane's **New record** opens
the same dialog with the lane's stage filled in. A timeline's **New record here**
or range-drawing gesture also opens the form, preserving the chosen date range
and the group stage when one was selected. The table's blank row at the
bottom still adds a row inline. On mobile the dialog is a bottom drawer. To verify
the person picker, choose an **Owner** in the dialog: its menu must accept the
click.
Stored views are everyone's and are written through the pipeline, so changing one
changes it for all viewers; All records is each viewer's own. A board can move a
card to another group from its card menu or by dragging, which sets the row's
grouping cell. Stored boards restore card order after a reload and keep each
view's positions separate. Switching boards during a save clears the previous
board's temporary drag placement; the save still completes on its original board.
Card titles wrap long company/contact names, and
visible fields show their labels above full-width values; unset fields show a
dash. Click the title to open its record, edit a field inline, or use the grip
at the top right to drag the card with a mouse. On touch screens, swipe
horizontally between lanes and use the card's Move menu to change groups.
Views cannot be reordered yet. The selected view is remembered
per pipeline. To verify a board, move a card between lanes and within a lane,
reload, and confirm its group and order; also check click-to-open and field
editing in light and dark themes.
**Trash pipeline** removes its table from navigation without deleting the linked
companies or contacts, then returns to Companies.

**Export CSV** downloads every row: `Company` and `Domain` (or `Contact` and
`Email`), then each pipeline column by name, with people as emails. **Import
CSV** reads the same shape, so an export imports into another team's pipeline.
Rows match companies by domain and contacts by email, creating missing ones
(personal domains such as gmail.com cannot be created); other headers fill the
pipeline columns of the same name, adding missing select options. A record
the pipeline already had is not added again, so retrying an interrupted import
adds only what is missing; several rows for one new record add separate entries
(deals), as an export of such a pipeline lists them. Relation and non-person entity columns are skipped,
and a value that does not fit its column is left empty. Stage-validation refusals
are isolated to individual entries: valid rows continue importing, and the result
lists each refused entry by its import position, domain or email, and missing fields.
Use **Add deal** or **Add contact** to correct and add a refused entry, including a
second deal for a company whose valid entry was imported. Reimporting skips records
already present in the pipeline.

Agent CSV imports report ambiguous contact emails as unresolved records with an
actionable reason and continue the valid rows. They never create another contact
for an ambiguous email; select the intended contact by ID when adding it to the
pipeline. Storage and authorization failures during lookup still fail the import.

CRM lists are currently disabled by `enableCrmLists` (default `false`). The sidebar
Lists section, list editor, and company membership controls only mount when enabled.
Existing list data is preserved; a restored list view returns to All companies while
disabled. Saved filter views remain available.

When enabled, lists are personal, team-scoped collections of explicit company IDs, persisted through
saved-view storage separately from saved filter views. `New list` opens a name and
company picker; `Edit list` changes membership or deletes the collection. An empty list
must not show every company. The picker browses up to 500 recent companies. Canceling
never saves the draft. Saving only closes the dialog after the server succeeds.

Company detail pages show a **Lists** section in the right panel, with current
personal list memberships as chips. **Manage lists** expands a searchable checkbox
picker. Checking or unchecking saves immediately and refreshes the CRM sidebar's
membership counts. Changes are disabled while saving; failures show an inline retry
message and keep the last saved membership. With no lists, create one in the CRM sidebar.

Desktop `New` → `Company` uses the existing creation dialog. `Import` previews a CSV with a
`Domain` (or `Domains`, `Website`) column and an optional `Name` or `Company`
column, such as a Companies export (up to 10,000 rows, at most 5 MB). Each row
takes its first valid domain; rows without one or repeating an earlier domain are
skipped. **Choose file** opens the CSV picker; the selected filename appears
beside it (wrapping on narrow screens), and **Change file** opens it again.
Cancelling the picker keeps the selection. The explicit Import button writes the
previewed companies four at a time; domains the team already tracks count as
already in the CRM. Partial
failures retain only failed rows for retry. Stage, Owner, and Revenue live on
pipeline rows, not companies: when the file has values in those columns and
pipelines are available, a picker chooses where they go: **New private
pipeline** (the default) or **New team pipeline**, either named after the file,
or any company pipeline you can edit. The import adds one row per company with a
value (missing Stage options are added; owners match by email) and offers **Open
pipeline** after. If that step fails, importing again reuses the same pipeline
and adds only missing rows. A pipeline's own **Import CSV** also takes a
Companies export. Use preview
and cancel for browser checks against hosted dev data.

`CRM settings` shows the settings in the Customers pane, in place of the open
list, pipeline, or record, and highlights its sidebar item. The back arrow
(**Close CRM settings**) returns to that same list, pipeline, or record; picking
another sidebar destination, or browser Back, also leaves settings. On touch
the back arrow is the only control in the header. It is the same page as
Settings > CRM, with the same member and admin permissions; check both roles.

CRM is available without contributing email. The banner **Your emails aren’t
contributing to CRM** opens **Review and opt in**. The dialog shows the exact
connected primary mailbox, **Team blacklist**, and **My blacklist** before
**Share my emails with CRM**. Opt-in shares full content from all available
historical and future messages, excluding blocked threads. The same controls
are in CRM settings and **Email contribution settings** on a company. A
changed or reconnecting mailbox requires a fresh review; a disconnected mailbox
cannot opt in.

Any member can add a team domain; only team admins/owners can remove one.
Personal domains affect only that member's mailbox. Domains include subdomains;
a blocked participant in To/Cc/Bcc or the sender excludes the whole thread.
Blocking hides previously shared matching threads on subsequent CRM reads.
Another teammate's permitted copy may still appear when only a personal block
applies. **Stop sharing my emails** withdraws that mailbox's contributions.
Company/contact records, references, pipelines and archive state remain intact.
Both **Team** and **Me** email tabs honor consent and exclusions; normal inbox
access remains available.

The **Email sync** section retains **Keep personal emails out** (on by default).
With it off, eligible mail sent to a personal-provider address adds a contact
without a company only when no same-team identity exists; otherwise sent and
received mail refresh the unique existing contact without changing its chosen
company. A selected company with email sync disabled suppresses interaction and
source updates while preserving the manual record. Both paths require the
mailbox owner's exact-primary contribution consent and eligible stored history.
Manual add-email and company link/switch remain available without consent and
never enable sync or enroll a mailbox. Vendor, brand
and bulk-sender filters still apply. Turning the filter back on stops future
capture without deleting contacts. The existing admin **Blocked domains**
controls use the same team exclusions as the privacy dialog. Blocking or
unblocking never archives or restores records. A partially failed multi-domain
change retains successful blocks and offers **Retry failed domains**.

Contacts without a company add no CRM thread-access grant. Archiving one
suppresses its team's CRM-derived grant; independent ownership, delegation,
sharing, and other eligible team grants still apply. Verify consent, withdrawal,
team/personal exclusions, retry behavior and scrolling for ordinary members and
admins on desktop and phone. Use owned local fixtures for all sharing mutations;
hosted data is read-only for verification.

`Export` opens options for companies. Choose Current view
(respects filters/search) or All records across views (each visible record once), then
select CSV columns. Company exports include Stage, Owner, Revenue and optional custom
properties. `Prepare export` fetches every page and shows a count and three-row preview;
it does not download. `Download CSV` saves the prepared snapshot using the selected
columns. Changing scope requires preparing again. Cancel stops preparation. CSV uses UTF-8,
quoted fields, original date timestamps and spreadsheet formula escaping.

The existing CRM New menus use icons and muted descriptions for Company, Contact, and Pipeline. Pipeline availability and permissions are unchanged.

For loading diagnostics (span names in the
[observability guide](observability.md#navigation-and-view-phases)), switch
sections and reopen a record: each restarts the `crm.company` / `crm.contact`
flow, and disabled sources must not leave it waiting once metadata is ready.
Traces hold opaque record ids and section categories, never names or addresses.
Metadata errors may cancel the detail flow when the outer error panel replaces it.

## Sequences

Sequences are multi-step emails the server sends from your own connected Gmail
inbox (not a delegated inbox or Outlook) to CRM People. They need a team with
Customers on and PostHog `enable-sequences` (on in dev; local override
`VITE_ENABLE_SEQUENCES`). Off, the sidebar item, mobile tab, contact card and
**Add to sequence** disappear, the sequence views never load, no sequence
requests run, and sequence links return to Companies after flags load. Without
CRM on for the team, the section and its links behave the same way.

- **Where:** the **Sequences** item after Pipelines in the Customers sidebar (its
  number counts enrollments that need attention) or the mobile view strip; the
  list is `sN.crm.tab=sequences` and one sequence opens at
  `/app/companies/sequence/<uuid>`. Only its owner sees it.
- **Create and activate:** **New** creates an Untitled sequence and opens it with
  the title focused; rename it in the header. Set **From**, the emails (the
  first sends at the start; each later one waits days after the previous and
  can reply in the same thread; **Insert** adds `{{firstName}}`, `{{name}}` or
  `{{email}}` at the caret) and the footer; the server adds an unsubscribe
  link. **Only send on weekdays** (on by default) moves weekend sends to
  Monday. Edits save on their own (**Saving…** shows beside the status), and
  **Activate** starts it; Delete is in the ⋯ menu. A sequence can be edited
  while active; edits reach every email not yet created (each is rendered
  about a minute before it sends). A save that would leave an active sequence
  incomplete (an emptied subject, say) is refused: the message shows above the
  editor and the local edits stay. Pending emails stay out of Mail; a failed one
  shows there like any failed send.
- **Add people:** **Add people** searches CRM People (up to 50 at a time) and
  takes a start time in your time zone, by default in a few minutes during
  working hours (9:00 to 17:00 on weekdays) or else 9:00 the next working day.
  Each inbox sends up to 100 sequence emails a day; more wait for the next
  day. People can be added before activating;
  nothing sends until the sequence is active. Selected People or
  Companies rows also offer **Add to sequence** in their right-click and
  selection command menus; a company brings all its people, so filter or group
  Companies by Stage to add a pipeline stage. Past 50 people, only the first
  50 are selected. Skipped people (no email, unsubscribed, already added) are
  listed with why.
- **Statuses:** a sequence is Draft, Active or Paused. A person is Active, Paused
  (also while the sequence is a draft or paused), Needs attention (an email
  didn't go out: check it in Mail, then resume or stop; sending it from Mail
  moves them on), Stopped (by you, replied, bounced, unsubscribed, or no
  longer in Customers) or Completed. Rows show progress, last and next send,
  and offer Pause, Resume (also after a stop for a reply, bounce or a person
  no longer in Customers), Stop and Unsubscribe (team-wide, confirmed first);
  the name opens the person, whose record holds the sent emails. An inbox
  that can't send holds emails back instead of failing them; an active
  sequence's detail says so until you reconnect it or choose another.
- **Contact card:** a contact's Overview lists its sequences for every teammate:
  sequence, owner, status, last and next send. The owner's sequence name
  opens it.
