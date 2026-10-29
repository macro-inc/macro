
### Repositories in native Herdr sessions

Macro can include `repoUrl` when opening a session on macrod. Native Herdr
sessions look for the matching origin in the configured workspace directory
(and its child directories), then in this daemon's repository cache. A missing
repository is cloned using the operator's Git credentials. New worktrees start
from a fresh fetch of `origin/main`; macrod never pulls into the operator's
working branch. A repository without `main` produces an error.

macrod creates each Git worktree without registering it with Herdr's worktree
grouping. The first prompt opens an independent top-level workspace with that
worktree as its working directory. Each session gets its own workspace, even when
another Herdr workspace already owns the repository's main checkout. The session
ID determines the path and branch, so redelivery reuses existing work without resetting edits.
Cached repositories and worktrees live under `~/.macrod/herdr/<harness-id>/`. Each
paired macrod instance has one configuration and its own storage directory.

Native workspaces use the prompt's visible text until Macro supplies its session
name; hidden context and mention payloads are excluded from that initial label. While
macrod is running, it checks the harness's session names every five seconds and
updates the matching workspace and tab, including later renames made in Macro.
Only a workspace created for that session is renamed. Older shared workspaces and
workspaces into which the user moves a session keep their existing names.

### Reconnecting native sessions

macrod records native session IDs and transcript locations in private files in
its instance directory, together with the session's Herdr workspace and tab.
Native launch retries and daemon restarts reuse that workspace; a closed session
opens a new independent workspace on its next prompt. Existing shared tabs are
reattached without changing their layout. ACP
`session/load` replays the native transcript before acknowledging the load.
A running Herdr agent is reattached; an explicitly missing
agent resumes its native session on the next prompt. Socket errors do not create
replacement agents. Changing the configured provider does not convert existing
sessions into sessions for the other provider.

After ACP attaches a session, a background reader forwards local TUI turns even
without a Macro prompt. The gateway currently binds existing sessions lazily:
after a daemon restart or gateway reconnect, a Macro control must reattach the
session before this reader runs again. Native conversations continue locally
during that gap, and the next successful ACP load replays their saved history.
Automatic reattachment for local-only activity is not yet implemented.

Complete JSONL records are read in bounded batches. Partial lines wait for the
next append; truncation or replacement requires a reload. Turn boundaries are
forwarded in order, including multiple local turns between polls.

### Native controls and MCP

Model selection from Macro applies before launch and to idle native sessions.
Claude receives `/model <id>`; Codex opens its native model picker, selects the
exact model row, and retains the reasoning level selected by the native picker.
Each key requires the expected dialog, session identity, and unchanged screen
and state generation. Only native confirmation reports success; unexpected
screens require completing the selection in Herdr. The session is not restarted.

The model label follows native transcript metadata, including after a reload.
Codex also reports its live footer model before a turn and reads available models
from its installed CLI catalog. Until the native agent identifies its model, an
unconfigured session reports the native default. Claude identifies the actual
model when its first assistant record arrives.

Unconfirmed prompt submission is reported as an error, never retried by pressing
Enter. Cancellation sends Escape without a delayed input-clearing key.

New and reloaded sessions advertise `/compact`, `/init`, and `/fast` in Macro;
Codex also advertises `/ultrafast`. Speed controls are delivered unchanged to
the native TUI. Macro acknowledges delivery without claiming the setting
changed: check the response in Herdr, including any confirmation or unavailable
mode message. Claude accepts `/fast on` and `/fast off`; bare `/fast` opens its
native controls. Codex's speed commands toggle tiers available to its current
model and account. Claude also advertises `/effort`, with an optional level,
`auto`, or `status`. Codex advertises `/model`, which opens its native model and
reasoning effort picker; choose the level in Herdr. These native controls need not
generate an assistant turn, so they do not wait for transcript output. Ordinary
prompts still require confirmation.

For Codex, `/effort` or `/effort status` reports the active model, effort, and
available levels directly in Macro. `/effort high` (or another supported level)
selects that level in the current model's native picker and waits for the footer
to confirm it. `/effort default` restores the model's catalog default. Explicit
`max` and `ultra` requests can navigate the advanced reasoning picker. Additional
warnings or unrecognized dialogs require native interaction; they are not
accepted automatically. These commands keep the current model and session.

Effort choices are validated by the native agent. Macro's model dropdown only
projects the ACP model option; it does not currently expose a separate effort
selector or mirror effort changes made inside Herdr.

Herdr does not provide command discovery; this is a curated built-in list, not
the full set of native commands or installed skills. Session-switching commands
such as `/resume`, `/new`, and `/fork` are not advertised because Macro tracks a
specific native session. Automatic recovery still resumes that saved session.

Remote permission answers require a recognized approval shortcut, the same
visible dialog, and the same Herdr state generation. Sign-in prompts and other
unknown dialogs require native interaction. Herdr does not offer an atomic
compare-and-send-key operation, so native interaction remains the authority.

Macro offers **Always allow** next to **Allow once**. When the dialog shows its
own "Yes, and don't ask again ..." answer with a known shortcut, Always allow
presses it and the native agent keeps the rule. Otherwise macrod approves the
dialog and remembers the tool for the rest of the session: Claude Code's tool
name (such as `Bash`) or Codex's exact command. Later dialogs for it are
approved without asking Macro. These standing approvals live in macrod's memory
and end when macrod restarts.

Macro supplies the session's configured MCP connections when macrod binds it:
owner-connection sessions include enabled connected apps and custom MCP servers;
explicit agent selections retain their selected apps. All connections use the
session credential through Macro's egress proxy.

Claude receives MCP configuration in a private file. Codex receives per-launch
MCP overrides; HTTP credentials come from private environment files sourced in
the native pane, and stdio servers use private launch scripts. This requires a
Bourne-compatible pane shell. User-wide Codex configuration is unchanged. SSE MCP
servers are rejected for Codex; use streamable HTTP. Credentials are refreshed on
native launch/resume, not injected into an already-running process.

Codex's documented [MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)
and [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)
describe `env_http_headers` and per-server configuration.

### Setup

Start macrod inside Herdr and choose **Claude Code in herdr** or **Codex in
herdr** in Quickstart. Select a workspace directory containing your existing
clones and pair with Macro. Native CLI authentication and Git credentials are
reused. Each instance has one configuration, with no profiles to choose per run.
Keep the daemon running in its own Herdr workspace; native sessions open in
separate top-level workspaces.

The Config tab adds **Model** (empty uses the native default), **Extra args**
(shell-style quoting), **Storage** (empty uses automatic instance storage), and
**Open sessions** (foreground or background). Switching agents clears the
previous agent's model and extra arguments. Storage and focus preferences remain.
Session metadata stays in the instance directory even with custom worktree storage.
Choose a repository in Macro's composer; local sessions always start from `main`.

For unattended Codex launches, include `-c check_for_update_on_startup=false` in
**Extra args** and manage CLI updates separately; otherwise its startup update
menu can stop an agent before the first prompt.

## Replies to chat-agent mentions

Trigger prompts use the source channel/document message UUID as the control
action ID, scoped to their session. Initial mentions, follow-ups, and retries
after an existing-thread conflict all retain that ID. The backend joins it to
the authorized reply destination, so a completed external chat turn replaces
its pending thread reply. The backend retains the result and reserved reply ID
to retry channel updates without rerunning the prompt. Direct session controls
continue using newly generated action IDs.

After 24 hours, replies without a persisted completion are checked at most hourly.
Direct completion handling remains immediate. If a completion callback is lost
for an older reply, recovery can take an hour plus the recovery backlog; the
durable answer is retained. Successful pending announcements are not posted again.

Deploy the backend migration/service and update macrod to enable this path.
Previously released daemons generate unrelated action IDs; this change does
not repair old pending replies produced by those versions.
