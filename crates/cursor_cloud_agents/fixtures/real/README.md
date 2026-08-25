# Recorded Cursor SSE corpus

Each `.sse` file is one Cursor cloud run's stream, **as bytes off the wire**:
`event:`/`data:`/`id:` lines exactly as `api.cursor.com` sent them. Replaying
one therefore exercises the whole inbound path — `sse-core` framing,
`CursorEvent::from_wire` naming, `TranslateMachine` translation — which
fixtures of already-decoded events cannot, since they start downstream of the
stage most likely to break on real traffic.

The sweep tests in `src/replay/test.rs` discover these with `insta::glob!`, so
**adding a fixture means dropping a sanitized file here.** Nothing to register.

## What each one covers

| fixture | covers |
| --- | --- |
| `shell_arithmetic` | one `run_terminal_cmd` call, announced then completed; a clean `FINISHED` run with `result` and `done` |
| `no_tools` | a run that answers directly — thinking and text chunks, no tool calls at all |
| `read_and_search` | five distinct tools in one run (`file_search`, `read_file`, `grep_search`, `get_mcp_tools`, `mcp`), including two calls in flight at once |
| `cancelled` | a real `session/cancel` landing mid-run: `status: CANCELLED` and a terminal `result` that is not `FINISHED` |
| `multi_turn_1`, `multi_turn_2` | two runs of the *same* agent, in order — the follow-up-prompt path, where a second run streams against an existing conversation |
| `thinking_only` | a stream with **no** terminal `result` or `done`, so translation cannot assume it ever sees one |
| `shell_5plus5` | an earlier `run_terminal_cmd` recording, kept as a second sample of the shell path |
| `file_operations` | `edit_file` and `read_file` against real paths — the write/read half of file work |
| `file_edits` | editing an existing file and creating a new one, with the `partial-tool-call` subtype that streams a call's arguments |
| `search_tools` | `file_search`, `grep_search` and `task` (subagent delegation) in one run |
| `web_tools` | `web_fetch` and `web_search` — the only two tools that never carry a typed descriptor |
| `todo_plan` | `todo_write` driving a todo list through to completion |
| `list_and_delete` | `delete_file` plus the `truncated` object that used to destroy a whole tool call |
| `mcp_servers` | an MCP server forwarded from `session/new` (`deepwiki`, HTTP transport) that the agent then enumerates as `ready` — end-to-end proof that forwarding works. Also the only recording of a tool call whose interim frame carries an `error` envelope and which then succeeds |

`thinking_only` and `shell_5plus5` predate raw capture: they were recorded as
decoded `{event, data}` JSONL and mechanically re-framed into SSE. The
framing is therefore synthetic (single `data:` line per record, no `id:`
lines) while the payloads are real. Every other fixture is verbatim wire
bytes.

## Chunk boundaries are deliberately not recorded

A recording is the concatenated bytes, not the read-by-read history. Where a
TCP read happened to split is an artifact of one session rather than a
property of the stream, so instead of preserving one split history the tests
replay every fixture at 1, 3, 17, 64, 997, 8192 and whole-file reads and
require identical results. That covers every boundary the recorded one would
have, and many it would not.

## Recording a new one

```bash
cargo build -p cursor_cloud_agents --bin cursor_cloud_agents
CURSOR_API_KEY=... CURSOR_ACP_RECORD_DIR=recordings/<label> target/debug/cursor_cloud_agents
```

Drive it with any ACP client. Each run lands as
`recordings/<label>/<agent>-<run>.sse`.

**Then sanitize before committing.** A recording carries whatever the run saw
— prompts, file contents, terminal output — any of which can hold a
credential someone pasted or `cat`ed:

```bash
doppler run --project shared_ai --config dev -- \
  ./crates/agent_fold/scripts/sanitize_recording.py \
  recordings/<label>/<file>.sse fixtures/real/<name>.sse
```

That script's two passes (LLM + regex) operate on raw text, so it works on
`.sse` unmodified. It refuses to write if a known-format secret survives.
Skim the result anyway — it reports counts, never values, so a clean report is
not the same as a read file.

Then `cargo test -p cursor_cloud_agents && cargo insta review` to accept the new
fixture's snapshots.

## The tool vocabulary, as observed

Kind classification used to be guesswork: a token matcher over tool names, and
a type table with arms for `write`, `search`, `fetch`, `web`, `move` and
`rename` — none of which Cursor has ever sent. Twelve live sessions produced
exactly this, and the mapping is now nothing but this table:

| `tool_call.name` | `toolCall.type` | ACP kind |
| --- | --- | --- |
| `run_terminal_cmd` | `shell` | Execute |
| `read_file` | `read` | Read |
| `edit_file` | `edit` | Edit |
| `delete_file` | `delete` | Delete |
| `file_search` | `glob` | Search |
| `grep_search` | `grep` | Search |
| `todo_write` | `updateTodos` | Think |
| `task` | `task` | Other |
| `mcp` | `mcp` | Other |
| `get_mcp_tools` | *(never sent)* | Other |
| `web_fetch` | *(never sent)* | Fetch |
| `web_search` | *(never sent)* | Fetch |

Three tools never carry a typed descriptor, so for those the name is the only
signal there will ever be. For the other nine the name and the type must agree,
or every tool call would visibly change category mid-flight when the descriptor
lands — `name_and_type_agree_for_every_paired_tool` pins that.

No `move`/`rename` tool exists: asked to rename a file, the agent reached for
the shell. `ToolKind::Move` is therefore unreachable, which is why nothing maps
to it.

## What the corpus caught

Four bugs, all invisible to hand-written fixtures:

- **A failed tool call read as successful.** Cursor reports tool failure in
  the *result envelope*, never the status word — `read_and_search`'s
  `get_mcp_tools` call failed while reporting `status: "completed"`.
- **The fix for that was then too eager.** `mcp_servers` has a call whose
  interim frame carries an `error` envelope while still `running`, and which
  then completes. So the status word decides *whether* a call is done and the
  envelope decides *how*; neither answers the other's question. It took a
  second real recording to find that, which is the argument for the corpus in
  one line.
- **`truncated` is an object, not a bool.** `list_and_delete` carries
  `"truncated": {"result": true}`. Typed as `bool`, that failed to deserialize
  and took the entire `tool_call` event down with it — the call degraded to
  `CursorEvent::Unknown` and vanished from the client, over a metadata field
  nothing reads.
- **`todo_write` classified as a file edit.** The old token matcher split the
  name and matched `write` against its edit vocabulary. A todo update is not an
  edit; the exact-name table cannot make that mistake.

## Known gaps the corpus documents

- **`todo_write` maps to `ToolKind::Think`, not a plan.** ACP models a todo
  list properly as `SessionUpdate::Plan`, which is where Cursor's `todo_write`
  calls really belong. `Think` is the closest *kind*; translating them into a
  plan update instead changes the shape of a turn rather than a kind mapping,
  so it is follow-up rather than a one-line fix. `todo_plan` is the fixture to
  do it against.
- **`task` and `mcp` map to `ToolKind::Other`.** A subagent delegation is not
  read, write, search or execute, and an MCP call could do anything the server
  offers. `Other` is what ACP has for "none of these" — a decision, not an
  oversight, and `tool_calls_and_their_kinds_are_pinned` will show it changing.
- **Consecutive thinking blocks concatenate.** Cursor marks block ends with
  `interaction_update: thinking-completed`, which is not translated, so two
  separate reasoning blocks arrive as one run of `agent_thought_chunk`s with
  no boundary between them. Visible in `read_and_search`'s transcript
  snapshot.
- **`result` carries a `git` field** (branches the run pushed) that nothing
  models. Not needed for translation today; it is the obvious place to look
  when surfacing "the agent opened this branch" to a client.
