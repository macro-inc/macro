# Customers (CRM)

## Customers (CRM) — `/app/component/companies`

On desktop, the local sidebar uses the same navigation primitives as Email and Tasks.
Its **New** menu creates a **Company**, a **Contact**, or a **Pipeline** (Pipeline
only when pipelines are enabled; disabled until the team's CRM is enabled). The
**Records** section lists **Companies** and **People**; Pipelines and Lists follow.
There are no built-in company views or Board/List layout. Companies and People
are plain soup lists with the shared pagination. Existing personal/team saved
views stay in the toolbar's Views menu.

The selected Customers tab is stored on the pane as `sN.crm.tab`. People uses
`people`, a pipeline uses `pipeline:<uuid>`, a list uses `list:<uuid>`, and
hidden companies use `hidden`. Companies is the default and omits the key.
Choosing Companies, People, a pipeline, or a list updates that parameter.
Browser Back and Forward restore the tab and close an open record.

Companies lists every visible company, grouped by Stage by default, with Owner,
Revenue and Last Interaction columns. A Stage column is off by default; turn it
on, or hide Owner or Revenue, under **Display options**. Its toolbar holds
sort, group, filter, display options, saved views, and **New company** at the
right end.

People lists contacts across every CRM-enabled team the viewer belongs to, from
the same Soup query with only CRM contacts opted in (`crmf`). The server collapses
duplicate full email addresses (case-insensitive) to one contact. Hidden contacts
and contacts under hidden companies are excluded. Columns are Person (name and
email), Company and Last contacted (sortable). `Search people` matches name or
email on the server after a short typing pause, so results include contacts not
yet scrolled into view. **New contact** sits at the right end of the toolbar. Its
dialog asks for a company through a **Choose a company** pill (searchable by name
or domain, from the up to 500 most relevant companies with a domain) and fixes
the email to that company's primary domain; **Add contact** on a company's Team
tab skips the company pill. The company, contact and pipeline dialogs share the
task/project composer layout: name on the first row beside **Close**, details
below, and a **Create …** button that also submits on Command-Enter.

`Search companies` and `Search people` use the shared Email/Tasks search bar.
Command-F focuses it, `Clear search` resets it, and Escape leaves the field.

On touch devices, CRM uses the same scrollable pill tabs as Tasks in the top
header: Companies, People, available pipelines, and enabled lists. Swipe the
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

On desktop, clicking a company or a person in the list (or pressing Enter on a
focused row) opens its details inside the CRM workspace, keeping the left
navigation visible. The top breadcrumb reads `<Companies, People or list> >
<record>`; click the first segment to return with the same filters and list
scroll position. Selecting another sidebar entry closes the details. Shift-click
still opens the record in a separate split. Direct company and contact links use
the standalone pages.
Each record opened from the details appends a breadcrumb: a contact from a
company's Team tab gives `Companies > <company> > <contact>`, and a person's
Company link gives `People > <contact> > <company>`. Opening a record already in
the trail (such as the contact's own company from `Companies > <company> >
<contact>`) returns to it instead of adding a duplicate. The CRM sidebar stays
visible throughout.
Company and contact headers have `Copy link` beside the side-panel toggle.
Their information panel starts closed and opens as a floating bubble at every
width, without shrinking the record content. Click outside the bubble or use
the toggle to dismiss it; the open state is not restored on a later visit.
It copies the record's direct URL and shows a confirmation toast; this is also
available in the embedded company and contact breadcrumb header.

The Team, Emails, Files, Tasks, and Calls tabs share a compact toolbar: search on
the left, with available filters and actions on the right. Search remains visible
for empty lists. `Add contact` and `New task` match the project task list's
creation button: a rounded outline, standard height, and leading plus icon.
The associated-tab search fields match the creation buttons' height.
Team rows show a profile photo when available, otherwise a
letter avatar at the same 16px size as channel list icons. Team uses the same Soup
row component as Emails, Files, and Calls: the avatar, name, and email are inline,
the last-contacted timestamp sits at the right, and the side gutters and row
spacing match. There is no column-heading row.
Emails, Files, and Calls search the loaded row titles and supporting text and
continue loading pages when the current pages have no match.
Emails, Files, Calls, and References rows open their items without selection
checkboxes, including on touch devices.

A company is laid out like a project. Its split header or embedded breadcrumb
header shows inset `Overview`, `Team`, `Emails`, `Files`, `Tasks`, and `Calls`
tabs, collapsing to icons when narrow. Overview shows the name, pills
for each domain and `Last interacted`, the generated description, a
**Pipelines** section and the Discussion. Pipelines stacks one full-width card
per row of a pipeline you can open that references the record. A card's header
strip names the pipeline (a lock marks a private one); below it, the row's first
four fields sit side by side, label over value, and the rest wait behind
`Show N more`. Cells edit like the pipeline table's when you can edit that
pipeline. Inside Customers, the header's `Open <pipeline>` button opens it. The
`Pipelines` caret header collapses and expands the cards, like the Discussion
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
`Retry` reloads it; a failed later page keeps the rows and shows `Couldn't
load more.`
A contact has the same layout with `Overview`, `Emails`, `Files`, `Tasks` and
`Calls`: Overview pills show the email, the company (opens it) and `Last
interacted`, followed by the contact's Pipelines cards. Its Files, Tasks, Calls,
and References show items associated with the contact itself (its `Contacts`
property or an @mention of it), not everything associated with its company;
Files also includes attachments of emails with its address. Tasks created from a
contact also reference its company. The side panel keeps Sharing (admins only)
and adds References.

In a company or contact's Tasks tab, clicking a task (or pressing Enter on its
focused row) opens the task detail view at `/app/tasks/<task-id>`, including on
mobile. Shift-click opens it in a separate split. Verify that the task's status
and properties appear, rather than the regular Drive markdown editor.

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
members and agents. A message's copied link is the standalone record URL
with `comment_id`; opening it, or a CRM discussion notification, scrolls to and
highlights that message. Deleting a thread's first comment deletes the thread.

Company selection actions **Set owner** and **Set revenue** remain available
while team deal-stage definitions are loading. **Set stage** waits for the active
team definition rather than opening an editor with system defaults. Check both
the entity actions menu and command menu with stage requests delayed; cancel the
editors without changing hosted data.

`Collapse CRM sidebar` persists across visits; `Expand CRM sidebar` restores it.
At narrow widths, `Show CRM navigation` opens the same navigation in a menu.
The sidebar's Records and Lists sections can also collapse independently.

**Pipelines** in the CRM sidebar hold company or contact entries in the shared
records editor. They have their own identity, ownership and sharing; their
storage does not appear as a separate database in navigation.
**New pipeline** is disabled until the team's CRM is enabled. For a new team,
use **Open CRM settings** in the empty state to enable CRM, then return to
Customers to create a pipeline. Verify this with a newly created team as well as
an existing CRM-enabled team.
Choose **New pipeline**, enter a name in the dialog's first row, pick
**Companies** (the default) or **Contacts** from the record-type pill, and tick
**Share with my team** to share it (unticked keeps it private). **Create
pipeline** or Command-Enter submits. Creating opens the pipeline's
editable table. Team members can edit shared pipelines; the creator owns them.
Anyone who can edit a pipeline can share it from the standard **Share** dialog.
Pick people or channels and an access level, and the message carries the pipeline.
The **People** list changes or removes their access. A teammate who receives a private
pipeline sees it in their Customers sidebar. Only the owner sees **Team access**:
choose **Edit** to share with the team or **None** to make the pipeline private.
Viewers see only **Copy Link**. **Copy Link** copies a CRM link that opens this pipeline for
anyone who has access, including when followed inside a split already showing Customers;
pasted into an editor it becomes a pipeline mention (see
[CRM pipeline mentions](documents.md#crm-pipeline-mentions)). On mobile, team
access is in the **Team** tab.

The first column is a required company/contact reference. Clicking a filled
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
(Table or Board), plus Group by (boards), Filter and Sort, then **Add company**
or **Add contact** (by the pipeline's record type) for editors, which starts a
row whose reference cell picks the record.
Stored views are everyone's and are written through the pipeline, so changing one
changes it for all viewers; All records is each viewer's own. A board can move a
card to another group from its card menu or by dragging, which sets the row's
grouping cell. Card order within a group is not read back after a reload, and
views cannot be reordered yet. The selected view is remembered per pipeline.
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
and a value that does not fit its column is left empty.

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

`New company` uses the existing creation dialog. `Import` previews a CSV with a
`Domain` (or `Domains`, `Website`) column and an optional `Name` or `Company`
column, such as a Companies export (up to 10,000 rows, at most 5 MB). Each row
takes its first valid domain; rows without one or repeating an earlier domain are
skipped. The explicit Import button writes the previewed companies four at a
time; domains the team already tracks count as already in the CRM. Partial
failures retain only failed rows for retry. Stage, Owner, and Revenue live on
pipeline rows, not companies: when the file has values in those columns and
pipelines are available, a picker chooses where they go: **New private
pipeline** (the default) or **New team pipeline**, either named after the file,
or any company pipeline you can edit. The import adds one row per company with a
value (missing Stage options are added; owners match by email) and offers **Open
pipeline** after. If that step fails, importing again reuses the same pipeline
and adds only missing rows. A pipeline's own **Import CSV** also takes a
Companies export. Use preview
and cancel for browser checks against hosted dev data. `CRM settings` opens the existing
settings panel. Requires a team with CRM enabled.

`Export` opens options for companies. Choose Current view
(respects filters/search) or All records across views (each visible record once), then
select CSV columns. Company exports include Stage, Owner, Revenue and optional custom
properties. `Prepare export` fetches every page and shows a count and three-row preview;
it does not download. `Download CSV` saves the prepared snapshot using the selected
columns. Changing scope requires preparing again. Cancel stops preparation. CSV uses UTF-8,
quoted fields, original date timestamps and spreadsheet formula escaping.
