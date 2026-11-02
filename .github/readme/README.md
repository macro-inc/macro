# README assets

## Product screenshots

The six JPEGs were recaptured on October 29, 2026 from a signed-in
Macro workspace in the web app. Use a desktop viewport around 1144 CSS pixels
wide so text remains readable at GitHub's README width. Trim excess empty
height rather than fitting an entire desktop into the image. Keep the navigation
sidebar visible. CRM uses a 1440-pixel viewport and a 1395-pixel-wide crop to
show three complete populated stages; the fourth stage is outside the crop.
These are live UI captures. The CRM board uses fictional sample companies
and deal values in a dedicated private Sales Demo pipeline.

| Asset | View |
| --- | --- |
| `email-thread.jpg` | First Macro Outlook Email!, a team test message, with email navigation open |
| `messages-channel.jpg` | feature-requests, discussing a Has PR / No PR task filter, handing it to Cursor, and asking an agent to find the owners |
| `tasks-list.jpg` | Search surface area project, Tasks grouped by assignee |
| `docs-prd.jpg` | PRD: Team Channels, with tags, assignees, and readable requirements |
| `crm-board.jpg` | Sales Demo pipeline, showing 9 fictional companies in Lead, Demo, and Customer; 2 Churned companies are outside the crop; all deal values are sample data |
| `agents-task-handoff.jpg` | Add Reminder Icon To Tasks, with a successful audit and PR #8824 |

Keep the navigation sidebar open in every screenshot. Capture browser page
content so macOS screen-sharing indicators and window controls stay out of the
image. Move the pointer away from controls and wait for tooltips to disappear.

Before refreshing screenshots, inspect all visible content, including sidebar
items. Use navigation search or collapse unrelated sections where needed. Avoid
private customer details, credentials, financial information, and personal
conversations. Use a populated pipeline board with fictional sample companies
for CRM and keep the root README's alt text consistent with each displayed
view. For chat, show a real team exchange with an agent handoff and result, not
only a long tool trace. Review every saved image before staging it.
The marketing homepage's separate screenshot copies under
`apps/marketing/src/app/assets/desktop-feature-screens` are independent.

## Star history

`star-history.py` embeds a GitHub stargazer timestamp snapshot through
October 29, 2026 (5,640 stars). It counts current stargazers, so removed stars
are absent from the historical totals.

Refresh the source timestamps with:

```sh
gh api --paginate -H 'Accept: application/vnd.github.star+json' \
  'repos/macro-inc/macro/stargazers?per_page=100' --jq '.[].starred_at'
```

Update `SERIES`, its snapshot comment, the axis bounds and month labels as
needed, and the root README's image description. From the repository root,
run `python3 .github/readme/star-history.py` to regenerate both SVG themes.
