# Native cancellation server cleanup

PR [#6667](https://github.com/macro-inc/macro/pull/6667), commit `8e785ffe4dd00cd52350752907b057cbefa19711`.

A native end during joining now enters the normal leave scope. That cancels the join, disconnects transport, removes server membership, handles cleanup failure/timeout, and preserves a newer native call arriving while cleanup settles. It reuses the same native-end helper as active calls, with `endNativeCall: false`.

## Before/after browser and backend proof

[Video](before-after.mp4) and [assertions](assertions.json). Chrome loads the production lifecycle and native bridge modules against the real isolated local backend. A small event harness supplies native connecting/end snapshots and holds media connection pending, reproducing a hangup after the server token has registered the participant. It compares the previous commit with the fix.

| Observation after native cancellation | Before | After |
| --- | --- | --- |
| Server participants still registered | 1 | 0 |
| Server leave requests | 0 | 1 |
| Transport disconnect requests | 0 | 1 |
| Join completion published | 0 | 0 |

The baseline's orphaned membership was cleaned up after recording its result. Assertions report the active-call lookup separately: this verifies participant removal, not immediate closure of the backend call record. This is a native event harness in Chrome, not a physical iOS device test.

## Checks

- 416 tests pass across channel, block-call, block-channel and machine projects, including 56 focused lifecycle/native tests.
- Eight regression cases failed before the fix; all 56 focused tests pass after. Coverage includes cancellation after token issuance and during connect, duplicate ends, disconnect errors, and replacement native calls across cleanup success/failure/timeout and late connection completion.
- Full frontend type-check, just check, and all five QC roles pass. No new effects or switch statements.
- Browser execution captured no JavaScript page errors.

[Test failures before](tests-before.log), [focused tests after](tests-after.log), [broader tests](tests.log), [types](typecheck.log), [repository checks](check.log), and [revision/video metadata](manifest.json).

The [earlier call review report](../call-review-fixes/README.md) retains the full LiveKit interaction and error-handler recordings.
