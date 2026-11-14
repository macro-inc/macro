
### Repositories in native Herdr sessions

Macro can include `repoUrl` when opening a session on macrod. Native Herdr
sessions look for the matching origin in the configured workspace directory
(and its child directories), then in this daemon's repository cache. A missing
repository is cloned using the operator's Git credentials. New worktrees start
from a fresh fetch of `origin/main`; macrod never pulls into the operator's
working branch. A repository without `main` produces an error.

Herdr creates and registers the worktree. The session ID determines its path
and branch, so redelivery reuses existing work without resetting edits. Cached
repositories and worktrees live under `~/.macrod/herdr/<harness-id>/`. Each
paired macrod instance has one configuration and its own storage directory.

### Reconnecting native sessions

macrod records native session IDs and transcript locations in private files in
its instance directory. ACP `session/load` replays the native transcript before
acknowledging the load. A running Herdr agent is reattached; an explicitly missing
agent resumes its native session on the next prompt. Socket errors do not create
replacement agents. Changing the configured provider does not convert existing
sessions into sessions for the other provider.

After macrod restarts or its runtime connection reconnects, the harness service
initializes the new connection and calls ACP `session/list`. herdr-acp lists
the sessions whose Herdr agent still runs, each with `updatedAt` set to its
transcript's last write. The service loads the ones with recent activity (in
Herdr or in Macro), an unfinished turn, or queued prompts; that replays local
history Macro missed and resumes forwarding without a Macro prompt. A session
idle for longer loads on its next Macro prompt, so local work started in it
after the reconnect reaches Macro only from then. Agents closed in Herdr are not
reopened.

Closing a session's agent in Herdr (its tab or pane, by you or the agent) is
reported to Macro once with the ACP extension notification `_session/closed`.
Only Herdr's explicit `agent_not_found` answer counts, checked every few
seconds while no Macro prompt runs; socket errors, timeouts, and unreadable
answers are never reported, and neither is macrod or its connection stopping.
Only an agent this macrod run launched or saw running counts, so sessions
restored after Herdr itself restarted, whose agents are all gone, stay visible.
Macro archives the session if its owner turned on archiving when the runtime
closes and the session is idle. The next prompt still relaunches the agent,
and a close of that new agent is reported again.

A background reader forwards local TUI turns even without a Macro prompt.
Complete JSONL records are read in bounded batches. Partial lines wait for the
next append; truncation or replacement requires a reload. Turn boundaries are
forwarded in order, including multiple local turns between polls.
Only typed prompts start a local turn; Claude Code's own transcript lines
(reminders, compaction summaries, local slash command output) do not, and an
Esc interrupt ends the turn as cancelled. A local turn whose transcript never
records an end, such as one cut short by a closed CLI, ends once Herdr reports
the agent idle and the transcript has been quiet for a few seconds.

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
Enter. Cancellation (Stop in Macro, for a Macro prompt or an observed native
turn) presses Escape until Herdr reports the agent stopped, at most three times
(Claude Code's vim editor mode spends the first Escape leaving insert mode), and
never sends an input-clearing key. The turn reports `cancelled` only once the
agent has stopped; if it keeps running, macrod follows it to its real end.

A prompt from Macro while the native agent is working or showing a dialog
waits, like input typed into the TUI mid-turn. The running turn keeps streaming
and its permission dialogs still reach Macro; the prompt is typed once the turn
ends. Stopping from Macro while it waits interrupts the native turn and drops
the prompt, which fails with a `prompt_not_delivered` notice so Macro shows the
message was never typed in rather than a stopped turn. Claude Code's exit confirmation, left by a second Ctrl-C while
background work runs, is dismissed with Escape ("Stay") before the prompt is
typed.

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
reused. Each instance has one configuration. The TUI and `macrod service`
share `~/.macrod/macrod.toml` (`%USERPROFILE%\.macrod\macrod.toml` on Windows;
`--config` overrides it), and only one macrod can serve a config at a time.
Another machine on the same computer is a named profile, `macrod --profile
<name>` (`~/.macrod/profiles/<name>.toml`); `macrod profiles` lists them. The
machine's name, access, and permission bypass are set on the web at
Settings → Machines. `allow_permission_bypass = false` in an old local config
no longer vetoes bypass: the machine's managers decide it on the web.

The Config tab adds **Model** (empty uses the native default, and is only the
launch fallback: Macro picks each agent's model), **Extra args**
(shell-style quoting), **Storage** (empty uses automatic instance storage), and
**Open sessions** (foreground or background). Switching agents clears the
previous agent's model and extra arguments. Storage and focus preferences remain.
Session metadata stays in the instance directory even with custom worktree storage.
Choose a repository in Macro's composer; local sessions always start from `main`.

### Herdr versions

macrod drives both herdrs and picks by where it runs (`src/herdr/cli.rs`):

- **herdr 0.9** (`HERDR_ENV=1`): the `herdr` CLI. Herdr creates worktrees, opens
  tabs, starts agents, and reports their status and session IDs.
- **herdr-core and the herdr app** (`HC_TERMINAL_ID`): the `hc` CLI, which must
  be on `PATH`. Each session is a core terminal labelled with the app's
  `herdr.space` and `herdr.tab`, so the app shows it as a tab in macrod's space.
  A managed worktree gets its own space. macrod starts the shell and then types
  `exec <agent> …` into it, so the agent gets the operator's login environment.
  git creates the worktrees. Tab names and focus go through `herdr-app do`, and
  macrod skips them when the app is not running.

herdr-core does not guess status; it shows what a program reports through
OSC 7501. Claude Code reports it. Codex does not, so under herdr-core a Codex
session loses three things: busy detection before a prompt, remote permission
answers (approve in Herdr), and cancelling a turn Macro did not start.
Transcripts still end its turns. Without a reported session ID, macrod finds
Codex's transcript by working directory and start time. Viewer windows
(`macrod herdr-pane`) report their own state through OSC 7501.

## What opened a session

Each `New` trigger event says what opened its session
(`NewAgentSessionEvent::origin`). `src/trigger.rs` keeps it on `TriggerWork`, and
`src/dispatch.rs` copies it onto the create request, where the service stores it
with the session. macrod reports only what the event said. The service treats it
as a description, so it never decides a session's visibility or notifications.

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

## Monitor

`macrod monitor` (Linux and macOS) is a live board of every agent on the
machine: hc terminals, Claude Code and Codex sessions, macrod's own sessions,
managers and work runs. The viewer (`crates/agent_monitor_tui`) reads one
collector (`crates/agent_monitor`) over gRPC on `~/.macrod/monitor/monitor.sock`.

- **One collector per machine.** The first process to claim the socket hosts
  it: the panel or `macrod service` while `[monitor] enabled` (the default),
  or `macrod monitor serve`. A socket that answers is left alone; a panel
  or service then tries the claim again every minute and takes over when
  that collector exits; a socket left by a dead collector is replaced only
  after a connect fails, under `<socket>.lock`. The socket lives in its own
  directory, `~/.macrod/monitor/`, which the monitor creates 0700 (and
  refuses to use when it is open to other users); the socket is 0600.
  macrod's home itself may be 0755.
- **`macrod monitor`** opens the viewer. When nothing answers it starts
  `macrod monitor serve --exit-when-idle` detached (its own process group,
  logging to `~/.macrod/monitor/collector.log`), which exits after ten minutes
  without a viewer. The viewer reconnects by itself when its collector goes
  away, and a collector started by a later `macrod monitor` takes over.
- **`macrod monitor serve`** runs the collector alone: no pairing, no config
  lock, no harness. It reads only `[monitor]`, from `~/.macrod/macrod.toml`
  or the `--config` / `--profile` it is given (resolved as for
  `macrod service`; the viewer passes its own to a collector it starts), and
  refuses to start while another collector answers.
- **Work runs** come from `[monitor] run_record_dirs` (`<id>.json` records
  with an optional `<id>.cost`; a leading `~` is the home directory). A run
  joins its terminal by the record's terminal name, or by an hc label named
  in `run_id_labels` whose value is the run's id.
- **`macrod monitor dump`** prints `{"connected": ...}`, then one
  `{"update": ...}` per update (snapshot first) as JSON lines; `--count N`
  stops after N updates. `--transcript <agent id>` prints that agent's
  transcript instead (`{"item": ...}`: its last items, then each new one),
  the same feed as the viewer's drill-in.
- **`macrod monitor --demo`** shows the scripted demo fleet from the viewer's
  own process, with no collector. Recordings shared outside the machine use it.
- `--socket <path>` points any of them at another socket (tests).
- A hosting panel or service adds the `daemon` source: its harness id,
  whether the runtime is connected, and its open prompts, as that source's
  health (detail = harness id, items = open prompts); the viewer's header
  shows it as `HOST <harness> ● ON  PROMPTS n` or `○ OFFLINE`.
- The Config tab toggles hosting (`Agent monitor`), which writes a
  `[monitor]` table; new configs leave it out (hosting is on by default),
  because a macrod older than the monitor rejects a file that has one.
  `history_hours`, `fps` and `run_record_dirs` take effect on the next start.
- `macrod monitor serve` and `macrod service` export `macrod.monitor*` spans
  when `OTEL_EXPORTER_OTLP_ENDPOINT` is set. Rows, spans and logs carry ids
  and counts, never transcript text.
