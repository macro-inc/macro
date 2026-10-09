# Billing Lab

A local workspace for reviewing the real Billing settings, Usage settings,
credit purchase, Auto-Reload, and usage-limit UI with deterministic fixtures.
It runs without signing in, a local backend, or Stripe credentials.

From `apps/web`:

```sh
bun run dev:billing
```

Open `/billing-lab.html` on the URL printed by Vite. If another worktree uses the
default port, choose a free one with `PORT=3003 bun run dev:billing`.
`MACRO_DEV_HTTPS=false` uses HTTP. You can also open the lab from a local app's
**Settings → Usage → Developer tools → Open Billing Lab**.

## Try Max → Pro

1. Select **Max → Pro at renewal** to start with a scheduled downgrade.
2. Max and its included usage stay active. Billing shows the scheduled Pro
   downgrade and its effective date.
3. Switch to the Usage preview to inspect the current allowance, or choose
   **Keep Max plan** in Billing to cancel the downgrade without resetting usage.
4. Reset the scenario if you canceled, then choose **Advance to renewal**.
   The plan becomes Pro and included usage
   resets; prepaid credits carry over.

**Max → Pro at renewal** starts with the downgrade already scheduled. The
timeline exposes the same state and also offers **Cancel scheduled change**.

## Other states and actions

The 20 presets cover Free/Pro/Max, a scheduled cancellation, exhausted
allowances, prepaid credits, paused reloads, spending limits, payment failures,
team members and owners, unlimited access, loading, errors, and pre-launch UI.
Controls advance time, change the usage percentage and credit balance, and
open the actual usage-limit dialog. **Fail the next billing request** injects
one request failure so the existing error and retry UI can be reviewed.

Purchases and payment management open an explicitly simulated flow. Choose
**Complete simulation** to apply its fixture transition, or cancel. Automatic
reload settings update the fixture; the lab does not run automatic charges or
meter AI requests. **Reset** restores the selected preset. **Copy scenario
link** shares the preset, not subsequent edits; refresh also restores it.

## Monthly reload limit notice

Choose **Monthly reload limit reached**. The lab opens Usage with a $50 monthly
cap already spent. The shared notice banner puts the amount in its title and
the reset date on the right. Try both full width and compact layout.

**Adjust limit** opens the real Auto-Reload dialog. Raising the cap clears the
notice while keeping this month's spend. **Add credits** opens the real purchase
dialog; manually purchased credits do not change auto-reload spend. Advancing
into November resets reload spend. Reload budgets use UTC calendar months,
independently of subscription renewal.

Live settings use the same banner with authoritative monthly reload commitments
and reset facts from the API. Paid and pending reloads, plus failed invoices that
can still collect, consume the cap; manual credit purchases do not. The notice
also appears when the remaining cap cannot fund the $0.50 minimum reload.
A limit-reached state does not imply existing credits or the included allowance
are exhausted. Older backends without budget facts show no cap notice.

## Team credit controls

The **Teams** group opens directly to Usage settings. **Mixed-plan team owner**
starts with a shared $25 credit balance and automatic reload enabled for four
seats (one Max, three Pro). Use **Add more** to purchase shared credits, or
**Automatic reload** to configure the minimum balance, target balance, monthly
spending cap, and payment method through the real application dialogs.
The section is labeled **Team Usage Credits** with “Credits are shared by your
entire team.” Purchase and auto-reload dialogs repeat the shared-team scope.

Try **Team credits exhausted**, **Team reload paused**, and **Team monthly reload
limit** to review empty-balance, payment-recovery, and cap-reached states. Complete
the simulated payment-method flow and save reload settings to test recovery.
Manual purchases increase the shared balance without consuming the reload cap.
Request failures and calendar-month resets work for these scenarios too.

Owners use **Settings → Usage** for shared credit controls in the live app;
Team settings manages seats. The included-usage meter is always the viewer's
own seat allowance, not a pooled team allowance. **Team-paid Max member** shows
the team-managed notice without the balance, purchase, or reload controls.
The lab simulates one viewer at a time; it does not meter other members' AI
activity or run automatic charges. Its fixture budget follows the same decoder
and cap status used by live Usage settings.

## Boundaries

Billing and Usage views receive injected capabilities. The lab uses the same
usage-summary decoder as the app, with no API clients, login, remote mutations,
or hosted payment navigation. Team-settings navigation is recorded locally.

The simulator's allowances and transitions are UI fixtures, not a billing
policy test or production price catalog. Backend and Stripe integration tests
remain responsible for real entitlement changes, invoices, proration, and
webhook handling.

The standalone HTML entry is excluded from Vite's production build inputs.
Rendering additionally requires `import.meta.hot`, the app's local-only gate.

Run fixture and action tests from `apps/web`:

```sh
bun run test src/features/billing-lab
```
