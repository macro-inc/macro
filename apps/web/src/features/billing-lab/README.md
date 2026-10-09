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

The 17 presets cover Free/Pro/Max, a scheduled cancellation, exhausted
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
