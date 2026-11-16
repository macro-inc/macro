---
name: agent-session-analysis
description: >-
  Find out why agent sessions are slow, expensive, or wrong. Use when asked to
  look at a specific agent session, export sessions for analysis, compare
  models on real sessions, or fan out agents over many sessions to rank what
  makes them slow or fail.
allowed-tools: Bash, Read, Grep, Glob, Agent
---

# Agent session analysis

Two sources, used together:

- **The session log** (`agent_session_log`): every ACP frame, so every prompt,
  thought, tool call, result and answer. Read it with
  `tooling/agent-session-view` (see its `AGENTS.md`). Times are when each
  frame was appended, read from its UUIDv7 id.
- **Traces** (Datadog us5, `service:agent-harness-service`, a session's
  `execute_tool` and `invoke_agent` spans by `@gen_ai.conversation.id:<id>`):
  true tool durations and result sizes on `execute_tool`, per model call sizes
  and cache tokens on `chat_streaming` (same traces), per turn counts on
  `agent.acp.prompt` and `agent.turn`. The fields are listed in
  `crates/agent_session/README.md`. Spans are sampled and kept 15 days; a
  missing span proves nothing. `--datadog` merges them into the viewer.

## One session

```sh
tooling/agent-session-view/agent-session-view <session-id>             # HTML timeline (prod replica)
tooling/agent-session-view/agent-session-view <session-id> --markdown  # <id>.md + <id>.full.md
tooling/agent-session-view/agent-session-view <session-id> --datadog   # + span timings, model-call lane
tooling/agent-session-view/agent-session-view <session-id> --serve 8000 # serve it on 127.0.0.1:8000
```

`--serve` is unauthenticated and binds to loopback; add `--bind 0.0.0.0` (or
the machine's tailnet IP) to open the page from another machine.

Add `--env dev` for dev. Read the `.md` first: the header says where the
time went and lists the slowest gaps and failures; each turn has a step table
(offset, gap before the step, kind, tool, result size, status, first error
line). The `.full.md` has the uncut code and results under the same step
numbers. Gaps are model time plus anything not recorded as a step; with
`--datadog`, tool steps run from their span's start to its end and each turn
lists its model calls (first chunk, tokens, cache reads, largest prompt
parts).

## Many sessions

```sh
tooling/agent-session-view/agent-session-view --query --since 2026-10-19 \
  --model gemini --min-tools 15 --limit 40 --out ~/.cache/agent-session-view/batch-gemini
```

Filters: `--since/--until` (created), `--owner` (`owner_id`), `--model`
(substring), `--include-routines`, `--min-seconds` (first to last frame),
`--min-tools`. One tunnel serves the whole batch; it writes each session's
markdown plus `index.md`. Exports are user content: keep them out of the repo.

## Fan out over the corpus

1. Export a batch as above. Read `index.md` and drop sessions too short to say
   anything.
2. Start one Sonnet subagent per 3 to 5 sessions, in parallel, each given its
   files and this rubric. Ask for findings as `pattern | session | turn.step |
   seconds or bytes lost | one line of evidence`, nothing else.
3. Merge the rows: group by pattern, sum the time lost, count sessions, and
   rank causes by total time lost, then by sessions affected. Keep two or
   three evidence lines per cause and the session ids.

Rubric (patterns found so far; report others under `other: <name>`):

- `doc-dump`: tool search or documentation results of 60 KB or more
- `invented-api`: SDK methods or arguments that do not exist
- `subagent-without-tools`: a Subagent call that could not act
- `list-without-activity`: lists returned without the activity metadata the
  task needed
- `overclaim`: the answer states more than the tool results support
- `huge-result`: a raw tool result large enough to crowd the context
- `serial-calls`: independent calls made one at a time
- `repeated-failure`: the same failing call repeated
- `silent-cap`: SDK results cut at 100 channels or 5 messages without saying so
- `search-error`: search 500s, or agent sessions polluting search results
- `missing-capability`: something the user needed that no tool offers (custom
  MCP connect, PDF attachments, the CRM interaction timeline, ...)
- `slow-model-round`: a single model gap over 15 s, with what preceded it
