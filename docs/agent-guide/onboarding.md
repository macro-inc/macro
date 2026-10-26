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

## Onboarding bypass — `/app/onboarding`

All `@macro.com` accounts see a **Bypass** button on every onboarding step. It
skips the rest of the flow and leaves onboarding. Accounts on other domains
do not see it.

## Setup plan step — `/app/onboarding`

The final step offers Pro with a 30-day trial only after the server confirms
first-subscription eligibility. Returning customers see `Get more with Pro.`
and `Get Pro` at the paid monthly price, without trial copy. A loading or failed
eligibility lookup disables Pro checkout; failure offers `Try again`. Invite
promotions keep their own terms. Accounts with an existing subscription see
`Manage subscription`, which opens Stripe billing management instead of creating
a replacement subscription. The comparison below the offer includes Free,
Pro, and Max (see [login](login.md#desktop-onboarding)). Customers can also
purchase plans afterwards in **Settings → Billing**.
