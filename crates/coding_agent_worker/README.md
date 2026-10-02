
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

A background reader forwards local TUI turns even without a Macro prompt.
Complete JSONL records are read in bounded batches. Partial lines wait for the
next append; truncation or replacement requires a reload. Turn boundaries are
forwarded in order, including multiple local turns between polls.

### Native controls and MCP

Model selection from Macro applies before native launch. Change a running
session's model in its native TUI; macrod rejects remote model changes it cannot
confirm. Unconfirmed prompt submission is reported as an error, never retried by
pressing Enter. Cancellation sends Escape without a delayed input-clearing key.

Remote permission answers require a recognized approval shortcut, the same
visible dialog, and the same Herdr state generation. Sign-in prompts and other
unknown dialogs require native interaction. Herdr does not offer an atomic
compare-and-send-key operation, so native interaction remains the authority.

Claude receives MCP configuration in a private file. Codex receives per-launch
MCP overrides; HTTP credentials come from private environment files sourced in
the native pane, and stdio servers use private launch scripts. This requires a
Bourne-compatible pane shell. User-wide Codex configuration is unchanged. SSE MCP
servers are rejected for Codex; use streamable HTTP. Credentials are refreshed on
native launch/resume, not injected into an already-running process.

Codex's documented [MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)
and [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)
describe `env_http_headers` and per-server configuration.
