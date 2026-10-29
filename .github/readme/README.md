# README assets

## Product screenshots

The six JPEGs were captured on October 28, 2026 from a signed-in
Macro workspace in the web app. The browser viewport is 2000 × 1293;
the channel image uses the top 2000 × 900 portion to frame the discussion.
These are live UI captures, not marketing fixtures.

| Asset | View |
| --- | --- |
| `email-thread.jpg` | First Macro Outlook Email!, a team test message, with email navigation open |
| `messages-channel.jpg` | Engineers, discussing search and delegating work to an agent |
| `tasks-list.jpg` | Search surface area project, Tasks grouped by assignee |
| `docs-prd.jpg` | PRD: Team Channels, with tags, assignees, and details expanded |
| `crm-board.jpg` | Sales pipeline board, grouped by stage and filtered to Every, a company shown in the previous public screenshot |
| `agents-task-handoff.jpg` | Add Reminder Icon To Tasks, with a successful audit and PR #8824 |

Keep the navigation sidebar open in every screenshot. Capture browser page
content so macOS screen-sharing indicators and window controls stay out of the
image. Move the pointer away from controls and wait for tooltips to disappear.

Before refreshing screenshots, inspect all visible content, including sidebar
items. Use navigation search or collapse unrelated sections where needed. Avoid
private customer details, credentials, financial information, and personal
conversations. Use the real pipeline board for CRM and keep the root README's
alt text consistent with each displayed view. Review every saved image before
staging it.
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
