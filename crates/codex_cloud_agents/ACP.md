# Codex Cloud in Zed

This standalone prototype runs Codex in OpenAI's cloud and speaks ACP v1 over
stdin/stdout. It does not execute against the folder opened in Zed.

## Fixed prototype configuration

| Setting | Value |
| --- | --- |
| Credentials and journal root | `/home/wolf/.local/state/macro-codex-probe` |
| Cloud repository | `404Wolf/temp-test-repo` |
| Environment | `6aa96d450dc88191a2ae2f7f93456e48` |
| Branch | `main` |

These values live in `src/lib.rs`. The authentication binary permits an explicit
`--state-dir` override for development, but `codex_acp` always uses the fixed path.

## Build and log in

From `/home/wolf/Macro/repos/wolf-1`:

```sh
nix develop --command cargo build -p codex_cloud_agents --bins
./target/debug/codex-cloud-probe login
```

If already connected, use `./target/debug/codex-cloud-probe status` instead.
Complete the browser device-code verification; credentials are stored in the
probe's own JSON format. The ACP binary refreshes expiring credentials itself.
Close active ACP processes before logging in or out: the state directory uses
an exclusive process lock to protect credential rotation and journals.

## Configure Zed

Merge this into Zed's settings JSON:

```json
{
  "agent_servers": {
    "Macro Codex Cloud": {
      "type": "custom",
      "command": "/home/wolf/Macro/repos/wolf-1/target/debug/codex_acp",
      "args": [],
      "env": {}
    }
  }
}
```

Select **Macro Codex Cloud** from the Agent Panel's new-thread selector. The first
message creates a cloud task; subsequent messages continue the same task.
Use Zed's stop button to request remote cancellation. The adapter waits for the
provider's terminal state rather than interpreting stream EOF as cancellation.

For a first test, send: “Read the repository without changing files. Say what you
found, then ask me one clarification question.” Answer in a follow-up message.
The question is a normal conversational turn, not a structured elicitation dialog.

Zed's `dev: open acp logs` command shows protocol traffic. Diagnostics use stderr;
stdout is reserved for JSON-RPC. See the official
[Zed custom-agent instructions](https://zed.dev/docs/ai/external-agents#custom-agents).

## Supported boundary

- Text prompts, assistant text updates, structured command/tool activity where
  present, serial follow-ups, and remote cancellation.
- Private local session journals retain cloud task/turn mapping and received
  events. Ambiguous submissions are never automatically repeated.
- Missing/reordered stream output is reconciled with the terminal provider
  snapshot. A final correction may be shown if the provider's completed output
  differs from earlier streamed text.
- Structured elicitation/approval replies, MCP forwarding, images/audio, model
  selection and local filesystem/terminal execution are not supported. The cloud
  agent executes commands in its own environment without a local permission gate.
- `loadSession` is not advertised yet: fully resuming observation after a process
  restart is not implemented. Start a new Zed thread for a new session. A cloud
  task can continue after the local process exits; closing the process is not a
  remote cancellation request.
- One process owns this credential state at a time. Starting a second ACP process
  against the same fixed directory fails explicitly rather than racing refresh.

The transport is derived from the official desktop bundle, not a published API
stability contract. [Transport evidence](../../docs/CODEX_DESKTOP_TRANSPORT.md) and
[live verification](../../docs/CODEX_ACP_VERIFICATION.md) record its tested scope.

## Tests and snapshots

```sh
nix develop --command env -u SQLX_OFFLINE cargo test -p codex_cloud_agents
nix develop --command just check
```

`tests/stdio.rs` drives real newline-delimited JSON-RPC byte streams and snapshots
initialization, messages, follow-ups, stop and unsupported input behavior.
Provider fixture tests cover SSE framing and cloud request contracts. Domain tests
cover serial turns, ambiguous submission, persistence and cancellation races.
Review snapshots before accepting updates; use `INSTA_UPDATE=always` only when
intentionally regenerating expected output and inspect the resulting diff.

Validation on 2026-09-15: 48 package tests and snapshots passed, as did Clippy
with warnings denied and `just check`. Live stdio testing verified an initial
message, ordinary clarification follow-up, command updates and remote cancellation.
The rebuilt binary also replayed a saved journal with clean JSON-only stdout.
Zed's graphical UI has not been exercised here.
