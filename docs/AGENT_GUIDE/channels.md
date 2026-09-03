# Channels and Messaging

## Create a channel

1. `Create` → `Channel G`. Dialog `Create a channel` opens with the `Name` textbox focused.
2. `fill` the name.
3. Invite (optional): click the combobox `To: Macro users or email addresses`, `type_text`
   the email, wait for the live-region text `one option available` (or `N options`), press
   **Enter** to tokenize — the email becomes a chip above the combobox. Skipping the Enter
   leaves raw text that is not submitted.
4. Click `Create Channel`. Navigates to the channel (as a split pane:
   `.../channel/<uuid>`); a system row `Channel <name> created` appears.

Channels are invite-only ("Only people you invite can see this channel"). A DM is just a
channel between two users.

## Message composer

Placeholder `Type @ to share with #<name>`. Click it, `type_text`, press Enter to send.
The message renders immediately with avatar, email, timestamp. Composer extras: `Attach
files`, `Format`, a `Task` switch (turns the message into a task), `Send message` button.

Hover a message for its action menu. `Reply` on a top-level message opens that thread. On
an existing thread reply, it inserts a one-line reply-target reference into the composer;
clicking the reference navigates back to that reply. If text in the message is
browser-selected before `Reply` is clicked, the reference previews only the selected text.
For agent-session messages, the reference previews the resolved answer or current activity
rather than the internal Magic Chip marker.
Agent-session announcements use the same ReplyTarget reference for the prompting channel
message; ordinary Markdown blockquotes remain presentation-only and do not count as replies.
The composer always keeps an editable empty line after a block reference, including after
the user deletes that line, so clicking below the reference can restore the text caret.

`@Macro` answers in the thread (classic bot). `@macro-new` / `@coder` / `@cursor` open
an agent session; follow-up `@` mentions of that bot in the same thread route to it.
Agent replies may contain mention chips (`<m-document-mention>`) that render like any
other channel mention.

## Channel tabs

Radio group at the top of the channel pane: `Messages` / `Attachments` / `Participants`,
plus a `Call` button. Clicking the radio input can time out — click the adjacent label text
instead.

`Participants` tab:
- `Copy invite link`, participant search box.
- Add: combobox `name@company.com` + `Add Participant` button.
- Each row: `<name> Member|Owner` with a `Remove participant` button (owner shows
  `Cannot remove participant`, disabled).
- Team access: `Team channel` switch (disabled until you belong to a team).
- Bots: `New bot`, `Search existing bots…` combobox, `Invite bot` — webhook-powered channel
  participants.

## Onboarding channel

New users get `Macro Support x <name>` seeded with a welcome message that @mentions them —
useful as a guaranteed-existing channel in tests.
