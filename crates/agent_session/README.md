# Agent session activity projection

`agent_session.turn_state` is a list projection of the authoritative ACP fold.
The live writer commits each changed state with its log frame under the session's
ownership fence. Streamed tokens do not trigger repeated projection writes.

Apply migrations before deploying the writer. For sessions created before the
projection existed, run the bounded backfill against the intended MacroDB:

```bash
cargo build -p agent_session --features cli --bin backfill_turn_states
target/debug/backfill_turn_states --database-url "$DATABASE_URL" --limit 100
```

Repeat the second command until it reports `examined=0`. Each invocation folds
at most 100 session histories. It uses the same fold as the live writer and
initializes only missing projections, checking the latest log cursor while
holding the session lock. A concurrent append or projection causes that session
to be skipped; rerunning is safe. It does not change logs or session timestamps.

## Runtime working branches

`agent_session.working_branch` stores the branch a provider actually reports for
the session's configured repository. It is independent of `repo_branch`, which
is only the selected starting branch, and of whether a pull request exists.
Changing the configured repository clears the working branch. Writes check the
owner, repository, and active runtime claim; changed facts invalidate list rows.
Malformed or unrelated provider git metadata is ignored without blocking the
session's transcript or history replay.

Deploy the additive `agent_session_working_branch` migration before the agent
harness and document storage services. The harness persists the provider facts;
document storage returns them in the existing Soup `workingBranch` field. Deploy
both backend services before relying on that field in a frontend preview.

Cursor terminal result events supply the pushed branch, including when no PR was
opened. Replaying a saved Cursor native journal restores historical branch facts
when that journal contains them. Sessions without such a result remain unknown
until the provider reports one; loading the list does not launch an agent. Other
harnesses do not currently publish authoritative working branch facts. Soup
retains the last captured linked-PR branch as a fallback for those sessions and
older rows only while its captured repository matches the session's current one;
it never substitutes the starting branch.

## Initialization and first streamed text latency

On each `invoke_agent` span, the session actor records independent millisecond
measurements from sending ACP `session/prompt`:

- `macro.genai.turn.time_to_first_text_ms`: first non-whitespace agent message
  text; excludes reasoning, tool calls, and empty chunks.
- `macro.genai.turn.time_to_first_reasoning_ms`: first non-whitespace thought.
- `macro.genai.turn.time_to_first_tool_call_ms`: first tool call.
- `macro.genai.turn.time_to_first_output_ms`: the existing combined metric,
  which also counts thought/tool events and is not answer-text latency.

Each milestone is recorded once per turn, regardless of content-capture policy.
Turns without text have no text-latency measurement, rather than a zero. A
correlated `agent first output milestone` log emits immediately with
`output_kind` and `elapsed_ms`, so a turn need not finish before it is observable.
These are server-observed timings, not browser render measurements, and they
exclude work before the prompt reaches the runtime.

For that preceding work, inspect `agent.init.*` spans in the harness: admission,
preferences, egress, persistence, publishing, runtime creation, permissions, and
attachment. `agent.init.acp` spans measure actual request-to-response time for
`initialize`, `session/new`, `session/load`, and `session/resume`, with
`rpc.method`, `agent.session.id`, and `outcome` (success/error/stopped). Runtime
attachment alone is not a readiness measurement.

The in-memory connector exposes `agent.mcp.initialize` and
`agent.mcp.list_tools` durations per `server`, alongside the aggregate connector
`pooled`, `dialed`, `failed`, and `elapsed_ms` fields. Servers initialize in
parallel: compare the critical path, not the sum of their durations. In-memory
prompt spans also split `agent.turn.lock_wait_ms`, `agent.turn.admission_wait_ms`,
and `agent.turn.first_text_ms`; their legacy `ttft_ms` can include reasoning or
a tool call, but excludes usage and tool-result events.

To investigate a slow first session in Datadog, correlate by `agent.session.id`,
compare cold and pooled connects separately, and report sample counts and
p50/p95 for initialization and first text by harness/model. Include the fraction
of turns with no text rather than silently counting them as fast answers. None
of these new fields supplies historical measurements before its deployment.

Home and Agents can prepare an unprompted session through
`POST /agent-sessions/warm`. It stays hidden until normal creation claims the
same id for the same owner, bot, model and instructions. Reusing the session
also reuses its egress token, which is part of the MCP pool key; creating and
immediately deleting a throwaway session would release those cached clients.
No model invocation or tool execution occurs during warming.

The browser consumes a result once within five minutes. Unclaimed rows expire
after ten minutes and are deleted through the managing replica. Each replica
reserves at most 64 warm attempts per ten minutes, with at most two per user.
The MCP pool holds at most 256 entries, evicts entries idle for ten minutes,
and limits handshakes to 16 concurrent attempts with a 30-second timeout.
`agent.session.warm` and `agent.session.warm_hit` on the open span distinguish
preparation, successful reuse and ordinary creation for latency comparisons.
