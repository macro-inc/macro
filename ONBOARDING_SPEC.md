# Onboarding v4

## Goals

- New users land in a full-screen, multi-step onboarding immediately after signup — no dead end at `/app/login`.
- This flow **replaces `/setup`** as the onboarding surface. The `/setup` page goes away; its backend machinery is what powers this flow.
- Navigation is forward-only: each optional step can be skipped, but there is no going back.
- Every import-capable connector step (Linear, Notion, Slack — GitHub is connect-only, see step 5) drives the **real** import machinery. This onboarding uses the exact same backend as `/setup`: `crates/onboarding` + `crates/import` (`import_entity` / `import_run`, gather-on-connect, auto-import runs, `GET /import/state`, `import_updated` gateway pushes). No mocks, no parallel implementation.
- Auto-import is on: connecting a source gathers and imports without a manual accept step; the summary page reports what happened.

## Entry point

Changes to `/app/login`:

- Remove "Connect with Apple" on desktop.

After login/signup, a **new** user is seamlessly transitioned into the onboarding flow. Existing users are unaffected.

## Base to build on

- Jacob's draft in [#5116](https://github.com/macro-inc/macro/pull/5116) (`Onboarding2.tsx` at `/onboarding2`) is a good starting point for the overall flow, step structure, and visual direction (styled after LoginNew). Note everything in it is mocked — OAuth, checkout, invites — so it's a skeleton, not a foundation.
- For the import/connector steps, prefer the import styling we already have on `/setup` (`ImportPanel` / `SourceImportCard` / `ImportEntityPill` in `apps/web/src/features/setup/`) over the mocked cards in #5116.

## Flow

### 1. Email accounts (Google)

- Encourage the user to connect their Google account. It is important we push them to connect **two** email accounts.
- If they signed up with Google, that account is already connected: show it pre-filled as successfully connected. No sync/import stats here — just the connected state.
- Immediately recommend connecting a second account (e.g. "work" if the first looks personal, and vice versa).

### 2. Linear (skippable)

Ask the user to connect Linear.

### 3. Notion (skippable)

Ask the user to connect Notion.

### 4. Slack (skippable)

Ask the user to connect Slack.

### 5. GitHub (skippable)

Ask the user to connect GitHub.

Note: GitHub is connect-only today — it is not an import source in `crates/import` (fixed sources are linear/notion/slack). Connecting it is still valuable (MCP tools); the step just won't show import results.

### 6. Team setup

Scenarios:

- **Custom domain, no existing team** (Google signup or plain email under a custom domain):
  - Auto-suggest a team name derived from the domain.
  - If Google is connected we can query contacts by this point: suggest inviting people under the same domain (v1: filtered client-side from the contacts service; a ranked colleagues endpoint does not exist on main).
- **Custom domain, team already exists for the domain:**
  - Show that they have been automatically added to that team. Verified backend behavior: the join happens at account creation (`create_user_webhook` → `try_join_team_by_domain`, fire-and-forget), keyed on the **signup/account email only**. The step just renders the resulting membership.
- **Free-mail domain** (generic consumer domains — gmail.com, yahoo.com, etc.; the canonical list lives in `crates/generic_email_domains`, shared by teams and the onboarding suggestion):
  - Still show the team step, just without domain-derived suggestions: the user can create a team (they name it themselves) and invite teammates by email. Skippable like the other optional steps.

Verified backend facts the step builds on (and their limits):

- Creating a team already auto-claims the owner's account-email domain when it's non-generic (`create_team` toggles `auto_join_domain` on by default; owners can turn it off). One team per domain. The flow does not need to enable anything.
- The domain is always derived from the team **owner's account email** — and that is the decision for v1: the flow keys everything (prefill, suggestions, claiming) off the main/account email only. A user who signed up with gmail but connected a `@acme.com` inbox gets the plain create-team form; supporting connected-inbox domains would need backend work (accept/verify a chosen inbox domain on create/toggle) and is deliberately deferred.
- Auto-join fires only at signup, immediately, with no zero-other-teams guard. Fine for this flow (its users just signed up); a later "join by domain from settings" surface would need the guard.

### 7. Summary

Since auto-import is on, show a summary of what was brought in:

- Linear tasks, Notion docs, Slack channels (imported / still importing, from `GET /import/state`).
- A brief note on how many emails and contacts are being processed (email sync/backfill stats).

### 8. Plan / payment

Option to pay — very similar to the free vs. premium picker in Jacob's #5116. Skippable; skippers land where users land today after onboarding (the default app route).

Finishing this step — paying or skipping — marks onboarding complete (which also discards any leftover onboarding-staged import rows, as completion does today).

## Non-goals / constraints

- Do not rebuild import state or gathering client-side; the flow reads `import/state` + onboarding state and reacts to `import_updated` / `onboarding_updated` gateway pushes.
- The `/setup` route gets unhooked, but keep its components around (`apps/web/src/features/setup/`) — the import UI there is reused/adapted by this flow.
