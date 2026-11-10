# Activated operation storage corpus

These 155 synthetic local workerd scenarios run with `chunked-operation-writes`
AND the test-only `transcript` feature. Default-OFF fixtures remain in
`../transcripts`, unchanged from c11b60c31907fa39fe9cb6d1fca5efc29c296b00.
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

The native replay allowlist is exactly the default corpus allowlist. Passing the
155-file wire/storage audit does not claim that every callback is supported by
native replay. Native replay is selected explicitly with `replay_activated`,
never from recorded output.

From `services/sync-service`:

```sh
just record-activated-transcripts /home/wolf/tmp/sync-activated-record
just diff-activated-transcripts git-activated:HEAD /home/wolf/tmp/sync-activated-record
bun scripts/audit-activated-transcripts.mjs ../../crates/sync_server_sim/tests/transcripts /home/wolf/tmp/sync-activated-record /home/wolf/tmp/sync-activated-ledger.json
```

The audit checks exact logical payload bytes after validating the typed receipt,
proves duplicate coverage before import, and compares every remaining event.
Operation IDs are aligned by room/generation/callback and counter only for this
storage-only comparison; the wire comparison runs before that alignment.
