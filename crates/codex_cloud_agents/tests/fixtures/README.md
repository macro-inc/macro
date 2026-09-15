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
