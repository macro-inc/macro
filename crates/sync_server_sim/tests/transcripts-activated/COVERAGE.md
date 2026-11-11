# Activated operation storage corpus

These 160 synthetic local workerd scenarios run with `chunked-operation-writes`
AND the test-only `transcript` feature. Default-OFF fixtures remain in
`../transcripts`: all 158 have activated counterparts. The common storage audit
is bound to reachable gzip baseline `375078f4849907343e7f7898a7e597d3b747fad1`.
Never enable transcript capture in deployed workers.

`STORAGE_DIFF.json` lists the exact changed fixtures, operations, payload SHA-256,
pre-import and required version vectors for removed duplicates, physical receipt
writes, and dependent read/GC observations. Every wire substream has a matching
SHA-256. No frame bytes, REST responses, alarm schedule, clocks, errors, Loro
payloads or unrelated effects are allowed to change.

Successful inline appends use one atomic `storage.put(entries)` with two values
(pending receipt tuple and unchanged archive), plus original attribution when
present. The storage audit expands this call only at its actual successful
return. It rejects unlisted transactions/failure sidecars rather than guessing.
Failure/repair and chunk transaction plans have separate literal workerd and
native mutation tests. Raw capture preserves every attempt, argument, return,
error and commit; native projection publishes its effect at commit, preserving
premature-ACK detection.

The original 155 fixture entries in `STORAGE_DIFF.json` remain unchanged. Its
158-case audit additionally covers the three application comment-root modes:

- [HTTP gate](comment_marks.test/real_comment_roots_are_accepted_and_content_edits_refused_in_http_mode.jsonl)
- [Native gate](comment_marks.test/real_comment_roots_are_accepted_and_content_edits_refused_in_in_process_mode.jsonl)
- [Shadow gate](comment_marks.test/real_comment_roots_are_accepted_and_content_edits_refused_in_shadow_mode.jsonl)

Each new case has exactly one listed embedded-complete inline write group. Their
wire substreams match the corresponding default fixtures before storage alignment.
Three complete comment-file recordings normalize identically, including all nine
existing activated cases. Run the complete file when recording these cases: a
filtered first test also captures unused beforeAll setup and changes its history.
Do not strip those records to make a filtered capture match.

Two additional pending-dependency scenarios exercise activated fanout; their exact
marker writes and new resolved RemoteUpdate frames are listed by callback,
update, line and byte hash in `resolved-history-ledger.json`:

- [WebSocket parent arrival](resolved_pending.test/joined_reader_receives_a_durable_suffix_when_its_missing_parent_arrives_through_websocket.jsonl.gz)
- [HTTP parent arrival](resolved_pending.test/joined_reader_receives_a_durable_suffix_when_its_missing_parent_arrives_through_http.jsonl.gz)

Both new fixtures replay natively and prove that already-buffered peers import
the resolved delta idempotently. Gzip decoding is lossless; the ledger hashes
refer to the complete decompressed transcript. The writer-OFF suite skips these
activation-only cases and its original 155 recordings remain unchanged.

The native replay allowlist additionally includes these two activated cases.
Passing the common 158-file wire/storage audit does not claim every callback is supported by
native replay. Native replay is selected explicitly with `replay_activated`,
never from recorded output.

From `services/sync-service`:

```sh
just record-activated-transcripts /home/wolf/tmp/sync-activated-record
just diff-activated-transcripts git-activated:HEAD /home/wolf/tmp/sync-activated-record
```

For the common 158-case subset listed in `STORAGE_DIFF.json`, `scripts/audit-activated-transcripts.mjs`
checks exact logical payload bytes after validating the typed receipt,
proves duplicate coverage before import, and compares every remaining event.
Operation IDs are aligned by room/generation/callback and counter only for this
storage-only comparison; the wire comparison runs before that alignment.
The two pending-dependency cases have no default baseline and use their separate scoped ledger;
do not pass an unmatched corpus union to the original storage-only audit.
