# Codex recordings

`recorded_cloud_turn.json` contains sanitized, desktop-accepted events from a
completed read-only cloud task. It exercises the served ACP byte stream and
snapshot projection.

`missing_live_deltas.json` reproduces two real replies whose SSE text deltas were
incomplete. It retains the observed delta order, duplicate identities, completed
messages, reasoning, commands and command output, and terminal snapshot Markdown.
The first reply is recovered from terminal snapshots; the second also has a
completed message event. The fixture keeps the original user prompt typos.

Sanitization consistently replaces IDs with `record_N`, removes timestamps,
context/mention prefixes, raw-response/log/unrelated-thread records, and snapshot
titles. Snapshot projections are retained with `native: null`; EOF errors are
normalized and journal sequences are reindexed. No credential records are included.
This is a focused reproduction, not an unmodified provider recording.

The missing-delta regression runs through the real ACP server and `agent_fold`.
Its folded snapshot was also rendered in Chromium using the production
`AgentMessage` and `StaticMarkdownContext` components: both assistant replies
appear once, with three headings, thirteen list items, inline code, and no
synthetic correction or final-output wrappers. That browser check uses the
recorded snapshot, not a new live cloud task.

The same recording also has a replacement-enabled ACP/fold snapshot. It checks
every fold prefix, final corrected prose, and repeated replacement loads. A
controlled live runtime test holds a prompt open until the client has received
and folded provisional text, then verifies that a terminal snapshot replaces it.
The WASM/browser check verifies that corrected text keeps the same message and
text-container DOM nodes. Standard ACP clients without the replacement
capability continue to receive complete messages.

`reported_gitkeep_message.md` is transcribed from the user's rendered message,
not a raw provider recording. Its ACP snapshot verifies that the native and
poll-fallback message paths both turn `【F:.gitkeep†L1】` into Markdown inline
code, `.gitkeep:1`, without changing the original provider text. The projected
snapshot is also checked in Chromium with the production message renderer.

`live_text_replacement.jsonl` retains all 236 ACP agent text updates from an
actual read-only cloud smoke test on 2026-09-15, plus its prompt and completion
response. The prompt requested approximately 200 words of tea instructions with
headings, a numbered list, and an emoji, explicitly forbidding tools, file access,
commands, commits, and pull requests. No tool calls were observed. The last text
snapshot corrects the preceding 1,007-character provisional message into the
exact 1,357-character provider answer, including a non-prefix change.

Only session, request, and text-key identifiers were normalized. Timestamps,
initialization, session creation, and the subsequent reload were omitted; text
and text-update order are unchanged. No credentials, private paths, or original
session identifiers are included. The live run's reloaded final text matched
its live answer exactly. `live_stream.rs` folds every retained prefix through
`agent_fold`, checks all updates were visible before completion, and asserts that
one corrected text part contains the final answer without duplication.
