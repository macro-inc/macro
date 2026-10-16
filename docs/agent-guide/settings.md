# Settings

## Settings — `/app/settings/<section>`

### Slack archive import

Temporary message storage recovers closed IndexedDB connections without restarting
the import or deleting staged history. Verify closure between staging batches and
between cursor pages: all messages must remain ordered, deduplicated, and within
the original byte limit. Cancellation and cleanup still work during recovery.
Deleted or replaced scratch databases fail the old import instead of silently
continuing with incomplete history; its cleanup must leave a replacement intact.

In **Team → Connections**, **Import from Slack** appears only for team admins
and owners with `enable-slack-archive-import` enabled. Production rollout stays
off until explicitly enabled. Select an export ZIP, filter the grouped conversation
picker, optionally show archived conversations, and use Space to toggle focused
checkboxes. **Select all visible conversations** preserves selections hidden by
filters; unchecking it or **Clear visible selection** clears only visible selections.
Rows show stable Slack IDs
so duplicate names remain distinguishable. Counts are advisory when available,
otherwise “not yet counted.” Discovery moves keyboard focus to the filter.
Slack file/canvas discussion folders (`FC:<file-id>:<title>`) are ignored, not
imported as channels; their presence must not prevent channel discovery.

Review email attribution and external membership implications, choose whether to
include history, and confirm the immutable Slack workspace binding before
**Import selected channels (N)**. At least one selection is required. File selection
alone makes no server writes. Close/Escape or cancel before confirmation discards
the archive and selection without creating a job; reopening requires choosing a
file again. After confirmation the selected IDs/options are frozen. Closing and
reopening then retains the upload session; keep Team Settings open until it finishes.
The dialog restores focus to its opener, and polling should not blank Settings.

Use **Job history** (including older pages) for server progress after a reload.
It displays the persisted selected names/IDs/kinds, history option and selected
failures/skips without the ZIP. Unselected channels are not skipped work. Reload
recovers server tracking, **not interrupted local uploads**; finalize verified work
with skips or cancel and explicitly confirm a new import/token.
**Cancel import (keep partial results)** does not delete committed messages or
channels; running work may finish. An interrupted upload offers **Recover job
receipt**, then **Finalize with skips** or cancellation. Channel links appear only
when the server confirms current participation and the viewer's channel list
confirms access. Verify counters, errors and skip
reasons at narrow widths, using synthetic exports and a test backend rather than
importing customer data into hosted dev.

For a release check, inspect the actual create request and then reload the server
receipt: both must contain exactly the selected Slack IDs and history option.
Select two rows with the same display name, filter both out, and confirm the
selected total remains unchanged. Cancel before confirmation and verify there
were no create, registration or PUT requests. An open job must reject tampered
registration/sealing of an unselected ID; a client-only picker test is insufficient.
Check desktop web and Tauri: opening Settings alone creates no ZIP worker, and
signed PUTs work without dropping checksum or conditional headers. A 412 upload
retry verifies the existing object instead of overwriting it. Keep an active job
open through websocket disconnect/reconnect to verify polling remains usable.
The [runbook](../runbooks/slack-archive-import.md) distinguishes fixture tests from
live-backend release gates and documents staging retention and recovery.

### Email signatures

Open **Settings → Email → Signatures**. Each owned inbox has a visible editor;
there is no expand/collapse control. Format the text, add links or images, and
choose **Save signature**. **Clear signature** removes only the signature, while
**Remove inbox** in Accounts uses the existing inbox removal confirmation.
**Add to replies & forwards** saves that preference immediately. On desktop,
**Import from Gmail** in each inbox's header fetches that account's Gmail
signature and saves it right away, replacing any unsaved draft; a toast reports
when Gmail has no signature. Unsaved drafts
survive switching settings pages. On phones, signature editing remains desktop-only;
the replies/forwards toggle and clear action are available.
Email accounts can also be managed from **Integrations**. Its **Email settings**
link opens the dedicated page, and Email links to Notifications and Calendar.
With a composer open, save a changed signature or reply-signature preference and
verify its preview updates. Once the account refresh completes, reopen a composer
offline and confirm it uses the saved settings.

### Notification snoozes

Open **Settings → Notifications** to see **Snoozed items** and their local resume
times. **Change time** opens the same searchable time picker used by entity
actions; **Resume** cancels a snooze immediately. Permanent mutes appear separately
under **Muted items**, with **Snooze instead** to replace one with a timed pause.

The Chat detail pane also supplies these commands for its current channel or DM;
focus the conversation before opening the command menu.

To snooze an entity, right-click its row (long-press on mobile) and choose
**Snooze notifications…**, or select/open the entity and search for that command
in Cmd/Ctrl+K. Multi-selection applies the chosen deadline to all selected items.
Use arrow keys and Enter, click a preset, or type a future date/time such as
`2h` or `tomorrow 10am`. The next morning means the next local 9 AM; the weekend
preset resumes on Monday at 9 AM. The picker displays the exact local date and
time before saving. Escape closes the picker; before choosing a time, it makes
no changes.

Snoozing pauses notifications only: it does not hide, archive, mark read, or mark
done. Channel message/thread rows target their parent channel, matching mute.
The server enforces expiration even when no client is open. Displayed snooze
state refreshes when the window regains focus or a mute/snooze changes; the
client does not poll. A failed save keeps the picker open for retry; a successful
save appears in notification settings.
If only some selected items save, the picker shows the saved count and retries
only the remaining items. Closing it keeps any snoozes already saved.

On phones, long-press opens the entity actions drawer. The snooze time picker
uses the same responsive `Dialog`, width, and `CommandMenuShell` as Cmd/Ctrl+K,
with larger touch targets and tap instructions. Swipe the preset list when the
viewport is short. In **More views → Settings → Notifications**, item names and
deadlines sit above **Change time** and **Resume**. Saving or cancelling a picker
returns to the settings sheet. Start new snoozes from an entity's actions or
Cmd/Ctrl+K; Settings manages existing snoozes and mutes.

Design references: [Slack notification pause/resume](https://slack.com/help/articles/214908388-Pause-your-Slack-notifications)
and [Superhuman's keyboard-driven Remind Me picker](https://new.superhuman.com/remind-me-29124).
Macro applies the temporary pause per entity and keeps the entity visible.

### Team membership

Team membership has no size cap, including free teams. Invitations and domain
auto-join must keep working beyond five members and the former stage-plan limits.
Free-team joins do not create a paid subscription, bill a seat, or grant premium
roles. Teams with an existing paid subscription retain their per-seat billing;
enterprise teams retain their billing bypass.

On a local stack started with `--no-doppler`, verify free-team creation from a
fresh passwordless signup. It must work without Stripe credentials.

Under **Team**, owners/admins can turn **Auto-join on domain** off and can restrict
invitations to admins with **Members can invite**. These controls still apply.
To verify the membership flow, use a local free team with five members: invite
and accept a sixth member, then sign up another user on its enabled auto-join
domain. Both should appear in the team's member list and configured auto-join
channels without an upgrade prompt. Repeat with auto-join disabled to verify a
same-domain signup is not added automatically.

### Navigation

On phones, **More views → Settings** opens an inset glass sheet over the current
page. The main page has a profile shortcut and the same grouped Blocks, Personal, Workspace,
and Developer sections as desktop, plus enabled admin settings. Search finds
individual settings; selecting a result opens its page and reveals the section. Tap a row to open that settings
page inside the sheet; **Back to settings** returns to the grouped list at its
previous scroll position. `API Keys` is desktop-only and has no row here.
**Close settings** at the top right, Escape, an
outside tap, or a downward swipe dismisses the sheet. A tap that dismisses a
menu opened inside the sheet leaves the sheet itself open. Opening Settings again
starts at the main page; explicit links (for example Account) open their
section directly. Existing settings URLs open the requested section in the sheet
and restore the underlying app route. The header stays visible while forms
scroll, including with the keyboard open. On desktop, Settings is an ordinary
split view: the rail's gear button (or `Ctrl ;`) opens it in the active split
like any other rail item, and Shift-click opens it in a new split.
`/app/settings/<tab>` opens it as the only split with the app rail still
visible, and `/app/home/~/settings/<tab>` places it beside Home. Its inner
sidebar matches Email and Tasks: a **Settings** title bar, a rounded
**Search settings** field, the grouped section pills, and a team action pinned
to the bottom: **Invite your team** (opens the invite dialog; hidden for members
when the team limits invites to admins) or, with no team, **Create a team**
(opens the create-team dialog). Unlike other views, it cannot be hidden at
desktop widths: there is no **Hide navigation** toggle and `Cmd .` does
nothing, even if it was hidden before. Below 720px the sidebar becomes an overlay opened from **Show
navigation** (or `Cmd .`), which starts closed. Escape closes a
settings split that shares the layout, or steps back to the previous view when
it is the only split (Home when there is none). Leave settings by picking any
other rail item; there is no separate back or fullscreen control.

Settings pages use the email composer’s raised surfaces on the page background.
Section headings and controls share a white surface in light mode and the
composer border in dark mode, with subtle row separators. The compact sidebar
uses the shared workspace width.

When a newer version is ready, an **Update available** button (a download icon
in a subtle accent circle that a glowing comet periodically circles) appears in
the sidebar rail above the mobile-app and settings icons. Its popover (a title,
a short description, and one action) opens by itself once per update until
dismissed (click outside or Escape); the button stays until the update is
applied. Its wording and action depend on the update: **New version available**
/ **Reload** for a newer web build, **Update ready** / **Update** for a
downloaded bundle in the desktop app, and **Desktop app update ready** /
**Restart and update** for a native desktop update. When part of the app fails
to load because a newer web build replaced it, the same button appears and its
popover opens again (even if dismissed) with **Reload**; there is no blocking
alert. Touch layouts have no rail, so a newer web build shows a **Reload** toast
there instead.

On desktop release builds, **Account → Desktop app update** shows native update
progress. While preparing to restart, the popover can't be dismissed and its
action is disabled. Restart waits for pending canvas/PDF saves and
local persistence; active calls, uploads, and imports must finish first. A ready
update also installs on normal app quit. Closing a window only triggers
installation if it exits the app. Browser, mobile, and development builds do not
show this native updater row.

Below Profile, **Account** shows a card naming the current plan (**Free plan**,
**Pro plan**, or **Max plan**; **Loading plan…** until the billing summary
arrives). Clicking it opens **Billing** settings.

Below the plan card, a **Log out** card signs out. Under it, outside any card,
**Delete account** opens a two-step dialog: an irreversibility warning with
optional feedback (and a **Log out instead** link), then a final step whose
**Hold to delete my account** button deletes only after it is held for 5
seconds (pointer, or Space/Enter); releasing early cancels.

Left nav (feature and platform gates still apply):

- **Blocks**: Email, Calendar, Agents, CRM.
- **Personal**: Account, Appearance, Notifications, Keyboard shortcuts, Usage, Billing, Desktop App, Mobile App.
- **Workspace**: Team, Tags, Integrations (personal Gmail/GitHub accounts).
- **Developer**: Agent connections, Runtimes, MCP server, API Keys, Bots.

**Desktop App** (`/app/settings/desktop-app`) shows a compact version and
build-date card in the desktop app. The date is when the running app bundle was
built, not when it was installed on the computer. In the browser it links to the
latest desktop release on GitHub, and only appears when the `desktop-app` PostHog
flag is enabled. Native desktop always shows this section regardless of the flag;
native mobile never shows it.

The **Mobile App** page is titled **Mobile app (Alpha)** and offers a QR code
to download **Macro Alpha** from the App Store.

Search checks individual setting titles and keywords, tolerates common typos,
and shows the parent page below each control result. Selecting a result opens
that page, scrolls to its section or row, and briefly highlights it. Try
`singature`, `email digest`, `calendar color`, or `cursor`. Arrow Down from search
focuses the first result; Tab moves through controls normally. Escape in the
search field clears the query. Clearing search restores the grouped navigation. Keyboard shortcuts are listed
by category with the action on the left and keys on the right; expand **Keyboard
preview** for the visual key map.
Appearance starts with visual **System**, **Light**, and **Dark** mode choices.
The previews use the saved themes; System follows the device and exposes both
per-mode theme selectors. Light or Dark shows its own theme selector. Each selector
retains theme search, editing, copying, and custom theme creation.

Existing settings URLs remain valid; `connections` still opens Integrations,
`agent-connections` opens Agent connections, and `harness` aliases Runtimes.

`Usage` appears directly above Billing, including for Free accounts. In
production, the `enable-ai-usage-billing` PostHog flag controls activation. While
it is off or loading, the page shows **AI billing changes take effect on October
8, 2026.** and all Usage controls are disabled. Turning the flag on activates the
page and removes the announcement. Dev and local remain interactive even with
the flag off. The production usage-limit dialog follows the same flag. Its
**Monthly limit** meter displays a percentage using the backend's current-period
usage and allowance. The info button explains AI agent chat and AI document
editing. **Usage Credits** shows the dollar balance and `Add more`, which opens
**Need more usage?** with `$25` / `$50` / `$100` / `Other`. Supported amounts
redirect to Stripe Checkout; unsupported custom amounts are disabled. Free
accounts see `View plans` instead of purchase or reload controls; paid team
members who are not the payer see only “Usage credits are managed by your team.”
Their credit balance and automatic reload row are hidden, with no
credit-purchase action.
Team owners who pay for their team's seats manage the shared credit balance and
automatic reload here in Usage, including purchases, balance thresholds, the
monthly reload cap, and payment methods. Team payers see **Team Usage
Credits**, “Credits are shared by your entire team.” and **Shared team balance**.
The purchase and auto-reload dialogs also identify the team-wide credit balance.
Team settings manages seats. Included
usage remains per seat: the owner's Monthly limit meter describes their own
usage, not the sum of the team's allowances. Team payers with a finite
allowance see “This is your personal monthly usage limit.” beneath the meter.
Unlimited enterprise plans show `Unlimited` and do not offer credit purchases
or automatic reload. The development paid-plan preview can still display
those controls, with purchases disabled.

The **Automatic reload** switch opens **Auto-Reload** without toggling directly.
It contains Minimum balance (default `$10`), Target balance (default `$100`),
optional Maximum monthly spend (`No limit`), a payment-method management link,
and the automatic-charge warning. The dialog saves for paid payers:
`Turn on auto-reload` enables automatic credit purchases with those thresholds,
`Save` updates them while on, and `Turn off` disables automatic reload. The monthly
limit caps reload purchases per UTC calendar month. The **Automatic reload**
switch reflects the saved state and is the billing opt-in indicator. Paid team
members who are not the payer see
`Only the account that pays for this plan can change automatic reload.` and
cannot save. After a failed automatic reload the Usage row shows
`Paused — payment failed` while preserving the enabled setting. The dialog shows `Your last
automatic reload could not be charged. Update your payment method, then save to
try again.`; saving retries. Extra usage is funded entirely by prepaid credits.
If the reload budget runs out or payment fails, uncovered usage cannot trigger a
direct usage charge; with quota enforcement enabled, exhausted credits and
allowance block further AI requests. Historical direct-charge invoices are still
recognized by webhooks, but settlement never creates or retries them. Local
**Developer tools** offer
`Preview Free plan` and `Preview paid plan` to display either Usage page with
sample usage, regardless of the signed-in account's tier.
`Open Free usage-limit dialog` and `Open paid usage-limit dialog` open the
corresponding exhausted-usage prompt directly. The previews also work before
the usage summary loads or when it fails. The paid-plan preview allows
testing Auto-Reload settings. Purchases and payment management are disabled during any
preview; `Reset preview` restores server data and closes the usage-limit dialog.
`Preview production before Oct 8` shows the October 8 announcement and disables
Usage controls, including usage-limit dialogs. Dev tools remain interactive:
Free and paid previews can be combined with this state, and `Reset preview`
restores the normal dev view.

Local **Developer tools → Open Billing Lab** opens `/billing-lab.html`, a
standalone simulator with no login or billing API calls. Its 20 presets include
Max with a pending Pro downgrade, exhausted allowances, credits, payment
failures, team roles, loading, and errors. Select **Max → Pro at renewal**
to start with a scheduled downgrade, and choose **Advance to
renewal**: Max stays active until renewal, then Pro becomes active and included
usage resets. Billing displays the scheduled downgrade and effective date;
**Keep Max plan** cancels it and preserves the active plan and usage. The
timeline also offers **Cancel scheduled change**. Purchases open a simulated checkout with explicit completion;
**Fail the next billing request** enables error and retry checks. Scenario links
restore the preset, not edits. **Monthly reload limit reached** opens Usage with
a notice banner: **Monthly auto-reload $50 limit reached**, with **resets Nov 1**
on the right. **Adjust limit** opens Auto-Reload; **Add credits** opens credit purchase.
Manual credits do not count toward the monthly reload cap, which resets at the
UTC month boundary. Live Usage shows this same banner from the API's monthly
reload commitments and reset date, including when remaining cap room is below
the minimum reload charge. Paid/pending reloads and failed invoices that can
still collect count toward the cap. Older backends without these facts show no notice.
The **Teams** scenario group opens Usage directly. **Mixed-plan team owner**
previews shared credits and enabled reload for one Max and three Pro seats;
**Team credits exhausted**, **Team reload paused**, and **Team monthly reload
limit** exercise the owner's purchase, payment-recovery, and cap controls through
the same Usage dialogs. Credit purchases add to the shared balance, while the
included-usage meter remains scoped to the viewer's own seat. **Team-paid Max
member** previews the notice-only member view. The simulator does not meter
other members' activity or perform automatic charges.
See [Billing Lab setup and boundaries](../../apps/web/src/features/billing-lab/README.md).

`Billing` shows the current plan and `Manage`. Free users see separate Pro
(`Get Pro`) and Max (`Get Max`) cards, side by side when the panel is wide enough
and stacked on narrow panels. The Pro card shows `Free for one month!` only after
`GET /user/stripe/trial_eligibility` confirms eligibility. Eligible customers get
the server-validated 30-day first-subscription trial; returning customers see
paid terms and `Get Pro` opens ordinary paid checkout. Eligibility loading
disables Pro checkout without showing a trial offer; a failed lookup adds
`Try again`. Checkout revalidates eligibility, and a stale trial offer reports
the server rejection rather than silently switching to an immediate charge.
Returning to the tab or reconnecting refreshes the offer. Accounts with an
existing recoverable subscription see `Manage` and payment-management guidance
instead of new checkout cards, even when their access is Free. A failed background
eligibility refresh preserves known subscription management but hides trial
claims. Management remains available if team lookup fails; plan changes wait for
team data. Checkout rejection clears the offer until eligibility refreshes. Retries reuse the
same open offer; changing plans invalidates the old link first. Competing tabs
can show a retryable checkout conflict without creating two payable sessions.
Reference captures from the isolated billing fixture: [returning customer](media/billing/returning-customer.png)
and [subscription recovery](media/billing/subscription-recovery.png). These show
phone-width layouts; payment-provider interactions are covered separately.

`Get Max` keeps standard paid terms. Prices read `/ month` for solo users and
`per seat / month` for team accounts. Each card puts its button beside the price when wide enough and below
the price when narrow. Free lists 2 connected email accounts; Pro and Max list
unlimited connected email accounts. Pro users see a Max card (`Upgrade to Max`); Max
users keep their current plan. Cards appear only for users who can
manage their subscription. Team-paid members see no plan options, including
on Free seats. Member options stay hidden until the billing summary confirms
they pay for their own seat. On a team, a plan change moves only the viewer's
own seat. Max lists "10x more AI usage than Pro"; Free and Pro allowance labels
still follow the `enable-ai-usage-billing` flag. Usage controls live in Usage.
The upgrade modal and Billing use the same plan cards and benefits, including
the same flag-gated AI usage label and responsive card layout. The modal offers
Pro and Max to Free accounts, only Max to Pro accounts, and no upgrade cards to
Max accounts. Cards in the modal show benefits without purchase buttons. The footer’s
`Manage plan` closes the modal and opens Billing settings, where checkout and
plan changes take place. Team-paid members see a message
to contact their team owner. Plan options wait for the billing summary and team
lookup; failed lookups show `Try again` rather than guessed upgrade options.

On a local HMR dev server, `Preview billing & paywall` opens an opt-in preview in
Billing. Choose Solo, a team-paid member, a self-paying member, or a team owner,
and Free, Pro, or Max. `Permissions, loading, and feature states` exposes the
billing summary status, billing permission, active/trialing license, Pro trial
eligibility, AI usage flag, and pending plan actions. The preview uses the real Billing UI with local
fixtures; checkout, plan changes, Manage, and Team settings only show preview
status messages. `Preview paywall` opens the same modal for the selected state,
without developer controls inside it. Dismissing the modal returns to Billing
with the selection preserved. `Manage plan` returns to the selected Billing preview.
`Reset preview` restores Solo/Free; `Exit preview` restores
the signed-in account. State is not persisted and resets on leaving Billing.
These controls are excluded from deployed builds, including dev.macro.com.

Billing shows the current billing period end and any scheduled downgrade date.
Max stays active until renewal; **Keep Max plan** cancels a pending downgrade
without resetting usage. Failed renewal-detail reads offer **Try again**.
Team members who cannot manage billing see the notice without its action.

`Team` (members list; on a paid team each row shows the seat's plan,
and admins/owners can move a seat between Pro and Max with the `Seat plan`
menu; Max upgrades are immediate and prorated, Pro downgrades start at renewal.
**Keep Max** appears only for a confirmed pending downgrade and cancels it;
failed scheduled-plan reads offer **Try again**, while teams without applicable
scheduled plans show no retry notice). CRM (enable/disable; once enabled, a `Deal stages` section
with `Customize stages`, inline rename, reorder by drag handle or arrow keys (up/down
buttons on touch), delete, `Add stage`, `Reset to defaults`, and `Closed stages`
checkboxes, editable by the role set as `edit_stages_role`)

`Agents` unifies agent definitions and runtime configuration in one page, also used by the Agents workspace. Its `Agents` section lists team and private agents. `New agent` / `Edit <name>` open full-page forms grouped
Profile, Behavior, Runtime, Connections, Channels, Share. Connections is a radio pair:
`Use my connected apps` (default; the agent gets whatever the person running it has
connected) or `Specific apps`, which reveals a `Search connectors` box over the whole
Pipedream catalog (results are `option` rows; picking one adds it) and a row per picked app
with a connected / not-connected dot for the *current viewer* plus an inline `Connect`
that opens the Pipedream Connect flow inside the web page. Native apps open
consent in the system browser; choose **Return to Macro** after authorization
to save the connection in the waiting app. Unconnected picks never block
saving; each teammate connects their own account. An agent session that calls a picked
but unconnected app gets a tool result saying so, and the agent's reply renders a
`Connect <app>` chip that opens Agents → Connections for that app. The same page
is also available as Settings → Agent connections.

Reference captures from an isolated browser fixture: [native waiting dialog](media/pipedream/native-waiting.png)
and [browser return page](media/pipedream/browser-return.png). The fixture uses
the real UI and iframe messaging with simulated provider consent and native IPC;
it does not exercise a real provider account or the operating system's app launch.

To change an agent's picture, open `Edit <name>`, choose an image with `Upload`,
wait for `Uploading…` to finish, then click `Save changes`. Images up to 16 MB
are uploaded to image storage; Save stays disabled during the upload. A failed
upload shows an error and keeps the previous picture so you can retry. Verify
the picture after reopening settings and after a page reload, then type `@` and
the agent's name in a channel to check its mention-menu picture. Team agents
available in all channels should refresh there without reloading the channel.

With `pipedream-mcp` enabled, Connections (in Agents or Settings) has `Connected` and `Discover`
tabs. Connected groups GitHub, Linear, Notion, and Slack tool grants by provider,
lists other catalog connections alongside them, and puts custom MCP servers in
a separate section. Discover offers featured providers, a searchable catalog,
and `Add custom MCP`. Pipedream Slack OAuth is available in production and
development from the featured Slack provider. Connecting Slack here grants tool
access; channel import is a separate action where the user chooses channels.
Provider Back returns to the tab that opened it; navigation is local to each
Connections page and starts at Connected on a fresh visit.

Macro agents and external AI clients using Macro's MCP server can run
`ImportNotionPage` and the shared import ledger tools against the user's
connections saved in Macro.
Verify a Notion import returns a document and a repeated import returns the
existing document; Linear imports recorded with `CreateImportEntity` should
appear in `ListImportEntities`. These calls must not report that import tracking
is unavailable.
On hosts without Pipedream credentials, saved Pipedream accounts must not hide
native Notion, Linear, or Slack connections when selecting import tools.

Provider and custom-server More menus contain Disable, Reconnect, and Disconnect;
custom servers also offer Rename. Disabled grants show Enable. Unauthenticated
custom servers show Connect and Remove. Disconnect/Remove require confirmation.
Adding a custom MCP saves its name and URL; Connect on its row starts OAuth.
Enabled custom servers are offered to the owner's agent sessions (Cursor, Claude,
Codex, macrod, in-memory) alongside connected apps, through the same session
egress path: the sandbox sees the server under its name and a URL key, never the
server's address or token. A disabled server is not offered. If a server's
connection has expired, its tool calls return a message telling the agent to
have the owner use Reconnect under Custom MCP; there is no `Connect` chip for
custom servers. Agents configured with a fixed app selection do not receive the
owner's custom servers.
An agent reply's `Connect <app>` chip still starts that app's connection flow.
Cursor stays in Agents → Runtimes with its API key and default model controls; it is not
featured or offered in the Connections catalog. Personal Gmail and GitHub account
links remain in Settings → Integrations. The native-only Connections page remains
available when `pipedream-mcp` is disabled.
Open Settings with the rail's gear button or `Ctrl+;`; leave it by picking any other rail item.

`Agents` → `New agent` (or edit an existing agent) opens a full-page form. The
`Instructions` field is a Lexical contenteditable textbox, not a textarea. It
supports Markdown headings, lists, emphasis, code, links, and the normal `@`
mention picker; select text to open the formatting menu. Saved instructions
retain mention identities using the shared editor's Markdown format and reopen
with their formatting intact. Enter adds a new paragraph; use `Create agent` or
`Save changes` to submit. The form also includes runtime selectors.
Under the runtime, `Answering a mention` chooses between `Coding agent` (a
channel mention is answered with a magic chip that opens into the live session)
and `Chat agent` (the agent replies in the thread, like `@macro`). It is the
agent's own setting and always saved: a new form starts from the selected runtime
- Macro's in-memory runtime as chat, every other runtime as coding - and picking a
different runtime resets it to that default, but only the saved choice counts.
The model list is loaded live and independently for Macro Agent, connected Cursor, and every
registered macrod harness. The selected harness stays selected when the list refreshes.
A paired macrod connects on startup, so models can load before any agents are bound.
A harness can show `Loading models…`, an unsupported message, or
a retryable error without hiding the other harnesses. Editing preserves a saved model that
is no longer offered and labels it `saved, unavailable`. A macrod with no responding runtime
can remain loading until the 10-second discovery timeout; use Retry after reconnecting it.
New macrod sessions use the agent's saved model before sending the first prompt.
Changing that default applies to new sessions; existing sessions keep their selected model.
If the runtime rejects the saved model, the prompt fails instead of using a different model.

The `Runtimes` section shows built-in Macro, Cursor, Claude, and Codex configuration, followed by paired macrod runtimes. Claude's card appears only with the `claude-cloud` flag, and Codex's only within the agents and Codex rollouts. The “Bring your own agent” card sits above the Agents / Runtimes navigation and is visible on both sections. It rotates Claude Code, OpenCode, OpenClaw, and Hermes; reduced motion keeps a static name. Its `New runtime` action opens the full-page pairing flow from either section: enter the code, look up the request, review the machine, name, sharing and permission consent, then Approve and Done. Back/Cancel returns to the runtime list. Destructive removal still requires confirmation. `/settings/runtimes` opens this section; legacy `/settings/harness?pair=…` links remain supported.
Connection chips in agent replies open this page, including before any account is connected. Cursor's default-model picker uses
the same live model discovery and retains its existing save action.

The Codex row uses the OpenAI logo and the same icon, button, and status styling
as Cursor. Under **Codex**, choose **Connect with ChatGPT**, copy the displayed device code,
and use **Continue to ChatGPT** to finish sign-in in the provider tab. The Macro
page displays pending, expired, failed, and retryable error states; **Cancel
sign-in** cancels the attempt. After connecting, choose a **Cloud environment**
and click **Save Codex settings** before using Codex. Options show their
repositories. New sessions always use the `main` branch; there is no branch
picker or automatic repository selection. Changed selections display **Unsaved
changes** until the server confirms them. The save button is disabled until an
environment is selected, and when it matches the saved environment.
These choices apply to new sessions. **Disconnect** in the Codex row (accessible
name **Disconnect ChatGPT**) asks for confirmation before removing the connection.
Claude, Cursor, and Connections disconnect actions use the same shared confirmation
dialog (a drawer on mobile); Cancel leaves the connection intact. Claude's row
keeps its layout while status loads, and sign-in details appear only after Connect.
The UI never asks for an
OAuth token.

The Codex section and its auth/config requests were exercised in Chromium with
mocked backend responses on 2026-09-15. Provider login and a full deployed Macro
session were not exercised by that UI check.
