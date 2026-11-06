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

## Team setup — `/app/onboarding`

When the server suggests a team domain, the create form pre-adds up to six
same-domain contacts, excluding the user's own email and duplicates regardless
of case. Suggestions filter bounded local browse pages to that domain, including
empty continuations, rather than downloading or remotely searching the address book. Without an approved domain,
no contacts are fetched. A failed lookup opens the plain editable form.

The form takes its first settled seed only. Renaming the workspace, removing a
suggestion or changing an invite address must survive later domain/contact refreshes.
Joining an existing team or accepting an invitation keeps its existing behavior.

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
