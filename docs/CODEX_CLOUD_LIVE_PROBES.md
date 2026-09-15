# Codex cloud live probe report

Date: 2026-09-15

This report records live, sanitized observations from Codex cloud using the
Macro-owned `codex-cloud-probe` binary and its isolated OAuth state. It contains
no tokens, account IDs, repository contents beyond the disposable test prompts,
or raw provider responses.

## Test boundary

- Environment: `404Wolf/temp-test-repo`
- Environment ID: `6aa96d450dc88191a2ae2f7f93456e48`
- Requested git ref: `main`
- Probe binary source: Macro repository commit
  `1bd2bcf799e8bd594c52ee0637c8c9bbdc2d5dd5` plus the current uncommitted
  `codex_cloud_agents` work
- Codex source reference: `2fdcdeaf0e219eea34c710e01de2ee0571ddeeb5`
- OpenCode source reference: `e03db9bc6908f75c9334d8aa997deeaac81c0298`
- Observation cadence: one task-details request per second after each response;
  only changed projected snapshots were printed

The three new tasks and the follow-up were requested to be read-only. They did not modify files, commit, push, or
open pull requests. An earlier user-run task did modify the disposable repository;
we used its existing details only to inspect structured artifact fields.

## Live tasks

### L1: requested progress, read-only, no diff

Task: `task_e_6aa9705a8c7483249e0874c46115f105`

Prompt:

> Work read-only: do not modify files, create commits, or open pull requests.
> Inspect this small repository and report: (1) the top-level files, (2) the
> current branch and latest commit subject, and (3) whether README.md exists
> and its exact line count. As you work, emit three clearly labeled progress
> updates: DISCOVERED, INSPECTED, and VERIFIED. Finish with a concise markdown
> summary containing a link written exactly as https://example.com/codex-probe
> and the Unicode marker 🐺.

Observed transitions:

| Observed timestamp | Status | Assistant output items |
| --- | --- | --- |
| `1789489244` | `pending` | none |
| `1789489249` | `in_progress` | none |
| `1789489303` | `completed` | `message`, `partial_repo_snapshot` |

The task completed about 59 seconds after the first snapshot. No intermediate
text appeared, even though the prompt explicitly requested three progress
updates. The terminal message preserved Markdown, a URL and Unicode. It reported
that the cloud checkout's active branch was `work`, showing that the requested
base ref does not imply that execution stays directly on a branch named `main`.
There was no diff and no PR item.

A source-backed sibling-attempt read for the assistant turn succeeded and
returned the schema `{ "sibling_turns": [] }`. The task details reported no
sibling IDs and no `attempt_placement`. This proves the read surface and the
zero-sibling case; it does not prove best-of-N behavior.

The raw terminal turn contained a `worklog.messages` field. Its single entry was
the user prompt: role `user`, one string part, and no assistant entry. We recorded
only shape and length, never the text. The current CLI projection does ignore this
field, but the follow-up probe below found no hidden assistant progress in it.

### L2: recoverable tool failure

Task: `task_e_6aa9709dec488324921893b8ec8e0664`

Prompt:

> Work read-only: do not modify files, create commits, or open pull requests.
> First run a command that is guaranteed to fail: `sh -c 'echo probe-stderr
> >&2; exit 23'`. Then recover, inspect README.md, and finish successfully. In
> the final response explicitly state the failed command's exit code and whether
> its stderr was visible to you. Keep the final response under 120 words.

Observed transitions:

| Observed timestamp | Status | Assistant output items |
| --- | --- | --- |
| `1789489311` | `pending` | none |
| `1789489317` | `in_progress` | none |
| `1789489354` | `completed` | `message`, `partial_repo_snapshot` |

The task completed about 43 seconds after the first snapshot. Its final message
correctly reported exit code 23 and the stderr marker, then reported successful
recovery. The task-details response did not expose a structured tool call, tool
result, command status, stdout, or stderr. A failed tool inside a successful task
therefore cannot currently become an ACP `tool_call` update from this surface.
This did not test a terminally failed cloud task.

### L3: direct worklog polling

Task: `task_e_6aa971995fd48324b0e45a303eb2c2f0`

Prompt:

> Work read-only: do not modify files, create commits, or open pull requests.
> Inspect the repository in at least four distinct steps. Before each step,
> send a short progress note labeled STEP-1 through STEP-4. Between progress
> notes, run a harmless read-only command. Finish by reporting the top-level
> tracked file names and whether the working tree stayed clean.

This probe bypassed the CLI's safe task projection for observation and polled
the source-backed task-details response directly. It reduced every response to
status, output-item types, worklog message count, author role, channel, recipient,
status, content-part type, and character count. It did not record content text.

During `in_progress`, both `output_items` and `worklog.messages` were empty. At
`completed`, the assistant output contained `message` and
`partial_repo_snapshot`; `worklog.messages` contained exactly one `user` entry,
the 361-character prompt. It contained no assistant progress or tool activity.
The loop observed 25 one-second waits before terminal state. The final assistant
message summarized four read-only commands, but no STEP-labeled updates appeared
before completion. The working tree remained clean.

This rules out the projection as the cause of the missing progress for this
task: the underlying task-details response itself exposed neither assistant
output items nor worklog messages while execution was in progress. It does not
rule out other fields or transports. The desktop-derived SSE probe below found
the provider's separate live transport.

### L4: desktop-derived SSE, continuation and cancellation

Task: `task_e_6aa971995fd48324b0e45a303eb2c2f0`

Inspection of Codex desktop bundle `26.908.70816` found the exact stream route:

```text
GET /wham/tasks/{task_id}/turns/{turn_id}/stream
    ?item_type=thread_event&item_type=log
```

The probe's OAuth bearer and ChatGPT account header authenticated successfully.
The endpoint returned HTTP/2 200 with `content-type: text/event-stream;
charset=utf-8`.

Opening the stream for completed L3 replayed 425 SSE data records: 388
`thread_event` and 37 `log`. Sanitized event counts included:

| Event method | Count | Evidence |
| --- | ---: | --- |
| `item/agentMessage/delta` | 342 | 1,270 text characters total |
| `item/completed` | 12 | 5 agent messages, 4 commands, 2 reasoning items, 1 user message |
| `item/reasoning/summaryTextDelta` | 2 | 104 characters total |
| `rawResponseItem/completed` | 20 | Raw item lifecycle present; content not retained |
| `thread/tokenUsage/updated` | 5 | Structured usage updates present |
| `turn/started`, `turn/completed` | 1 each | Full replay lifecycle |

This first result proves authenticated event replay, not by itself live delivery.
The separate `/turns`, per-turn, and `/logs` reads also succeeded. `/turns`
returned `current_turn_id` plus `turn_mapping`; the per-turn response wrapped
`task`, `turn`, and `user_turn`; `/logs` returned 84 log records.

The desktop-derived follow-up request was then tested with a read-only prompt:

```text
POST /wham/tasks
{
  "follow_up": {
    "task_id": "...",
    "turn_id": "...",
    "environment_mode": "code"
  },
  "input_items": [{ "type": "message", "role": "user", "content": [...] }]
}
```

The response retained the same task ID and created new user and assistant turn
IDs. That is direct evidence of conversation continuation rather than a second,
unrelated task. The prompt asked the agent to recall the prior turn, then wait 90
seconds so cancellation could be exercised. Its new assistant turn ID was
`task_e_6aa971995fd48324b0e45a303eb2c2f0~assttrn_e_6aa97270c0088324a83b4be5e6aa57b8`.

The stream for that still-running turn delivered 13 events before cancellation,
including `turn/started` with `inProgress`, completed user-message and
agent-message items, and five `item/agentMessage/delta` events totalling 19
characters. These deltas arrived while task details still reported
`in_progress`, so live delivery is confirmed independently of completed replay.

The desktop-derived cancellation call was also tested:

```text
POST /wham/tasks/{task_id}/cancel
```

It required no body, returned an object containing `success`, and task details
changed from `in_progress` to `cancelled` on the next poll about one second later.
The SSE request ended cleanly but did not emit a `turn/completed` or explicit
cancellation event in the captured 13 events. An ACP adapter must therefore
verify cancellation through task/turn state when the stream closes, rather than
treating EOF as proof of cancellation.

### L0: existing diff/PR task, read only inspection

Task: `task_e_6aa96f3208508324bb8424e07227d15e`

The existing task's selected assistant turn and `current_diff_task_turn` each
contained output types `message`, `partial_repo_snapshot`, and `pr`. Each exposed
a 193-byte diff payload. The `pr` object had the keys `output_diff`, `pr_message`,
`pr_title`, `pre_apply_patch`, and `type`; no PR URL field was present in that
object. The probe did not print or apply the diff.

The current projection emitted the selected assistant turn twice because the
same logical turn also appeared as `current_diff_task_turn`. A production adapter
must deduplicate by turn ID and payload identity. The prior assistant prose said
a pull request was opened, but the structured response observed here proves only
a `pr` output item and patch metadata. It does not independently prove a remote
PR URL or GitHub PR creation.

## Codex client surfaces

The reviewed Rust Codex cloud client exposes these operations:

- list tasks and read a task summary;
- create one task with its initial prompt;
- read current task text/messages and the current diff;
- list sibling attempts for an assistant turn;
- apply or preflight a returned patch to a local checkout.

That Rust client has no method for a remote event subscription, follow-up turn,
or remote cancellation. The Codex desktop bundle does expose all three, and L4
verified each with the probe's OAuth credentials. We did not guess endpoint names
or payloads. The Rust task-details parser recognizes current user, assistant,
and diff turns, output items, worklog messages, errors, sibling IDs, attempt
placement, and turn status. Those are selected/current views rather than proof
of complete conversation history. The turn mapping and SSE replay provide a
stronger recovery surface that still needs ordering, reconnect and retention
tests before production use.

## Comparison with Cursor and ACP mapping

| ACP behavior | Codex evidence | Cursor adapter comparison | Recommendation |
| --- | --- | --- | --- |
| `initialize` | Local protocol concern | Implemented locally | Advertise only capabilities below |
| `session/new` | Can allocate locally without cloud work | Cursor also creates lazily | Supported locally |
| First `session/prompt` | Task creation and terminal polling work | Cursor creates first run | Supported as one remote task |
| `session/update` text | Authenticated SSE emitted live agent-message deltas | Cursor SSE yields incremental text/thought/tool events | Translate and journal deltas by stable event/item ID |
| Lifecycle updates | `pending`, `in_progress`, terminal status | Cursor has status/result/done events | Keep as provider metadata/UI status, not invented assistant text |
| Tool calls | SSE replay exposed command item lifecycle; exact command output mapping needs fixtures | Cursor exposes typed tool-call events | Map structured items only; never derive calls from prose |
| Diff | Source and live task expose a patch | Cursor emits edit diffs per tool call | Emit a deduplicated terminal artifact only after adding safe projection/journaling |
| PR | `pr` item observed, no URL in inspected object | Cursor exposes branch/PR state and Macro reporter | Treat as patch metadata until a URL is evidenced |
| Prompt failure | Terminal failure shape exists in source, not live-tested | Cursor emits provider error/result | Unknown; add one bounded natural failure fixture before production |
| `session/cancel` | Verified POST changed task from running to cancelled | Cursor has an explicit cancel endpoint | Supported with terminal-state verification after SSE EOF |
| Follow-up prompt | Verified new turns under the same task ID | Cursor opens another run on the same agent | Supported serially using latest selected assistant turn |
| `session/load` | Turn mapping plus completed SSE replay verified | Cursor journals and replays complete events | Add durable journal/replay invariants before advertising |
| MCP forwarding | No task-create field or cloud client operation observed | Cursor accepts remote MCP servers | Unsupported |
| Usage/context | SSE emitted structured token-usage updates; field semantics not yet validated | Cursor adapter avoids inventing context size | Preserve as provider metadata until fields are mapped and tested |

## Result

The evidence now supports the provider primitives for a conversational ACP
adapter:

1. Lazily create one Codex cloud task for the first prompt.
2. Subscribe to SSE and translate agent-message, reasoning, command, usage and
   lifecycle events by their stable IDs.
3. Journal each received event before publishing and deduplicate replay/live
   overlap by event ID.
4. Continue the same task with the verified follow-up request, one turn at a time.
5. Cancel remotely with the verified endpoint, then confirm terminal state via
   task/turn reads if the stream closes without a terminal event.
6. Record terminal patches/artifacts separately, without applying implicitly.
7. Return the ACP prompt response only after a verified terminal provider state.

Task-details polling alone exposed delayed final output, but the separate SSE
surface provides genuine live transcript events. Continuation and cancellation
also work with the saved OAuth login. The remaining work is protocol hardening:
complete event translation, replay ordering and retention, reconnect behavior,
failure fixtures, credential lifecycle, and honest ACP capability advertisement.
Macro should retain the Codex web task link for provider-native inspection.

## Next bounded probes

- Launch one task with source-supported `metadata.best_of_n = 2`, then verify
  sibling IDs, attempt placement, ordering, selected attempt, and per-attempt
  patch/message reads. This requires a deliberate cost decision.
- Capture a naturally terminally failed task when one occurs; do not manufacture
  failure by guessing provider controls.
- Test SSE reconnect during a live turn and after completion: ordering, duplicate
  IDs, retention, truncation, EOF behavior and whether any resume cursor exists.
- Build sanitized fixtures for every desktop-accepted event method, especially
  command output, diffs, plans, errors, reasoning, token usage and cancellation.
- Treat the desktop-derived WHAM API as unpublished until OpenAI provides a
  supported third-party contract; pin compatibility observations and fail closed
  on unknown schemas.
