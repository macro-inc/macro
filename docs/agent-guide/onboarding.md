# Onboarding

## Resume link

Lifecycle emails return someone to the step they left with
`https://macro.com/app/onboarding?step={lastOnboardingStep}`. `step` is one
of `welcome`, `vision`, `security`, `work`, `personal`, `tools`, `team`,
`plan`, or `routines`. Any other value is ignored. A Stripe checkout return still opens the
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

Choosing Free, finishing checkout, claiming an invite offer, or (for a licensed
team member) continuing from the team step moves on to the routines step;
onboarding completes there, not on the plan step.

## Routines step — `/app/onboarding`

The last step, **Put your busywork on autopilot.**, lists every suggested
routine (see [suggested routines](setup-cards.md#suggested-routines)) grouped
under **Email automations**, **Task automations**, **CRM automations**, and so
on. Each row has a switch (**Turn on <name>**) and expands to edit the name,
instructions, and Home visibility. Every switch starts off except the AI's
likely keepers: the suggestions whose estimated chance the user keeps them is
at least 80%, topped up to two and capped at five, most likely first. Routines
that send, post, share, or change what other people see never start on, since
their instructions come from a model that read third-party mail.

**Turn on N routines** creates the chosen routines, then completes onboarding;
with none chosen the button reads **Continue to workspace**, and **Skip for
now** leaves without creating any. A failed create keeps the user on the step
with an alert, and pressing the button again retries only what failed. While
suggestions are still generating the step shows a loading list and
**Continue to workspace** stays available. Back is hidden here: the plan is
settled. `onboarding_v4_routines` records how many were suggested, recommended,
turned on, and how many recommendations the user kept.

Suggestions start generating when the user leaves the tools step, so the inbox
they connected informs them. The server reads that inbox straight from Gmail or
Outlook rather than waiting for it to synchronize, and every plan gets the
free-tier model, since generation starts before the plan step.
