# README assets

## Product screenshots

The six JPEGs were captured on October 28, 2026 from a signed-in
Macro workspace. Email uses the web app at 1600 × 1000; the other five use the desktop
app at 2802 × 1752. These are live UI captures, not marketing fixtures.

| Asset | View |
| --- | --- |
| `email-thread.jpg` | First Macro Outlook Email!, a team test message, with details expanded |
| `messages-channel.jpg` | Engineers, discussing search and delegating work to an agent |
| `tasks-list.jpg` | Search surface area project, Tasks grouped by assignee |
| `docs-prd.jpg` | PRD: Team Channels, with tags, assignees, and details expanded |
| `crm-board.jpg` | Companies filtered to Lead and Demo; x.ai and Every appeared in the previous public screenshot |
| `agents-task-handoff.jpg` | Fix Share Button Attachment Pill Access, with merged PR #8818 |

The CRM image keeps its existing filename, but now shows the company list:
the desktop app's saved Sales board failed to load during capture. Keep the
root README's alt text consistent with the displayed view.

Before refreshing screenshots, inspect all visible content and hide unrelated
navigation. Avoid private customer details, credentials, financial information,
and personal conversations. Review every saved image before staging it.
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
