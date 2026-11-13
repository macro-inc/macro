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

In local development (`LOCAL_ONLY`), every account sees **Bypass** on every
signed-in onboarding step. Before signup, **Bypass** skips the opening slides
and opens the sign-up step; authentication is still required. After signing in,
**Bypass** saves the onboarding record as skipped, marks the tutorial complete,
and opens the original destination or Home, so reloading does not restart setup.
The button uses the same completion and retry path as finishing normally.

Deployed builds keep **Bypass** restricted to `@macro.com` accounts; other
accounts still follow the existing onboarding flow.

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
It shows with `enable-routine-suggestions` and `enable-routine-code-steps` on.
As soon as an inbox is connected during onboarding, AI starts suggesting
routines (`POST /scheduled-actions/suggestions/generate?timezone=<zone>`,
once per person).

- The server fills every area to three with Macro's templates (drafted
  routines, then catalog picks, then templates). While its status is
  `generating` (polled every 2 s), only AI's suggestions show, as they land,
  under **Studying your workspace…** and then **Finding more routines for
  you…**. After about 30 s, areas AI left empty fill with their templates
  and stay filled. Once AI is done (`ready` or `failed`), every area tops up
  to the server's list. With no inbox (`none`), templates show at once.
- Rows are grouped by area: area icon, name, what it does, when it runs, and
  a byline, **For you · <reason>** for AI's or **Template from Macro**, with a
  switch. Opening a row lets the person rename it and choose **Show each run
  in Home** before it is created.
- Switched on to start: only catalog picks the scheduler marks on by default
  (never one that affects other people), at most two. Routines AI drafted
  always start off.
- **Turn on N routines** creates the ones left on, each recorded as saved
  from its suggestion (`suggestion_id`); a tagging routine first provisions
  the personal tag set. One that fails stays with an error and the button
  retries only it. **Continue to workspace** (nothing on) or **Skip** leaves
  without creating any. Back is gone here: the plan is settled.
- Analytics: `onboarding_v4_routines_shown` when templates first fill in (time to
  AI's first suggestion, counts, fallback) and `onboarding_v4_routines` on
  leaving. The step's wait is traced as the `onboarding.routines` flow.
- Backend-free check: `bunx playwright test --config
  src/features/onboarding/browser-test/playwright.config.ts
  routines.browser.e2e.ts` (from `apps/web`).
