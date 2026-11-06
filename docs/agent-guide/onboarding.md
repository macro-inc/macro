# Onboarding

## Resume link

Lifecycle emails return someone to the step they left with
`https://macro.com/app/onboarding?step={lastOnboardingStep}`. `step` is one
of `welcome`, `vision`, `security`, `work`, `personal`, `tools`, `team`, or
`plan`. Any other value is ignored. A Stripe checkout return still opens the
plan step, and a Google sign-up return still opens work email. Saved progress
for this user wins over the link; a first visit with nothing saved opens the
link, otherwise the flow starts at welcome. The step is stored in
localStorage for that user and removed from the URL after it is applied, so a
reload keeps later progress. The app shell and the inbox connection callback
keep `step` when they send a first-run user into onboarding.

Agent accounts never see this flow, including through a direct link; see
[login](login.md#agent-accounts).

## Onboarding bypass — `/app/onboarding`

All `@macro.com` accounts see a **Bypass** button on every onboarding step. It
skips the rest of the flow and leaves onboarding. Accounts on other domains
do not see it.

## Tools step — `/app/onboarding?step=tools`

If the inbox read has already finished, **Connect your tools.** shows its
suggestions at once. Otherwise it shows a short loader (the workspace mark in
the chosen accent, with tool icons wiring into it) and, in Continue's place, a
**Loading 3 · 2 · 1** countdown. An answer within 3 s shows the suggestions
(after at least 0.8 s, so the loader never flashes); otherwise, or if the read
fails, the step falls back to the plain searchable catalog and stays there
(`onboarding_v4_tool_suggestions` records which). The suggestions list
**Add another inbox** first (its **Add** menu
chooses Google, or Outlook when the account may connect one), then four
suggested tools, each with its `native`/`mcp` badge and what connecting it does in Macro. The
suggestions aim at what the business runs on: at most one tool per category,
a detected CRM or store always shown, and fewer than three messages ignored.
Tools are ranked by mail from their sender domains in the last six months
(Gmail leaves out Promotions),
searched live at Gmail or Outlook (`POST /email/senders/domain-counts`)
because the inbox backfill hasn't run yet. The flow starts that search as soon
as an inbox is connected, so the step usually finds it done; with no such mail, or if the search
fails, Slack, Linear, Notion and GitHub are suggested. **Browse all
integrations** opens the searchable catalog without the suggested tools. The
backend-free check is
`bunx playwright test --config src/features/onboarding/browser-test/playwright.config.ts`
from `apps/web`; seed `senderDomainCounts` in the fixture world to rank tools.

## Setup plan step — `/app/onboarding`

The final step offers Pro with a 30-day trial only after the server confirms
first-subscription eligibility. Returning customers see `Get more with Pro.`
and `Get Pro` at the paid monthly price, without trial copy. A loading or failed
eligibility lookup disables Pro checkout; failure offers `Try again`. Invite
promotions keep their own terms. Accounts with an existing subscription see
`Manage subscription`, which opens Stripe billing management instead of creating
a replacement subscription. The comparison below the offer includes Free,
Pro, and Max (see [login](login.md#desktop-onboarding)). Customers can also
purchase plans afterwards in **Settings → Billing**. Max in that comparison
starts paid checkout with no trial. A later switch from a Pro trial to Max
ends the trial and charges Max immediately.
