# README assets

## Product screenshots

The root README uses nine product screenshots. The October 29 final gallery
supplies Databases, Agents, and Calendar. A subsequent sharpness review replaces
Chat, Tasks, and Docs with the user's higher-resolution first-pass captures.
Email and CRM retain Jacob's clean test/demo JPEGs pending equivalent sharp
recaptures. The CRM pipeline and database contain fictional sample data.
Calendar retains the real meeting names explicitly selected by the user.
Calls uses the approved web capture of the internal Tasks & Docs design review
at 3:45, with the recording and speaker-labelled transcript visible. The
2374×1470 focused crop preserves the call header and actual playback frame.

Chat and Tasks use 3024-pixel-wide desktop sources, trimmed by 6 pixels left,
8 right, and 12 bottom to remove capture edges. Docs uses the 2402×1308 compact
capture unchanged. The existing new Databases/Agents/Calendar PNGs have the same
6/8/12 edge trim. These are genuine source crops, with no upscaling or alteration
of UI content. Original captures remain outside the repository.

Keep enough source pixels for a sharp display on high-density screens. Capture
at a useful desktop viewport and retain roughly 2× pixels; do not downsample to
the README's display width before saving. Use lossless PNG for cropped UI text.

| Asset | View |
| --- | --- |
| `email-thread.jpg` | First Macro Outlook Email!, a team test message, with email navigation open |
| `messages-channel.png` | Engineers agent result, with links to the created project and task |
| `tasks-list.png` | Search Surface Area project grouped by assignee, higher-resolution desktop capture |
| `docs-prd.png` | PRD: Team Channels, compact desktop view with tags, assignees, and document content |
| `crm-board.jpg` | Sales Demo pipeline, showing 9 fictional companies in Lead, Demo, and Customer; 2 Churned companies are outside the crop; all deal values are sample data |
| `databases-table.png` | Donations Example, showing dates, amounts, designations, and donor relations |
| `agents-task-handoff.png` | Add Reminder Icon To Tasks, recaptured on web with a successful audit and PR #8824 |
| `calls-recording.png` | Tasks & Docs Page Design Review with Jacob, recording at 3:45 and speaker-labelled transcript |
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
Previous Chat, Tasks, Docs, and Agents JPEGs remain available but are no longer
referenced by the root README. The banner is unchanged. A booking-link companion image remains optional.

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
