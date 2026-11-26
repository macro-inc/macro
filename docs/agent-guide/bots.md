# Macro Bots

The standalone Bots app starts at `/` in Character Creator. In the local
fixture preview, choose a preset, change the portrait width, and edit the bot
name. Hire opens a local sign-in screen. Use Go back to restore the same
draft in the current tab. Macro sign-in and hiring require a future local
integration.

Open Fleet at `/fleet` or from the header. Add bot opens Creator. In fixture
mode, each sample bot has a Brain with Overview, Activity, Email, and Access
tabs. Passwords and Billing are Tower routes alongside Fleet. Passwords
reserves navigation for a later integration.

Open Billing at `/billing` to see the sample team's estimated started-hour
work through Nov 25 UTC in the Nov 1–30 cycle. Daily values expands the chart
data. The usage ledger totals 124 estimated hours and $1,860 unbilled. The
$300 recurring subscription preview and the pending modeled AI spend have
their own sections.

In fixture mode, append `?billing-fixture=pending`, `?billing-fixture=denied`,
`?billing-fixture=empty`, or `?billing-fixture=zero` to exercise those states.
The default build shows Billing unavailable. Live integration requires
viewer-authorized team reads for started-hour usage, posted agent charges,
recurring invoice previews, and modeled spend. The SDK's computer usage read
reports CPU and memory, and its subscription status read is scoped to the
caller's seat. Billing is read-only.

See the [Bots app guide](../../apps/bots/AGENTS.md) for preview commands.
