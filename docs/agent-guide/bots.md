# Bots on the local stack

Open `/bots/` on the HTTPS origin printed by `just run_local`.
The Creator, Fleet, Passwords and Billing links stay within that base path.

Edit a Creator profile and select **Hire** while signed out to retain a draft
for sign-in. **Sign in with Macro** opens the standard Macro login on the
same origin. Stay in the same tab so the Creator can read the expiring draft
when the login flow returns. The link describes a Creator return and can
carry an opaque draft reference. The profile stays in the tab.

This startup layer verifies the signed viewer and current team. Hire terms
and team data remain unavailable until their scoped service adapters are
connected. The ordinary stack shows those unavailable states. Use the
[standalone fixture build](../../apps/bots/AGENTS.md#checks) for sample data.
