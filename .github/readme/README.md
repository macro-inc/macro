# README assets

## Product screenshots

The root README uses the eight-image selection from the final October 29,
2026 gallery. Five existing JPEGs are retained unchanged. Databases and Agents
use new high-resolution web captures; Calendar uses a desktop capture. The
Databases example and CRM pipeline contain fictional sample data. The Calendar
capture was explicitly selected with its real meeting names visible.

The new PNGs preserve the gallery's selected crops without another lossy encode.
They omit browser chrome, the system sharing indicator, and the pointer. Keep
text readable at GitHub's README width rather than fitting an entire desktop
into every image. The existing CRM crop shows three complete populated stages.

| Asset | View |
| --- | --- |
| `email-thread.jpg` | First Macro Outlook Email!, a team test message, with email navigation open |
| `messages-channel.jpg` | Engineers, delegating project and task creation to an agent |
| `tasks-list.jpg` | Search surface area project, Tasks grouped by assignee |
| `docs-prd.jpg` | PRD: Team Channels, with tags, assignees, and readable requirements |
| `crm-board.jpg` | Sales Demo pipeline, showing 9 fictional companies in Lead, Demo, and Customer; 2 Churned companies are outside the crop; all deal values are sample data |
| `databases-table.png` | Donations Example, showing dates, amounts, designations, and donor relations |
| `agents-task-handoff.png` | Add Reminder Icon To Tasks, recaptured on web with a successful audit and PR #8824 |
| `calendar-week.png` | Populated weekly calendar with connected calendars and booking-link controls |

Keep the navigation rail visible; show the expanded sidebar when it adds useful context. Capture browser page
content so macOS screen-sharing indicators and window controls stay out of the
image. Move the pointer away from controls and wait for tooltips to disappear.

Before refreshing screenshots, inspect all visible content, including sidebar
items. Use navigation search or collapse unrelated sections where needed. Avoid
private customer details, credentials, financial information, and personal
conversations. Use a populated pipeline board with fictional sample companies
for CRM and keep the root README's alt text consistent with each displayed
view. Review every saved image before staging it.
The previous `agents-task-handoff.jpg` is retained but no longer referenced by
the root README. The banner is unchanged. Calls and booking-link companion
images remain optional and are not part of this eight-image selection.

The marketing homepage's separate screenshot copies under
`apps/marketing/src/app/assets/desktop-feature-screens` are independent.

## Star history

`star-history.py` embeds a GitHub stargazer timestamp snapshot through
October 28, 2026 (5,281 stars). It counts current stargazers, so removed stars
are absent from the historical totals.

Refresh the source timestamps with:

```sh
gh api --paginate -H 'Accept: application/vnd.github.star+json' \
  'repos/macro-inc/macro/stargazers?per_page=100' --jq '.[].starred_at'
```

Update `SERIES`, its snapshot comment, the axis bounds and month labels as
needed, and the root README's image description. From the repository root,
run `python3 .github/readme/star-history.py` to regenerate both SVG themes.
