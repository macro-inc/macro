# Onboarding

## Resume link

Lifecycle emails return someone to the step they left with
`https://macro.com/app/onboarding?step={lastOnboardingStep}`. `step` is one
of `welcome`, `vision`, `security`, `work`, `personal`, `tools`, `team`,
`plan`, or `demo`. Any other value is ignored. A Stripe checkout return still opens the
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

## Setup plan step — `/app/onboarding`

The plan step offers Pro with a 30-day trial only after the server confirms
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

## Demo call step — `/app/onboarding`

Only a paid (active or trialing license) owner of a team sees this optional last
step, after payment is confirmed or, for someone already licensed, after the
team step. Members of someone else's team and Free accounts finish without it.
It opens on **One last thing / Want a live walkthrough?** (one live onboarding
for the owner and their team) with **Skip** and **Book now**, and has no Back
button. **Book now** shows **Pick a time.** with Macro's own demo booking page
(the same page the website's **Book demo** opens) and the account email
prefilled; **Skip** stays below it. Booking shows **You're booked.** with the
call time, and **Continue to workspace** finishes; Skip finishes from either
screen. If the booking page can't load (for example against the dev backend),
it offers **Open booking page**, which opens the hosted page.
