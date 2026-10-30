# Submission management

Vendors whose servers support neither CIMD nor DCR need Macro Connect's own
OAuth app, and most review it before it can serve real users. Agents run these
submissions end to end; the goal is the shortest time from "needed" to
"approved". The workflow is the `connect-submission` skill; this file is the
reference it uses.

## The record

One file per vendor: `submissions/<vendor>.md`. Frontmatter is the tracker;
the body is the working file.

```markdown
---
vendor: google
apps: [google_drive, gmail, google_calendar]
state: needs-human          # see States
portal: https://console.cloud.google.com/apis/credentials/consent
account: connect@macro.com  # who owns the developer account
submitted: 2026-11-02       # first submission date, or empty
last_contact: 2026-11-04    # last message to or from the vendor
next_action: Eric signs the CASA assessor contract
next_action_owner: human    # human | agent
due: 2026-11-05
---

## Requirements
Checklist from the vendor's current docs, with links. Each item: done or not.

## Scopes
Requested scopes and the one-line justification for each.

## Log
Dated entries: what was submitted, what the vendor said, what we answered.
```

## States

`not-started → drafting → needs-human → submitted → changes-requested →
approved`, or `rejected`, `blocked`, `deferred` (the human postponed it), or
`excluded` (out of scope). `needs-human` and `blocked` carry the
reason in `next_action`. An approved record lists where the client ID and
secret live in Doppler (names only).

## How agents keep approval fast

- File everything at once; vendors review in parallel.
- Ask for the narrowest scopes that work. On Google, `drive.file` keeps Docs,
  Sheets, and Slides out of CASA; restricted scopes (Gmail, full Drive, Chat)
  are requested separately so they don't hold up the rest.
- Reuse approved wording from `submissions/answers.md` (data handling,
  retention, security contact, product description). New wording the human
  approves goes there.
- Record demo videos with a browser agent against the real flow.
- Answer reviewers the same day; the vendor's clock stops while we are silent.
- Check each portal daily for status changes vendors don't email about.

## Human gates

The agent prepares everything, then queues the human step in `STATUS.md` and
sets `state: needs-human`:

- signing in where 2FA or a CAPTCHA blocks the agent
- accepting terms, legal attestations, and contracts (e.g. CASA assessor)
- identity verification and payments
- choosing between options with business or legal weight

## Known requirements (2026-10-30)

From [`research/vendor-auth.csv`](research/vendor-auth.csv); re-verify before
filing.

| Vendor | Needs |
| --- | --- |
| Google | OAuth consent verification for sensitive scopes; plus annual CASA assessment (about $500-4,500, weeks to months) for restricted scopes; 100-user cap until verified; Workspace MCP Developer Preview enrollment. |
| Microsoft | Multitenant Entra app, publisher verification (Microsoft AI Cloud Partner Program ID). MCP needs Agent 365 licences, so out of v1. |
| Zoom | Marketplace app; public apps need review (weeks). |
| Xero | App certification; paid tiers by connection count (Core AUD$35/mo for 50). |
| Figma, Vercel | Client allowlist; request inclusion. |
| HubSpot, Asana | Self-serve app; confirm whether Macro already has one. |
| Box | Each customer's admin enables the integration; listing needs a Box partnership. |
| Discord | MCP server unannounced; ask before building. |

## Browser

Submission agents use Macro Connect's own Chromium, never the shared agent
browser: `connect/tooling/browser/run.sh` starts it (Docker, loopback only)
with a profile volume that holds only `connect@macro.com` sessions.

- Agents drive it over CDP at `http://localhost:9333` (raw CDP over a
  WebSocket; Playwright's `connectOverCDP` hangs against this image).
- The human watches and takes over at `http://localhost:6081/vnc.html`,
  through `ssh -L 6081:localhost:6081 <host>` from their machine.
- Sessions persist across restarts. When a sign-in is needed, the agent fills
  the email and the password from Doppler (`CONNECT_ACCOUNT_*`, `connect/prd`)
  without logging them, and completes TOTP 2FA from
  `CONNECT_ACCOUNT_TOTP_SECRET`. A CAPTCHA or device check goes to the human
  queue with the tab left open on it.
