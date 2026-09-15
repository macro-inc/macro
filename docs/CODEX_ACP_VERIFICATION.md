# Standalone Codex ACP verification

Date: 2026-09-15. This report distinguishes provider observations from adapter
verification. The unpublished WHAM transport is pinned to the official Desktop
bundle identified in [transport evidence](CODEX_DESKTOP_TRANSPORT.md).

## Live reconnect and completed replay

The probe used the existing isolated OAuth state and the disposable
`404Wolf/temp-test-repo` environment on requested ref `main`. No credentials,
account identifiers, or raw repository outputs are included here.

One new read-only follow-up continued task
`task_e_6aa971995fd48324b0e45a303eb2c2f0`, creating assistant turn
`task_e_6aa971995fd48324b0e45a303eb2c2f0~assttrn_e_6aa974f7e74c8324b92d6eb8316ec65b`.
It requested a progress marker, `pwd`, a twelve-second pause, and a short final
report about README existence. It explicitly prohibited edits, commits, pushes,
and pull requests.

The probe opened the bundle-derived SSE route, closed the connection after eight
data records, and reconnected without a cursor:

| Read | Records | Observation |
| --- | ---: | --- |
| Initial connection, deliberately interrupted | 8 | Nonterminal partial stream |
| Reconnect through EOF | 46 | First eight IDs repeated as an exact prefix; all 46 IDs unique; `turn/completed` present |
| Immediate completed replay | 52 | All previous IDs retained in the same relative order; six historical additions |
| Fourth read | 52 | Exact same ordered IDs as third read |
| Fifth read | 52 | Exact same ordered IDs as fourth read |

The six added records were two `rawResponseItem/completed`, two
`item/completed`, and two `item/agentMessage/delta` records. They appeared inside
the previous ordering, rather than solely at its end. Per-turn detail reported
`turn_status: completed`.

Consequences for the adapter:

- Deduplicate reconnect overlap by outer event ID.
- Do not assume the first EOF or `turn/completed` includes every stored event.
- Reconcile completed items and authoritative terminal snapshots. The final
  message must take precedence over a possibly incomplete delta assembly.
- Replay order is eventually stable in this sample; live arrival order is not a
  proof of complete historical ordering.

The probe does not establish a retention period, resume cursor, exact delay until
storage converges, or behavior for every task. Existing cancellation evidence
in [the live probe report](CODEX_CLOUD_LIVE_PROBES.md) establishes that cancellation
can close SSE without a terminal marker, requiring an authoritative state read.

## Elicitation boundary

The reviewed Desktop remote-conversation bundle contained no
`elicitation`, `requestUserInput`, `requestApproval`, or `request_user_input`
handler. Its accepted remote event methods and task operations provide no
verified cloud response endpoint for interactive questions or approval requests.
This is scoped negative evidence, not proof that no such provider feature exists.

An ACP implementation must advertise only supported capabilities and must not
invent a cloud elicitation reply route. A model asking a question in assistant
text is ordinary conversation: the next user prompt is a follow-up turn. It is
not evidence of a structured ACP permission or elicitation exchange.

## Zed configuration

Zed's current official [External Agents documentation](https://zed.dev/docs/ai/external-agents#custom-agents)
defines custom agents using `agent_servers`, a `type` of `custom`, an executable
`command`, `args`, and `env`. Add the adapter under a distinct name such as
`Macro Codex Cloud`:

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

The executable uses its dedicated state directory and configured disposable cloud
environment, described in [the adapter README](../crates/codex_cloud_agents/README.md).

Start it from the Agent Panel's new-thread selector. Zed's
`dev: open acp logs` command displays the protocol traffic for debugging.
Authentication belongs to the adapter's own credential store; keep credentials
out of settings and reserve process stdout for newline-delimited JSON-RPC.

## Built binary over stdio

A Python JSON-RPC client launched the built `target/debug/codex_acp` directly;
no SDK or editor bridge stood between the client and executable. This exercised
the live provider, separate from the adapter's deterministic snapshot tests.

| Case | Observed result |
| --- | --- |
| `initialize` | Protocol version 1; image/audio/embedded context, MCP, and advertised load support all false |
| `session/new` | Local UUID returned; cloud task created only on first prompt |
| First text prompt | Provider task completed; ACP returned `end_turn` after 1 thought update, 1 completed command tool call, and 9 assistant text chunks |
| Conversational clarification | Assistant asked whether to inspect README; represented as assistant text, with no fabricated elicitation exchange |
| Process restart and explicit `session/load` | Existing handler replayed the exact 11 prior assistant updates plus the stored user message; automatic active recovery remains unsupported and load capability remains false |
| Empty prompt | Rejected with JSON-RPC `-32602` before remote work |
| Image prompt | Rejected with JSON-RPC `-32602` before remote work |
| Follow-up | Continued the same provider task with a distinct assistant turn |
| `session/cancel` after 15 seconds | Pending prompt returned `cancelled`; independent per-turn GET confirmed authoritative `turn_status: cancelled` |
| Stdout | Every line parsed as JSON-RPC; no authentication or diagnostic prose appeared |

The adapter's new task was
`task_e_6aa97667b6248324829fff60f249e6b0`; the cancelled follow-up turn was
`task_e_6aa97667b6248324829fff60f249e6b0~assttrn_e_6aa9769b513c83248aa6f02f1726efdd`.
Both prompts prohibited changes, commits, pushes, and pull requests.

### Observed transcript limitation

The first live deltas assembled a README question but omitted the branch name
that was present in the completed provider message. Final reconciliation emitted
an additional chunk headed `Corrected provider message:` containing the complete
answer. This preserves the final answer but can visibly repeat part of an
assistant message. The live provider evidence above explains why deltas cannot
alone establish the complete final transcript. This run verifies delivery and
honest recovery, not a claim of seamless message replacement in every ACP client.

Zed configuration was checked against official documentation; the Zed GUI itself
was not driven during this verification. Stdio protocol execution and GUI
interaction are distinct checks.

## Recorded snapshot input

[recorded_cloud_turn.json](../crates/codex_cloud_agents/tests/fixtures/recorded_cloud_turn.json)
contains sixteen sanitized events from a later completed replay of the first ACP
turn above. The read returned seventy outer records; the fixture keeps the
accepted turn lifecycle, completed user/command/assistant items, and eleven
assistant deltas in their observed order. No started-item or command-output-delta
record occurred in this capture; synthetic tests cover those shapes separately.

Stable identifiers were consistently replaced. Prompts, assistant prose, command
text, command output, working directory, and timing values were replaced with
generic values. Completed assistant text matches the replacement deltas.
Structural field names, enum values, nulls, nesting, and retained event order come
from the actual provider capture. Raw-response events and internal reasoning
were excluded. This is live-origin schema/order evidence with synthetic content,
not an unaltered transcript.

## Final rebuilt executable smoke

After the account-binding and replay fixes were built, the final executable
passed another stdio `initialize` and explicit `session/load` against the existing
journal. It replayed eighteen updates: two user messages, two thought updates,
one tool call, and thirteen assistant text chunks. Initialization still honestly
reported `loadSession: false`.

The saved account binding matched the dedicated credential store; environment
and branch bindings matched the configured disposable environment and `main`.
Task/turn receipts remained present and `uncertain_write` was false. Journal bytes
were unchanged by the read. Every stdout line was JSON-RPC, the one diagnostic
line went to stderr, and closing stdin exited successfully with code zero. This
smoke created no provider task or follow-up turn.
