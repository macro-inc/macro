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

## Routines step — `/app/onboarding`

The last step, after the plan is chosen (Continue with Free, a paid checkout
return, or a licensed team member), is **Put your busywork on autopilot.**
Leaving the tools step starts the scheduler picking routines from the inbox
and tools connected so far (`POST /scheduled-actions/suggestions/refresh`,
with `enable-routine-suggestions` and `enable-routine-code-steps` on).

- It lists only catalog routines, grouped by area, each as a Routines page
  template card (area icon, name, trigger → step line) with a switch in the
  corner, its sentence with editable knobs, and why AI picked it. Requests the drafter
  would write wait for the sidebars.
- Switched on to start: only routines the catalog marks safe by default
  (code that changes the person's own mail and tasks), most likely kept
  first, every one AI is confident in and at least two, at most five.
  Routines that post or change what others see start off, however sure AI
  is.
- **Turn on N routines** creates the ones left on, each recorded as saved
  from its suggestion; a tagging routine first provisions the personal tag
  set. One that fails stays with an error and the button retries only it.
  **Continue to workspace** (nothing on) or **Skip** leaves without creating
  any. Back is gone here: the plan is settled.
- While nothing is picked yet it says **Picking routines from your inbox and
  tools…**; with no suggestions it says so and Continue leaves.
