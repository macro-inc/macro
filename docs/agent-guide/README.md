# Agent Guide to the Macro App

How an automated agent (driving a real browser via the chrome-devtools MCP server, or
observing via the Grafana MCP server) should operate the Macro web app. Everything here was
verified live against a local stack (`just run_local`, which needs no terminal: see
[Run without a terminal](../development/running-locally.md#run-without-a-terminal)).

| File | Contents |
| --- | --- |
| [login.md](login.md) | Passwordless login end to end, Mailpit, known crash + recovery |
| [navigation.md](navigation.md) | Routes, sidebar, command menu, keyboard model, splits |
| [documents.md](documents.md) | Creating docs, typing in the editor, AI edit, comments, Word (DOCX) editor, PowerPoint presentations, Figma designs, Photoshop and Illustrator editors, Photoshop and Illustrator documents (AI tools, search), side panel |
| [databases.md](databases.md) | Properties, records, kanban boards, saved views, AI questions, live answers |
| [forms.md](forms.md) | Forms: create doors, builder (drag and drop, gates), respond route, Responses grid, sharing, polls |
| [ai-chat.md](ai-chat.md) | Standalone and doc-scoped AI chat |
| [channels.md](channels.md) | Channels: create, invite, message, participants, bots |
| [tasks.md](tasks.md) | Task list and creation dialog |
| [view-tours.md](view-tours.md) | Desktop feature flyovers, dismissal, targeting, and embedded videos |
| [reminders.md](reminders.md) | Email snoozing, the reminder command menu, delivery, and safe failure verification |
| [home.md](home.md) | Home and the mobile Notifications inbox |
| [email.md](email.md) | Mail: threads, read state, trash, cached filtering, reminders |
| [calendar.md](calendar.md) | Calendar views, Scheduling workspace, booking links, events, and invitations in email |
| [search.md](search.md) | Search |
| [files.md](files.md) | Files (Drive) |
| [calls.md](calls.md) | Calls, call links, guests, and sharing |
| [crm.md](crm.md) | Customers (CRM) |
| [passwords.md](passwords.md) | Team vault, inline editing, sharing and recent sign-in |
| [pull-requests.md](pull-requests.md) | Pull request review |
| [activity.md](activity.md) | Activity |
| [notifications.md](notifications.md) | Notifications |
| [external.md](external.md) | External tab: linking WhatsApp by QR, adding and sharing external chats, mocking `/whatsapp` and `/external-chats` |
| [settings.md](settings.md) | Settings sections, including Slack import and team membership |
| [onboarding.md](onboarding.md) | Onboarding resume links, bypass, and setup plan |
| [setup-cards.md](setup-cards.md) | Sidebar import and setup cards, the connector import dialog, and permanent dismissal |
| [canvas.md](canvas.md) | Canvas colors and link paste |
| [soup-live-updates.md](soup-live-updates.md) | Live updates in flat Soup lists |
| [ui-conventions.md](ui-conventions.md) | Shared UI behavior: list loading, top bars, dialog actions, user cards, information panels |
| [browser-technique.md](browser-technique.md) | Generic chrome-devtools MCP lessons learned on this app |
| [observability.md](observability.md) | Correlating a UI action to backend traces/logs with the Grafana MCP |

Local stack conventions used in examples: frontend `http://localhost:<fe>/app`, backend proxy
`https://localhost:<be>` (checked-in self-signed cert; trust `infra/local/certs/ca.pem`), Mailpit `http://localhost:<mp>` (ports come from the `--instance`;
e.g. the `lgtm` instance uses 27910 / 27909 / 27908).

For remote browser testing, trust `infra/local/certs/ca.pem` and open the
printed `https://<hostname>:<proxy-port>/app/` URL. The launcher calls `hostname`
and includes it in both the generated certificate and Vite's allowed hosts.
Caddy forwards frontend assets and HMR to Vite while routing API and backend
WebSockets directly. No Tailscale setup is required; the browser needs network
access to that hostname and port. Plain HTTP on a remote hostname cannot retain
secure login cookies.

Standalone `bun run dev` uses the same CA and serves HTTPS directly through
Vite. Hosted dev API and WebSocket requests use `/__macro_dev/` on the page
origin, with auth cookies scoped to that hostname. Use email-code sign-in; the
hosted Google/SSO redirect allowlist does not include arbitrary hostnames.
Email magic links retain the page's HTTP or HTTPS scheme and port.
On allowed OAuth origins such as `https://localhost`, standalone Vite uses the
session-code handoff to establish cookies on the local hostname after SSO.

For the standalone marketing site, verify cold product-page navigation with the
route module delayed: prerendered content must remain until the page is ready.
On mobile, the single hamburger opens and closes navigation; there is no separate
caret. Check Escape focus return and keyboard wrapping inside the open menu.
Standalone marketing dev/preview servers hand `/app/*` navigation to
`VITE_APP_BASE_URL` (`https://macro.com` by default); verify that signup leaves the local website instead of
showing an empty header. Use an `apps/web` preview for local signup testing.

For the homepage, verify one opening section on desktop and mobile: the Macro
logo surrounded by the 12 decorative app logos from the production welcome
constellation, the unified-workspace H1 and supporting H2, signup action, and
backing/security badges. Check visible keyboard focus on signup, sidebar, and
Learn about links; the decorative constellation is hidden from assistive technology.
Scroll down and back with regular and reduced motion: there is no separate GitHub
section, and the hero stays readable. Below it, check the centered slab headings,
small Inter descriptions, and side rules across all five product chapters.
The email illustration must reveal its draft and show the completed result
with reduced motion; it sends no email. Check the page has no horizontal overflow
and Home navigation preserves the sidebar.



## Public website documentation

For the public website preview, open `/docs` to read the integrated guides. Navigate Home → Chat → Home and use browser Back/Forward: the desktop sidebar must stay mounted and visible without a document reload.
Desktop navigation is always open with a search icon at the left of the pinned search field. Command/Control+K or Command/Control+F focuses search (and opens the drawer on phones). Search matches titles and content across feature pages, setup guides, comparisons, and customer stories, with at most eight results. Check that changelogs, Tool Reference, engineering posts, legal pages, and company pages are excluded, and each feature appears only once. Check a typo such as `calednar`, a blog such as `Linear`, and a guide such as `MCP Setup`; results show an icon, title, and location. Use arrow keys and Enter to open a result. The clear button or Escape clears the query; a second Escape closes the mobile drawer and restores focus. Use Top features and More features to open a product page. The current guide is highlighted. The desktop sidebar stays at a fixed 217px width with no collapse or resize controls. On phones, use the top-left menu button and close the full-screen drawer before reading. Escape closes the mobile drawer. Content is authored in `apps/docs`; rendering and navigation belong to `apps/marketing/src/features/documentation`.

Feature links in the public website sidebar open the visual product overviews.
Use the labeled documentation sections for standalone reference, or open Setup and reference
below a feature page’s FAQ. Product guide URLs redirect to their feature page.

For the docs-domain migration, build the website and run the marketing
`check:docs-redirects` command (optionally with a static preview `--origin`).
Verify `/docs/product/databases` redirects to `/databases`, then check its expandable
reference and a legacy heading link. Verify a standalone guide as well. Only after an authorized website deploy should the redirect records
in `apps/docs/docs.json` be published to Mintlify; check real old-host 308s then.

## Public website feature navigation

The website sidebar lists product overviews under Features, including
`/spreadsheets`, `/databases`, `/canvas`, `/snippets`, `/calendar`, `/booking-links`,
`/drive`, `/routines`, and `/skills`. Matching product guides are not
repeated below: open a feature page and use its Read guide link, or search the
sidebar for the detailed guide. Folders is covered by Drive and Reviews by GitHub;
all original `/docs` URLs remain available.

Projects are part of Tasks: `/projects` and the former Projects guide redirect to `/tasks`. Project setup, sharing, and agent assignment are in the Tasks reference.

Main benefits starts with Replace 27+ apps (`/replace-apps`), followed by Company graph, AI tagging, Automatic permissions, Workspace events, and Unified search. The replacement page reuses the pricing savings calculator below a compact wall of app logos; check seat changes, tool toggles, and plan selection on desktop and mobile. The other benefit routes render centered feature-style overviews and annotated graphics on black with faint localized glow, without colored poster frames. Check all five on desktop and mobile, and confirm playing a demo replaces the diagram with a visible video. The original MDX remains available under Setup and reference. Verify the overview, expand the guide, and test a legacy heading fragment. Existing guide URLs remain valid; the event overview is at `/docs/concepts/event-system` and links to the routine trigger reference.

On `/pricing`, verify Free ($0), Pro ($40), and Max ($200) prices, signup links, the expandable plan comparison, and shared FAQ keyboard toggles. Test calculator seats and tool selection on desktop and mobile. The customer story uses a native video with an accessible play button.

Agent API hosting: chat, routines, preview control, and public MCP share the
agent harness service; browser gateway paths remain unchanged. See the
[service consolidation guide](../guides/consolidate-agent-services.md).
