# README assets

## Feature grid graphics

The ten JPEGs in `features/` are browser-rendered product graphics, exported at
2400 × 1600. They use the website refresh's existing components, fonts, avatars,
menus, and controls, with dark angled panels and message overlays. These are
staged marketing scenes, separate from the six signed-in screenshots below.

`feature-graphics.mjs` renders components from a supplied marketing checkout:

```sh
bun .github/readme/feature-graphics.mjs /path/to/refresh/apps/marketing
```

The checkout needs its installed dependencies and Google Chrome. The exporter
uses port 4188, temporarily creates three `.readme-capture.*` files in that
checkout (refusing to overwrite existing files), and removes them on completion.
It waits for fonts and images, uses reduced motion, and captures at 2× density.
Review all ten exports before committing; retain all categories and docs links.

Source reference: the `b6a3` website refresh worktree on October 29, 2026
(base commit `9bacc0f5de367be1dc4c3598db501ac212a495a8`, including its working
changes). The exporter imports these existing presentations:

- Email: `MultiInboxSpotlight`; messages: `ChannelPreviewGraphic`.
- Tasks: `TaskGithubDemo`; docs: `HeroDocWindow`.
- Agents: `AgentThreadGraphic`; calls: `CallStageGraphic`.
- Files: `FolderComposerMockup`; pull requests: `DemoPrDocument`.
- CRM: `CompanyKanbanColumn` and `CompanyKanbanCardSurface`, with nine fictional
  sample companies and deal values.
- Canvas: a staged canvas composition using the site's button components and
  the drawing tools/order from `apps/web/src/features/block-canvas/views/canvas-toolbars.tsx`.

The exporter adds framing and `HomepageConversation` overlays; it does not alter
the reference component files. It replaces the earlier simplified SVG generator.

## Product screenshots

The six JPEGs were captured on October 28, 2026 from a signed-in
Macro workspace in the web app. The browser viewport is 2000 × 1293;
the channel image uses the top 2000 × 900 portion to frame the discussion.
These are live UI captures. The CRM board uses fictional sample companies
and deal values in a dedicated private Sales Demo pipeline.

| Asset | View |
| --- | --- |
| `email-thread.jpg` | First Macro Outlook Email!, a team test message, with email navigation open |
| `messages-channel.jpg` | Engineers, discussing search and delegating work to an agent |
| `tasks-list.jpg` | Search surface area project, Tasks grouped by assignee |
| `docs-prd.jpg` | PRD: Team Channels, with tags, assignees, and details expanded |
| `crm-board.jpg` | Sales Demo pipeline with 11 fictional companies: 3 Lead, 3 Demo, 3 Customer, and 2 Churned; all deal values are sample data |
| `agents-task-handoff.jpg` | Add Reminder Icon To Tasks, with a successful audit and PR #8824 |

Keep the navigation sidebar open in every screenshot. Capture browser page
content so macOS screen-sharing indicators and window controls stay out of the
image. Move the pointer away from controls and wait for tooltips to disappear.

Before refreshing screenshots, inspect all visible content, including sidebar
items. Use navigation search or collapse unrelated sections where needed. Avoid
private customer details, credentials, financial information, and personal
conversations. Use a populated pipeline board with fictional sample companies
for CRM and keep the root README's alt text consistent with each displayed
view. Review every saved image before staging it.
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
